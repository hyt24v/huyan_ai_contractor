import type { ReactNode } from 'react';

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-card px-3 py-2">
      {children}
    </div>
  );
}

/** shadcn 风格工具栏按钮 */
export function ToolbarButton({
  onClick,
  children,
  title,
  primary,
  active,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  const base =
    'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
    'disabled:pointer-events-none disabled:opacity-50';
  const color = primary
    ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
    : active
      ? 'bg-accent text-accent-foreground'
      : 'border border-input bg-transparent text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground';
  return (
    <button onClick={onClick} title={title} disabled={disabled} className={`${base} ${color}`}>
      {children}
    </button>
  );
}

export function ToolbarDivider() {
  return <div className="mx-1 h-4 w-px bg-border" />;
}

/** 分段选择控件（对标 cc-switch 的 segmented control） */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-7 rounded-sm px-3 text-xs font-medium transition-all ${
            value === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
