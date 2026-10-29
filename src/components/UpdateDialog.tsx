/** 新版本弹窗:展示更新内容,一键下载更新/重启生效 */
import { useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { ArrowUpCircle, Loader2, X } from 'lucide-react';
import { downloadAndInstall, relaunchApp } from '../lib/updater';
import { parseReleaseNotes } from '../lib/releaseNotes';
import { useToast } from '../hooks/useToast';
import { FloatingToast } from './Toast';

type Phase =
  | { kind: 'confirm' }
  | { kind: 'downloading'; percent: number | null }
  | { kind: 'ready' };

export default function UpdateDialog({
  update,
  currentVersion,
  onClose,
}: {
  update: Update;
  currentVersion: string;
  /** 关闭弹窗(「稍后提醒」语义由调用方处理) */
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const { toast, showToast } = useToast();
  const notes = parseReleaseNotes(update.body ?? '');

  const startDownload = async () => {
    setPhase({ kind: 'downloading', percent: null });
    try {
      await downloadAndInstall(update, ({ downloaded, total }) => {
        setPhase({
          kind: 'downloading',
          percent: total ? Math.round((downloaded / total) * 100) : null,
        });
      });
      setPhase({ kind: 'ready' });
    } catch (e) {
      setPhase({ kind: 'confirm' });
      showToast(`下载更新失败:${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm"
      onMouseDown={phase.kind === 'confirm' ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="发现新版本"
        className="w-full max-w-md overflow-hidden rounded-lg border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">发现新版本 v{update.version}</span>
          </div>
          {phase.kind === 'confirm' && (
            <button
              onClick={onClose}
              aria-label="关闭"
              className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 更新内容 */}
        <div className="max-h-72 overflow-y-auto px-4 py-3">
          <div className="text-[11px] text-muted-foreground">
            当前版本 v{currentVersion} → 新版本 v{update.version}
            {update.date ? ` · ${update.date.split(' ')[0]}` : ''}
          </div>
          {notes.bullets.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-[13px] font-medium">更新内容</div>
              <ul className="space-y-1">
                {notes.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-foreground">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.bullets.length === 0 && notes.paragraphs.length === 0 && (
            <div className="mt-3 text-[13px] text-muted-foreground">暂无更新说明</div>
          )}
          {notes.paragraphs.length > 0 && (
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              {notes.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
        </div>

        {/* 下载进度 */}
        {phase.kind === 'downloading' && (
          <div className="px-4 pb-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: phase.percent !== null ? `${phase.percent}%` : '100%',
                }}
              />
            </div>
            <div className="mt-1 text-right text-[11px] text-muted-foreground">
              {phase.percent !== null ? `${phase.percent}%` : '下载中…'}
            </div>
          </div>
        )}

        {/* 操作区 */}
        <div className="flex items-center justify-end gap-2 border-t border-border/40 px-4 py-3">
          {phase.kind === 'confirm' && (
            <>
              <button
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                稍后提醒
              </button>
              <button
                onClick={() => startDownload().catch(() => undefined)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                立即更新
              </button>
            </>
          )}
          {phase.kind === 'downloading' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在下载更新,请勿关闭应用…
            </span>
          )}
          {phase.kind === 'ready' && (
            <button
              onClick={() =>
                relaunchApp().catch((e) =>
                  showToast(
                    `重启失败:${e instanceof Error ? e.message : String(e)}`,
                    'err',
                  ),
                )
              }
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              重启完成更新
            </button>
          )}
        </div>

        {toast && <FloatingToast toast={toast} />}
      </div>
    </div>
  );
}
