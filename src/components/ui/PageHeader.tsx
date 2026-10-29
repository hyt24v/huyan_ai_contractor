/** PageHeader：所有工具页的统一头部（标题 + 描述 + 右侧操作区） */
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex h-10 shrink-0 items-center gap-3 border-b border-border px-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xs font-medium text-foreground">{title}</h1>
          {description && <span className="truncate text-[11px] text-muted-foreground">{description}</span>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}
