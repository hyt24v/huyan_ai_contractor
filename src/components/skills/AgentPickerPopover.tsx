/** 可搜索的 Agent 多选弹层：批量操作 / AddSkillsPicker 等场景选择部署目标 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { AgentDef, AgentId } from '../../lib/agents';
import AgentBadge from './AgentBadge';

export interface AgentPickerPopoverProps {
  agents: AgentDef[];
  selected: Set<AgentId>;
  onChange: (next: Set<AgentId>) => void;
  disabled?: boolean;
  /** 面板向上展开（用于页面底部固定栏） */
  align?: 'up' | 'down';
  /** 触发按钮前缀文案，默认「Agent」 */
  label?: string;
  className?: string;
}

export default function AgentPickerPopover({
  agents,
  selected,
  onChange,
  disabled,
  align = 'down',
  label = 'Agent',
  className = '',
}: AgentPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      // 等弹层挂载后再聚焦
      requestAnimationFrame(() => inputRef.current?.focus());
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(needle) || a.id.includes(needle));
  }, [agents, query]);

  const toggle = (id: AgentId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const allSelected = agents.length > 0 && agents.every((a) => selected.has(a.id));
  // selected 里可能带着后来被隐藏的 agent，计数只统计当前 agents 列表内的
  const selectedVisible = agents.filter((a) => selected.has(a.id)).length;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="选择目标 Agent"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-card px-2 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-40"
      >
        {label}
        <span className="tabular-nums text-muted-foreground">
          {selectedVisible}/{agents.length}
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-30 w-60 overflow-hidden rounded-md border bg-card shadow-lg ${
              align === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
            } left-0`}
          >
            {agents.length > 8 && (
              <div className="border-b p-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索 Agent…"
                    className="h-7 w-full rounded-md border border-input bg-transparent pl-6 pr-2 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            )}
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  没有匹配的 Agent
                </div>
              ) : (
                filtered.map((a) => {
                  const on = selected.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(a.id)}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                        on ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      <AgentBadge agent={a.id} state={on ? 'linked' : 'none'} />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span
                        className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${
                          on ? 'border-primary bg-primary' : 'border-input'
                        }`}
                      >
                        {on && (
                          <svg viewBox="0 0 14 14" className="h-full w-full text-primary-foreground">
                            <path
                              d="M3 7.5 6 10.5 11 4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center gap-1 border-t px-2 py-1.5">
              <button
                type="button"
                disabled={allSelected}
                onClick={() => onChange(new Set(agents.map((a) => a.id)))}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                全选
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => onChange(new Set())}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                清空
              </button>
              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
                已选 {selectedVisible}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
