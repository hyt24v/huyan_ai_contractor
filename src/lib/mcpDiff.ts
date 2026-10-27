/**
 * MCP 分发差异计算（纯逻辑，不碰文件系统，可单测）。
 *
 * 与 `planDistribution` 的语义保持一致：
 * - 清单里勾选了某个 agent 的 server → 写入/更新
 * - 清单里存在但没勾选该 agent 的 server，且该 agent 配置里存在 → 移除
 * - 该 agent 配置里存在、但清单里没有的 server → 不纳入管理（untracked），不动它
 */
import { AGENTS, type AgentDef, type AgentId } from './agents';
import { canonicalSpec, fieldEntries } from './mcp';
import type { CentralManifest, CentralServer, McpServerSpec } from './mcp';

// 等价比较逻辑在 mcp.ts（planDistribution 复用，保持同一事实源），此处仅转发
export { canonicalSpec, fieldEntries } from './mcp';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffLine {
  kind: 'added' | 'removed' | 'changed' | 'context';
  text: string;
}

export interface ServerDiff {
  name: string;
  status: DiffStatus;
  /** 字段级差异行；unchanged 为空数组 */
  lines: DiffLine[];
}

export interface AgentDiff {
  agent: AgentId;
  /** agent 展示名，如 Claude Code */
  name: string;
  /** MCP 配置文件（相对 $HOME） */
  file: string;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
  /** 存在于该 agent 配置、但不在中央清单里的 server（本次不会改动） */
  untracked: string[];
  servers: ServerDiff[];
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** 有变更的 agent 数量 */
  changedAgents: number;
  hasChanges: boolean;
}

export interface McpDiff {
  perAgent: AgentDiff[];
  summary: DiffSummary;
}

/** 各 agent 当前实际配置里的 server 规格 */
export type PerAgentServers = Partial<Record<AgentId, Record<string, McpServerSpec>>>;

/** 从中央清单条目里取出可下发的规格（去掉 name / agents） */
export function specOf(server: CentralServer): McpServerSpec {
  return server.type === 'http'
    ? {
        type: 'http',
        ...(server.url !== undefined ? { url: server.url } : {}),
        ...(server.headers ? { headers: server.headers } : {}),
      }
    : {
        type: 'stdio',
        ...(server.command !== undefined ? { command: server.command } : {}),
        ...(server.args ? { args: server.args } : {}),
        ...(server.env ? { env: server.env } : {}),
      };
}

/** 两个规格之间的字段级差异行 */
export function diffServerLines(
  current: McpServerSpec | undefined,
  desired: McpServerSpec | undefined,
): DiffLine[] {
  if (!current && !desired) return [];
  if (!current) {
    return fieldEntries(desired as McpServerSpec).map(([k, v]) => ({
      kind: 'added' as const,
      text: `${k}: ${v}`,
    }));
  }
  if (!desired) {
    return fieldEntries(current).map(([k, v]) => ({
      kind: 'removed' as const,
      text: `${k}: ${v}`,
    }));
  }
  const cur = new Map(fieldEntries(current));
  const des = new Map(fieldEntries(desired));
  const keys = [...new Set([...des.keys(), ...cur.keys()])];
  const lines: DiffLine[] = [];
  for (const key of keys) {
    const c = cur.get(key);
    const d = des.get(key);
    if (c !== undefined && d !== undefined) {
      lines.push(
        c === d
          ? { kind: 'context', text: `${key}: ${c}` }
          : { kind: 'changed', text: `${key}: ${c} → ${d}` },
      );
    } else if (d !== undefined) {
      lines.push({ kind: 'added', text: `${key}: ${d}` });
    } else if (c !== undefined) {
      lines.push({ kind: 'removed', text: `${key}: ${c}` });
    }
  }
  return lines;
}

/**
 * 计算中央清单（期望状态）与各 agent 当前配置（现状）之间的差异。
 */
export function computeMcpDiff(
  manifest: CentralManifest,
  current: PerAgentServers,
  agents: AgentDef[] = AGENTS,
): McpDiff {
  const managed = new Map(manifest.servers.map((s) => [s.name, s]));
  const perAgent: AgentDiff[] = [];

  for (const agent of agents) {
    const cur = current[agent.id] ?? {};
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const unchanged: string[] = [];
    const untracked: string[] = [];
    const servers: ServerDiff[] = [];

    for (const server of manifest.servers) {
      if (server.agents[agent.id] !== true) continue;
      const desired = specOf(server);
      const existing = cur[server.name];
      if (!existing) {
        added.push(server.name);
        servers.push({
          name: server.name,
          status: 'added',
          lines: diffServerLines(undefined, desired),
        });
      } else if (canonicalSpec(existing) === canonicalSpec(desired)) {
        unchanged.push(server.name);
        servers.push({ name: server.name, status: 'unchanged', lines: [] });
      } else {
        changed.push(server.name);
        servers.push({
          name: server.name,
          status: 'changed',
          lines: diffServerLines(existing, desired),
        });
      }
    }

    for (const name of Object.keys(cur).sort((a, b) => a.localeCompare(b))) {
      const server = managed.get(name);
      if (!server) {
        untracked.push(name);
        continue;
      }
      if (server.agents[agent.id] === true) continue;
      removed.push(name);
      servers.push({
        name,
        status: 'removed',
        lines: diffServerLines(cur[name], undefined),
      });
    }

    perAgent.push({
      agent: agent.id,
      name: agent.name,
      file: agent.mcpFile ?? '',
      added,
      removed,
      changed,
      unchanged,
      untracked,
      servers,
    });
  }

  const summary = perAgent.reduce<DiffSummary>(
    (acc, a) => {
      acc.added += a.added.length;
      acc.removed += a.removed.length;
      acc.changed += a.changed.length;
      acc.unchanged += a.unchanged.length;
      if (a.added.length + a.removed.length + a.changed.length > 0) acc.changedAgents += 1;
      return acc;
    },
    { added: 0, removed: 0, changed: 0, unchanged: 0, changedAgents: 0, hasChanges: false },
  );
  summary.hasChanges = summary.added + summary.removed + summary.changed > 0;
  return { perAgent, summary };
}

/** 人类可读的分发预览摘要（用于 toast / 日志 / 测试） */
export function formatDiff(diff: McpDiff): string {
  const { summary } = diff;
  const head = `共 ${summary.added + summary.removed + summary.changed} 项变更：新增 ${summary.added}，移除 ${summary.removed}，修改 ${summary.changed}，未变化 ${summary.unchanged}`;
  const lines = diff.perAgent
    .filter((a) => a.added.length + a.removed.length + a.changed.length > 0)
    .map((a) => {
      const parts: string[] = [];
      if (a.added.length > 0) parts.push(`新增 ${a.added.join('、')}`);
      if (a.removed.length > 0) parts.push(`移除 ${a.removed.join('、')}`);
      if (a.changed.length > 0) parts.push(`修改 ${a.changed.join('、')}`);
      return `${a.name}（${a.file}）：${parts.join('；')}`;
    });
  return [head, ...lines].join('\n');
}