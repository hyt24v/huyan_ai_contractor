/**
 * 每个 agent 的模型服务（Provider）配置落点。
 * 只描述「写到哪、什么格式、能不能写」，不碰文件系统。
 */
import type { AgentId } from './agents';

export type ProviderTargetFormat =
  | 'claude-settings'
  | 'codex-toml'
  | 'pi-models'
  | 'unsupported';

export interface ProviderTarget {
  agent: AgentId;
  /** 配置文件（相对 $HOME）；unsupported 时为空串 */
  file: string;
  format: ProviderTargetFormat;
  /** 是否支持写入 */
  writable: boolean;
  /** 备份文件扩展名 */
  ext: 'json' | 'toml';
  /** 页面提示（不可写时说明原因） */
  note?: string;
}

/** 不可写 agent 的统一提示文案 */
export const UNSUPPORTED_NOTE = '暂不支持写入，仅支持查看';

export const PROVIDER_TARGETS: Record<AgentId, ProviderTarget> = {
  claude: {
    agent: 'claude',
    file: '.claude/settings.json',
    format: 'claude-settings',
    writable: true,
    ext: 'json',
  },
  codex: {
    agent: 'codex',
    file: '.codex/config.toml',
    format: 'codex-toml',
    writable: true,
    ext: 'toml',
  },
  pi: {
    agent: 'pi',
    file: '.pi/agent/models.json',
    format: 'pi-models',
    writable: true,
    ext: 'json',
  },
  cursor: {
    agent: 'cursor',
    file: '.cursor/mcp.json',
    format: 'unsupported',
    writable: false,
    ext: 'json',
    note: UNSUPPORTED_NOTE,
  },
  gemini: {
    agent: 'gemini',
    file: '.gemini/settings.json',
    format: 'unsupported',
    writable: false,
    ext: 'json',
    note: UNSUPPORTED_NOTE,
  },
};

export const providerTarget = (agent: AgentId): ProviderTarget =>
  PROVIDER_TARGETS[agent];

/** 可写入的 agent（页面新增/应用时优先展示） */
export const writableAgents: AgentId[] = (
  Object.keys(PROVIDER_TARGETS) as AgentId[]
).filter((a) => PROVIDER_TARGETS[a].writable);

export const isProviderWritable = (agent: AgentId): boolean =>
  PROVIDER_TARGETS[agent].writable;

/** 备份文件相对路径：provider-backups/<agent>-<timestamp>.<ext> */
export function providerBackupName(
  agent: AgentId,
  now: Date,
  ext: string,
  seq = 0,
): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(
    now.getHours(),
  )}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${agent}-${ts}${seq > 0 ? `-${seq}` : ''}.${ext}`;
}