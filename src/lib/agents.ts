/** 本机 agent 注册表：skills 目录与 MCP 配置文件位置（相对 $HOME） */

export type AgentId = 'claude' | 'codex' | 'pi' | 'cursor' | 'gemini';

export interface AgentDef {
  id: AgentId;
  name: string;
  /** skills 目录（相对 $HOME） */
  skillsDir: string;
  /** MCP 配置文件（相对 $HOME） */
  mcpFile: string;
  mcpFormat: 'json' | 'toml';
  /** 该 agent 的 mcpServers 条目支持 enabled 字段（pi） */
  hasEnabledFlag?: boolean;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    skillsDir: '.claude/skills',
    mcpFile: '.claude.json',
    mcpFormat: 'json',
  },
  {
    id: 'codex',
    name: 'Codex',
    skillsDir: '.codex/skills',
    mcpFile: '.codex/config.toml',
    mcpFormat: 'toml',
  },
  {
    id: 'pi',
    name: 'Pi',
    skillsDir: '.pi/agent/skills',
    mcpFile: '.pi/agent/mcp.json',
    mcpFormat: 'json',
    hasEnabledFlag: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    skillsDir: '.cursor/skills',
    mcpFile: '.cursor/mcp.json',
    mcpFormat: 'json',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    skillsDir: '.gemini/skills',
    mcpFile: '.gemini/settings.json',
    mcpFormat: 'json',
  },
];

export const agentById = (id: AgentId): AgentDef => {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw new Error(`未知 agent: ${id}`);
  return a;
};

/** 中央 skill 库目录（相对 $HOME），本身可直接 git 管理 */
export const SKILL_LIBRARY_DIR = 'ai-skills';
