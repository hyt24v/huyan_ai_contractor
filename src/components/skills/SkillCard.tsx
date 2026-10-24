/** 中央库 / Agent 工作区的 skill 卡片 */
import { useState } from 'react';
import {
  ArrowUpCircle,
  CheckSquare,
  FileText,
  Folder,
  FolderInput,
  GitBranch,
  Globe2,
  MoreHorizontal,
  Square,
  Cable,
  Trash2,
} from 'lucide-react';
import type { AgentId } from '../../lib/agents';
import { useAgents } from '../../hooks/useAgents';
import {
  skillEnabledAnywhere,
  sourceLabel,
  type CatalogSkill,
  type SkillSource,
} from '../../lib/skillCatalog';
import AgentBadge from './AgentBadge';

const TAG_TONES = [
  'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  'bg-teal-500/10 text-teal-700 dark:text-teal-300',
];

export function tagTone(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_TONES[hash % TAG_TONES.length];
}

export function TagPill({
  tag,
  active,
  count,
  onClick,
}: {
  tag: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}) {
  const cls = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
    active
      ? 'border-primary/40 bg-primary/10 text-foreground'
      : `border-transparent ${tagTone(tag)}`
  }`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} hover:brightness-95`}>
        {tag}
        {typeof count === 'number' && <span className="opacity-60">{count}</span>}
      </button>
    );
  }
  return (
    <span className={cls}>
      {tag}
      {typeof count === 'number' && <span className="opacity-60">{count}</span>}
    </span>
  );
}

const SOURCE_ICON: Record<SkillSource, typeof Folder> = {
  local: Folder,
  git: GitBranch,
  'skills.sh': Globe2,
  unknown: Folder,
};

function Switch({
  on,
  disabled,
  onToggle,
  title,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'bg-success' : 'bg-muted-foreground/25'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
        danger ? 'text-destructive' : 'text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

export interface SkillCardProps {
  skill: CatalogSkill;
  layout: 'grid' | 'list';
  selected: boolean;
  busy?: boolean;
  /** Agent 工作区视角：只关心该 agent 的状态 */
  focusAgent?: AgentId;
  onOpen: () => void;
  onToggleSelect: () => void;
  onToggleAll: () => void;
  onToggleAgent: (agent: AgentId) => void;
  onAdopt: (agent: AgentId) => void;
  onSyncAll: () => void;
  onUpdate: () => void;
}

export default function SkillCard({
  skill,
  layout,
  selected,
  busy,
  focusAgent,
  onOpen,
  onToggleSelect,
  onToggleAll,
  onToggleAgent,
  onAdopt,
  onSyncAll,
  onUpdate,
}: SkillCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const agents = useAgents();
  const enabledAnywhere = skillEnabledAnywhere(skill);
  const switchOn = focusAgent
    ? skill.agents[focusAgent] === 'linked'
    : enabledAnywhere;
  const localAgents = agents.filter((a) => skill.agents[a.id] === 'local');
  const focusState = focusAgent ? skill.agents[focusAgent] : null;

  const menu = menuOpen && (
    <>
      <div
        className="fixed inset-0 z-20"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(false);
        }}
      />
      <div
        className="absolute right-0 top-7 z-30 w-44 overflow-hidden rounded-md border bg-card py-1 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem
          icon={FileText}
          label="查看详情"
          onClick={() => {
            setMenuOpen(false);
            onOpen();
          }}
        />
        {skill.inLibrary && (
          <MenuItem
            icon={Cable}
            label="启用到全部 Agent"
            onClick={() => {
              setMenuOpen(false);
              onSyncAll();
            }}
          />
        )}
        {localAgents.length > 0 && (
          <MenuItem
            icon={FolderInput}
            label="收编到中央库"
            onClick={() => {
              setMenuOpen(false);
              if (localAgents[0]) onAdopt(localAgents[0].id);
            }}
          />
        )}
        {skill.gitRemote && (
          <MenuItem
            icon={ArrowUpCircle}
            label="从 Git 更新"
            onClick={() => {
              setMenuOpen(false);
              onUpdate();
            }}
          />
        )}
        {focusAgent && focusState === 'linked' && (
          <MenuItem
            icon={Trash2}
            label="删除本地链接"
            danger
            onClick={() => {
              setMenuOpen(false);
              onToggleAgent(focusAgent);
            }}
          />
        )}
      </div>
    </>
  );

  const checkbox = (
    <button
      type="button"
      aria-label={selected ? '取消选择' : '选择该 skill'}
      title={selected ? '取消选择' : '选择该 skill'}
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect();
      }}
      className={`shrink-0 rounded text-muted-foreground/70 transition hover:text-foreground ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
      }`}
    >
      {selected ? (
        <CheckSquare className="h-4 w-4 text-primary" />
      ) : (
        <Square className="h-4 w-4" />
      )}
    </button>
  );

  const switchEl = (
    <Switch
      on={switchOn}
      disabled={busy || !skill.inLibrary}
      onToggle={focusAgent ? () => onToggleAgent(focusAgent) : onToggleAll}
      title={
        !skill.inLibrary
          ? '先收编到中央库才能启用'
          : focusAgent
            ? switchOn
              ? '从该 Agent 禁用'
              : '在该 Agent 启用'
            : switchOn
              ? '从全部 Agent 禁用'
              : '启用到全部 Agent'
      }
    />
  );

  const menuButton = (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="更多操作"
        title="更多操作"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu}
    </div>
  );

  const agentBadges = (
    <div className="flex items-center gap-1">
      {agents.map((a) => (
        <AgentBadge
          key={a.id}
          agent={a.id}
          state={skill.agents[a.id]}
          onClick={() =>
            skill.agents[a.id] === 'local' ? onAdopt(a.id) : onToggleAgent(a.id)
          }
        />
      ))}
    </div>
  );

  if (layout === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className={`group flex cursor-pointer items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left shadow-sm transition hover:border-ring/60 hover:bg-accent/30 ${
          selected ? 'border-primary/50 ring-1 ring-primary/30' : ''
        }`}
      >
        {checkbox}
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            enabledAnywhere ? 'bg-success' : 'bg-muted-foreground/30'
          }`}
        />
        <span className="w-48 shrink-0 truncate font-mono text-[13px] font-medium">
          {skill.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {skill.description || '暂无描述'}
        </span>
        <span className="hidden shrink-0 items-center gap-1 lg:flex">
          {skill.tags.slice(0, 2).map((tag) => (
            <TagPill key={tag} tag={tag} />
          ))}
        </span>
        {focusAgent ? (
          <span className="shrink-0">
            <AgentBadge
              agent={focusAgent}
              state={skill.agents[focusAgent]}
              onClick={() => onToggleAgent(focusAgent)}
            />
          </span>
        ) : (
          <span className="hidden shrink-0 sm:block">{agentBadges}</span>
        )}
        {skill.gitRemote && (
          <button
            type="button"
            title={`从 Git 更新（${skill.gitRemote}）`}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate();
            }}
            className="shrink-0 rounded p-1 text-muted-foreground/70 hover:text-foreground"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
          </button>
        )}
        {switchEl}
        {menuButton}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group flex cursor-pointer flex-col rounded-lg border bg-card p-3 text-left shadow-sm transition hover:border-ring/60 hover:shadow-md ${
        selected ? 'border-primary/50 ring-2 ring-primary/25' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        {checkbox}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            enabledAnywhere ? 'bg-success' : 'bg-muted-foreground/30'
          }`}
          title={enabledAnywhere ? '已在某个 Agent 启用' : '未启用'}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">
          {skill.name}
        </span>
        {switchEl}
        {menuButton}
      </div>

      <p
        className="mt-1.5 min-h-[2.4rem] break-words text-xs leading-5 text-muted-foreground line-clamp-3"
        title={skill.description}
      >
        {skill.description || '暂无描述（可在详情中查看 SKILL.md）'}
      </p>

      <div className="mt-2 flex min-h-[1.35rem] flex-wrap gap-1">
        {skill.tags.slice(0, 3).map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
        {skill.tags.length > 3 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            +{skill.tags.length - 3}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
        {focusState ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
              focusState === 'linked'
                ? 'bg-success/15 text-success'
                : focusState === 'local'
                  ? 'bg-warning text-warning-foreground'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {focusState === 'linked' ? '已同步' : focusState === 'local' ? '本地' : '未启用'}
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1">
            {(() => {
              const Icon = SOURCE_ICON[skill.source];
              return <Icon className="h-3 w-3 shrink-0" />;
            })()}
            <span className="truncate">{sourceLabel(skill.source)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="shrink-0">{skill.inLibrary ? '中央库' : '仅本地'}</span>
          </span>
        )}
        <span className="shrink-0">
          {focusAgent && focusState ? (
            <AgentBadge
              agent={focusAgent}
              state={focusState}
              onClick={() =>
                focusState === 'local' ? onAdopt(focusAgent) : onToggleAgent(focusAgent)
              }
            />
          ) : (
            agentBadges
          )}
        </span>
      </div>
    </div>
  );
}