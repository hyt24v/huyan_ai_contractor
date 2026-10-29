/** 表单控件补齐：Select / Checkbox / Tabs —— 与 controls.tsx 的 Button/Input 同密度规范 */
import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

// ── Select ──────────────────────────────────────────────────────────────────

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...rest }, ref) {
    return (
      <span className={`relative inline-flex ${className.includes('w-') ? '' : 'w-full'} ${className}`}>
        <select
          ref={ref}
          className="h-8 w-full appearance-none rounded-md border border-input bg-transparent pl-2.5 pr-7 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 dark:bg-input/30"
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </span>
    );
  },
);

// ── Checkbox ────────────────────────────────────────────────────────────────

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 text-xs text-foreground ${disabled ? 'pointer-events-none opacity-40' : ''} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm accent-primary"
      />
      {label}
    </label>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className = '',
}: {
  items: { key: T; label: ReactNode }[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5 ${className}`}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-xs transition-colors ${
            active === it.key
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
