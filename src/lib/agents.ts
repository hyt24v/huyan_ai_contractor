/**
 * 本机 agent 注册表:skills 目录 / MCP 配置文件位置(相对 $HOME)。
 * 56 个内置 agent,路径定义与 skills-manager 对齐;
 * 现有 5 个 id(claude/codex/pi/cursor/gemini)保持不变以兼容存量数据。
 */

export type AgentId = string;

export interface AgentDef {
  id: AgentId;
  name: string;
  /** skills 目录(相对 $HOME) */
  skillsDir: string;
  /** MCP 配置文件(相对 $HOME);未知/不支持为 undefined,UI 置灰 */
  mcpFile?: string;
  mcpFormat?: 'json' | 'toml';
  /** 该 agent 的 mcpServers 条目支持 enabled 字段(pi) */
  hasEnabledFlag?: boolean;
}

/** 用于「是否已安装」检测的目录(相对 $HOME):skillsDir 去掉末尾 /skills */
export function detectDirOf(agent: AgentDef): string {
  return agent.skillsDir.replace(/\/skills$/, '');
}

/** 该 agent 是否支持 MCP 配置管理 */
export function hasMcpSupport(agent: AgentDef): boolean {
  return !!agent.mcpFile;
}

export const AGENTS: AgentDef[] = [
  // —— 原有 5 个(id 与数据兼容,勿改 id)——
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
  // —— 扩展 51 个(路径与 skills-manager 对齐;MCP 配置路径未知,暂不支持)——
  { id: 'grok', name: 'Grok', skillsDir: '.grok/skills' },
  { id: 'opencode', name: 'OpenCode', skillsDir: '.config/opencode/skills' },
  { id: 'antigravity', name: 'Antigravity', skillsDir: '.gemini/antigravity/skills' },
  { id: 'amp', name: 'Amp', skillsDir: '.config/agents/skills' },
  { id: 'kilo_code', name: 'Kilo Code', skillsDir: '.kilocode/skills' },
  { id: 'roo_code', name: 'Roo Code', skillsDir: '.roo/skills' },
  { id: 'goose', name: 'Goose', skillsDir: '.config/goose/skills' },
  { id: 'github_copilot', name: 'GitHub Copilot', skillsDir: '.copilot/skills' },
  { id: 'openclaw', name: 'OpenClaw', skillsDir: '.openclaw/skills' },
  { id: 'droid', name: 'Droid', skillsDir: '.factory/skills' },
  { id: 'windsurf', name: 'Windsurf', skillsDir: '.codeium/windsurf/skills' },
  { id: 'trae', name: 'TRAE IDE', skillsDir: '.trae/skills' },
  { id: 'cline', name: 'Cline', skillsDir: '.agents/skills' },
  { id: 'deepagents', name: 'Deep Agents', skillsDir: '.deepagents/agent/skills' },
  { id: 'firebender', name: 'Firebender', skillsDir: '.firebender/skills' },
  { id: 'kimi', name: 'Kimi Code CLI', skillsDir: '.kimi-code/skills' },
  { id: 'replit', name: 'Replit', skillsDir: '.config/agents/skills' },
  { id: 'warp', name: 'Warp', skillsDir: '.agents/skills' },
  { id: 'augment', name: 'Augment', skillsDir: '.augment/skills' },
  { id: 'bob', name: 'IBM Bob', skillsDir: '.bob/skills' },
  { id: 'codebuddy', name: 'CodeBuddy', skillsDir: '.codebuddy/skills' },
  { id: 'command_code', name: 'Command Code', skillsDir: '.commandcode/skills' },
  { id: 'continue', name: 'Continue', skillsDir: '.continue/skills' },
  { id: 'cortex', name: 'Cortex Code', skillsDir: '.snowflake/cortex/skills' },
  { id: 'crush', name: 'Crush', skillsDir: '.config/crush/skills' },
  { id: 'iflow', name: 'iFlow CLI', skillsDir: '.iflow/skills' },
  { id: 'junie', name: 'Junie', skillsDir: '.junie/skills' },
  { id: 'kiro', name: 'Kiro CLI', skillsDir: '.kiro/skills' },
  { id: 'kode', name: 'Kode', skillsDir: '.kode/skills' },
  { id: 'mcpjam', name: 'MCPJam', skillsDir: '.mcpjam/skills' },
  { id: 'mistral_vibe', name: 'Mistral Vibe', skillsDir: '.vibe/skills' },
  { id: 'mux', name: 'Mux', skillsDir: '.mux/skills' },
  { id: 'neovate', name: 'Neovate', skillsDir: '.neovate/skills' },
  { id: 'openhands', name: 'OpenHands', skillsDir: '.openhands/skills' },
  { id: 'pochi', name: 'Pochi', skillsDir: '.pochi/skills' },
  { id: 'qoder', name: 'Qoder', skillsDir: '.qoder/skills' },
  { id: 'qwen_code', name: 'Qwen Code', skillsDir: '.qwen/skills' },
  { id: 'trae_cn', name: 'TRAE CN', skillsDir: '.trae-cn/skills' },
  { id: 'zencoder', name: 'Zencoder', skillsDir: '.zencoder/skills' },
  { id: 'zcode', name: 'ZCode', skillsDir: '.zcode/skills' },
  { id: 'adal', name: 'AdaL', skillsDir: '.adal/skills' },
  { id: 'hermes', name: 'Hermes Agent', skillsDir: '.hermes/skills' },
  { id: 'qclaw', name: 'QClaw', skillsDir: '.qclaw/skills' },
  { id: 'easyclaw', name: 'EasyClaw', skillsDir: '.easyclaw/skills' },
  { id: 'autoclaw', name: 'AutoClaw', skillsDir: '.openclaw-autoclaw/skills' },
  { id: 'workbuddy', name: 'WorkBuddy', skillsDir: '.workbuddy/skills' },
  { id: 'workbuddy_overseas', name: 'WorkBuddy AI', skillsDir: '.workbuddy-ai/skills' },
  { id: 'deepseek_harness', name: 'DeepSeek Harness', skillsDir: '.dsh/skills' },
  { id: 'gitlab_duo', name: 'GitLab Duo', skillsDir: '.gitlab/duo/skills' },
  { id: 'minimax_code', name: 'MiniMax Code', skillsDir: '.minimax/skills' },
  { id: 'omp_agent', name: 'OMP Agent', skillsDir: '.omp/agent/skills' },
];

export const agentById = (id: AgentId): AgentDef => {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw new Error(`未知 agent: ${id}`);
  return a;
};

/** 中央 skill 库目录(相对 $HOME),本身可直接 git 管理 */
export const SKILL_LIBRARY_DIR = 'ai-skills';
