import { describe, expect, it } from 'vitest';
import type { AgentId } from './agents';
import type { CatalogSkill } from './skillCatalog';
import {
  DEFAULT_VIEW_PREFS,
  OTHER_SECTION_ID,
  PIN_SECTION_ID,
  buildLibrarySections,
  groupSkills,
  isSectionCollapsed,
  loadCollapsedSkillGroups,
  loadPinnedSkills,
  loadSkillsViewPrefs,
  primaryTag,
  sortSkillsInGroup,
  toggleSectionCollapsed,
} from './skillGrouping';

const allNone = (): Record<AgentId, 'linked' | 'local' | 'none'> => ({
  claude: 'none',
  codex: 'none',
  pi: 'none',
  cursor: 'none',
  gemini: 'none',
});

const makeSkill = (name: string, over: Partial<CatalogSkill> = {}): CatalogSkill => ({
  name,
  tags: [],
  source: 'local',
  inLibrary: true,
  agents: allNone(),
  agentPaths: {},
  ...over,
});

const linked = (name: string, over: Partial<CatalogSkill> = {}): CatalogSkill =>
  makeSkill(name, { agents: { ...allNone(), claude: 'linked' }, ...over });

describe('sortSkillsInGroup', () => {
  it('name：按名称字典序', () => {
    const out = sortSkillsInGroup([makeSkill('b'), makeSkill('a'), makeSkill('c')], 'name');
    expect(out.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('updated：mtimeMs 倒序，缺省垫底，平局按名称', () => {
    const out = sortSkillsInGroup(
      [
        makeSkill('no-mtime'),
        makeSkill('old', { mtimeMs: 100 }),
        makeSkill('new', { mtimeMs: 300 }),
        makeSkill('tie-a', { mtimeMs: 200 }),
        makeSkill('tie-b', { mtimeMs: 200 }),
      ],
      'updated',
    );
    expect(out.map((s) => s.name)).toEqual(['new', 'tie-a', 'tie-b', 'old', 'no-mtime']);
  });

  it('不修改入参', () => {
    const input = [makeSkill('b'), makeSkill('a')];
    sortSkillsInGroup(input, 'name');
    expect(input.map((s) => s.name)).toEqual(['b', 'a']);
  });
});

describe('primaryTag', () => {
  it('取字典序最小的标签，与录入顺序无关', () => {
    expect(primaryTag(makeSkill('x', { tags: ['b', 'a', 'c'] }))).toBe('a');
  });
  it('无标签返回 null', () => {
    expect(primaryTag(makeSkill('x'))).toBeNull();
  });
});

describe('groupSkills', () => {
  it('tag：按主标签分组，无标签垫底，组内排序', () => {
    const sections = groupSkills(
      [
        makeSkill('z1', { tags: ['beta'] }),
        makeSkill('a2', { tags: ['alpha'] }),
        makeSkill('a1', { tags: ['alpha', 'zzz'] }),
        makeSkill('none1'),
      ],
      'tag',
    );
    expect(sections.map((s) => s.id)).toEqual(['tag:alpha', 'tag:beta', 'tag:untagged']);
    expect(sections[0]?.skills.map((s) => s.name)).toEqual(['a1', 'a2']);
    expect(sections[2]?.label).toBe('无标签');
  });

  it('source：按固定顺序 local < git < skills.sh < unknown，标签用中文', () => {
    const sections = groupSkills(
      [
        makeSkill('u', { source: 'unknown' }),
        makeSkill('g', { source: 'git' }),
        makeSkill('l', { source: 'local' }),
        makeSkill('s', { source: 'skills.sh' }),
      ],
      'source',
    );
    expect(sections.map((s) => s.id)).toEqual([
      'source:local',
      'source:git',
      'source:skills.sh',
      'source:unknown',
    ]);
    expect(sections.map((s) => s.label)).toEqual(['本地', 'Git', 'skills.sh', '未知']);
  });
});

describe('buildLibrarySections', () => {
  it('默认（不分组不聚焦无置顶）：单个无组头 section', () => {
    const sections = buildLibrarySections([makeSkill('b'), makeSkill('a')]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe('');
    expect(sections[0]?.skills.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('置顶组恒在最前，且不重复出现在其它组', () => {
    const sections = buildLibrarySections(
      [makeSkill('a', { tags: ['t'] }), makeSkill('b', { tags: ['t'] }), makeSkill('c')],
      { groupBy: 'tag', pinned: new Set(['b']) },
    );
    expect(sections.map((s) => s.id)).toEqual([PIN_SECTION_ID, 'tag:t', 'tag:untagged']);
    expect(sections[0]?.skills.map((s) => s.name)).toEqual(['b']);
    expect(sections[1]?.skills.map((s) => s.name)).toEqual(['a']);
  });

  it('聚焦视图：已部署按组展示，未部署收进默认折叠的「其他」', () => {
    const sections = buildLibrarySections(
      [linked('on'), makeSkill('off1'), makeSkill('off2')],
      { focus: true },
    );
    expect(sections.map((s) => s.id)).toEqual(['all', OTHER_SECTION_ID]);
    expect(sections[0]?.skills.map((s) => s.name)).toEqual(['on']);
    expect(sections[1]?.defaultCollapsed).toBe(true);
    expect(sections[1]?.skills.map((s) => s.name)).toEqual(['off1', 'off2']);
  });

  it('聚焦视图下置顶 skill 即使未部署也进置顶组而非「其他」', () => {
    const sections = buildLibrarySections([linked('on'), makeSkill('pin')], {
      focus: true,
      pinned: new Set(['pin']),
    });
    expect(sections.map((s) => s.id)).toEqual([PIN_SECTION_ID, 'all']);
    expect(sections[0]?.skills.map((s) => s.name)).toEqual(['pin']);
  });

  it('聚焦 + 分组：已部署部分仍按标签分组', () => {
    const sections = buildLibrarySections(
      [linked('on', { tags: ['t'] }), makeSkill('off')],
      { focus: true, groupBy: 'tag' },
    );
    expect(sections.map((s) => s.id)).toEqual(['tag:t', OTHER_SECTION_ID]);
  });
});

describe('分组折叠状态', () => {
  const sections = [
    { id: 'a' },
    { id: OTHER_SECTION_ID, defaultCollapsed: true as const },
  ];

  it('无用户记录时看 defaultCollapsed', () => {
    expect(isSectionCollapsed(null, sections[0]!)).toBe(false);
    expect(isSectionCollapsed(null, sections[1]!)).toBe(true);
  });

  it('首次展开默认折叠组：种子逻辑保留其它默认组', () => {
    const next = toggleSectionCollapsed(null, sections, OTHER_SECTION_ID);
    expect(next.has(OTHER_SECTION_ID)).toBe(false);
  });

  it('折叠普通组后再展开', () => {
    const collapsed = toggleSectionCollapsed(null, sections, 'a');
    expect(collapsed.has('a')).toBe(true);
    expect(collapsed.has(OTHER_SECTION_ID)).toBe(true); // 默认折叠被种入
    const reopened = toggleSectionCollapsed(collapsed, sections, 'a');
    expect(reopened.has('a')).toBe(false);
    expect(reopened.has(OTHER_SECTION_ID)).toBe(true);
  });
});

describe('localStorage 偏好（node 环境降级）', () => {
  it('无 window 时返回默认值，不抛错', () => {
    expect(loadSkillsViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
    expect(loadPinnedSkills()).toEqual([]);
    expect(loadCollapsedSkillGroups()).toBeNull();
  });
});
