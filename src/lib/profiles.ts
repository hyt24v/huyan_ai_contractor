/** 配置套餐（Profile）的纯逻辑（不碰文件系统，可单测） */
import { AGENTS, type AgentId } from './agents';

export interface Profile {
  id: string;
  name: string;
  description?: string;
  /** 要启用的 skill 名（中央库中的名字） */
  skills: string[];
  /** 要启用的中央 MCP server 名 */
  mcpServers: string[];
  /** 每个 agent 要写入的提示词 id */
  prompts: Partial<Record<AgentId, string>>;
  /** 每个 agent 要应用的模型服务 id（providers.json） */
  providers?: Partial<Record<AgentId, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileStore {
  profiles: Profile[];
}

export interface ProfileDraft {
  name: string;
  description?: string;
  skills: string[];
  mcpServers: string[];
  prompts: Partial<Record<AgentId, string>>;
  providers?: Partial<Record<AgentId, string>>;
}

export interface ProfileValidation {
  ok: boolean;
  errors: string[];
}

export interface ProfileWriteOptions {
  id?: string;
  now?: Date;
}

export interface ProfileSummary {
  skills: number;
  mcpServers: number;
  prompts: number;
  providers: number;
}

export const emptyProfileStore = (): ProfileStore => ({ profiles: [] });

const AGENT_IDS = AGENTS.map((a) => a.id);
const isAgentId = (v: string): v is AgentId => (AGENT_IDS as string[]).includes(v);

let seq = 0;

export function newProfileId(): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `profile_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/** 去空白、去空项、去重（保持顺序） */
export function sanitizeStringList(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function sanitizePrompts(
  map: Partial<Record<AgentId, string>> | undefined,
): Partial<Record<AgentId, string>> {
  const out: Partial<Record<AgentId, string>> = {};
  if (!map) return out;
  for (const [agent, promptId] of Object.entries(map) as [AgentId, string][]) {
    if (!isAgentId(agent)) continue;
    if (typeof promptId !== 'string' || promptId.trim().length === 0) continue;
    out[agent] = promptId.trim();
  }
  return out;
}

/** 名称必填、不与其它套餐重名（excludeId 用于编辑自身） */
export function validateProfileDraft(
  draft: ProfileDraft,
  existing: readonly Profile[] = [],
  excludeId?: string,
): ProfileValidation {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push('套餐名称不能为空');
  } else {
    const lowered = name.toLowerCase();
    const clash = existing.find(
      (p) => p.id !== excludeId && p.name.trim().toLowerCase() === lowered,
    );
    if (clash) errors.push(`已存在同名套餐：${clash.name}`);
  }
  return { ok: errors.length === 0, errors };
}

function assertValid(
  draft: ProfileDraft,
  existing: readonly Profile[],
  excludeId?: string,
): void {
  const v = validateProfileDraft(draft, existing, excludeId);
  if (!v.ok) throw new Error(v.errors.join('；'));
}

function uniqueName(base: string, taken: readonly string[]): string {
  const set = new Set(taken.map((n) => n.trim()));
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

function profileFromDraft(
  draft: ProfileDraft,
  id: string,
  createdAt: string,
  updatedAt: string,
): Profile {
  return {
    id,
    name: draft.name.trim(),
    ...(draft.description && draft.description.trim().length > 0
      ? { description: draft.description.trim() }
      : {}),
    skills: sanitizeStringList(draft.skills),
    mcpServers: sanitizeStringList(draft.mcpServers),
    prompts: sanitizePrompts(draft.prompts),
    providers: sanitizePrompts(draft.providers),
    createdAt,
    updatedAt,
  };
}

export function findProfile(store: ProfileStore, id: string): Profile | undefined {
  return store.profiles.find((p) => p.id === id);
}

/** 新增套餐；重名 / 空名称时抛错 */
export function addProfile(
  store: ProfileStore,
  draft: ProfileDraft,
  opts: ProfileWriteOptions = {},
): { store: ProfileStore; profile: Profile } {
  assertValid(draft, store.profiles);
  const now = opts.now ?? new Date();
  const profile = profileFromDraft(
    draft,
    opts.id ?? newProfileId(),
    now.toISOString(),
    now.toISOString(),
  );
  return { store: { profiles: [...store.profiles, profile] }, profile };
}

/** 整体更新套餐（保留 createdAt）；不存在 / 重名 / 空名称时抛错 */
export function updateProfile(
  store: ProfileStore,
  id: string,
  draft: ProfileDraft,
  now: Date = new Date(),
): ProfileStore {
  const current = findProfile(store, id);
  if (!current) throw new Error(`套餐不存在: ${id}`);
  assertValid(draft, store.profiles, id);
  const next = profileFromDraft(draft, id, current.createdAt, now.toISOString());
  return { profiles: store.profiles.map((p) => (p.id === id ? next : p)) };
}

export function removeProfile(store: ProfileStore, id: string): ProfileStore {
  return { profiles: store.profiles.filter((p) => p.id !== id) };
}

/** 复制套餐：名称自动加「副本」，内容完全拷贝，时间戳刷新 */
export function duplicateProfile(
  store: ProfileStore,
  id: string,
  opts: ProfileWriteOptions = {},
): { store: ProfileStore; profile: Profile } {
  const source = findProfile(store, id);
  if (!source) throw new Error(`套餐不存在: ${id}`);
  const now = opts.now ?? new Date();
  const name = uniqueName(
    `${source.name} 副本`,
    store.profiles.map((p) => p.name),
  );
  const copy = profileFromDraft(
    {
      name,
      ...(source.description ? { description: source.description } : {}),
      skills: source.skills,
      mcpServers: source.mcpServers,
      prompts: source.prompts,
      providers: source.providers,
    },
    opts.id ?? newProfileId(),
    now.toISOString(),
    now.toISOString(),
  );
  return { store: { profiles: [...store.profiles, copy] }, profile: copy };
}

export function profileSummary(profile: Profile): ProfileSummary {
  return {
    skills: profile.skills.length,
    mcpServers: profile.mcpServers.length,
    prompts: Object.keys(profile.prompts).length,
    providers: Object.keys(profile.providers ?? {}).length,
  };
}

/** 卡片上的一行摘要 */
export function summarizeProfile(profile: Profile): string {
  const s = profileSummary(profile);
  return `${s.skills} 个 Skill · ${s.mcpServers} 个 MCP · ${s.prompts} 个提示词 · ${s.providers} 个模型服务`;
}

/** 宽松解析单条套餐；关键字段缺失返回 null */
export function normalizeProfile(raw: unknown): Profile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (name.length === 0) return null;
  const fallback = new Date(0).toISOString();
  const createdAt = typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : fallback;
  const updatedAt = typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : createdAt;
  return {
    id: id || newProfileId(),
    name,
    ...(typeof r.description === 'string' && r.description.trim().length > 0
      ? { description: r.description.trim() }
      : {}),
    skills: Array.isArray(r.skills) ? sanitizeStringList(r.skills.map(String)) : [],
    mcpServers: Array.isArray(r.mcpServers)
      ? sanitizeStringList(r.mcpServers.map(String))
      : [],
    prompts:
      typeof r.prompts === 'object' && r.prompts !== null
        ? sanitizePrompts(r.prompts as Partial<Record<AgentId, string>>)
        : {},
    providers:
      typeof r.providers === 'object' && r.providers !== null
        ? sanitizePrompts(r.providers as Partial<Record<AgentId, string>>)
        : {},
    createdAt,
    updatedAt,
  };
}

/** 宽松解析整个 store：跳过坏条目、修复重复 id */
export function normalizeProfileStore(raw: unknown): ProfileStore {
  const root =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(root.profiles) ? root.profiles : [];
  const profiles: Profile[] = [];
  const ids = new Set<string>();
  for (const item of list) {
    const p = normalizeProfile(item);
    if (!p) continue;
    if (ids.has(p.id)) p.id = newProfileId();
    ids.add(p.id);
    profiles.push(p);
  }
  return { profiles };
}

export function serializeProfiles(store: ProfileStore): string {
  const normalized = normalizeProfileStore(store);
  return JSON.stringify({ profiles: normalized.profiles }, null, 2) + '\n';
}

export function parseProfiles(text: string): ProfileStore {
  if (!text.trim()) return emptyProfileStore();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`套餐 JSON 解析失败：${msg}`);
  }
  return normalizeProfileStore(raw);
}

/**
 * 导入合并：追加到现有 store。
 * id 冲突时重新生成，名称冲突时加序号，同名套餐不会被静默覆盖。
 */
export function mergeProfileStores(
  base: ProfileStore,
  incoming: ProfileStore,
  now: Date = new Date(),
): { store: ProfileStore; added: Profile[] } {
  const profiles = [...base.profiles];
  const ids = new Set(profiles.map((p) => p.id));
  const added: Profile[] = [];
  for (const src of incoming.profiles) {
    const id = ids.has(src.id) ? newProfileId() : src.id;
    ids.add(id);
    const name = uniqueName(
      src.name,
      profiles.map((p) => p.name),
    );
    const copy: Profile = {
      ...src,
      id,
      name,
      skills: [...src.skills],
      mcpServers: [...src.mcpServers],
      prompts: { ...src.prompts },
      providers: { ...(src.providers ?? {}) },
      updatedAt: now.toISOString(),
    };
    profiles.push(copy);
    added.push(copy);
  }
  return { store: { profiles }, added };
}