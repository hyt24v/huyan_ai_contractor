/** MCP 管理服务：fsPort + mcp.ts 纯逻辑的粘合层 */
import { AGENTS, type AgentId } from '../lib/agents';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  applyJsonServers,
  backupPath,
  emptyManifest,
  mergeIntoManifest,
  parseMcpServersJson,
  planDistribution,
  replaceTomlServers,
  type CentralManifest,
  type CentralServer,
  type McpServerSpec,
} from '../lib/mcp';

const MANIFEST_FILE = '.ai-baogongtou/mcp-central.json';

export interface McpSnapshot {
  manifest: CentralManifest;
  /** 每个 agent 当前实际配置里的 server 名（用于展示差异） */
  perAgent: Partial<Record<AgentId, string[]>>;
  /** 每个 agent 当前实际的 server 规格（用于分发预览 / 漂移检测） */
  current: Partial<Record<AgentId, Record<string, McpServerSpec>>>;
}

async function manifestPath(): Promise<string> {
  return absPath(MANIFEST_FILE);
}

export async function loadManifest(fs: FsPort = tauriFs): Promise<CentralManifest> {
  const p = await manifestPath();
  if (!(await fs.exists(p))) return emptyManifest();
  try {
    const parsed: unknown = JSON.parse(await fs.readText(p));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as CentralManifest).servers)
    ) {
      return parsed as CentralManifest;
    }
  } catch {
    // 损坏时回退空清单
  }
  return emptyManifest();
}

export async function saveManifest(
  manifest: CentralManifest,
  fs: FsPort = tauriFs,
): Promise<void> {
  const p = await manifestPath();
  const dir = p.slice(0, p.lastIndexOf('/'));
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  await fs.writeText(p, JSON.stringify(manifest, null, 2) + '\n');
}

/** 扫描各 agent 配置 → 与现有清单合并（清单已有的保留其 agents 勾选） */
export async function scanMcp(fs: FsPort = tauriFs): Promise<McpSnapshot> {
  const manifest = await loadManifest(fs);
  const scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec>; enabled: Record<string, boolean> }>> = {};
  const perAgent: Partial<Record<AgentId, string[]>> = {};
  const current: Partial<Record<AgentId, Record<string, McpServerSpec>>> = {};
  for (const agent of AGENTS) {
    const p = await absPath(agent.mcpFile);
    if (!(await fs.exists(p))) continue;
    try {
      const text = await fs.readText(p);
      if (agent.mcpFormat === 'json') {
        scans[agent.id] = parseMcpServersJson(text);
      } else {
        scans[agent.id] = parseTomlMcpServers(text);
      }
      perAgent[agent.id] = Object.keys(scans[agent.id]!.servers);
      current[agent.id] = scans[agent.id]!.servers;
    } catch {
      // 单个 agent 配置坏了不影响整体
    }
  }
  // 合并：扫描结果补齐清单缺失的 server，保留清单中的勾选状态
  const merged = mergeIntoManifest(scans, AGENTS.map((a) => a.id));
  const byName = new Map(manifest.servers.map((s) => [s.name, s]));
  const servers: CentralServer[] = merged.servers.map((s) => {
    const existing = byName.get(s.name);
    return existing
      ? { ...s, agents: { ...s.agents, ...existing.agents } }
      : s;
  });
  return { manifest: { servers }, perAgent, current };
}

/** 简单解析 codex config.toml 里的 mcp_servers（只读我们生成的标准形态 + 常见形态） */
export function parseTomlMcpServers(text: string): {
  servers: Record<string, McpServerSpec>;
  enabled: Record<string, boolean>;
} {
  const servers: Record<string, McpServerSpec> = {};
  const enabled: Record<string, boolean> = {};
  const lines = text.split('\n');
  let current: string | null = null;
  let sub: 'env' | 'headers' | null = null;
  const ensure = (name: string): McpServerSpec => {
    if (!servers[name]) servers[name] = { type: 'stdio' };
    return servers[name];
  };
  const unq = (s: string) => s.trim().replace(/^"|"$/g, '');
  for (const line of lines) {
    const hm = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (hm) {
      const path = hm[1].split('.').map(unq);
      if (path[0] === 'mcp_servers' && path.length >= 2) {
        current = path[1];
        sub = path[2] === 'env' ? 'env' : path[2] === 'headers' ? 'headers' : null;
        ensure(current);
      } else {
        current = null;
        sub = null;
      }
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = unq(kv[1]);
    let val = kv[2];
    const spec = ensure(current);
    if (sub === 'env' || sub === 'headers') {
      const map = sub === 'env' ? (spec.env ??= {}) : (spec.headers ??= {});
      map[key] = unq(val);
      continue;
    }
    if (key === 'command') spec.command = unq(val);
    else if (key === 'url') {
      spec.type = 'http';
      spec.url = unq(val);
    } else if (key === 'args') {
      const m = val.match(/\[(.*)\]/);
      if (m) {
        spec.args = m[1]
          .split(',')
          .map((s) => unq(s))
          .filter((s) => s.length > 0);
      }
    } else if (key === 'enabled') {
      enabled[current] = val.trim() !== 'false';
    }
    void val;
  }
  for (const n of Object.keys(servers)) enabled[n] = enabled[n] !== false;
  return { servers, enabled };
}

/** 分发：把清单写回各 agent 配置（写前备份） */
export async function distribute(
  manifest: CentralManifest,
  fs: FsPort = tauriFs,
): Promise<{ written: AgentId[]; errors: Record<string, string> }> {
  const scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec> }>> = {};
  const texts: Partial<Record<AgentId, string>> = {};
  for (const agent of AGENTS) {
    const p = await absPath(agent.mcpFile);
    const text = (await fs.exists(p)) ? await fs.readText(p) : '';
    texts[agent.id] = text;
    scans[agent.id] =
      agent.mcpFormat === 'json'
        ? parseMcpServersJson(text || '{}')
        : parseTomlMcpServers(text);
  }
  const plan = planDistribution(manifest, scans, AGENTS.map((a) => a.id));
  const written: AgentId[] = [];
  const errors: Record<string, string> = {};
  for (const agent of AGENTS) {
    const { updates, removals } = plan[agent.id];
    // 额外：清单里没勾选该 agent、但该 agent 配置里存在且属于清单管理的 server → 移除
    const managed = new Set(manifest.servers.map((s) => s.name));
    for (const name of Object.keys(scans[agent.id]?.servers ?? {})) {
      if (managed.has(name)) {
        const server = manifest.servers.find((s) => s.name === name);
        if (server && !server.agents[agent.id] && !removals.includes(name)) {
          removals.push(name);
        }
      }
    }
    if (Object.keys(updates).length === 0 && removals.length === 0) continue;
    const p = await absPath(agent.mcpFile);
    try {
      const original = texts[agent.id] ?? '';
      // 备份
      if (original.length > 0) {
        await fs.writeText(backupPath(p, new Date()), original);
      }
      const next =
        agent.mcpFormat === 'json'
          ? applyJsonServers(
              original || '{}',
              Object.fromEntries(
                Object.entries(updates).map(([n, s]) => [
                  n,
                  { spec: s, hasEnabledFlag: agent.hasEnabledFlag ?? false },
                ]),
              ),
              removals,
            )
          : replaceTomlServers(original, updates, removals);
      await fs.writeText(p, next);
      written.push(agent.id);
    } catch (e) {
      errors[agent.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return { written, errors };
}
