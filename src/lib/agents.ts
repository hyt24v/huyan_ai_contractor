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
  /** 额外的 MCP 配置文件（只读合并扫描，分发只写 mcpFile 主文件）。如 qoder 同时读 settings.json 与 mcp.json */
  mcpExtraFiles?: string[];
  mcpFormat?: 'json' | 'toml';
  /** 该 agent 的 mcpServers 条目支持 enabled 字段(pi) */
  hasEnabledFlag?: boolean;
  /** MCP 服务器在 JSON 配置中的顶层键,默认 'mcpServers';支持点路径嵌套(amp 为 'amp.mcpServers') */
  mcpRootKey?: string;
  /** 服务器条目 schema:'standard'=mcpServers 标准(command/args/env/url，条目自带 type:'stdio'/'http');'opencode'=mcp 键下 {type:'local',command:[…]}/{type:'remote',url} */
  mcpSpecStyle?: 'standard' | 'opencode';
}

/** 用于「是否已安装」检测的目录(相对 $HOME):skillsDir 去掉末尾 /skills */
export function detectDirOf(agent: AgentDef): string {
  return agent.skillsDir.replace(/\/skills$/, '');
}

/** 该 agent 是否支持 MCP 配置管理 */
export function hasMcpSupport(agent: AgentDef): boolean {
  return !!agent.mcpFile;
}

/** 统一的 agent 显示名：查注册表 name，未知 id 兜底返回 id 本身。
 * 禁止再在各页面硬编码 AGENT_SHORT 映射表（56 个 agent 只有 5 个键会渲染空白）。 */
export function agentShortName(id: AgentId): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
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
  // —— 扩展 51 个(路径与 skills-manager 对齐;已核实的 MCP 配置见各条目)——
  {
    id: 'grok',
    name: 'Grok',
    skillsDir: '.grok/skills',
    // docs.x.ai/build/features/mcp-servers：TOML [mcp_servers.<name>]，与 codex 同构
    mcpFile: '.grok/config.toml',
    mcpFormat: 'toml',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    skillsDir: '.config/opencode/skills',
    mcpFile: '.config/opencode/opencode.json',
    mcpFormat: 'json',
    mcpRootKey: 'mcp',
    mcpSpecStyle: 'opencode',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    skillsDir: '.gemini/antigravity/skills',
    // antigravity.google/docs/mcp：App/IDE/CLI 共用
    mcpFile: '.gemini/config/mcp_config.json',
    mcpFormat: 'json',
  },
  {
    id: 'amp',
    name: 'Amp',
    skillsDir: '.config/agents/skills',
    mcpFile: '.config/amp/settings.json',
    mcpFormat: 'json',
    mcpRootKey: 'amp.mcpServers',
  },
  {
    id: 'kilo_code',
    name: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    mcpFile:
      'Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/settings/mcp_settings.json',
    mcpFormat: 'json',
  },
  {
    id: 'roo_code',
    name: 'Roo Code',
    skillsDir: '.roo/skills',
    mcpFile:
      'Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
    mcpFormat: 'json',
  },
  { id: 'goose', name: 'Goose', skillsDir: '.config/goose/skills' },
  {
    id: 'github_copilot',
    name: 'GitHub Copilot',
    skillsDir: '.copilot/skills',
    // docs.github.com copilot-cli：copilot mcp add 写入此文件
    mcpFile: '.copilot/mcp-config.json',
    mcpFormat: 'json',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    skillsDir: '.openclaw/skills',
    // docs.openclaw.ai：JSON5（含注释时读取会失败并按错误跳过，不会清空）
    mcpFile: '.openclaw/openclaw.json',
    mcpFormat: 'json',
    mcpRootKey: 'mcp.servers',
  },
  {
    id: 'droid',
    name: 'Droid',
    skillsDir: '.factory/skills',
    mcpFile: '.factory/mcp.json',
    mcpFormat: 'json',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    skillsDir: '.codeium/windsurf/skills',
    mcpFile: '.codeium/windsurf/mcp_config.json',
    mcpFormat: 'json',
  },
  { id: 'trae', name: 'TRAE IDE', skillsDir: '.trae/skills' },
  {
    id: 'cline',
    name: 'Cline',
    skillsDir: '.agents/skills',
    mcpFile:
      'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    mcpFormat: 'json',
  },
  {
    id: 'deepagents',
    name: 'Deep Agents',
    skillsDir: '.deepagents/agent/skills',
    // docs.langchain.com/oss/deepagents/code/mcp-tools
    mcpFile: '.deepagents/.mcp.json',
    mcpFormat: 'json',
  },
  {
    id: 'firebender',
    name: 'Firebender',
    skillsDir: '.firebender/skills',
    // docs.firebender.com/api-reference/syntax
    mcpFile: '.firebender/firebender.json',
    mcpFormat: 'json',
  },
  {
    id: 'kimi',
    name: 'Kimi Code CLI',
    skillsDir: '.kimi-code/skills',
    mcpFile: '.kimi-code/mcp.json',
    mcpFormat: 'json',
  },
  { id: 'replit', name: 'Replit', skillsDir: '.config/agents/skills' },
  {
    id: 'warp',
    name: 'Warp',
    skillsDir: '.agents/skills',
    mcpFile: '.warp/.mcp.json',
    mcpFormat: 'json',
  },
  { id: 'augment', name: 'Augment', skillsDir: '.augment/skills' },
  // bob.ibm.com/docs：远程条目用 httpURL 字段
  { id: 'bob', name: 'IBM Bob', skillsDir: '.bob/skills', mcpFile: '.bob/settings/mcp.json', mcpFormat: 'json' },
  // codebuddy.ai/docs/zh/cli/mcp：USER 作用域推荐 ~/.codebuddy/.mcp.json
  { id: 'codebuddy', name: 'CodeBuddy', skillsDir: '.codebuddy/skills', mcpFile: '.codebuddy/.mcp.json', mcpFormat: 'json' },
  // commandcode.ai/docs/mcp：条目用 transport 字段，type 为兼容别名
  { id: 'command_code', name: 'Command Code', skillsDir: '.commandcode/skills', mcpFile: '.commandcode/mcp.json', mcpFormat: 'json' },
  { id: 'continue', name: 'Continue', skillsDir: '.continue/skills' },
  // docs.snowflake.com cortex-code-mcp：type 为必填字段
  { id: 'cortex', name: 'Cortex Code', skillsDir: '.snowflake/cortex/skills', mcpFile: '.snowflake/cortex/mcp.json', mcpFormat: 'json' },
  {
    id: 'crush',
    name: 'Crush',
    skillsDir: '.config/crush/skills',
    mcpFile: '.config/crush/crush.json',
    mcpFormat: 'json',
    mcpRootKey: 'mcp',
  },
  // iflow-cli：~/.iflow/settings.json 顶层 mcpServers（2026-04 官方公告停服，配置仍有效）
  { id: 'iflow', name: 'iFlow CLI', skillsDir: '.iflow/skills', mcpFile: '.iflow/settings.json', mcpFormat: 'json' },
  // junie.jetbrains.com/docs/junie-cli-mcp-configuration
  { id: 'junie', name: 'Junie', skillsDir: '.junie/skills', mcpFile: '.junie/mcp/mcp.json', mcpFormat: 'json' },
  {
    id: 'kiro',
    name: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    mcpFile: '.kiro/settings/mcp.json',
    mcpFormat: 'json',
  },
  // Kode-CLI：user scope 写在 ~/.kode.json（中置信度）
  { id: 'kode', name: 'Kode', skillsDir: '.kode/skills', mcpFile: '.kode.json', mcpFormat: 'json' },
  { id: 'mcpjam', name: 'MCPJam', skillsDir: '.mcpjam/skills' },
  { id: 'mistral_vibe', name: 'Mistral Vibe', skillsDir: '.vibe/skills' },
  // mux.coder.com/config/mcp-servers：JSONC，顶层键是 servers（非 mcpServers）
  { id: 'mux', name: 'Mux', skillsDir: '.mux/skills', mcpFile: '.mux/mcp.jsonc', mcpFormat: 'json', mcpRootKey: 'servers' },
  // neovate config.ts：顶层 mcpServers，type 必填
  { id: 'neovate', name: 'Neovate', skillsDir: '.neovate/skills', mcpFile: '.neovate/config.json', mcpFormat: 'json' },
  { id: 'openhands', name: 'OpenHands', skillsDir: '.openhands/skills' },
  { id: 'pochi', name: 'Pochi', skillsDir: '.pochi/skills' },
  // docs.qoder.com/cli/mcp-reference
  { id: 'qoder', name: 'Qoder', skillsDir: '.qoder/skills', mcpFile: '.qoder/settings.json', mcpFormat: 'json', mcpExtraFiles: ['.qoder/mcp.json'] },
  {
    id: 'qwen_code',
    name: 'Qwen Code',
    skillsDir: '.qwen/skills',
    mcpFile: '.qwen/settings.json',
    mcpFormat: 'json',
  },
  { id: 'trae_cn', name: 'TRAE CN', skillsDir: '.trae-cn/skills' },
  { id: 'zencoder', name: 'Zencoder', skillsDir: '.zencoder/skills' },
  // zcode.z.ai/docs/mcp-services：~/.zcode/cli/config.json 的 mcp.servers
  { id: 'zcode', name: 'ZCode', skillsDir: '.zcode/skills', mcpFile: '.zcode/cli/config.json', mcpFormat: 'json', mcpRootKey: 'mcp.servers' },
  // adal-cli issue #125：~/.adal/settings.json 的 mcpServers（中置信度）
  { id: 'adal', name: 'AdaL', skillsDir: '.adal/skills', mcpFile: '.adal/settings.json', mcpFormat: 'json' },
  { id: 'hermes', name: 'Hermes Agent', skillsDir: '.hermes/skills' },
  { id: 'qclaw', name: 'QClaw', skillsDir: '.qclaw/skills' },
  { id: 'easyclaw', name: 'EasyClaw', skillsDir: '.easyclaw/skills' },
  { id: 'autoclaw', name: 'AutoClaw', skillsDir: '.openclaw-autoclaw/skills' },
  // 腾讯同产品系：与 codebuddy 共用 ~/.codebuddy/.mcp.json（幂等写入）
  { id: 'workbuddy', name: 'WorkBuddy', skillsDir: '.workbuddy/skills', mcpFile: '.codebuddy/.mcp.json', mcpFormat: 'json' },
  { id: 'workbuddy_overseas', name: 'WorkBuddy AI', skillsDir: '.workbuddy-ai/skills', mcpFile: '.codebuddy/.mcp.json', mcpFormat: 'json' },
  { id: 'deepseek_harness', name: 'DeepSeek Harness', skillsDir: '.dsh/skills' },
  // docs.gitlab.com gitlab_duo/mcp_clients
  { id: 'gitlab_duo', name: 'GitLab Duo', skillsDir: '.gitlab/duo/skills', mcpFile: '.gitlab/duo/mcp.json', mcpFormat: 'json' },
  // agent.minimax.io/docs：用户级 mcp.json（中置信度）
  { id: 'minimax_code', name: 'MiniMax Code', skillsDir: '.minimax/skills', mcpFile: '.minimax/mcp.json', mcpFormat: 'json' },
  // omp.sh/docs：顶层 mcpServers + disabledServers/enabledServers
  { id: 'omp_agent', name: 'OMP Agent', skillsDir: '.omp/agent/skills', mcpFile: '.omp/agent/mcp.json', mcpFormat: 'json' },
];

export const agentById = (id: AgentId): AgentDef => {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) throw new Error(`未知 agent: ${id}`);
  return a;
};

/** 中央 skill 库目录(相对 $HOME),本身可直接 git 管理 */
export const SKILL_LIBRARY_DIR = 'ai-skills';
