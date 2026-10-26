import {
  Braces,
  Cable,
  FileText,
  Layers,
  PenLine,
  Puzzle,
  Server,
} from 'lucide-react';

export interface ToolDef {
  path: string;
  name: string;
  icon: typeof Braces;
  /** 侧栏分组（借鉴 skills-manager 侧栏分组） */
  group: '编辑器' | '管理';
}

export const TOOLS: ToolDef[] = [
  { path: '/json', name: 'JSON 编辑器', icon: Braces, group: '编辑器' },
  { path: '/markdown', name: 'Markdown', icon: PenLine, group: '编辑器' },
  { path: '/skills', name: 'Skills 管理', icon: Puzzle, group: '管理' },
  { path: '/mcp', name: 'MCP 管理', icon: Cable, group: '管理' },
  { path: '/prompts', name: '提示词', icon: FileText, group: '管理' },
  { path: '/profiles', name: '配置套餐', icon: Layers, group: '管理' },
  { path: '/providers', name: '模型服务', icon: Server, group: '管理' },
];

/** 侧栏分组顺序 */
export const TOOL_GROUPS: ToolDef['group'][] = ['编辑器', '管理'];