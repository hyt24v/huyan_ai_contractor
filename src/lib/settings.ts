/** 应用级设置项( localStorage 持久化 + 变更事件,跨组件即时生效) */

export const SETTINGS_CHANGED_EVENT = 'huyan:settings-changed';

const KEYS = {
  /** 启动时自动检查更新 */
  autoCheckUpdate: 'huyan_tool:auto_check_update',
  /** MCP 配置自动快照 */
  autoBackup: 'huyan_tool:auto_backup_enabled',
  /** 点了「稍后提醒」的更新版本(不再自动弹窗,红点仍提示) */
  dismissedUpdate: 'huyan_tool:update_dismissed',
} as const;

function read(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // localStorage 不可用时忽略
  }
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

/** 启动时是否自动静默检查更新(默认开) */
export function getAutoCheckUpdate(): boolean {
  return read(KEYS.autoCheckUpdate, true);
}
export function setAutoCheckUpdate(v: boolean): void {
  write(KEYS.autoCheckUpdate, v);
}

/** 是否自动快照 MCP 配置(默认开,间隔见 useAutoBackup) */
export function getAutoBackupEnabled(): boolean {
  return read(KEYS.autoBackup, true);
}
export function setAutoBackupEnabled(v: boolean): void {
  write(KEYS.autoBackup, v);
}

/** 记录用户对某个版本点了「稍后提醒」 */
export function dismissUpdate(version: string): void {
  try {
    window.localStorage.setItem(KEYS.dismissedUpdate, version);
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 该版本是否已被「稍后提醒」过 */
export function isUpdateDismissed(version: string): boolean {
  try {
    return window.localStorage.getItem(KEYS.dismissedUpdate) === version;
  } catch {
    return false;
  }
}

/** 订阅设置变更;返回取消函数 */
export function onSettingsChanged(listener: () => void): () => void {
  window.addEventListener(SETTINGS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, listener);
}
