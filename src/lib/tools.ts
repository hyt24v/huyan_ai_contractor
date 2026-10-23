import {
  Braces,
  Cable,
  FileText,
  HeartPulse,
  Layers,
  PenLine,
  Puzzle,
  Server,
} from 'lucide-react';

export const TOOLS = [
  { path: '/json', name: 'JSON 编辑器', icon: Braces },
  { path: '/markdown', name: 'Markdown', icon: PenLine },
  { path: '/skills', name: 'Skills 管理', icon: Puzzle },
  { path: '/mcp', name: 'MCP 管理', icon: Cable },
  { path: '/health', name: '健康检查', icon: HeartPulse },
  { path: '/profiles', name: '配置套餐', icon: Layers },
  { path: '/providers', name: '模型服务', icon: Server },
  { path: '/prompts', name: '提示词', icon: FileText },
] as const;