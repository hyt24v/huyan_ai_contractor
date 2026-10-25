/** Skills 统一管理的纯逻辑（不碰文件系统，可单测） */
import type { AgentId } from './agents';

/** 一次扫描的结果：某 agent 的 skills 目录内容 */
export interface SkillScanEntry {
  name: string;
  /** 软链 → 指向中央库（managed）；真实目录 → 未收编的本地 skill */
  kind: 'linked' | 'local';
}

export interface AgentSkillsScan {
  agent: AgentId;
  /** 目录不存在（agent 未装 skills 功能） */
  dirExists: boolean;
  skills: SkillScanEntry[];
}

export type SkillAgentState = 'linked' | 'local' | 'none';

/** 项目工作区中单个 skill 的状态（借鉴 skills-manager 三态） */
export type ProjectSkillStatus =
  | 'synced'        // 软链指向中央库 = 与中心一致
  | 'project-only'  // 真实目录且中央库无同名 = 仅项目
  | 'diverged'      // 真实目录且中央库有同名 = 分叉，需用户决策
  | 'none';         // 项目里不存在

/** 由 inLibrary + agent 状态推导项目三态（纯函数，可单测） */
export function projectSkillStatus(
  inLibrary: boolean,
  state: SkillAgentState,
): ProjectSkillStatus {
  if (state === 'linked') return 'synced';
  if (state === 'local') return inLibrary ? 'diverged' : 'project-only';
  return 'none';
}

export const PROJECT_STATUS_LABEL: Record<ProjectSkillStatus, string> = {
  synced: '与中心一致',
  'project-only': '仅项目',
  diverged: '分叉',
  none: '未部署',
};

export interface SkillRow {
  name: string;
  /** 中央库中存在 */
  inLibrary: boolean;
  agents: Record<AgentId, SkillAgentState>;
}

/**
 * 汇总中央库 + 各 agent 扫描结果，生成 skill × agent 矩阵。
 * 行 = skill 名（库里的 + 各 agent 本地独有的）。
 */
export function computeSkillMatrix(
  librarySkills: string[],
  scans: AgentSkillsScan[],
): SkillRow[] {
  const names = new Set<string>(librarySkills);
  for (const scan of scans) {
    for (const s of scan.skills) names.add(s.name);
  }
  const libSet = new Set(librarySkills);
  const rows: SkillRow[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const agents = {} as Record<AgentId, SkillAgentState>;
    for (const scan of scans) {
      const entry = scan.skills.find((s) => s.name === name);
      agents[scan.agent] = entry ? entry.kind : 'none';
    }
    rows.push({ name, inLibrary: libSet.has(name), agents });
  }
  return rows;
}

/**
 * 判断软链目标是否指向中央库。
 * @param target 软链目标绝对路径
 * @param libraryAbs 中央库绝对路径（不带尾斜杠）
 */
export function linkPointsToLibrary(target: string, libraryAbs: string): boolean {
  return target === libraryAbs || target.startsWith(`${libraryAbs}/`);
}

const stripQuotes = (raw: string): string =>
  raw.trim().replace(/^["']/, '').replace(/["']$/, '').trim();

const unique = (list: string[]): string[] => [...new Set(list.filter(Boolean))];

/** 解析 frontmatter 里的 tags：支持 [a, b] / a, b / 多行 - a 三种写法 */
function parseFrontmatterTags(front: string): string[] | undefined {
  // tags:\n  - a\n  - b
  const block = front.match(/^tags:[ \t]*\n((?:[ \t]*-[^\n]*\n?)+)/m);
  if (block) {
    return unique(
      block[1]
        .split('\n')
        .map((line) => line.match(/^[ \t]*-[ \t]*(.+)$/)?.[1] ?? '')
        .map(stripQuotes),
    );
  }
  const inline = front.match(/^tags:[ \t]*(.*)$/m);
  if (inline) {
    return unique(
      inline[1]
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map(stripQuotes),
    );
  }
  return undefined;
}

/** 从 SKILL.md 内容提取 name/description/tags（YAML frontmatter，宽松解析） */
export function parseSkillMdMeta(content: string): {
  name?: string;
  description?: string;
  tags?: string[];
} {
  // 兼容 CRLF/CR 换行，否则 Windows 编辑过的 SKILL.md 解析不出 frontmatter
  const text = content.replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const front = m[1];
  const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const desc = front.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const tags = parseFrontmatterTags(front);
  return {
    ...(name ? { name } : {}),
    ...(desc ? { description: desc.slice(0, 120) } : {}),
    ...(tags ? { tags } : {}),
  };
}

/** 从 GitHub URL 提取 skill 目录名（仓库名；支持 /tree/<branch>/<subdir> 形式取末段） */
export function skillNameFromGitUrl(url: string): string | null {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const treeMatch = cleaned.match(/\/tree\/[^/]+\/(.+)$/);
  if (treeMatch) {
    const segs = treeMatch[1].split('/').filter(Boolean);
    return segs[segs.length - 1] ?? null;
  }
  const last = cleaned.split('/').pop();
  return last && last.length > 0 ? last : null;
}

/** 解析 /tree/<branch>/<subdir> 形式的 GitHub URL，返回仓库地址与子目录；非 tree 链接返回 null */
export function parseGitTreeUrl(url: string): { repoUrl: string; subdir: string } | null {
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const m = cleaned.match(/^(.+?)\/tree\/[^/]+\/(.+)$/);
  if (!m) return null;
  const subdir = m[2].replace(/\/+$/, '');
  return subdir ? { repoUrl: m[1], subdir } : null;
}
