/** 各 agent 的提示词（AGENTS.md / CLAUDE.md 等）目标文件位置（相对 $HOME） */
import type { AgentId } from './agents';

export interface PromptTarget {
  agent: AgentId;
  /** 展示名 */
  label: string;
  /** 目标文件（相对 $HOME）；不可写的 agent 为 null */
  file: string | null;
  /** 是否支持通过写文件配置（Cursor 的全局规则只在设置界面，不落盘） */
  writable: boolean;
  /** 不可写时给用户的说明 */
  hint?: string;
}

export const PROMPT_TARGETS: PromptTarget[] = [
  { agent: 'claude', label: 'Claude Code', file: '.claude/CLAUDE.md', writable: true },
  { agent: 'codex', label: 'Codex', file: '.codex/AGENTS.md', writable: true },
  { agent: 'pi', label: 'Pi', file: '.pi/agent/AGENTS.md', writable: true },
  {
    agent: 'cursor',
    label: 'Cursor',
    file: null,
    writable: false,
    hint: 'Cursor 的全局规则不落盘，请在 Cursor 设置 → Rules 中手动配置',
  },
  { agent: 'gemini', label: 'Gemini CLI', file: '.gemini/GEMINI.md', writable: true },
];

export function promptTarget(agent: AgentId): PromptTarget {
  const t = PROMPT_TARGETS.find((x) => x.agent === agent);
  if (!t) throw new Error(`未知 agent: ${agent}`);
  return t;
}

/** 该 agent 的提示词目标文件路径；不可写的 agent 抛错 */
export function promptTargetFile(agent: AgentId): string {
  const t = promptTarget(agent);
  if (!t.writable || !t.file) {
    throw new Error(t.hint ?? `${t.label} 不支持写入提示词文件`);
  }
  return t.file;
}