/**
 * 模型服务（Provider）管理的纯逻辑：
 * 校验 / 脱敏 / 存储增删改 / 各 agent 配置文本的「外科手术」。
 * 不依赖文件系统与 UI，可单测。
 *
 * API Key 属于敏感数据：除了写进本地配置文件与编辑表单外，任何展示都必须脱敏。
 */
import { AGENTS, agentById, type AgentId } from './agents';
import { parseTomlHeader, tomlStr } from './mcp';
import {
  providerTarget,
  type ProviderTarget,
  type ProviderTargetFormat,
} from './providerTargets';

// ---------- 数据模型 ----------

export type ProviderApi =
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages';

export const PROVIDER_APIS: ProviderApi[] = [
  'openai-responses',
  'openai-completions',
  'anthropic-messages',
];

export const API_LABEL: Record<ProviderApi, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-completions': 'OpenAI Completions',
  'anthropic-messages': 'Anthropic Messages',
};

export interface Provider {
  id: string;
  name: string;
  agent: AgentId;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  api?: ProviderApi;
  createdAt: string;
  updatedAt: string;
}

/** 本地存储：~/.ai-baogongtou/providers.json */
export interface ProviderStore {
  providers: Provider[];
  /** 每个 agent 当前生效的 provider id */
  active: Partial<Record<AgentId, string>>;
}

/** 新增 / 编辑表单的输入 */
export interface ProviderInput {
  id?: string;
  name: string;
  agent: AgentId;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  api?: ProviderApi;
}

export const PROVIDER_STORE_FILE = '.ai-baogongtou/providers.json';
export const PROVIDER_BACKUP_DIR = '.ai-baogongtou/provider-backups';

export const emptyStore = (): ProviderStore => ({ providers: [], active: {} });

// ---------- 校验 ----------

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isAgentId(value: unknown): value is AgentId {
  return (
    typeof value === 'string' && AGENTS.some((a) => a.id === value)
  );
}

export function isProviderApi(value: unknown): value is ProviderApi {
  return (
    typeof value === 'string' &&
    (PROVIDER_APIS as string[]).includes(value)
  );
}

const trimOrEmpty = (s: string | undefined): string => (s ?? '').trim();

/** 校验输入，返回中文错误列表（空 = 通过） */
export function validateProvider(input: ProviderInput): string[] {
  const errors: string[] = [];
  const name = trimOrEmpty(input.name);
  if (!name) errors.push('名称不能为空');
  else if (name.length > 60) errors.push('名称不能超过 60 个字符');

  if (!isAgentId(input.agent)) errors.push('请选择目标 Agent');

  const url = trimOrEmpty(input.baseUrl);
  if (!url) errors.push('Base URL 不能为空');
  else if (!/^https?:\/\//i.test(url))
    errors.push('Base URL 必须以 http:// 或 https:// 开头');
  else if (/\s/.test(url)) errors.push('Base URL 不能包含空白字符');

  const key = input.apiKey;
  if (key !== undefined && /[\r\n]/.test(key))
    errors.push('API Key 不能包含换行');

  if (input.model !== undefined && /[\r\n]/.test(input.model))
    errors.push('模型名不能包含换行');

  if (input.api !== undefined && !isProviderApi(input.api))
    errors.push('未知的 API 协议');

  if (input.id !== undefined && !ID_RE.test(input.id))
    errors.push('ID 只能包含字母、数字、下划线和连字符');

  return errors;
}

// ---------- 脱敏 ----------

/** API Key 脱敏展示：绝不返回完整 key */
export function maskKey(key?: string): string {
  const k = (key ?? '').trim();
  if (!k) return '未设置';
  if (k.length <= 8) return '••••••••';
  if (k.length <= 16) return `••••••${k.slice(-4)}`;
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

// ---------- 构造 / id ----------

const slugify = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'provider';
};

/** 生成可读且唯一的 id（codex 会用它作为 model_providers 的键） */
export function uniqueProviderId(
  name: string,
  existingIds: readonly string[],
): string {
  const base = slugify(name);
  if (!existingIds.includes(base)) return base;
  let i = 2;
  while (existingIds.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function createProvider(
  input: ProviderInput,
  now: Date,
  existingIds: readonly string[] = [],
): Provider {
  const ts = now.toISOString();
  const key = input.apiKey?.trim();
  const model = input.model?.trim();
  return {
    id: input.id?.trim() || uniqueProviderId(input.name, existingIds),
    name: input.name.trim(),
    agent: input.agent,
    baseUrl: input.baseUrl.trim(),
    ...(key ? { apiKey: key } : {}),
    ...(model ? { model } : {}),
    ...(input.api ? { api: input.api } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
}

/** 编辑已有 provider：可选字段留空 = 清除 */
export function updateProvider(
  existing: Provider,
  input: ProviderInput,
  now: Date,
): Provider {
  const key = input.apiKey?.trim();
  const model = input.model?.trim();
  return {
    id: existing.id,
    name: input.name.trim(),
    agent: input.agent,
    baseUrl: input.baseUrl.trim(),
    ...(key ? { apiKey: key } : {}),
    ...(model ? { model } : {}),
    ...(input.api ? { api: input.api } : {}),
    createdAt: existing.createdAt,
    updatedAt: now.toISOString(),
  };
}

// ---------- 存储增删改 ----------

export function upsertProvider(
  store: ProviderStore,
  provider: Provider,
): ProviderStore {
  const prev = store.providers.find((p) => p.id === provider.id);
  const providers = prev
    ? store.providers.map((p) => (p.id === provider.id ? provider : p))
    : [...store.providers, provider];
  const active = { ...store.active };
  // agent 改动后，旧 agent 的 active 指向需清理
  if (prev && prev.agent !== provider.agent && active[prev.agent] === provider.id) {
    delete active[prev.agent];
  }
  return { providers, active };
}

export function removeProvider(store: ProviderStore, id: string): ProviderStore {
  const target = store.providers.find((p) => p.id === id);
  const active = { ...store.active };
  if (target && active[target.agent] === id) delete active[target.agent];
  return { providers: store.providers.filter((p) => p.id !== id), active };
}

/** 设为某个 agent 的当前 provider；id=null 清除 */
export function setActive(
  store: ProviderStore,
  agent: AgentId,
  id: string | null,
): ProviderStore {
  const active = { ...store.active };
  if (id === null) {
    delete active[agent];
    return { providers: store.providers, active };
  }
  const target = store.providers.find((p) => p.id === id);
  if (!target) throw new Error(`provider 不存在：${id}`);
  if (target.agent !== agent) throw new Error('provider 不属于该 Agent');
  active[agent] = id;
  return { providers: store.providers, active };
}

export const activeProvider = (
  store: ProviderStore,
  agent: AgentId,
): Provider | undefined => {
  const id = store.active[agent];
  return id ? store.providers.find((p) => p.id === id) : undefined;
};

export const providersOf = (
  store: ProviderStore,
  agent: AgentId,
): Provider[] => store.providers.filter((p) => p.agent === agent);

export const isActive = (store: ProviderStore, provider: Provider): boolean =>
  store.active[provider.agent] === provider.id;

/**
 * 把磁盘上的未知数据整理成合法 store（坏条目丢弃，active 只保留有效指向）。
 * 用于读取损坏 / 手改过的 providers.json 时兜底。
 */
export function normalizeStore(raw: unknown, now: Date): ProviderStore {
  const root = asPlainObject(raw);
  if (!root) return emptyStore();
  const list = Array.isArray(root.providers) ? root.providers : [];
  const ts = now.toISOString();
  const providers: Provider[] = [];
  for (const item of list) {
    const o = asPlainObject(item);
    if (!o) continue;
    if (
      typeof o.id !== 'string' ||
      !ID_RE.test(o.id) ||
      typeof o.name !== 'string' ||
      o.name.trim() === '' ||
      !isAgentId(o.agent) ||
      typeof o.baseUrl !== 'string' ||
      o.baseUrl.trim() === ''
    ) {
      continue;
    }
    if (providers.some((p) => p.id === o.id)) continue;
    providers.push({
      id: o.id,
      name: o.name.trim(),
      agent: o.agent,
      baseUrl: o.baseUrl.trim(),
      ...(typeof o.apiKey === 'string' && o.apiKey !== ''
        ? { apiKey: o.apiKey }
        : {}),
      ...(typeof o.model === 'string' && o.model !== '' ? { model: o.model } : {}),
      ...(isProviderApi(o.api) ? { api: o.api } : {}),
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : ts,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : ts,
    });
  }
  const active: Partial<Record<AgentId, string>> = {};
  const rawActive = asPlainObject(root.active);
  if (rawActive) {
    for (const agent of AGENTS) {
      const id = rawActive[agent.id];
      if (typeof id !== 'string') continue;
      if (providers.some((p) => p.id === id && p.agent === agent.id)) {
        active[agent.id] = id;
      }
    }
  }
  return { providers, active };
}

// ---------- 导出 / 导入 ----------

export function exportStoreJson(store: ProviderStore): string {
  return JSON.stringify(store, null, 2) + '\n';
}

export type ImportResult =
  | { ok: true; store: ProviderStore; imported: number }
  | { ok: false; error: string };

function parseProvider(raw: unknown, now: Date): Provider | string {
  if (typeof raw !== 'object' || raw === null) return '条目不是对象';
  const r = raw as Record<string, unknown>;
  const input: ProviderInput = {
    id: typeof r.id === 'string' ? r.id : undefined,
    name: typeof r.name === 'string' ? r.name : '',
    agent: r.agent as AgentId,
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : '',
    apiKey: typeof r.apiKey === 'string' ? r.apiKey : undefined,
    model: typeof r.model === 'string' ? r.model : undefined,
    api: r.api as ProviderApi | undefined,
  };
  const errors = validateProvider(input);
  if (errors.length > 0) return errors.join('；');
  const ts = now.toISOString();
  const prov: Provider = {
    id: input.id ?? uniqueProviderId(input.name, []),
    name: input.name.trim(),
    agent: input.agent,
    baseUrl: input.baseUrl.trim(),
    ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.api ? { api: input.api } : {}),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : ts,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : ts,
  };
  return prov;
}

/**
 * 导入 JSON（`{providers, active}` 或纯 provider 数组）。
 * 同 id 覆盖已有条目，其余保留；active 只接受指向存在条目的键。
 */
export function importStoreJson(
  text: string,
  current: ProviderStore,
  now: Date,
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const rawProviders: unknown = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).providers
      : undefined;
  if (!Array.isArray(rawProviders)) {
    return { ok: false, error: '缺少 providers 数组' };
  }
  const incoming: Provider[] = [];
  for (let i = 0; i < rawProviders.length; i++) {
    const r = parseProvider(rawProviders[i], now);
    if (typeof r === 'string') {
      return { ok: false, error: `第 ${i + 1} 条无效：${r}` };
    }
    const dup = incoming.findIndex((p) => p.id === r.id);
    if (dup >= 0) incoming.splice(dup, 1);
    incoming.push(r);
  }

  let providers = [...current.providers];
  for (const p of incoming) {
    const prev = providers.find((x) => x.id === p.id);
    providers = prev
      ? providers.map((x) => (x.id === p.id ? p : x))
      : [...providers, p];
  }

  const active: Partial<Record<AgentId, string>> = { ...current.active };
  const rawActive =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).active
      : undefined;
  if (typeof rawActive === 'object' && rawActive !== null) {
    for (const [agent, id] of Object.entries(rawActive)) {
      if (!isAgentId(agent) || typeof id !== 'string') continue;
      if (providers.some((p) => p.id === id && p.agent === agent)) {
        active[agent] = id;
      }
    }
  }
  // 清理历史脏数据（导入后 provider 可能已不存在 / 改 agent）
  for (const agent of AGENTS) {
    const id = active[agent.id];
    if (id && !providers.some((p) => p.id === id && p.agent === agent.id)) {
      delete active[agent.id];
    }
  }
  return { ok: true, store: { providers, active }, imported: incoming.length };
}

// ---------- 读取现有配置（供页面展示「当前生效」） ----------

export interface CurrentConfig {
  /** 是否解析到有效配置 */
  found: boolean;
  baseUrl?: string;
  model?: string;
  providerId?: string;
  providerName?: string;
  api?: string;
  hasKey: boolean;
}

export const emptyCurrent = (): CurrentConfig => ({ found: false, hasKey: false });

const unquoteToml = (raw: string): string => {
  let v = raw.trim();
  // 去掉行尾注释（仅处理引号外的情况，够用于我们生成的配置）
  const hash = v.indexOf(' #');
  if (hash > 0) v = v.slice(0, hash).trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    const body = v.slice(1, -1);
    return v.startsWith('"')
      ? body.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : body;
  }
  return v;
};

/** 读取 Claude ~/.claude/settings.json 里的 env 覆盖项 */
export function readClaudeSettings(text: string): CurrentConfig {
  const root = safeParseObject(text);
  const env = asPlainObject(root?.env);
  if (!env) return emptyCurrent();
  const baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : undefined;
  const model = typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL : undefined;
  const hasKey =
    typeof env.ANTHROPIC_AUTH_TOKEN === 'string' && env.ANTHROPIC_AUTH_TOKEN !== '';
  if (!baseUrl && !model && !hasKey) return emptyCurrent();
  return { found: true, baseUrl, model, hasKey };
}

/** 读取 Codex ~/.codex/config.toml 的 model_provider / model / provider 段 */
export function readCodexToml(text: string): CurrentConfig {
  const lines = text.split('\n');
  let section: string[] | null = null;
  let modelProvider: string | undefined;
  let model: string | undefined;
  const blocks: Record<
    string,
    { name?: string; baseUrl?: string; requiresAuth: boolean }
  > = {};
  for (const line of lines) {
    const header = parseTomlHeader(line);
    if (header) {
      section = header;
      if (header[0] === 'model_providers' && header.length >= 2) {
        blocks[header[1]] ??= { requiresAuth: false };
      }
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = unquoteToml(kv[2]);
    if (!section) {
      if (key === 'model_provider') modelProvider = value;
      else if (key === 'model') model = value;
      continue;
    }
    if (section[0] === 'model_providers' && section.length === 2) {
      const block = (blocks[section[1]] ??= { requiresAuth: false });
      if (key === 'name') block.name = value;
      else if (key === 'base_url') block.baseUrl = value;
      else if (key === 'requires_openai_auth') block.requiresAuth = value === 'true';
    }
  }
  const chosen =
    (modelProvider && blocks[modelProvider]) ||
    Object.values(blocks)[0] ||
    undefined;
  if (!modelProvider && !model && !chosen) return emptyCurrent();
  return {
    found: true,
    ...(chosen?.baseUrl ? { baseUrl: chosen.baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(modelProvider ? { providerId: modelProvider } : {}),
    ...(chosen?.name ? { providerName: chosen.name } : {}),
    hasKey: chosen?.requiresAuth === true,
  };
}

/** 读取 Pi ~/.pi/agent/models.json 的 providers 条目 */
export function readPiModels(text: string, providerId?: string): CurrentConfig {
  const root = safeParseObject(text);
  const providers = asPlainObject(root?.providers);
  if (!providers) return emptyCurrent();
  const ids = Object.keys(providers);
  const key = providerId && providers[providerId] ? providerId : ids[0];
  if (!key) return emptyCurrent();
  const entry = asPlainObject(providers[key]);
  if (!entry) return emptyCurrent();
  const models = Array.isArray(entry.models) ? entry.models : [];
  const firstModel = asPlainObject(models[0]);
  return {
    found: true,
    ...(typeof entry.baseUrl === 'string' ? { baseUrl: entry.baseUrl } : {}),
    ...(typeof firstModel?.id === 'string' ? { model: firstModel.id } : {}),
    providerId: key,
    ...(typeof entry.name === 'string' ? { providerName: entry.name } : {}),
    ...(typeof entry.api === 'string' ? { api: entry.api } : {}),
    hasKey: typeof entry.apiKey === 'string' && entry.apiKey !== '',
  };
}

export function readProviderConfig(
  format: ProviderTargetFormat,
  text: string,
  providerId?: string,
): CurrentConfig {
  switch (format) {
    case 'claude-settings':
      return readClaudeSettings(text);
    case 'codex-toml':
      return readCodexToml(text);
    case 'pi-models':
      return readPiModels(text, providerId);
    case 'unsupported':
      return emptyCurrent();
  }
}

// ---------- 写回配置（纯文本变换） ----------

function safeParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 交给调用方按 null 处理
  }
  return null;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseJsonRoot(originalText: string, label: string): Record<string, unknown> {
  if (originalText.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(originalText);
  } catch {
    throw new Error(`${label} 不是合法 JSON，已中止写入（原文件未改动）`);
  }
  const root = asPlainObject(parsed);
  if (!root) throw new Error(`${label} 根节点不是对象，已中止写入（原文件未改动）`);
  return root;
}

/**
 * Claude：合并 env 里的三个变量，保留其余全部设置（hooks / permissions 等）。
 * API Key / model 未提供时会移除对应 env 项，避免残留上一个 provider 的值。
 */
export function applyClaudeSettings(
  originalText: string,
  provider: Provider,
): string {
  const root = parseJsonRoot(originalText, 'settings.json');
  const env = { ...(asPlainObject(root.env) ?? {}) };
  env.ANTHROPIC_BASE_URL = provider.baseUrl;
  if (provider.apiKey) env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
  else delete env.ANTHROPIC_AUTH_TOKEN;
  if (provider.model) env.ANTHROPIC_MODEL = provider.model;
  else delete env.ANTHROPIC_MODEL;
  root.env = env;
  return JSON.stringify(root, null, 2) + '\n';
}

const codexWireApi = (provider: Provider): 'responses' | 'completions' =>
  provider.api === 'openai-completions' ? 'completions' : 'responses';

const codexKey = (id: string): string =>
  /^[A-Za-z0-9_-]+$/.test(id) ? id : tomlStr(id);

/** Codex env_key 只能指向环境变量名：从 provider id 派生合法的环境变量名 */
export const codexEnvKey = (id: string): string =>
  `${id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_API_KEY`;

/**
 * Codex：行级外科手术，保留注释与其它配置。
 * - 顶层 model_provider / model（model 仅在提供时覆盖）
 * - 整段替换 [model_providers.<id>]（含其子表）
 */
export function applyCodexToml(originalText: string, provider: Provider): string {
  const lines = originalText.split('\n');
  const wanted: Record<string, string> = { model_provider: tomlStr(provider.id) };
  if (provider.model) wanted.model = tomlStr(provider.model);

  // 顶层区域 = 第一个节头之前
  let topEnd = lines.findIndex((l) => parseTomlHeader(l) !== null);
  if (topEnd < 0) topEnd = lines.length;

  const replaced = new Set<string>();
  for (let i = 0; i < topEnd; i++) {
    const m = lines[i].match(/^\s*(model_provider|model)\s*=/);
    if (!m) continue;
    const key = m[1];
    if (replaced.has(key)) continue;
    if (key in wanted) {
      lines[i] = `${key} = ${wanted[key]}`;
      replaced.add(key);
    }
  }
  const missing = Object.keys(wanted).filter((k) => !replaced.has(k));
  if (missing.length > 0) {
    let at = topEnd;
    while (at > 0 && lines[at - 1].trim() === '') at--;
    const block = missing.map((k) => `${k} = ${wanted[k]}`);
    // 后面紧跟节头时留一个空行，保持可读
    if (at < lines.length && parseTomlHeader(lines[at]) !== null) block.push('');
    lines.splice(at, 0, ...block);
  }

  // 删除旧的 [model_providers.<id>] 及其子表
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const path = parseTomlHeader(line);
    if (path) {
      skipping =
        path.length >= 2 && path[0] === 'model_providers' && path[1] === provider.id;
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();

  const block = [
    `[model_providers.${codexKey(provider.id)}]`,
    `name = ${tomlStr(provider.name)}`,
    `base_url = ${tomlStr(provider.baseUrl)}`,
    `wire_api = ${tomlStr(codexWireApi(provider))}`,
    // Codex 的 config.toml 不支持明文 apiKey，只能指向环境变量
    ...(provider.apiKey
      ? [
          'requires_openai_auth = true',
          `env_key = ${tomlStr(codexEnvKey(provider.id))}`,
        ]
      : []),
  ];
  const body = out.join('\n');
  return (body ? body + '\n\n' : '') + block.join('\n') + '\n';
}

/**
 * Pi：upsert providers.<id>，保留其它 provider / models。
 * 只有提供 model 时才写 models 数组。
 */
export function applyPiModels(originalText: string, provider: Provider): string {
  const root = parseJsonRoot(originalText, 'models.json');
  const providers = { ...(asPlainObject(root.providers) ?? {}) };
  providers[provider.id] = {
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api ?? 'openai-responses',
    ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    ...(provider.model
      ? { models: [{ id: provider.model, name: provider.model }] }
      : {}),
  };
  root.providers = providers;
  return JSON.stringify(root, null, 2) + '\n';
}

/** 按 agent 的配置格式选择写回函数 */
export function applyProviderText(
  agent: AgentId,
  originalText: string,
  provider: Provider,
): string {
  const target: ProviderTarget = providerTarget(agent);
  switch (target.format) {
    case 'claude-settings':
      return applyClaudeSettings(originalText, provider);
    case 'codex-toml':
      return applyCodexToml(originalText, provider);
    case 'pi-models':
      return applyPiModels(originalText, provider);
    case 'unsupported':
      throw new Error(
        `${agentById(agent).name} ${target.note ?? '暂不支持写入，仅支持查看'}`,
      );
  }
}