/**
 * 浮动 Toast 渲染组件（Magpie 基线）——配合 useToast 使用：
 *
 *   const { toast, showToast } = useToast();
 *   ...
 *   <FloatingToast toast={toast} />
 *
 * 样式基线：rounded-xl + border-border/70 + 浮层投影 shadow-[0_4px_16px_rgba(0,0,0,0.08)]；
 * err tone 走 destructive 语义 token（卡片底 + 红字），ok tone 走 card 底。
 */
import type { ToastState } from '../hooks/useToast';

export function FloatingToast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border px-3 py-2 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.08)] ${
        toast.tone === 'err'
          ? 'border-destructive/40 bg-card text-destructive'
          : 'border-border/70 bg-card text-foreground'
      }`}
    >
      {toast.msg}
    </div>
  );
}
