/** 提示词库的纯逻辑（不碰文件系统，可单测） */
import { AGENTS, type AgentId } from './agents';

export interface PromptEntry {
  id: string;
  name: string;
  content: string;
  description?: string;
  /** ISO 时间 */
  updatedAt: string;
}

export interface PromptLibrary {
  prompts: PromptEntry[];
  /** 每个 agent 当前启用的提示词 id */
  active: Partial<Record<AgentId, string>>;
}

export interface PromptDraft {
  name: string;
  content: string;
  description?: string;
}

export interface PromptValidation {
  ok: boolean;
  errors: string[];
}

export interface PromptWriteOptions {
  id?: string;
  now?: Date;
}

export const emptyPromptLibrary = (): PromptLibrary => ({ prompts: [], active: {} });

const AGENT_IDS = AGENTS.map((a) => a.id);
const isAgentId = (v: string): v is AgentId => (AGENT_IDS as string[]).includes(v);

/** 名称/内容都必填（内容允许首尾空白，但不能只有空白） */
export function validatePromptDraft(draft: PromptDraft): PromptValidation {
  const errors: string[] = [];
  if (!draft.name || draft.name.trim().length === 0) errors.push('提示词名称不能为空');
  if (!draft.content || draft.content.trim().length === 0) errors.push('提示词内容不能为空');
  return { ok: errors.length === 0, errors };
}

let seq = 0;

/** 生成提示词 id；opts.id 可注入固定值（测试 / 导入） */
export function newPromptId(): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `prompt_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

function assertValid(draft: PromptDraft): void {
  const v = validatePromptDraft(draft);
  if (!v.ok) throw new Error(v.errors.join('；'));
}

function entryFromDraft(
  draft: PromptDraft,
  id: string,
  updatedAt: string,
): PromptEntry {
  return {
    id,
    name: draft.name.trim(),
    content: draft.content,
    ...(draft.description && draft.description.trim().length > 0
      ? { description: draft.description.trim() }
      : {}),
    updatedAt,
  };
}

export function findPrompt(lib: PromptLibrary, id: string): PromptEntry | undefined {
  return lib.prompts.find((p) => p.id === id);
}

/** 新增提示词；名称/内容不合法时抛错 */
export function addPrompt(
  lib: PromptLibrary,
  draft: PromptDraft,
  opts: PromptWriteOptions = {},
): { library: PromptLibrary; prompt: PromptEntry } {
  void assertValid(draft);
  const now = opts.now ?? new Date();
  const prompt = entryFromDraft(draft, opts.id ?? newPromptId(), now.toISOString());
  return { library: { ...lib, prompts: [...lib.prompts, prompt] }, prompt };
}

/** 更新提示词（不传的字段保持原值）；不存在或校验失败时抛错 */
export function updatePrompt(
  lib: PromptLibrary,
  id: string,
  patch: Partial<PromptDraft>,
  now: Date = new Date(),
): PromptLibrary {
  const current = findPrompt(lib, id);
  if (!current) throw new Error(`提示词不存在: ${id}`);
  const merged: PromptDraft = {
    name: patch.name ?? current.name,
    content: patch.content ?? current.content,
    description: patch.description ?? current.description,
  };
  assertValid(merged);
  const next = entryFromDraft(merged, id, now.toISOString());
  return {
    ...lib,
    prompts: lib.prompts.map((p) => (p.id === id ? next : p)),
  };
}

/** 删除提示词，并清掉引用它的 active 映射 */
export function removePrompt(lib: PromptLibrary, id: string): PromptLibrary {
  const active: Partial<Record<AgentId, string>> = {};
  for (const [agent, promptId] of Object.entries(lib.active) as [AgentId, string][]) {
    if (promptId !== id) active[agent] = promptId;
  }
  return { prompts: lib.prompts.filter((p) => p.id !== id), active };
}

/** 复制提示词，名称自动加「副本」（重名时加序号） */
export function duplicatePrompt(
  lib: PromptLibrary,
  id: string,
  opts: PromptWriteOptions = {},
): { library: PromptLibrary; prompt: PromptEntry } {
  const source = findPrompt(lib, id);
  if (!source) throw new Error(`提示词不存在: ${id}`);
  const now = opts.now ?? new Date();
  const prompt = entryFromDraft(
    {
      name: nextAvailableName(
        `${source.name} 副本`,
        lib.prompts.map((p) => p.name),
      ),
      content: source.content,
      ...(source.description ? { description: source.description } : {}),
    },
    opts.id ?? newPromptId(),
    now.toISOString(),
  );
  return { library: { ...lib, prompts: [...lib.prompts, prompt] }, prompt };
}

/** 名称去重：base、base 2、base 3 … */
export function nextAvailableName(base: string, taken: string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

/** 某 agent 当前启用的提示词（active 指向已删除的 id 时返回 undefined） */
export function activeForAgent(lib: PromptLibrary, agent: AgentId): PromptEntry | undefined {
  const id = lib.active[agent];
  return id ? findPrompt(lib, id) : undefined;
}

/** 设置/清除某 agent 的启用提示词；传 null 表示清除 */
export function setActivePrompt(
  lib: PromptLibrary,
  agent: AgentId,
  promptId: string | null,
): PromptLibrary {
  const active = { ...lib.active };
  if (promptId === null) {
    delete active[agent];
  } else {
    if (!findPrompt(lib, promptId)) throw new Error(`提示词不存在: ${promptId}`);
    active[agent] = promptId;
  }
  return { ...lib, active };
}

/** 提示词被多少个 agent 启用 */
export function usageCount(lib: PromptLibrary, id: string): number {
  return Object.values(lib.active).filter((v) => v === id).length;
}

/** 序列化为持久化 JSON 文本 */
export function serializeLibrary(lib: PromptLibrary): string {
  const normalized = normalizeLibrary(lib);
  return JSON.stringify(
    { prompts: normalized.prompts, active: normalized.active },
    null,
    2,
  ) + '\n';
}

/** 宽松解析：跳过损坏条目、去重 id、丢弃未知 agent / 悬空 active */
export function normalizeLibrary(raw: unknown): PromptLibrary {
  const root =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawPrompts = Array.isArray(root.prompts) ? root.prompts : [];
  const prompts: PromptEntry[] = [];
  const seen = new Set<string>();
  for (const item of rawPrompts) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const content = typeof r.content === 'string' ? r.content : '';
    if (!id || !name || content.trim().length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    prompts.push({
      id,
      name,
      content,
      ...(typeof r.description === 'string' && r.description.trim().length > 0
        ? { description: r.description.trim() }
        : {}),
      updatedAt:
        typeof r.updatedAt === 'string' && r.updatedAt.length > 0
          ? r.updatedAt
          : new Date(0).toISOString(),
    });
  }
  const active: Partial<Record<AgentId, string>> = {};
  const rawActive =
    typeof root.active === 'object' && root.active !== null
      ? (root.active as Record<string, unknown>)
      : {};
  for (const [agent, promptId] of Object.entries(rawActive)) {
    if (!isAgentId(agent)) continue;
    if (typeof promptId !== 'string' || !seen.has(promptId)) continue;
    active[agent] = promptId;
  }
  return { prompts, active };
}

/** 解析 JSON 文本；空文本返回空库，非法 JSON 抛错 */
export function parseLibrary(text: string): PromptLibrary {
  if (!text.trim()) return emptyPromptLibrary();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`提示词库 JSON 解析失败：${msg}`);
  }
  return normalizeLibrary(raw);
}