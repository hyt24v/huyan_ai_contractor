/** 应用更新状态机:检查 → 下载(进度) → 重启。供设置页与全局静默检查复用 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import {
  checkForUpdate,
  currentVersion,
  downloadAndInstall,
  relaunchApp,
} from '../lib/updater';
import { useToast } from './useToast';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'ready' };

export function useUpdater() {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const { toast, showToast } = useToast();
  const checking = useRef(false);

  useEffect(() => {
    currentVersion()
      .then(setVersion)
      .catch(() => setVersion(''));
  }, []);

  /** silent=true 时无更新/失败都不弹 toast(用于启动自动检查) */
  const check = useCallback(
    async (silent: boolean) => {
      if (checking.current) return;
      checking.current = true;
      setStatus({ kind: 'checking' });
      try {
        const update = await checkForUpdate();
        if (update) {
          setStatus({ kind: 'available', update });
          showToast(`发现新版本 v${update.version}`);
        } else {
          setStatus({ kind: 'latest' });
          if (!silent) showToast('已是最新版本');
        }
      } catch (e) {
        setStatus({ kind: 'idle' });
        if (!silent) {
          showToast(
            `检查更新失败:${e instanceof Error ? e.message : String(e)}`,
            'err',
          );
        }
      } finally {
        checking.current = false;
      }
    },
    [showToast],
  );

  const download = useCallback(
    async (update: Update) => {
      setStatus({ kind: 'downloading', percent: null });
      try {
        await downloadAndInstall(update, ({ downloaded, total }) => {
          setStatus({
            kind: 'downloading',
            percent: total ? Math.round((downloaded / total) * 100) : null,
          });
        });
        setStatus({ kind: 'ready' });
        showToast('更新已下载,重启后生效');
      } catch (e) {
        setStatus({ kind: 'available', update });
        showToast(
          `下载更新失败:${e instanceof Error ? e.message : String(e)}`,
          'err',
        );
      }
    },
    [showToast],
  );

  const relaunch = useCallback(() => {
    relaunchApp().catch((e) =>
      showToast(
        `重启失败:${e instanceof Error ? e.message : String(e)}`,
        'err',
      ),
    );
  }, [showToast]);

  return { version, status, toast, check, download, relaunch };
}
