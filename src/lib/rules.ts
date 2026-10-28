/** 规则库数据模型与纯逻辑：中心库 ~/.ai-baogongtou/rules/，以软链引用到各 agent 的项目级规则文件（AGENTS.md 等） */
import type { AgentId } from './agents';
import { promptTargetFile, PROMPT_TARGETS } from './agentTargets';

/** 一个历史版本的元信息（快照文件在 rules/<id>.history/<versionId>.md） */
export interface RuleVersionMeta {
  /** 版本 id（= 快照时的 ISO 时间戳，可排序） */
  id: string;
  createdAt: string;
  /** 内容大小（字符数） */
  size: number;
  /** 内容首个非空行（预览用） */
  preview: string;
}

/** agent 链接的同步状态：记录该 agent 当前软链对应的是哪个版本 */
export interface RuleSyncState {
  version: string;
  at: string;
}

export interface RuleEntry {
  id: string;
  name: string;
  /** Markdown 内容（中心库唯一事实源） */
  content: string;
  tags: string[];
  description: string;
  /** 各 agent 是否启用（软链到该 agent 的规则文件） */
  agents: Partial<Record<AgentId, boolean>>;
  /** 历史版本（按时间升序；当前内容即最新一版） */
  versions: RuleVersionMeta[];
  /** 各 agent 链接当前对应的版本 */
  syncs: Partial<Record<AgentId, RuleSyncState>>;
  createdAt: string;
  updatedAt: string;
}

export interface RulesLibrary {
  version: number;
  rules: RuleEntry[];
}

export function emptyRulesLibrary(): RulesLibrary {
  return { version: 1, rules: [] };
}

const AGENT_ID_RE = /^[a-z0-9_]+$/;

export function normalizeRule(r: Partial<RuleEntry>): RuleEntry {
  const agents: Partial<Record<AgentId, boolean>> = {};
  for (const [k, v] of Object.entries(r.agents ?? {})) {
    if (AGENT_ID_RE.test(k) && typeof v === 'boolean') agents[k as AgentId] = v;
  }
  const versions: RuleVersionMeta[] = [];
  for (const v of Array.isArray(r.versions) ? r.versions : []) {
    if (!v || typeof v !== 'object') continue;
    const m = v as Partial<RuleVersionMeta>;
    if (typeof m.id === 'string' && typeof m.createdAt === 'string') {
      versions.push({
        id: m.id,
        createdAt: m.createdAt,
        size: typeof m.size === 'number' ? m.size : 0,
        preview: typeof m.preview === 'string' ? m.preview : '',
      });
    }
  }
  const syncs: Partial<Record<AgentId, RuleSyncState>> = {};
  for (const [k, v] of Object.entries(r.syncs ?? {})) {
    if (!AGENT_ID_RE.test(k)) continue;
    if (v && typeof v === 'object' && typeof (v as RuleSyncState).version === 'string') {
      syncs[k as AgentId] = {
        version: (v as RuleSyncState).version,
        at: typeof (v as RuleSyncState).at === 'string' ? (v as RuleSyncState).at : '',
      };
    }
  }
  const now = new Date().toISOString();
  return {
    id: r.id ?? '',
    name: r.name ?? '',
    content: r.content ?? '',
    tags: (r.tags ?? []).map((t) => String(t).trim()).filter(Boolean),
    description: r.description ?? '',
    agents,
    versions,
    syncs,
    createdAt: r.createdAt ?? now,
    updatedAt: r.updatedAt ?? now,
  };
}

export function parseRulesLibrary(text: string): RulesLibrary {
  const raw = JSON.parse(text) as { version?: number; rules?: Partial<RuleEntry>[] };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) {
    throw new Error('规则库文件格式不正确');
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    rules: raw.rules.map(normalizeRule).filter((r) => r.id && r.name),
  };
}

export function serializeRulesLibrary(lib: RulesLibrary): string {
  return JSON.stringify({ version: 1, rules: lib.rules }, null, 2) + '\n';
}

/** 中心库内的规则文件名：id 清洗后 + .md */
export function ruleCentralFileName(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${clean}.md`;
}

export interface RuleTarget {
  agent: AgentId;
  /** 目标文件（相对 $HOME） */
  file: string;
  enabled: boolean;
}

/** 规则在各 agent 下的目标文件（file 为 null 的不可写 agent 直接跳过） */
export function ruleTargetFiles(rule: RuleEntry): RuleTarget[] {
  const out: RuleTarget[] = [];
  for (const t of PROMPT_TARGETS) {
    if (!t.writable || !t.file) continue;
    out.push({
      agent: t.agent,
      file: promptTargetFile(t.agent),
      enabled: rule.agents[t.agent] === true,
    });
  }
  return out;
}

/** 规则文件模板（新建时的默认骨架） */
export const RULE_FILE_TEMPLATES: Record<string, string> = {
  claude: '# CLAUDE.md\n\n## 项目约定\n\n- \n',
  codex: '# AGENTS.md\n\n## 项目约定\n\n- \n',
  gemini: '# GEMINI.md\n\n## 项目约定\n\n- \n',
};

/** 版本在列表中的序号（v1、v2…，按时间升序）；找不到返回 null */
export function ruleVersionNumber(rule: RuleEntry, versionId: string): number | null {
  const idx = rule.versions.findIndex((v) => v.id === versionId);
  return idx >= 0 ? idx + 1 : null;
}

/** 规则的当前版本 id（最新一版；无历史则 null） */
export function currentVersionId(rule: RuleEntry): string | null {
  return rule.versions.length > 0 ? rule.versions[rule.versions.length - 1].id : null;
}

/** 历史快照文件名：rules/<id>.history/<versionId 清洗>.md */
export function ruleHistoryRelPath(ruleId: string, versionId: string): string {
  const clean = ruleId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const vid = versionId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  return `${clean}.history/${vid}.md`;
}

/** 从内容生成版本元信息 */
export function versionMetaOf(content: string, at: string): RuleVersionMeta {
  const firstLine = content.split('\n').find((l) => l.trim()) ?? '';
  return {
    id: at,
    createdAt: at,
    size: content.length,
    preview: firstLine.trim().slice(0, 60),
  };
}
