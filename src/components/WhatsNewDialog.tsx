/** 「本次更新了什么」弹窗：版本更新后首次启动展示当前版本的更新日志（借鉴 ColaMD） */
import { Sparkles, X } from 'lucide-react';
import { parseReleaseNotes } from '../lib/releaseNotes';

export default function WhatsNewDialog({
  version,
  body,
  onClose,
}: {
  version: string;
  body: string;
  onClose: () => void;
}) {
  const notes = parseReleaseNotes(body);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`已更新到 v${version}`}
        className="w-full max-w-md overflow-hidden rounded-lg border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">已更新到 v{version}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto px-4 py-3">
          {notes.bullets.length > 0 ? (
            <ul className="space-y-1">
              {notes.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-foreground">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0">{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[13px] text-muted-foreground">本次更新没有说明</div>
          )}
          {notes.paragraphs.length > 0 && (
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              {notes.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-border/40 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
