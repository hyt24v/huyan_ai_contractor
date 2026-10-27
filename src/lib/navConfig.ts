/**
 * 导航栏自定义：工具显示/隐藏 + 组内排序。
 * 配置存 localStorage，通过 SETTINGS_CHANGED_EVENT 广播变更；
 * visibleTools() 返回缓存引用（配合 useSyncExternalStore，避免新引用导致重渲染风暴）。
 */
import { useSyncExternalStore } from 'react';
import { onSettingsChanged, SETTINGS_CHANGED_EVENT } from './settings';
import { TOOLS, type ToolDef } from './tools';

const CUSTOM_KEY = 'huyan_tool:nav_custom'; // '1' = 用户自定义过
const ORDER_KEY = 'huyan_tool:nav_order'; // JSON string[]：tool.path 的完整排序
const HIDDEN_KEY = 'huyan_tool:nav_hidden'; // JSON string[]：隐藏的 tool.path

function readPaths(key: string): string[] | null {
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

function writePaths(key: string, paths: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

function emitChanged(): void {
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

export function isNavCustomized(): boolean {
  try {
    return window.localStorage.getItem(CUSTOM_KEY) === '1';
  } catch {
    return false;
  }
}

function markCustom(): void {
  try {
    window.localStorage.setItem(CUSTOM_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** 当前生效的排序（未自定义 = 注册表顺序）。不在列表里的新工具排到所在组末尾。 */
export function navOrder(): string[] {
  return readPaths(ORDER_KEY) ?? TOOLS.map((t) => t.path);
}

/** 当前隐藏的工具 path 列表 */
export function navHidden(): string[] {
  return readPaths(HIDDEN_KEY) ?? [];
}

/** 按用户排序后的工具列表（不过滤隐藏；新工具排末尾） */
export function orderedTools(): ToolDef[] {
  const order = readPaths(ORDER_KEY);
  if (!order) return TOOLS;
  const idx = new Map(order.map((p, i) => [p, i]));
  return [...TOOLS].sort(
    (a, b) =>
      (idx.get(a.path) ?? 10000 + TOOLS.indexOf(a)) -
      (idx.get(b.path) ?? 10000 + TOOLS.indexOf(b)),
  );
}

let visibleCache: ToolDef[] | null = null;

/** 生效的导航工具列表：排序 + 过滤隐藏。返回缓存引用，供 useSyncExternalStore 使用。 */
export function visibleTools(): ToolDef[] {
  if (visibleCache) return visibleCache;
  const hidden = new Set(navHidden());
  return (visibleCache = orderedTools().filter((t) => !hidden.has(t.path)));
}

function invalidate(): void {
  visibleCache = null;
}

/** 设置工具显示/隐藏 */
export function setToolHidden(path: string, hidden: boolean): void {
  const set = new Set(navHidden());
  if (hidden) set.add(path);
  else set.delete(path);
  writePaths(HIDDEN_KEY, [...set]);
  markCustom();
  invalidate();
  emitChanged();
}

/** 设置完整排序（组内排序由调用方保证：只传入同组重排后的完整顺序） */
export function setNavOrder(paths: string[]): void {
  writePaths(ORDER_KEY, paths);
  markCustom();
  invalidate();
  emitChanged();
}

/** 组内移动：把 from 位置的项插到 to 位置（同组内），返回新的完整排序 */
export function moveWithinGroup(group: ToolDef['group'], from: number, to: number): string[] {
  const ordered = orderedTools();
  const groupItems = ordered.filter((t) => t.group === group);
  if (from < 0 || from >= groupItems.length || to < 0 || to >= groupItems.length || from === to) {
    return ordered.map((t) => t.path);
  }
  const [moved] = groupItems.splice(from, 1);
  groupItems.splice(to, 0, moved);
  const queue = [...groupItems];
  return ordered.map((t) => (t.group === group ? queue.shift()!.path : t.path));
}

/** 恢复默认（注册表顺序、全部显示） */
export function resetNavConfig(): void {
  try {
    window.localStorage.removeItem(CUSTOM_KEY);
    window.localStorage.removeItem(ORDER_KEY);
    window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* ignore */
  }
  invalidate();
  emitChanged();
}

/** React hook：订阅生效的导航工具列表 */
export function useNavTools(): ToolDef[] {
  return useSyncExternalStore(onSettingsChanged, visibleTools, visibleTools);
}
