/** 规则库数据模型与纯逻辑：中心库 ~/.ai-baogongtou/rules/，以软链引用到各 agent 的项目级规则文件（AGENTS.md 等） */
import type { AgentId } from './agents';
import { promptTargetFile, PROMPT_TARGETS } from './agentTargets';

export interface RuleEntry {
  id: string;
  name: string;
  /** Markdown 内容（中心库唯一事实源） */
  content: string;
  tags: string[];
  description: string;
  /** 各 agent 是否启用（软链到该 agent 的规则文件） */
  agents: Partial<Record<AgentId, boolean>>;
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
  const now = new Date().toISOString();
  return {
    id: r.id ?? '',
    name: r.name ?? '',
    content: r.content ?? '',
    tags: (r.tags ?? []).map((t) => String(t).trim()).filter(Boolean),
    description: r.description ?? '',
    agents,
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
