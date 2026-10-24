/**
 * Agent 可见性:用户可在设置中选择「在工具中显示」哪些 agent。
 * 默认(未自定义)= 检测到的 agent(配置/skills 目录存在);什么都没检测到时回退到 5 个内置。
 * 检测结果缓存在 localStorage,启动/设置页打开/点「重新检测」时刷新。
 */
import { AGENTS, detectDirOf, type AgentDef, type AgentId } from './agents';
import { absPath, tauriFs, type FsPort } from './fsPort';
import { SETTINGS_CHANGED_EVENT } from './settings';

const CUSTOM_KEY = 'huyan_tool:agents_custom'; // '1' = 用户自定义过
const ENABLED_KEY = 'huyan_tool:agents_enabled'; // JSON string[]
const DETECTED_KEY = 'huyan_tool:agents_detected'; // JSON string[] 检测缓存

/** 一个 agent 都没检测到时回退显示的内置 agent */
export const FALLBACK_AGENT_IDS: AgentId[] = ['claude', 'codex', 'pi', 'cursor', 'gemini'];

function readIds(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

function emitChanged(): void {
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

/** 用户是否自定义过可见列表 */
export function isAgentVisibilityCustomized(): boolean {
  try {
    return window.localStorage.getItem(CUSTOM_KEY) === '1';
  } catch {
    return false;
  }
}

function defsOf(ids: string[]): AgentDef[] {
  const set = new Set(ids);
  return AGENTS.filter((a) => set.has(a.id));
}

let cache: AgentDef[] | null = null;

/**
 * 当前生效的 agent 列表(同步读缓存/存储,供组件与纯逻辑使用)。
 * 优先级:自定义 > 检测缓存 > 内置回退。
 */
export function effectiveAgents(): AgentDef[] {
  if (cache) return cache;
  if (isAgentVisibilityCustomized()) {
    const ids = readIds(ENABLED_KEY);
    if (ids) return (cache = defsOf(ids));
  }
  const detected = readIds(DETECTED_KEY);
  return (cache = defsOf(detected && detected.length > 0 ? detected : FALLBACK_AGENT_IDS));
}

/** 当前生效的 agent id 列表 */
export function effectiveAgentIds(): AgentId[] {
  return effectiveAgents().map((a) => a.id);
}

/**
 * 重新检测本机已安装的 agent(detect 目录或 skills 目录存在),刷新缓存。
 * 已自定义时不改生效列表,只更新检测缓存(供设置页展示「已检测到」徽标)。
 */
export async function refreshAgentVisibility(fs: FsPort = tauriFs): Promise<AgentDef[]> {
  const detected: string[] = [];
  for (const agent of AGENTS) {
    try {
      const dir = await absPath(detectDirOf(agent));
      const skills = await absPath(agent.skillsDir);
      if ((await fs.exists(dir)) || (await fs.exists(skills))) detected.push(agent.id);
    } catch {
      /* 单个检测失败忽略 */
    }
  }
  writeIds(DETECTED_KEY, detected);
  if (!isAgentVisibilityCustomized()) {
    cache = defsOf(detected.length > 0 ? detected : FALLBACK_AGENT_IDS);
  }
  return effectiveAgents();
}

/** 设置单个 agent 显示/隐藏;首次操作时以当前生效列表为底初始化自定义列表 */
export function setAgentEnabled(id: AgentId, enabled: boolean): void {
  const base = isAgentVisibilityCustomized()
    ? (readIds(ENABLED_KEY) ?? [])
    : effectiveAgents().map((a) => a.id);
  const next = new Set(base);
  if (enabled) next.add(id);
  else next.delete(id);
  const ids = AGENTS.map((a) => a.id).filter((x) => next.has(x)); // 保持注册表顺序
  try {
    window.localStorage.setItem(CUSTOM_KEY, '1');
  } catch {
    /* ignore */
  }
  writeIds(ENABLED_KEY, ids);
  cache = defsOf(ids);
  emitChanged();
}

/** 恢复自动(检测到的)模式 */
export function resetAgentVisibility(): void {
  try {
    window.localStorage.removeItem(CUSTOM_KEY);
    window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* ignore */
  }
  cache = null;
  emitChanged();
}

/** 上次检测到的 agent id(设置页徽标用) */
export function detectedAgentIds(): string[] {
  return readIds(DETECTED_KEY) ?? [];
}
