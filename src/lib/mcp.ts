/** MCP 统一管理的纯逻辑（不碰文件系统，可单测） */
import type { AgentId } from './agents';

/** 一个 MCP server 的规格（各 agent 配置的公共子集） */
export interface McpServerSpec {
  type: 'stdio' | 'http';
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http */
  url?: string;
  headers?: Record<string, string>;
}

/** 中央清单里的一条：规格 + 启用到哪些 agent */
export interface CentralServer extends McpServerSpec {
  name: string;
  agents: Partial<Record<AgentId, boolean>>;
}

export interface CentralManifest {
  servers: CentralServer[];
}

export const emptyManifest = (): CentralManifest => ({ servers: [] });

// ---------- 从 agent 配置解析 ----------

/** 解析单个 agent 配置里的 mcpServers 对象，返回 name → spec 与 name → enabled(pi) */
export function parseMcpServersJson(text: string): {
  servers: Record<string, McpServerSpec>;
  enabled: Record<string, boolean>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { servers: {}, enabled: {} };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { servers: {}, enabled: {} };
  }
  const root = parsed as Record<string, unknown>;
  const mcp = root.mcpServers;
  if (typeof mcp !== 'object' || mcp === null) return { servers: {}, enabled: {} };
  const servers: Record<string, McpServerSpec> = {};
  const enabled: Record<string, boolean> = {};
  for (const [name, raw] of Object.entries(mcp as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const spec: McpServerSpec = r.url
      ? {
          type: 'http',
          url: String(r.url),
          ...(r.headers ? { headers: r.headers as Record<string, string> } : {}),
        }
      : {
          type: 'stdio',
          ...(r.command ? { command: String(r.command) } : {}),
          ...(Array.isArray(r.args) ? { args: r.args.map(String) } : {}),
          ...(r.env ? { env: r.env as Record<string, string> } : {}),
        };
    servers[name] = spec;
    enabled[name] = r.enabled !== false;
  }
  return { servers, enabled };
}

/** 把各 agent 扫到的 server 合并成中央清单 */
export function mergeIntoManifest(
  scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec>; enabled: Record<string, boolean> }>>,
  agentIds: AgentId[],
): CentralManifest {
  const names = new Set<string>();
  for (const id of agentIds) {
    const scan = scans[id];
    if (scan) for (const n of Object.keys(scan.servers)) names.add(n);
  }
  const servers: CentralServer[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    // 取第一个扫到的规格作为基准
    let spec: McpServerSpec = { type: 'stdio' };
    const agents: Partial<Record<AgentId, boolean>> = {};
    for (const id of agentIds) {
      const scan = scans[id];
      if (!scan) continue;
      if (scan.servers[name]) {
        if (Object.keys(spec).length <= 1) spec = scan.servers[name];
        agents[id] = scan.enabled[name] !== false;
      }
    }
    servers.push({ name, ...spec, agents });
  }
  return { servers };
}

// ---------- 写回 agent 配置 ----------

/** 生成单个 server 在 JSON 配置中的条目（pi 额外写 enabled） */
export function specToJsonEntry(
  spec: McpServerSpec,
  hasEnabledFlag: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    spec.type === 'http'
      ? {
          type: 'http',
          url: spec.url,
          ...(spec.headers ? { headers: spec.headers } : {}),
        }
      : {
          type: 'stdio',
          ...(spec.command ? { command: spec.command } : {}),
          ...(spec.args ? { args: spec.args } : {}),
          ...(spec.env ? { env: spec.env } : {}),
        };
  if (hasEnabledFlag) base.enabled = true;
  return base;
}

/**
 * 修改 JSON 配置文本的 mcpServers 节：应用 updates、删除 removals，保留其他键。
 */
export function applyJsonServers(
  originalText: string,
  updates: Record<string, { spec: McpServerSpec; hasEnabledFlag: boolean }>,
  removals: string[],
): string {
  let root: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(originalText);
    if (typeof parsed === 'object' && parsed !== null) {
      root = parsed as Record<string, unknown>;
    }
  } catch {
    // 原文件非法时从空对象开始
  }
  const mcp: Record<string, unknown> =
    typeof root.mcpServers === 'object' && root.mcpServers !== null
      ? { ...(root.mcpServers as Record<string, unknown>) }
      : {};
  for (const name of removals) delete mcp[name];
  for (const [name, { spec, hasEnabledFlag }] of Object.entries(updates)) {
    mcp[name] = specToJsonEntry(spec, hasEnabledFlag);
  }
  root.mcpServers = mcp;
  return JSON.stringify(root, null, 2) + '\n';
}

// ---------- Codex TOML 外科手术 ----------

/** TOML 字符串转义（basic string） */
export function tomlStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 解析 TOML 节头行，返回点分路径段（处理引号）；非节头返回 null */
export function parseTomlHeader(line: string): string[] | null {
  const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
  if (!m) return null;
  const inner = m[1];
  const segs: string[] = [];
  let cur = '';
  let inQuote = false;
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') {
      inQuote = !inQuote;
      quoted = true;
    } else if (ch === '.' && !inQuote) {
      segs.push(quoted ? cur : cur.trim());
      cur = '';
      quoted = false;
    } else {
      cur += ch;
    }
  }
  segs.push(quoted ? cur : cur.trim());
  return segs;
}

/** 生成一个 server 的 TOML 段（codex 无 type 字段，有 url 即 http） */
export function serverToToml(name: string, spec: McpServerSpec): string {
  const qName = tomlStr(name);
  const lines: string[] = [`[mcp_servers.${qName}]`];
  if (spec.type === 'http') {
    if (spec.url) lines.push(`url = ${tomlStr(spec.url)}`);
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      lines.push('', `[mcp_servers.${qName}.headers]`);
      for (const [k, v] of Object.entries(spec.headers)) {
        lines.push(`${tomlStr(k)} = ${tomlStr(v)}`);
      }
    }
  } else {
    if (spec.command) lines.push(`command = ${tomlStr(spec.command)}`);
    if (spec.args && spec.args.length > 0) {
      lines.push(`args = [${spec.args.map(tomlStr).join(', ')}]`);
    }
    if (spec.env && Object.keys(spec.env).length > 0) {
      lines.push('', `[mcp_servers.${qName}.env]`);
      for (const [k, v] of Object.entries(spec.env)) {
        lines.push(`${tomlStr(k)} = ${tomlStr(v)}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Codex config.toml 外科手术：
 * 移除属于 removals/updates 名字的 mcp_servers.* 段，其余原样保留（注释不丢），
 * 新的 server 段追加到文件末尾。
 */
export function replaceTomlServers(
  originalText: string,
  updates: Record<string, McpServerSpec>,
  removals: string[],
): string {
  const drop = new Set([...removals, ...Object.keys(updates)]);
  const lines = originalText.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const path = parseTomlHeader(line);
    if (path) {
      skipping =
        path.length >= 2 &&
        path[0] === 'mcp_servers' &&
        drop.has(path[1]);
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  // 去掉尾部多余空行后追加新段
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  const blocks = Object.entries(updates).map(([n, s]) => serverToToml(n, s));
  const body = out.join('\n');
  if (blocks.length === 0) return body + '\n';
  return body + '\n\n' + blocks.join('\n\n') + '\n';
}

// ---------- 分发计算 ----------

/** 对比中央清单与现状，算出每个 agent 的 updates/removals */
export function planDistribution(
  manifest: CentralManifest,
  scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec> }>>,
  agentIds: AgentId[],
): Record<AgentId, { updates: Record<string, McpServerSpec>; removals: string[] }> {
  const plan = {} as Record<AgentId, { updates: Record<string, McpServerSpec>; removals: string[] }>;
  for (const id of agentIds) {
    const updates: Record<string, McpServerSpec> = {};
    const removals: string[] = [];
    const current = scans[id]?.servers ?? {};
    // 清单中勾选该 agent 的 → 写入/更新
    for (const server of manifest.servers) {
      if (!server.agents[id]) continue;
      const spec: McpServerSpec =
        server.type === 'http'
          ? {
              type: 'http',
              ...(server.url ? { url: server.url } : {}),
              ...(server.headers ? { headers: server.headers } : {}),
            }
          : {
              type: 'stdio',
              ...(server.command ? { command: server.command } : {}),
              ...(server.args ? { args: server.args } : {}),
              ...(server.env ? { env: server.env } : {}),
            };
      if (JSON.stringify(current[server.name]) !== JSON.stringify(spec)) {
        updates[server.name] = spec;
      }
    }
    plan[id] = { updates, removals };
  }
  return plan;
}

/** 备份文件名：xxx.bak.<yyyymmdd-hhmmss> */
export function backupPath(path: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${path}.bak.${ts}`;
}
