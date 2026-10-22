/**
 * 健康检查的纯逻辑（不碰文件系统，可单测）。
 * 输入是 skills/mcp 扫描快照 + 服务层补充的文件探测结果，输出评分与问题清单。
 */
import { AGENTS, type AgentId } from './agents';

export type Severity = 'error' | 'warning' | 'info';

export interface HealthIssue {
  /** 稳定 id，便于去重/测试 */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  agent?: AgentId;
  skill?: string;
}

// ---------- 输入（结构兼容 services 里的快照，避免循环依赖） ----------

export interface SkillScanEntryLike {
  name: string;
  kind: 'linked' | 'local';
}

export interface AgentSkillsScanLike {
  agent: AgentId;
  dirExists: boolean;
  skills: SkillScanEntryLike[];
}

export interface SkillsScanLike {
  librarySkills: string[];
  scans: AgentSkillsScanLike[];
}

export interface ManifestServerLike {
  name: string;
  type: 'stdio' | 'http';
  command?: string;
  url?: string;
  agents: Partial<Record<AgentId, boolean>>;
}

export interface McpScanLike {
  manifest: { servers: ManifestServerLike[] };
  perAgent: Partial<Record<AgentId, string[]>>;
}

export interface AgentHealthInput {
  agent: AgentId;
  /** MCP 配置文件存在 */
  configExists: boolean;
  /** 文件存在且能解析（空文件视为可解析） */
  configParsable: boolean;
  configError?: string;
}

/** skill 的实际探测结果（服务层读盘后填充） */
export interface SkillHealthEntry {
  name: string;
  scope: 'library' | 'agent';
  agent?: AgentId;
  kind: 'linked' | 'local';
  /** 软链目标不存在 */
  broken?: boolean;
  /** 软链目标不在中央库内 */
  outsideLibrary?: boolean;
  hasSkillMd: boolean;
  description?: string;
}

export interface BackupInfo {
  /** 备份目录存在（功能已启用） */
  enabled: boolean;
  count: number;
  /** 最近一次备份时间（展示用字符串） */
  latest?: string;
}

export interface DiagnosticsInput {
  skills?: SkillsScanLike;
  mcp?: McpScanLike;
  /** skills 扫描整体失败 */
  skillsError?: string;
  /** MCP 扫描整体失败 */
  mcpError?: string;
  /** 中央清单文件损坏 */
  mcpManifestError?: string;
  agentHealth: AgentHealthInput[];
  skillEntries: SkillHealthEntry[];
  /** 路径型 command 但文件不存在 */
  missingCommands: { server: string; command: string }[];
  backups: BackupInfo;
}

// ---------- 输出 ----------

export interface AgentHealthRow {
  agent: AgentId;
  configExists: boolean;
  configParsable: boolean;
  configError?: string;
  skillsDirExists: boolean;
  skillCount: number;
  linkedCount: number;
  localCount: number;
  mcpServerCount: number;
}

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface HealthReport {
  score: number;
  grade: HealthGrade;
  issues: HealthIssue[];
  counts: Record<Severity, number>;
  agents: AgentHealthRow[];
  backups: BackupInfo;
}

export const agentLabel = (id: AgentId): string =>
  AGENTS.find((a) => a.id === id)?.name ?? id;

/**
 * command 是否像一个本地文件路径（可以只靠 fs.exists 判断）。
 * npx / uvx / node 这类裸命令依赖 PATH，无法在无 shell 的情况下检查。
 */
export function commandIsPathLike(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  return c.startsWith('/') || c.startsWith('~/') || c.startsWith('./') || c.startsWith('../');
}

export function gradeForScore(score: number): HealthGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

const SEVERITY_WEIGHT: Record<Severity, number> = { error: 15, warning: 5, info: 1 };
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** 汇总一次健康检查，纯函数、可重复调用 */
export function analyzeHealth(input: DiagnosticsInput): HealthReport {
  const issues: HealthIssue[] = [];
  const skills = input.skills;
  const mcp = input.mcp;

  if (input.skillsError) {
    issues.push({
      id: 'scan-skills',
      severity: 'error',
      title: 'Skills 扫描失败',
      detail: input.skillsError,
    });
  }
  if (input.mcpError) {
    issues.push({
      id: 'scan-mcp',
      severity: 'error',
      title: 'MCP 扫描失败',
      detail: input.mcpError,
    });
  }
  if (input.mcpManifestError) {
    issues.push({
      id: 'mcp-manifest-parse',
      severity: 'error',
      title: '中央清单解析失败',
      detail: `~/.ai-baogongtou/mcp-central.json 无法解析：${input.mcpManifestError}。到 MCP 管理页重新保存可重建清单。`,
    });
  }

  // ---------- 每个 agent 的配置状态 ----------
  const agents: AgentHealthRow[] = input.agentHealth.map((a) => {
    const scan = skills?.scans.find((s) => s.agent === a.agent);
    const list = scan?.skills ?? [];
    return {
      agent: a.agent,
      configExists: a.configExists,
      configParsable: a.configParsable,
      ...(a.configError ? { configError: a.configError } : {}),
      skillsDirExists: scan?.dirExists ?? false,
      skillCount: list.length,
      linkedCount: list.filter((s) => s.kind === 'linked').length,
      localCount: list.filter((s) => s.kind === 'local').length,
      mcpServerCount: mcp?.perAgent[a.agent]?.length ?? 0,
    };
  });

  for (const a of input.agentHealth) {
    const label = agentLabel(a.agent);
    if (!a.configExists) {
      issues.push({
        id: `agent-config-missing:${a.agent}`,
        severity: 'info',
        title: '未发现 MCP 配置',
        detail: `${label} 尚无 MCP 配置文件，未使用 MCP 时属正常。`,
        agent: a.agent,
      });
    } else if (!a.configParsable) {
      issues.push({
        id: `agent-config-parse:${a.agent}`,
        severity: 'error',
        title: 'MCP 配置解析失败',
        detail: `${label} 的 MCP 配置无法解析${a.configError ? `：${a.configError}` : '。'}`,
        agent: a.agent,
      });
    }
    if (skills && !(skills.scans.find((s) => s.agent === a.agent)?.dirExists ?? false)) {
      issues.push({
        id: `skills-dir-missing:${a.agent}`,
        severity: 'info',
        title: '未发现 Skills 目录',
        detail: `${label} 尚无 skills 目录，启用任一 skill 后会自动创建。`,
        agent: a.agent,
      });
    }
  }

  // ---------- skill 问题 ----------
  if (skills) {
    const library = new Set(skills.librarySkills);
    const localByName = new Map<string, AgentId[]>();
    for (const e of input.skillEntries) {
      if (e.scope !== 'agent' || e.kind !== 'local' || !e.agent) continue;
      const ids = localByName.get(e.name) ?? [];
      ids.push(e.agent);
      localByName.set(e.name, ids);
    }
    for (const [name, ids] of localByName) {
      const uniq = [...new Set(ids)];
      const labels = uniq.map(agentLabel).join('、');
      if (library.has(name)) {
        issues.push({
          id: `skill-dup-library:${name}`,
          severity: 'warning',
          title: 'skill 与中央库同名',
          detail: `${name} 在中央库与 ${labels} 的本地目录同时存在，建议在 Skills 管理页「收编」以统一管理。`,
          skill: name,
        });
      }
      if (uniq.length >= 2) {
        issues.push({
          id: `skill-dup-agents:${name}`,
          severity: 'warning',
          title: '多个 agent 维护同名 skill',
          detail: `${name} 在 ${labels} 各有本地副本，版本容易分叉，建议收编到中央库。`,
          skill: name,
        });
      }
    }

    for (const e of input.skillEntries) {
      const scopeLabel =
        e.scope === 'library' ? '中央库' : e.agent ? agentLabel(e.agent) : '未知 agent';
      const idBase =
        e.scope === 'library'
          ? `skill:library:${e.name}`
          : `skill:agent:${e.agent}:${e.name}`;
      if (e.broken) {
        issues.push({
          id: `skill-broken-link:${idBase}`,
          severity: 'error',
          title: '软链失效',
          detail: `${scopeLabel} 的 ${e.name} 指向的目录不存在，agent 加载时会报错，建议在 Skills 管理页重新建立或删除。`,
          ...(e.agent ? { agent: e.agent } : {}),
          skill: e.name,
        });
        continue;
      }
      if (e.outsideLibrary) {
        issues.push({
          id: `skill-outside-library:${idBase}`,
          severity: 'warning',
          title: '软链指向中央库之外',
          detail: `${scopeLabel} 的 ${e.name} 链接到中央库外的目录，不受统一管理影响。`,
          ...(e.agent ? { agent: e.agent } : {}),
          skill: e.name,
        });
      }
      // 指向中央库的软链，其 SKILL.md 由中央库条目统一检查，避免重复报错
      if (e.kind === 'linked' && !e.outsideLibrary) continue;
      if (!e.hasSkillMd) {
        issues.push({
          id: `skill-missing-md:${idBase}`,
          severity: e.scope === 'library' ? 'error' : 'warning',
          title: '缺少 SKILL.md',
          detail: `${scopeLabel} 的 ${e.name} 目录下没有 SKILL.md，多数 agent 会忽略该 skill。`,
          ...(e.agent ? { agent: e.agent } : {}),
          skill: e.name,
        });
        continue;
      }
      if (!e.description?.trim()) {
        issues.push({
          id: `skill-empty-description:${idBase}`,
          severity: 'info',
          title: 'SKILL.md 缺少描述',
          detail: `${scopeLabel} 的 ${e.name} frontmatter 没有 description，会影响 agent 自动发现与匹配。`,
          ...(e.agent ? { agent: e.agent } : {}),
          skill: e.name,
        });
      }
    }
  }

  // ---------- MCP 问题 ----------
  if (mcp) {
    const manifestNames = new Set(mcp.manifest.servers.map((s) => s.name));
    for (const server of mcp.manifest.servers) {
      if (server.type === 'stdio' && !server.command?.trim()) {
        issues.push({
          id: `mcp-no-command:${server.name}`,
          severity: 'warning',
          title: 'stdio server 缺少 command',
          detail: `中央清单里的 ${server.name} 没有 command，分发后 agent 无法启动它。`,
        });
      }
      if (server.type === 'http' && !server.url?.trim()) {
        issues.push({
          id: `mcp-no-url:${server.name}`,
          severity: 'warning',
          title: 'http server 缺少 url',
          detail: `中央清单里的 ${server.name} 没有 url，分发后 agent 无法连接。`,
        });
      }
      const missing = input.missingCommands.find((m) => m.server === server.name);
      if (missing) {
        issues.push({
          id: `mcp-missing-command:${server.name}`,
          severity: 'warning',
          title: 'server 命令文件不存在',
          detail: `${server.name} 的 command ${missing.command} 在本机不存在，启动时会失败。`,
        });
      }
      for (const agent of input.agentHealth) {
        if (!server.agents[agent.agent]) continue;
        // 配置本身缺失/损坏已单独提示，避免重复刷屏
        if (!agent.configExists || !agent.configParsable) continue;
        const names = mcp.perAgent[agent.agent] ?? [];
        if (!names.includes(server.name)) {
          issues.push({
            id: `mcp-drift:${agent.agent}:${server.name}`,
            severity: 'warning',
            title: '清单与配置不一致',
            detail: `中央清单已勾选 ${agentLabel(agent.agent)}，但其配置里没有 ${server.name}，到 MCP 管理页重新分发即可修复。`,
            agent: agent.agent,
          });
        }
      }
    }
    for (const [agent, names] of Object.entries(mcp.perAgent) as [
      AgentId,
      string[] | undefined,
    ][]) {
      for (const name of names ?? []) {
        if (manifestNames.has(name)) continue;
        issues.push({
          id: `mcp-unmanaged:${agent}:${name}`,
          severity: 'info',
          title: '存在未纳管的 MCP server',
          detail: `${agentLabel(agent)} 配置里有 ${name}（或清单尚未同步），可在 MCP 管理页刷新后编辑。`,
          agent,
        });
      }
    }
  }

  // ---------- 评分 ----------
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  let score = 100;
  for (const severity of ['error', 'warning', 'info'] as Severity[]) {
    score -= counts[severity] * SEVERITY_WEIGHT[severity];
  }
  score = Math.max(0, Math.min(100, score));

  issues.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.title.localeCompare(b.title, 'zh-Hans-CN'),
  );

  return {
    score,
    grade: gradeForScore(score),
    issues,
    counts,
    agents,
    backups: input.backups,
  };
}