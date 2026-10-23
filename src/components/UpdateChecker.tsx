/** 侧边栏底部的版本号 + 检查更新入口;启动时静默检查一次,发现新版本高亮提示 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { ArrowUpCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import {
  checkForUpdate,
  currentVersion,
  downloadAndInstall,
  relaunchApp,
} from '../lib/updater';
import { useToast } from '../hooks/useToast';

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'ready' };

export default function UpdateChecker() {
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const { toast, showToast } = useToast();
  const checking = useRef(false);

  useEffect(() => {
    currentVersion()
      .then(setVersion)
      .catch(() => setVersion(''));
  }, []);

  const doCheck = useCallback(
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
          showToast(`检查更新失败:${e instanceof Error ? e.message : String(e)}`, 'err');
        }
      } finally {
        checking.current = false;
      }
    },
    [showToast],
  );

  // 启动后静默检查一次(dev 环境或网络不可用时静默忽略)
  useEffect(() => {
    const t = window.setTimeout(() => {
      doCheck(true).catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [doCheck]);

  const doDownload = useCallback(
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
        showToast(`下载更新失败:${e instanceof Error ? e.message : String(e)}`, 'err');
      }
    },
    [showToast],
  );

  const onClick = () => {
    if (status.kind === 'idle' || status.kind === 'latest') {
      doCheck(false).catch(() => undefined);
    } else if (status.kind === 'available') {
      doDownload(status.update).catch(() => undefined);
    } else if (status.kind === 'ready') {
      relaunchApp().catch((e) =>
        showToast(`重启失败:${e instanceof Error ? e.message : String(e)}`, 'err'),
      );
    }
  };

  const busy = status.kind === 'checking' || status.kind === 'downloading';

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={busy}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
          status.kind === 'available' || status.kind === 'ready'
            ? 'bg-primary/10 font-medium text-primary hover:bg-primary/20'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        } ${busy ? 'cursor-wait opacity-70' : ''}`}
        title={
          status.kind === 'available'
            ? `发现新版本 v${status.update.version},点击下载更新`
            : status.kind === 'ready'
              ? '更新已就绪,点击重启生效'
              : '检查更新'
        }
      >
        {status.kind === 'checking' || status.kind === 'downloading' ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : status.kind === 'available' || status.kind === 'ready' ? (
          <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
        ) : status.kind === 'latest' ? (
          <Check className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {status.kind === 'checking' && '检查更新中…'}
          {status.kind === 'downloading' &&
            (status.percent !== null ? `下载中 ${status.percent}%` : '下载中…')}
          {status.kind === 'available' && `新版本 v${status.update.version}`}
          {status.kind === 'ready' && '重启完成更新'}
          {(status.kind === 'idle' || status.kind === 'latest') &&
            `v${version} · 检查更新`}
        </span>
      </button>

      {toast && (
        <div
          className={`pointer-events-none absolute bottom-full left-0 mb-1 w-max max-w-56 rounded-md border px-2.5 py-1.5 text-[11px] shadow-lg ${
            toast.tone === 'err'
              ? 'border-destructive/40 bg-destructive text-destructive-foreground'
              : 'bg-card text-foreground'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
