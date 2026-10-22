import type { ReactNode } from 'react';

export type BadgeTone = 'error' | 'warning' | 'info' | 'success' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  error: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  neutral: 'border border-input bg-transparent text-muted-foreground',
};

/** 小号状态标签（严重程度、agent 名、配置状态等） */
export function StatusBadge({
  tone,
  children,
  className = '',
}: {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export default StatusBadge;