/** 浮层组件：Dialog / Popover / Tooltip —— 统一定位、关闭行为、focus 管理 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// ── Dialog ──────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 宽度档位：max-w-sm/md/lg/xl/2xl */
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // 焦点移入弹窗
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[85vh] w-full flex-col rounded-lg border border-border bg-card ${width}`}
      >
        {title !== undefined && (
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="text-xs font-medium text-foreground">{title}</div>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onClose}
              aria-label="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Popover ─────────────────────────────────────────────────────────────────

export function Popover({
  open,
  onClose,
  anchor,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  /** 锚点元素（用于定位）；为空时相对最近 relative 父级 */
  anchor?: HTMLElement | null;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`fixed z-50 rounded-lg border border-border bg-card ${className}`}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

export function Tooltip({
  content,
  children,
  delay = 300,
}: {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        timer.current = setTimeout(() => setShow(true), delay);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setShow(false);
      }}
    >
      {children}
      {show && content && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground">
          {content}
        </span>
      )}
    </span>
  );
}
