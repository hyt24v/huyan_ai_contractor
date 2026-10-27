/** 各 agent 的小徽标：字母 + 品牌色调，支持点击切换部署状态 */
import { AGENTS, type AgentId } from '../../lib/agents';
import type { SkillAgentState } from '../../lib/skills';

/** 已知 agent 的品牌色调（用主题 token，随主题变化）;未收录的走中性色 */
const AGENT_TONE: Record<string, string> = {
  claude: 'bg-json-number/15 text-json-number',
  codex: 'bg-json-boolean/15 text-json-boolean',
  pi: 'bg-info/15 text-info',
  cursor: 'bg-muted text-muted-foreground',
  gemini: 'bg-primary/10 text-primary',
};

const AGENT_LETTER: Record<string, string> = {
  claude: 'C',
  codex: 'X',
  pi: 'P',
  cursor: 'Cu',
  gemini: 'G',
};

const STATE_LABEL: Record<SkillAgentState, string> = {
  linked: '已部署',
  local: '本地技能',
  none: '未部署',
};

export function agentName(id: AgentId): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
}

export function agentLetter(id: AgentId): string {
  // 未收录的 agent 用名称首字母(大写)
  return AGENT_LETTER[id] ?? (agentName(id).charAt(0).toUpperCase() || '?');
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
      : `${AGENT_TONE[agent] ?? 'bg-primary/15 text-primary'} border-transparent`;
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
        {agentLetter(agent)}
      </button>
    );
  }

  return (
    <span title={label} aria-label={label} className={`${base} ${shape}`}>
      {agentLetter(agent)}
    </span>
  );
}