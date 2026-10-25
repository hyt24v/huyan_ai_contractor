/**
 * 「先看后切」确认弹窗（借鉴 cc-switch：切换类操作先看只读预览，
 * 确认按钮文案写明后果，避免“点了以为已生效/没看清就生效”）。
 * 用于套餐应用、模型服务应用等会改写 agent 配置的破坏性操作。
 */
import type { ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmApplyDialog({
  title,
  preview,
  consequences,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** 只读预览区：即将应用的内容明细 */
  preview: ReactNode;
  /** 后果说明（逐条列出，会逐字展示给用户） */
  consequences: string[];
  /** 确认按钮文案，需写明动作，如「确认应用套餐」 */
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">{title}</span>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{preview}</div>

        <div className="shrink-0 border-t bg-warning/10 px-4 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-warning-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            确认后将发生
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
            {consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
          <button
            onClick={onCancel}
            className="h-8 rounded-md border border-input px-3 text-xs transition-colors hover:bg-accent"
          >
            取消
          </button>
          <button
            disabled={busy}
            onClick={onConfirm}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
