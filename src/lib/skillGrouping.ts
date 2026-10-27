/**
 * 技能库浏览增强的纯逻辑：分组（标签/来源）、组内排序、置顶、聚焦视图、分组折叠。
 * localStorage 偏好读写也收在这里（浏览器外自动降级为默认值，node 环境可单测）。
 */
import { skillEnabledAnywhere, sourceLabel, type CatalogSkill } from './skillCatalog';

/** 分组方式：不分组 / 按主标签 / 按来源 */
export type SkillGroupBy = 'none' | 'tag' | 'source';

/** 组内排序：按名称 / 按最近更新（mtimeMs 缺省垫底） */
export type SkillSortKey = 'name' | 'updated';

/** 一个渲染分组：label 为空串时不渲染组头 */
export interface SkillSection {
  id: string;
  label: string;
  skills: CatalogSkill[];
  /** 默认折叠（如聚焦视图的「其他」组）；用户显式展开/折叠优先 */
  defaultCollapsed?: boolean;
}

/** 置顶分组的固定 id / 聚焦视图「其他」组的固定 id */
export const PIN_SECTION_ID = 'pinned';
export const OTHER_SECTION_ID = 'others';
export const UNTAGGED_LABEL = '无标签';

export interface LibraryViewOptions {
  groupBy?: SkillGroupBy;
  sortKey?: SkillSortKey;
  pinned?: ReadonlySet<string>;
  /** 聚焦视图：只展示 已部署 + 置顶，其余收进「其他」折叠组 */
  focus?: boolean;
}

export function compareSkillName(a: CatalogSkill, b: CatalogSkill): number {
  return a.name.localeCompare(b.name);
}

/** 组内排序副本：updated 按 mtimeMs 倒序（缺省视为 0 垫底），平局按名称 */
export function sortSkillsInGroup(
  skills: readonly CatalogSkill[],
  sortKey: SkillSortKey = 'name',
): CatalogSkill[] {
  const copy = [...skills];
  copy.sort((a, b) => {
    if (sortKey === 'updated') {
      const diff = (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0);
      if (diff !== 0) return diff;
    }
    return compareSkillName(a, b);
  });
  return copy;
}

/**
 * 主标签（分组归属用）：取按字典序最小的标签，保证与扫描/录入顺序无关。
 * 每个 skill 只属于一个标签组，分组数量可相加、不重复渲染。
 */
export function primaryTag(skill: CatalogSkill): string | null {
  if (skill.tags.length === 0) return null;
  return [...skill.tags].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

/** 来源分组的固定顺序（与 SOURCE_FILTERS 展示习惯一致：本地在前） */
const SOURCE_ORDER: Record<CatalogSkill['source'], number> = {
  local: 0,
  git: 1,
  'skills.sh': 2,
  unknown: 3,
};

/** 按标签/来源分组；组间有序（标签字典序、无标签垫底；来源固定序），组内按 sortKey 排序 */
export function groupSkills(
  skills: readonly CatalogSkill[],
  groupBy: Exclude<SkillGroupBy, 'none'>,
  sortKey: SkillSortKey = 'name',
): SkillSection[] {
  const buckets = new Map<string, CatalogSkill[]>();
  for (const skill of skills) {
    const key = groupBy === 'tag' ? (primaryTag(skill) ?? '') : skill.source;
    const list = buckets.get(key);
    if (list) list.push(skill);
    else buckets.set(key, [skill]);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (groupBy === 'source') {
      return (
        (SOURCE_ORDER[a as CatalogSkill['source']] ?? 99) -
        (SOURCE_ORDER[b as CatalogSkill['source']] ?? 99)
      );
    }
    // tag：空串（无标签）垫底
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });
  return keys.map((key) => ({
    id: groupBy === 'source' ? `source:${key}` : `tag:${key || 'untagged'}`,
    label:
      groupBy === 'source'
        ? sourceLabel(key as CatalogSkill['source'])
        : key || UNTAGGED_LABEL,
    skills: sortSkillsInGroup(buckets.get(key) ?? [], sortKey),
  }));
}

/**
 * 组装技能库的渲染分组：
 * 1. 置顶组恒在最前（仅当置顶项出现在当前筛选结果里）；
 * 2. 聚焦视图下，其余 skill 中「已部署」的按 groupBy 分组，未部署的收进「其他」默认折叠组；
 * 3. 非聚焦且不分组时返回单个无组头的 section（平铺）。
 */
export function buildLibrarySections(
  skills: readonly CatalogSkill[],
  options: LibraryViewOptions = {},
): SkillSection[] {
  const groupBy = options.groupBy ?? 'none';
  const sortKey = options.sortKey ?? 'name';
  const pinned = options.pinned;
  const focus = options.focus ?? false;

  const pinnedSkills = pinned ? skills.filter((s) => pinned.has(s.name)) : [];
  const rest = pinned ? skills.filter((s) => !pinned.has(s.name)) : [...skills];

  const sections: SkillSection[] = [];
  if (pinnedSkills.length > 0) {
    sections.push({
      id: PIN_SECTION_ID,
      label: '置顶',
      skills: sortSkillsInGroup(pinnedSkills, sortKey),
    });
  }

  if (focus) {
    const deployed = rest.filter(skillEnabledAnywhere);
    const others = rest.filter((s) => !skillEnabledAnywhere(s));
    if (groupBy === 'none') {
      if (deployed.length > 0) {
        sections.push({ id: 'all', label: '', skills: sortSkillsInGroup(deployed, sortKey) });
      }
    } else {
      sections.push(...groupSkills(deployed, groupBy, sortKey));
    }
    if (others.length > 0) {
      sections.push({
        id: OTHER_SECTION_ID,
        label: '其他',
        skills: sortSkillsInGroup(others, sortKey),
        defaultCollapsed: true,
      });
    }
    return sections;
  }

  if (groupBy === 'none') {
    if (rest.length > 0) {
      sections.push({ id: 'all', label: '', skills: sortSkillsInGroup(rest, sortKey) });
    }
    return sections;
  }
  sections.push(...groupSkills(rest, groupBy, sortKey));
  return sections;
}

/** 分组是否折叠：用户显式状态（collapsed 集合）优先，否则看 defaultCollapsed */
export function isSectionCollapsed(
  collapsed: ReadonlySet<string> | null,
  section: Pick<SkillSection, 'id' | 'defaultCollapsed'>,
): boolean {
  if (collapsed) return collapsed.has(section.id);
  return Boolean(section.defaultCollapsed);
}

/**
 * 切换某分组的折叠状态。
 * collapsed 为 null（用户从未操作过）时，先把当前默认折叠的组种入集合再切换，
 * 保证「其他」这类默认折叠组在用户第一次展开后保持展开。
 */
export function toggleSectionCollapsed(
  collapsed: ReadonlySet<string> | null,
  sections: readonly Pick<SkillSection, 'id' | 'defaultCollapsed'>[],
  id: string,
): Set<string> {
  const base = new Set(
    collapsed ?? sections.filter((s) => s.defaultCollapsed).map((s) => s.id),
  );
  if (isSectionCollapsed(collapsed, sections.find((s) => s.id === id) ?? { id })) {
    base.delete(id);
  } else {
    base.add(id);
  }
  return base;
}

// ---------- localStorage 偏好（键前缀与 agentVisibility 等保持一致） ----------

const VIEW_KEY = 'huyan_tool:skills_view';
const PIN_KEY = 'huyan_tool:skills_pinned';
const COLLAPSE_KEY = 'huyan_tool:skills_collapsed_groups';

export interface SkillsViewPrefs {
  groupBy: SkillGroupBy;
  sortKey: SkillSortKey;
  focus: boolean;
}

export const DEFAULT_VIEW_PREFS: SkillsViewPrefs = {
  groupBy: 'none',
  sortKey: 'name',
  focus: false,
};

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSkillsViewPrefs(): SkillsViewPrefs {
  const store = storage();
  if (!store) return DEFAULT_VIEW_PREFS;
  try {
    const raw = store.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_VIEW_PREFS;
    const p = parsed as Record<string, unknown>;
    return {
      groupBy:
        p.groupBy === 'tag' || p.groupBy === 'source' || p.groupBy === 'none'
          ? p.groupBy
          : 'none',
      sortKey: p.sortKey === 'updated' || p.sortKey === 'name' ? p.sortKey : 'name',
      focus: p.focus === true,
    };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

export function saveSkillsViewPrefs(prefs: SkillsViewPrefs): void {
  try {
    storage()?.setItem(VIEW_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function loadPinnedSkills(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(PIN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function savePinnedSkills(names: readonly string[]): void {
  try {
    storage()?.setItem(PIN_KEY, JSON.stringify([...names]));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 读取折叠分组 id 列表；null = 用户从未操作过（用分组默认值） */
export function loadCollapsedSkillGroups(): string[] | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(COLLAPSE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}

export function saveCollapsedSkillGroups(ids: readonly string[]): void {
  try {
    storage()?.setItem(COLLAPSE_KEY, JSON.stringify([...ids]));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
