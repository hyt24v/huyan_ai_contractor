/**
 * 磁盘变更监听（借鉴 ColaMD「Always in Sync」）：
 * Rust 后端用 notify 监听文件父目录（兼容原子写入 rename），
 * 前端按路径订阅 `fs-changed` 事件。非 Tauri 环境全部静默降级。
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface FsChange {
  path: string;
  kind: 'modified' | 'removed';
}

/** 监听单个文件的外部变更；父目录不存在时后端静默不监听 */
export async function watchPath(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('watch_path', { path });
  } catch (e) {
    // 静默降级：页面仍可用，只是不自动刷新
    console.debug('watch_path failed:', e);
  }
}

export async function unwatchPath(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('unwatch_path', { path });
  } catch (e) {
    console.debug('unwatch_path failed:', e);
  }
}

/** 订阅 fs-changed 事件，返回取消函数（组件卸载时调用） */
export function onFsChange(handler: (e: FsChange) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<FsChange>('fs-changed', (ev) => handler(ev.payload)).then(
    (u) => {
      if (disposed) u();
      else unlisten = u;
    },
  );
  return () => {
    disposed = true;
    unlisten?.();
  };
}
