/** 各 agent 的提示词（AGENTS.md / CLAUDE.md 等）目标文件位置（相对 $HOME） */
import type { AgentId } from './agents';

export interface PromptTarget {
  agent: AgentId;
  /** 展示名 */
  label: string;
  /** 目标文件（相对 $HOME） */
  file: string;
}

export const PROMPT_TARGETS: PromptTarget[] = [
  { agent: 'claude', label: 'Claude Code', file: '.claude/CLAUDE.md' },
  { agent: 'codex', label: 'Codex', file: '.codex/AGENTS.md' },
  { agent: 'pi', label: 'Pi', file: '.pi/agent/AGENTS.md' },
  // Cursor 没有全局 AGENTS.md，只有 rules 目录下的 .mdc；写文件时自动建目录
  { agent: 'cursor', label: 'Cursor', file: '.cursor/rules/global.mdc' },
  { agent: 'gemini', label: 'Gemini CLI', file: '.gemini/GEMINI.md' },
];

export function promptTarget(agent: AgentId): PromptTarget {
  const t = PROMPT_TARGETS.find((x) => x.agent === agent);
  if (!t) throw new Error(`未知 agent: ${agent}`);
  return t;
}