/** MCP 管理服务：fsPort + mcp.ts 纯逻辑的粘合层 */
import { hasMcpSupport, type AgentDef, type AgentId } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  applyJsonServers,
  backupPath,
  emptyManifest,
  mergeIntoManifest,
  parseMcpServersJson,
  parseTomlMcpServers,
  planDistribution,
  replaceTomlServers,
  sanitizeManifest,
  type CentralManifest,
  type CentralServer,
  type McpServerSpec,
} from '../lib/mcp';

export { parseTomlMcpServers } from '../lib/mcp';

const MANIFEST_FILE = '.ai-baogongtou/mcp-central.json';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 串行化 MCP 写操作：避免与页面刷新 / 定时快照等并发路径互踩 */
let mcpWriteLock: Promise<unknown> = Promise.resolve();
function withMcpLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mcpWriteLock.then(fn, fn);
  mcpWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface McpSnapshot {
  manifest: CentralManifest;
  /** 每个 agent 当前实际的 server 规格（用于分发预览 / 漂移检测） */
  current: Partial<Record<AgentId, Record<string, McpServerSpec>>>;
  /** 已安装（配置目录或配置文件存在）的 agent；未安装的不参与漂移/分发 */
  installed: AgentId[];
}

/** 参与 MCP 管理的 agent:可见性开启且已知 MCP 配置路径 */
function mcpAgents(): AgentDef[] {
  return effectiveAgents().filter(hasMcpSupport);
}

/** 判断 agent 是否已安装：配置文件存在，或其配置目录（skillsDir 的父级）存在 */
async function isAgentInstalled(agent: AgentDef, fs: FsPort): Promise<boolean> {
  if (agent.mcpFile) {
    const cfg = await absPath(agent.mcpFile);
    if (await fs.exists(cfg)) return true;
  }
  const dir = await absPath(agent.skillsDir.split('/').slice(0, -1).join('/'));
  return fs.exists(dir);
}

/** 检测本机已安装的 agent(只含支持 MCP 管理的可见 agent) */
export async function detectInstalledAgents(fs: FsPort = tauriFs): Promise<AgentId[]> {
  const out: AgentId[] = [];
  for (const agent of mcpAgents()) {
    if (await isAgentInstalled(agent, fs)) out.push(agent.id);
  }
  return out;
}

async function manifestPath(): Promise<string> {
  return absPath(MANIFEST_FILE);
}

export async function loadManifest(fs: FsPort = tauriFs): Promise<CentralManifest> {
  const p = await manifestPath();
  if (!(await fs.exists(p))) return emptyManifest();
  try {
    const parsed: unknown = JSON.parse(await fs.readText(p));
    // 逐条校验，丢弃畸形条目（手改/旧格式不直接透传到页面）
    return sanitizeManifest(parsed);
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
  const current: Partial<Record<AgentId, Record<string, McpServerSpec>>> = {};
  for (const agent of mcpAgents()) {
    const p = await absPath(agent.mcpFile!);
    if (!(await fs.exists(p))) continue;
    try {
      const text = await fs.readText(p);
      if (agent.mcpFormat === 'json') {
        scans[agent.id] = parseMcpServersJson(text, {
          rootKey: agent.mcpRootKey,
          specStyle: agent.mcpSpecStyle,
        });
      } else {
        scans[agent.id] = parseTomlMcpServers(text);
      }
      current[agent.id] = scans[agent.id]!.servers;
    } catch {
      // 单个 agent 配置坏了不影响整体
    }
  }
  // 合并：扫描结果补齐清单缺失的 server，保留清单中的勾选状态
  const merged = mergeIntoManifest(scans, mcpAgents().map((a) => a.id));
  const byName = new Map(manifest.servers.map((s) => [s.name, s]));
  const servers: CentralServer[] = merged.servers.map((s) => {
    const existing = byName.get(s.name);
    return existing
      ? { ...s, agents: { ...s.agents, ...existing.agents } }
      : s;
  });
  return { manifest: { servers }, current, installed: await detectInstalledAgents(fs) };
}

/** 每个配置文件最多保留的 .bak 份数（快照体系之外的轻量兜底，防只增不减） */
const BAK_KEEP = 5;

/** 清理 target 旁边的 .bak.<时间戳>，只保留最新 BAK_KEEP 份。
 * 注意：FsPort.readDir 过滤点开头条目，$HOME 下 .claude.json.bak.* 这类不可见，
 * 只能清理目录内非隐藏的 .bak（如 .codex/config.toml.bak.*）。 */
async function pruneBakFiles(fs: FsPort, target: string): Promise<void> {
  const slash = target.lastIndexOf('/');
  if (slash < 0) return;
  const dir = target.slice(0, slash);
  const base = target.slice(slash + 1);
  try {
    const baks = (await fs.readDir(dir))
      .filter((e) => !e.isDirectory && e.name.startsWith(`${base}.bak.`))
      .map((e) => e.name)
      .sort();
    for (const old of baks.slice(0, Math.max(0, baks.length - BAK_KEEP))) {
      await fs.remove(`${dir}/${old}`).catch(() => undefined);
    }
  } catch {
    // 清理失败不影响分发
  }
}

/** 分发：把清单写回各 agent 配置（写前备份）；未安装的 agent 跳过并计入 skipped。
 * 单个 agent 读取/解析/写入失败只记入 errors，不中断整单。 */
export async function distribute(
  manifest: CentralManifest,
  fs: FsPort = tauriFs,
): Promise<{ written: AgentId[]; skipped: AgentId[]; errors: Record<string, string> }> {
  return withMcpLock(async () => {
    const agents = mcpAgents();
    const installed = new Set(await detectInstalledAgents(fs));
    const skipped = agents.filter((a) => !installed.has(a.id)).map((a) => a.id);
    const errors: Record<string, string> = {};
    const scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec> }>> = {};
    const texts: Partial<Record<AgentId, string>> = {};
    // 预读：单个 agent 读取失败记入 errors 并跳过，不冲出整个函数
    for (const agent of agents) {
      if (!installed.has(agent.id)) continue;
      try {
        const p = await absPath(agent.mcpFile!);
        const text = (await fs.exists(p)) ? await fs.readText(p) : '';
        texts[agent.id] = text;
        scans[agent.id] =
          agent.mcpFormat === 'json'
            ? parseMcpServersJson(text || '{}', {
                rootKey: agent.mcpRootKey,
                specStyle: agent.mcpSpecStyle,
              })
            : parseTomlMcpServers(text);
      } catch (e) {
        errors[agent.id] = `读取配置失败：${errMsg(e)}`;
      }
    }
    const plan = planDistribution(manifest, scans, agents.map((a) => a.id));
    const written: AgentId[] = [];
    for (const agent of agents) {
      if (!installed.has(agent.id) || errors[agent.id]) continue;
      const { updates, removals } = plan[agent.id];
      if (Object.keys(updates).length === 0 && removals.length === 0) continue;
      const p = await absPath(agent.mcpFile!);
      // 配置父目录可能不存在（如 ~/.kiro/settings、VS Code globalStorage），先补建
      const parent = p.slice(0, p.lastIndexOf('/'));
      if (!(await fs.exists(parent))) await fs.mkdir(parent);
      try {
        const original = texts[agent.id] ?? '';
        // TOCTOU 防护：写入前再读一次，预读后被外部改动则跳过
        const latest = (await fs.exists(p)) ? await fs.readText(p) : '';
        if (latest !== original) {
          errors[agent.id] = '配置在分发期间被外部修改，已跳过（请刷新后重试）';
          continue;
        }
        // 先计算新内容（原文件 JSON 损坏会在这里抛错），成功后才备份/写入
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
                { rootKey: agent.mcpRootKey, specStyle: agent.mcpSpecStyle },
              )
            : replaceTomlServers(original, updates, removals);
        // 备份
        if (original.length > 0) {
          await fs.writeText(backupPath(p, new Date()), original);
          await pruneBakFiles(fs, p);
        }
        await fs.writeText(p, next);
        written.push(agent.id);
      } catch (e) {
        errors[agent.id] = errMsg(e);
      }
    }
    return { written, skipped, errors };
  });
}
