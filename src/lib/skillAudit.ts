/**
 * Skill 审计纯逻辑：只吃扫描快照 + SKILL.md 元信息 + 软链目标，不碰文件系统。
 * 由 services/skillAudit.ts 负责采集，本模块负责判定与打分。
 */
import type { AgentId } from './agents';
import { linkPointsToLibrary, parseSkillMdMeta } from './skills';

export type AuditSeverity = 'error' | 'warning' | 'info';

export type AuditCode =
  | 'library-missing-on-disk'
  | 'skill-dir-missing'
  | 'empty-skill-dir'
  | 'missing-skill-md'
  | 'unreadable-skill-md'
  | 'invalid-frontmatter'
  | 'missing-frontmatter'
  | 'missing-description'
  | 'short-description'
  | 'duplicate-name-across-agents'
  | 'duplicate-library-local'
  | 'broken-symlink'
  | 'symlink-outside-library'
  | 'suspicious-content';

export interface AuditIssue {
  /** 稳定 id，用于 React key / 去重 */
  id: string;
  severity: AuditSeverity;
  code: AuditCode;
  skill: string;
  agent?: AgentId;
  message: string;
  detail?: string;
}

export interface AuditCounts {
  error: number;
  warning: number;
  info: number;
}

export interface AuditReport {
  issues: AuditIssue[];
  counts: AuditCounts;
  /** 0-100，按问题严重级别扣分 */
  score: number;
}

/** 审计所需的最小快照结构（与 services 的 SkillsSnapshot 结构兼容） */
export interface AuditSkillEntry {
  name: string;
  kind: 'linked' | 'local';
}

export interface AuditAgentScan {
  agent: AgentId;
  dirExists: boolean;
  skills: AuditSkillEntry[];
}

export interface AuditSnapshot {
  libraryAbs: string;
  librarySkills: string[];
  scans: AuditAgentScan[];
}

/** 单个 skill 目录的采集结果 */
export interface SkillMeta {
  dirExists: boolean;
  skillMdExists: boolean;
  /** SKILL.md 是否成功读出 */
  readable: boolean;
  /** 目录项数量（用于空目录检测） */
  fileCount?: number;
  content?: string;
}

/** key 形如 `library:<name>` / `claude:<name>` */
export type SkillMetaMap = Record<string, SkillMeta>;

export interface SymlinkTarget {
  target?: string;
  error?: string;
}

/** key 形如 `<agentId>:<name>` */
export type SymlinkTargetMap = Record<string, SymlinkTarget>;

export const metaKey = (scope: 'library' | AgentId, name: string): string => `${scope}:${name}`;

/** 描述短于该字符数视为「过短」 */
export const MIN_DESCRIPTION_LENGTH = 12;

interface SuspiciousRule {
  label: string;
  pattern: RegExp;
  severity: AuditSeverity;
}

/** 可疑内容规则：命中即提示人工确认 */
export const SUSPICIOUS_PATTERNS: SuspiciousRule[] = [
  { label: 'rm -rf', pattern: /rm\s+-rf\b/, severity: 'error' },
  { label: 'curl | sh', pattern: /curl[^\n|]*\|\s*(?:sh|bash|zsh)\b/, severity: 'error' },
  { label: 'git reset --hard', pattern: /git\s+reset\s+--hard/, severity: 'warning' },
  { label: 'git push --force', pattern: /git\s+push\s+(?:--force|-f)\b/, severity: 'warning' },
  { label: 'eval', pattern: /\beval\s*\(/, severity: 'warning' },
];

interface FrontmatterState {
  present: boolean;
  closed: boolean;
  empty: boolean;
}

function inspectFrontmatter(content: string): FrontmatterState {
  const c = content.replace(/\r\n/g, '\n');
  if (!/^---\n/.test(c)) return { present: false, closed: false, empty: false };
  const end = c.indexOf('\n---', 4);
  if (end === -1) return { present: true, closed: false, empty: false };
  const block = c.slice(4, end).trim();
  return { present: true, closed: true, empty: block.length === 0 };
}

const SEVERITY_ORDER: Record<AuditSeverity, number> = { error: 0, warning: 1, info: 2 };

export function countIssues(issues: AuditIssue[]): AuditCounts {
  const counts: AuditCounts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

/** 100 分起扣：error -12 / warning -4 / info -1，最低 0 */
export function auditScore(counts: AuditCounts): number {
  const penalty = counts.error * 12 + counts.warning * 4 + counts.info;
  return Math.max(0, Math.min(100, 100 - penalty));
}

type PushFn = (
  severity: AuditSeverity,
  code: AuditCode,
  skill: string,
  message: string,
  extra?: { agent?: AgentId; detail?: string },
) => void;

function auditSkillContent(
  name: string,
  agent: AgentId | undefined,
  meta: SkillMeta,
  push: PushFn,
): void {
  if (!meta.dirExists) {
    push('error', 'skill-dir-missing', name, `skill「${name}」目录不存在`, agent ? { agent } : undefined);
    return;
  }
  if ((meta.fileCount ?? 0) === 0) {
    push('warning', 'empty-skill-dir', name, `skill「${name}」目录为空`, agent ? { agent } : undefined);
  }
  if (!meta.skillMdExists) {
    push('error', 'missing-skill-md', name, `skill「${name}」缺少 SKILL.md`, agent ? { agent } : undefined);
    return;
  }
  if (!meta.readable || typeof meta.content !== 'string') {
    push(
      'error',
      'unreadable-skill-md',
      name,
      `skill「${name}」的 SKILL.md 无法读取`,
      agent ? { agent } : undefined,
    );
    return;
  }

  const content = meta.content;
  const fm = inspectFrontmatter(content);
  if (fm.present && (!fm.closed || fm.empty)) {
    push(
      'error',
      'invalid-frontmatter',
      name,
      `skill「${name}」的 SKILL.md frontmatter 无效`,
      {
        ...(agent ? { agent } : {}),
        detail: fm.closed ? 'frontmatter 内容为空' : 'frontmatter 缺少结束的 ---',
      },
    );
  } else if (!fm.present) {
    push(
      'warning',
      'missing-frontmatter',
      name,
      `skill「${name}」的 SKILL.md 缺少 frontmatter`,
      agent ? { agent } : undefined,
    );
  } else {
    const parsed = parseSkillMdMeta(content.replace(/\r\n/g, '\n'));
    const description = parsed.description?.trim() ?? '';
    const detail = agent ? { agent } : undefined;
    if (!description) {
      push('warning', 'missing-description', name, `skill「${name}」缺少 description`, detail);
    } else if ([...description].length < MIN_DESCRIPTION_LENGTH) {
      push(
        'warning',
        'short-description',
        name,
        `skill「${name}」的 description 过短`,
        {
          ...(agent ? { agent } : {}),
          detail: `仅 ${[...description].length} 个字符，建议至少 ${MIN_DESCRIPTION_LENGTH} 个`,
        },
      );
    }
  }

  const hits = SUSPICIOUS_PATTERNS.filter((rule) => rule.pattern.test(content));
  if (hits.length > 0) {
    push(
      hits.some((h) => h.severity === 'error') ? 'error' : 'warning',
      'suspicious-content',
      name,
      `skill「${name}」包含可疑内容，请人工确认`,
      {
        ...(agent ? { agent } : {}),
        detail: `命中：${hits.map((h) => h.label).join('、')}`,
      },
    );
  }
}

/**
 * 审计 skill 库 + agent 本地 skills。
 * @param snapshot 扫描快照（中央库 + 各 agent）
 * @param metaMap  SKILL.md 采集结果，key 用 metaKey()
 * @param linkTargets 软链采集结果，key 用 metaKey()
 */
export function auditSkills(
  snapshot: AuditSnapshot,
  metaMap: SkillMetaMap = {},
  linkTargets: SymlinkTargetMap = {},
): AuditReport {
  const issues: AuditIssue[] = [];
  const seen = new Set<string>();
  const push: PushFn = (severity, code, skill, message, extra) => {
    const scope = extra?.agent ?? 'library';
    const id = `${code}:${scope}:${skill}`;
    if (seen.has(id)) return;
    seen.add(id);
    issues.push({
      id,
      severity,
      code,
      skill,
      ...(extra?.agent ? { agent: extra.agent } : {}),
      message,
      ...(extra?.detail ? { detail: extra.detail } : {}),
    });
  };

  // 1) 中央库 skill
  const librarySet = new Set(snapshot.librarySkills);
  for (const name of [...snapshot.librarySkills].sort((a, b) => a.localeCompare(b))) {
    const meta = metaMap[metaKey('library', name)];
    if (!meta || !meta.dirExists) {
      push(
        'error',
        'library-missing-on-disk',
        name,
        `中央库中的 skill「${name}」在磁盘上不存在`,
      );
      continue;
    }
    auditSkillContent(name, undefined, meta, push);
  }

  // 2) agent 本地 skill（linked 的实际内容归属中央库，避免重复报错）
  const localAgents = new Map<string, AgentId[]>();
  for (const scan of snapshot.scans) {
    for (const entry of scan.skills) {
      if (entry.kind !== 'local') continue;
      const list = localAgents.get(entry.name) ?? [];
      list.push(scan.agent);
      localAgents.set(entry.name, list);

      const meta = metaMap[metaKey(scan.agent, entry.name)];
      if (meta) auditSkillContent(entry.name, scan.agent, meta, push);

      if (librarySet.has(entry.name)) {
        push(
          'warning',
          'duplicate-library-local',
          entry.name,
          `skill「${entry.name}」同时存在于中央库和 ${scan.agent} 本地`,
          { agent: scan.agent, detail: '建议收编或改为指向中央库的软链' },
        );
      }
    }
  }
  for (const [name, agents] of localAgents) {
    if (agents.length > 1) {
      push(
        'warning',
        'duplicate-name-across-agents',
        name,
        `skill「${name}」在多个 agent 中以本地副本存在`,
        { detail: `出现在：${agents.join('、')}` },
      );
    }
  }

  // 3) 软链健康度
  for (const [key, link] of Object.entries(linkTargets)) {
    const sep = key.indexOf(':');
    if (sep === -1) continue;
    const scope = key.slice(0, sep);
    const name = key.slice(sep + 1);
    if (scope === 'library') continue;
    const agent = scope as AgentId;
    if (link.error) {
      push('error', 'broken-symlink', name, `skill「${name}」的软链不可读`, {
        agent,
        detail: link.error,
      });
    } else if (link.target && !linkPointsToLibrary(link.target, snapshot.libraryAbs)) {
      push(
        'warning',
        'symlink-outside-library',
        name,
        `skill「${name}」的软链指向中央库之外`,
        { agent, detail: link.target },
      );
    } else if (link.target) {
      // 指向库内的软链：目标目录必须存在
      const rel =
        link.target === snapshot.libraryAbs
          ? ''
          : link.target.slice(snapshot.libraryAbs.length + 1);
      const targetName = rel.split('/').filter(Boolean)[0] ?? '';
      const targetMeta = targetName ? metaMap[metaKey('library', targetName)] : undefined;
      if (!targetName || !targetMeta || !targetMeta.dirExists) {
        push(
          'error',
          'broken-symlink',
          name,
          `skill「${name}」的软链目标已不存在`,
          { agent, detail: link.target },
        );
      }
    }
  }

  issues.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const bySkill = a.skill.localeCompare(b.skill);
    if (bySkill !== 0) return bySkill;
    return a.code.localeCompare(b.code);
  });

  const counts = countIssues(issues);
  return { issues, counts, score: auditScore(counts) };
}