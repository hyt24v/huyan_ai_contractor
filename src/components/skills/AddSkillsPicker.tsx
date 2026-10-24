/** 从中央库挑选 skills 并批量部署到多个 agent */
import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Search, Square, X } from 'lucide-react';
import type { AgentId } from '../../lib/agents';
import { useAgents } from '../../hooks/useAgents';
import { skillEnabledAnywhere, type CatalogSkill } from '../../lib/skillCatalog';
import AgentBadge from './AgentBadge';
import { TagPill } from './SkillCard';

export interface AddSkillsPickerProps {
  open: boolean;
  skills: CatalogSkill[];
  initialAgents: AgentId[];
  busy?: boolean;
  onClose: () => void;
  onDeploy: (names: string[], agents: AgentId[]) => void;
}

export default function AddSkillsPicker({
  open,
  skills,
  initialAgents,
  busy,
  onClose,
  onDeploy,
}: AddSkillsPickerProps) {
  const visibleAgents = useAgents();
  const visibleAgentIds = visibleAgents.map((a) => a.id);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [agents, setAgents] = useState<Set<AgentId>>(() => new Set(initialAgents));
  const initialKey = initialAgents.join(',');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(new Set());
    setAgents(new Set(initialKey ? (initialKey.split(',') as AgentId[]) : []));
  }, [open, initialKey]);

  const librarySkills = useMemo(
    () => skills.filter((s) => s.inLibrary).sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return librarySkills;
    return librarySkills.filter((s) =>
      [s.name, s.description ?? '', ...s.tags].join(' ').toLowerCase().includes(needle),
    );
  }, [librarySkills, query]);

  if (!open) return null;

  const toggleSkill = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAgent = (agent: AgentId) => {
    setAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = visible.every((s) => next.has(s.name));
      for (const s of visible) {
        if (allSelected) next.delete(s.name);
        else next.add(s.name);
      }
      return next;
    });
  };

  const allAgentsSelected = visibleAgents.every((a) => agents.has(a.id));
  const canDeploy = selected.size > 0 && agents.size > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label="从中央库添加 Skills"
        className="absolute left-1/2 top-1/2 flex max-h-[82vh] w-[760px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <span className="text-sm font-semibold">从中央库添加 Skills</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            库内 {librarySkills.length} 个
          </span>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 目标 Agent 始终可见 */}
        <div className="shrink-0 border-b bg-muted/30 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium text-muted-foreground">目标 Agent</span>
            {visibleAgents.map((a) => {
              const on = agents.has(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAgent(a.id)}
                  title={on ? `取消 ${a.name}` : `选择 ${a.name}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
                    on
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <AgentBadge agent={a.id} state={on ? 'linked' : 'none'} />
                  {a.name}
                </button>
              );
            })}
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAgents(new Set(visibleAgentIds))}
                disabled={allAgentsSelected}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setAgents(new Set())}
                disabled={agents.size === 0}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                清空
              </button>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索库内 skills…"
              className="h-8 w-full rounded-md border border-input bg-transparent pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={selectAllVisible}
            disabled={visible.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-[11px] font-medium hover:bg-accent disabled:opacity-40"
          >
            {visible.length > 0 && visible.every((s) => selected.has(s.name)) ? (
              <CheckSquare className="h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            全选当前
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-[11px] font-medium hover:bg-accent disabled:opacity-40"
          >
            清空
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {visible.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              没有匹配的库内 skill，先去「安装 Skills」添加吧
            </div>
          ) : (
            <ul className="divide-y">
              {visible.map((skill) => {
                const on = selected.has(skill.name);
                return (
                  <li key={skill.name}>
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill.name)}
                      className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition hover:bg-accent/40 ${
                        on ? 'bg-accent/30' : ''
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 text-muted-foreground">
                        {on ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[12px] font-medium">{skill.name}</span>
                          {skillEnabledAnywhere(skill) && (
                            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                              已启用
                            </span>
                          )}
                          {skill.tags.slice(0, 3).map((tag) => (
                            <TagPill key={tag} tag={tag} />
                          ))}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {skill.description || '暂无描述'}
                        </span>
                      </span>
                      <span className="mt-0.5 flex shrink-0 items-center gap-1">
                        {visibleAgents.filter((a) => (skill.agents[a.id] ?? 'none') !== 'none').map((a) => (
                          <AgentBadge key={a.id} agent={a.id} state={skill.agents[a.id]} />
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            已选 <strong className="text-foreground">{selected.size}</strong> 个 skill ×{' '}
            <strong className="text-foreground">{agents.size}</strong> 个 Agent
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canDeploy}
              onClick={() => onDeploy([...selected], [...agents])}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? '部署中…' : '批量部署'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}