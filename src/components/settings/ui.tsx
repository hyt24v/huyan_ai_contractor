/** 设置页共享 UI 原语:行布局 / 开关 / 分组容器 */
import type { ReactNode } from 'react';

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export function SettingGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card">
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full text-left transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function LinkButton({
  onClick,
  children,
  primary,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        primary
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border/60 text-foreground hover:bg-accent/60'
      }`}
    >
      {children}
    </button>
  );
}
