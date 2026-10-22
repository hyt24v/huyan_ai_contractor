/** 各 agent 的小徽标：字母 + 品牌色调，支持点击切换启用状态 */
import { AGENTS, type AgentId } from '../../lib/agents';
import type { SkillAgentState } from '../../lib/skills';

const AGENT_TONE: Record<AgentId, string> = {
  claude: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  codex: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  pi: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  cursor: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  gemini: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
};

const AGENT_LETTER: Record<AgentId, string> = {
  claude: 'C',
  codex: 'X',
  pi: 'P',
  cursor: 'Cu',
  gemini: 'G',
};

const STATE_LABEL: Record<SkillAgentState, string> = {
  linked: '已启用',
  local: '本地技能',
  none: '未启用',
};

export function agentName(id: AgentId): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
}

export function agentLetter(id: AgentId): string {
  return AGENT_LETTER[id];
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'h-5 w-5 text-[9px]',
  md: 'h-9 w-9 rounded-xl text-[12px]',
};

export interface AgentBadgeProps {
  agent: AgentId;
  state?: SkillAgentState;
  /** 传入后变成可点击按钮（点击切换该 agent 的启用状态） */
  onClick?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

export default function AgentBadge({
  agent,
  state = 'none',
  onClick,
  size = 'sm',
  className = '',
}: AgentBadgeProps) {
  const label = `${agentName(agent)} · ${STATE_LABEL[state]}`;
  const tone =
    state === 'none'
      ? 'border-border bg-muted/50 text-muted-foreground/60'
      : `${AGENT_TONE[agent]} border-transparent`;
  const base = `inline-flex shrink-0 items-center justify-center border font-semibold leading-none ${SIZE_CLASS[size]} ${tone} ${className}`;
  const shape = size === 'sm' ? 'rounded-full' : 'rounded-xl';

  if (onClick) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClick();
        }}
        className={`${base} ${shape} transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        {AGENT_LETTER[agent]}
      </button>
    );
  }

  return (
    <span title={label} aria-label={label} className={`${base} ${shape}`}>
      {AGENT_LETTER[agent]}
    </span>
  );
}