import type { ReactNode } from 'react';
import { Button } from './ui/controls';

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
      {children}
    </div>
  );
}

/** 工具栏按钮（dbx 密度：h-8 px-2.5 text-xs，无阴影） */
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
  return (
    <Button
      variant={primary ? 'default' : active ? 'ghost' : 'outline'}
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={active ? 'bg-accent text-accent-foreground' : ''}
    >
      {children}
    </Button>
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
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
