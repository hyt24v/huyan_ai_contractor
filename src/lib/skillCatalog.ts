/** Skills 目录的纯逻辑：过滤 / 排序 / 标签 / agent 统计（不碰文件系统，可单测） */
import { AGENTS, type AgentId } from './agents';
import type { SkillAgentState } from './skills';

/** skill 来源：本地目录 / git 仓库 / skills.sh / 无法判断 */
export type SkillSource = 'local' | 'git' | 'skills.sh' | 'unknown';

/** 目录里的一条 skill（中央库 + 各 agent 状态） */
export interface CatalogSkill {
  name: string;
  description?: string;
  tags: string[];
  source: SkillSource;
  gitRemote?: string;
  /** 中央库中存在 */
  inLibrary: boolean;
  agents: Record<AgentId, SkillAgentState>;
  /** 中央库中的目录（绝对路径） */
  libraryPath?: string;
  /** 各 agent skills 目录下的绝对路径（含软链） */
  agentPaths: Partial<Record<AgentId, string>>;
}

/** 一次扫描得到的完整目录 */
export interface SkillCatalog {
  libraryAbs: string;
  skills: CatalogSkill[];
  generatedAt?: string;
}

export type CatalogView = 'all' | 'enabled' | 'available';

/** 附加过滤：无标签 / 按来源 */
export type CatalogFilter = 'all' | 'untagged' | SkillSource;

export type CatalogSort = 'name' | 'enabled';

export interface CatalogFilterOptions {
  query?: string;
  view?: CatalogView;
  /** 只看某个 agent 的视角（enabled = 该 agent 已建立软链） */
  agent?: AgentId | 'all' | null;
  filter?: CatalogFilter;
  /** 多选标签：必须全部命中 */
  tags?: readonly string[];
  /** 预设（Profile）里的 skill 名，用于预设过滤 */
  presetSkillNames?: readonly string[];
  sort?: CatalogSort;
}

export interface AgentCatalogStats {
  agent: AgentId;
  /** 该 agent 目录下的 skill 总数（软链 + 本地） */
  total: number;
  /** 指向中央库的软链数（= managed） */
  linked: number;
  /** 未收编的本地副本数 */
  local: number;
  /** 已托管数（软链即托管） */
  managed: number;
  /** 托管且中央库仍在（不会失联）的数量 */
  inSync: number;
}

export interface CatalogStats {
  total: number;
  inLibrary: number;
  /** 至少在一个 agent 启用 */
  enabled: number;
  available: number;
  /** 仅存在于 agent 本地、未进入中央库 */
  localOnly: number;
  /** 全部 agent 的软链总数 */
  links: number;
  /** 全部 agent 的本地副本总数 */
  localLinks: number;
  byAgent: Record<AgentId, AgentCatalogStats>;
}

export const SOURCE_LABEL: Record<SkillSource, string> = {
  local: '本地',
  git: 'Git',
  'skills.sh': 'skills.sh',
  unknown: '未知',
};

export function sourceLabel(source: SkillSource): string {
  return SOURCE_LABEL[source];
}

/** 是否至少在一个 agent 启用（软链） */
export function skillEnabledAnywhere(skill: CatalogSkill): boolean {
  return AGENTS.some((a) => skill.agents[a.id] === 'linked');
}

/** 已启用的 agent id 列表（按 AGENTS 顺序） */
export function linkedAgentIds(skill: CatalogSkill): AgentId[] {
  return AGENTS.filter((a) => skill.agents[a.id] === 'linked').map((a) => a.id);
}

/** 该 skill 出现在多少个 agent 目录中 */
export function skillAgentCount(skill: CatalogSkill): number {
  // 注册表扩到 56 个后,agents 记录只含可见 agent;缺失的 key 视为 'none'
  return AGENTS.filter((a) => (skill.agents[a.id] ?? 'none') !== 'none').length;
}

const matchesQuery = (skill: CatalogSkill, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [skill.name, skill.description ?? '', ...skill.tags].join(' ').toLowerCase();
  return hay.includes(needle);
};

/** 过滤目录，返回新的数组（不修改入参） */
export function filterCatalog(
  catalog: SkillCatalog,
  options: CatalogFilterOptions = {},
): CatalogSkill[] {
  const view = options.view ?? 'all';
  const agent = options.agent && options.agent !== 'all' ? options.agent : null;
  const filter = options.filter ?? 'all';
  const tags = options.tags ?? [];
  const preset = options.presetSkillNames ? new Set(options.presetSkillNames) : null;

  const out = catalog.skills.filter((skill) => {
    if (!matchesQuery(skill, options.query ?? '')) return false;
    if (preset && !preset.has(skill.name)) return false;

    const enabled = agent ? skill.agents[agent] === 'linked' : skillEnabledAnywhere(skill);
    if (view === 'enabled' && !enabled) return false;
    if (view === 'available' && enabled) return false;

    if (filter === 'untagged') {
      if (skill.tags.length > 0) return false;
    } else if (filter !== 'all') {
      if (skill.source !== filter) return false;
    }

    if (tags.length > 0 && !tags.every((t) => skill.tags.includes(t))) return false;
    return true;
  });

  return sortSkills(out, options.sort ?? (agent ? 'name' : 'enabled'));
}

/** 排序副本：enabled 模式把已启用的排前面，其余按名字 */
export function sortSkills(
  skills: readonly CatalogSkill[],
  sort: CatalogSort = 'enabled',
): CatalogSkill[] {
  const copy = [...skills];
  copy.sort((a, b) => {
    if (sort === 'enabled') {
      const ea = skillEnabledAnywhere(a) ? 0 : 1;
      const eb = skillEnabledAnywhere(b) ? 0 : 1;
      if (ea !== eb) return ea - eb;
    }
    return a.name.localeCompare(b.name);
  });
  return copy;
}

export function catalogAgentStats(catalog: SkillCatalog, agent: AgentId): AgentCatalogStats {
  let total = 0;
  let linked = 0;
  let local = 0;
  let inSync = 0;
  for (const skill of catalog.skills) {
    const state = skill.agents[agent];
    if (!state || state === 'none') continue;
    total += 1;
    if (state === 'linked') {
      linked += 1;
      if (skill.inLibrary) inSync += 1;
    } else if (state === 'local') {
      local += 1;
    }
  }
  return { agent, total, linked, local, managed: linked, inSync };
}

export function catalogStats(catalog: SkillCatalog): CatalogStats {
  const byAgent = {} as Record<AgentId, AgentCatalogStats>;
  let links = 0;
  let localLinks = 0;
  for (const agent of AGENTS) {
    const stat = catalogAgentStats(catalog, agent.id);
    byAgent[agent.id] = stat;
    links += stat.linked;
    localLinks += stat.local;
  }
  let enabled = 0;
  let inLibrary = 0;
  for (const skill of catalog.skills) {
    if (skillEnabledAnywhere(skill)) enabled += 1;
    if (skill.inLibrary) inLibrary += 1;
  }
  return {
    total: catalog.skills.length,
    inLibrary,
    enabled,
    available: catalog.skills.length - enabled,
    localOnly: catalog.skills.length - inLibrary,
    links,
    localLinks,
    byAgent,
  };
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 汇总标签及出现次数（按标签名排序） */
export function collectTags(skills: readonly CatalogSkill[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const seen = new Set<string>();
    for (const raw of skill.tags) {
      const tag = raw.trim();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/** 切换数组中的某一项（返回新数组，保持顺序） */
export function toggleInList<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** 切换标签选择 */
export function toggleTag(tags: readonly string[], tag: string): string[] {
  return toggleInList(tags, tag);
}

/** 计算比例（0-100），total 为 0 时返回 0 */
export function ratioPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}