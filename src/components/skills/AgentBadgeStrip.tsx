/** skill 卡片上的 Agent 徽标条：只显示已部署/本地的徽标（最多 max 个），
 *  其余折叠为 +N 弹层（带搜索）；全部未部署时显示「未部署 + 部署…」入口。
 *  解决可见 Agent 多达几十个时卡片被灰点撑爆的问题。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { AgentDef, AgentId } from '../../lib/agents';
import type { SkillAgentState } from '../../lib/skills';
import AgentBadge from './AgentBadge';

const STATE_LABEL: Record<SkillAgentState, string> = {
  linked: '已部署',
  local: '本地',
  none: '未部署',
};

export interface AgentBadgeStripProps {
  agents: AgentDef[];
  /** skill.agents 记录（可能缺键，读取时用 ?? 'none' 兜底） */
  states: Partial<Record<AgentId, SkillAgentState>>;
  busy?: boolean;
  /** 直接展示的徽标上限，默认 4 */
  max?: number;
  /** 点击徽标：父层负责 linked/none 切换部署、local 收编 */
  onPress: (agent: AgentId, state: SkillAgentState) => void;
}

export default function AgentBadgeStrip({
  agents,
  states,
  busy,
  max = 4,
  onPress,
}: AgentBadgeStripProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const stateOf = (id: AgentId): SkillAgentState => states[id] ?? 'none';

  // busy 时连直显徽标也一起拦截（AgentBadge 本身无 disabled 属性）
  const handlePress = (id: AgentId, st: SkillAgentState) => {
    if (!busy) onPress(id, st);
  };

  // Escape 关闭弹层
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const active = useMemo(
    () => agents.filter((a) => stateOf(a.id) !== 'none'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, states],
  );
  const shown = active.slice(0, max);
  const overflow = active.length - shown.length;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = [...agents].sort((a, b) => {
      // 有状态的排前面，便于弹层里直接看到已部署目标
      const rank = (s: SkillAgentState) => (s === 'none' ? 1 : 0);
      return rank(stateOf(a.id)) - rank(stateOf(b.id));
    });
    if (!needle) return list;
    return list.filter((a) => a.name.toLowerCase().includes(needle) || a.id.includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, states, query]);

  const popover = open && (
    <>
      <div
        className="fixed inset-0 z-20"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(false);
        }}
      />
      <div
        className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-md border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
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
              const st = stateOf(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    handlePress(a.id, st);
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
                >
                  <AgentBadge agent={a.id} state={st} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
                      st === 'linked'
                        ? 'bg-success/15 text-success'
                        : st === 'local'
                          ? 'bg-warning text-warning-foreground'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {STATE_LABEL[st]}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );

  // 键盘事件也要拦在卡片外，否则 Enter/空格会触发 SkillCard 的 onOpen 且 preventDefault 吞掉空格
  return (
    <span
      className="relative inline-flex min-w-0 items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {shown.map((a) => (
        <AgentBadge
          key={a.id}
          agent={a.id}
          state={stateOf(a.id)}
          onClick={() => handlePress(a.id, stateOf(a.id))}
        />
      ))}
      {overflow > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          title={`还有 ${overflow} 个 Agent，点击展开全部`}
          className="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-muted/50 px-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          +{overflow}
        </button>
      )}
      {active.length === 0 && (
        <>
          <span className="shrink-0 text-[10px] text-muted-foreground/70">未部署</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
            title="选择要部署到的 Agent"
            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 text-[10px] font-medium text-muted-foreground transition hover:border-ring/60 hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-2.5 w-2.5" />
            部署…
          </button>
        </>
      )}
      {active.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          title="展开全部 Agent 部署状态"
          aria-label="展开全部 Agent 部署状态"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {popover}
    </span>
  );
}
