/**
 * 自动本地快照：应用打开期间每 6 小时创建一次 MCP 配置快照。
 * 由 Layout 后续接入；浏览器环境（无 Tauri）自动 no-op。
 */
import { useEffect } from 'react';
import { createSnapshot, pruneSnapshots } from '../services/backups';

export const AUTO_BACKUP_KEY = 'huyan_tool:last_auto_backup';
export const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function useAutoBackup(enabled = true): void {
  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      let last = 0;
      try {
        last = Number(window.localStorage.getItem(AUTO_BACKUP_KEY)) || 0;
      } catch {
        last = 0;
      }
      if (Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return;
      try {
        await createSnapshot(undefined, '自动备份');
        await pruneSnapshots();
        try {
          window.localStorage.setItem(AUTO_BACKUP_KEY, String(Date.now()));
        } catch {
          // localStorage 不可用时忽略，仅影响节流
        }
      } catch {
        // 自动备份失败不打扰用户，下次再试
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), AUTO_BACKUP_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}