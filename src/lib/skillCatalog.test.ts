import { describe, expect, it } from 'vitest';
import type { AgentId } from './agents';
import {
  catalogAgentStats,
  catalogStats,
  collectTags,
  filterCatalog,
  linkedAgentIds,
  ratioPercent,
  skillAgentCount,
  skillEnabledAnywhere,
  sortSkills,
  sourceLabel,
  toggleInList,
  toggleTag,
  type CatalogSkill,
  type SkillCatalog,
} from './skillCatalog';
import { parseSkillMdMeta } from './skills';

const allNone = (): Record<AgentId, 'linked' | 'local' | 'none'> => ({
  claude: 'none',
  codex: 'none',
  pi: 'none',
  cursor: 'none',
  gemini: 'none',
});

const makeSkill = (name: string, over: Partial<CatalogSkill> = {}): CatalogSkill => ({
  name,
  description: `${name} 的描述`,
  tags: [],
  source: 'local',
  inLibrary: true,
  agents: allNone(),
  agentPaths: {},
  ...over,
});

const makeCatalog = (skills: CatalogSkill[]): SkillCatalog => ({
  libraryAbs: '/home/u/ai-skills',
  skills,
});

const ids = (skills: CatalogSkill[]): string[] => skills.map((s) => s.name);

describe('filterCatalog', () => {
  const catalog = makeCatalog([
    makeSkill('browser', {
      description: '自动化浏览器操作',
      tags: ['search', 'web'],
      source: 'skills.sh',
      agents: { ...allNone(), claude: 'linked', codex: 'linked' },
    }),
    makeSkill('note-manager', {
      description: '管理 Obsidian 笔记',
      tags: ['manage', 'obsidian'],
      source: 'local',
      agents: { ...allNone(), claude: 'local' },
    }),
    makeSkill('arxiv', {
      description: '搜索 arXiv 论文',
      tags: [],
      source: 'git',
      inLibrary: false,
      agents: { ...allNone(), pi: 'local' },
    }),
  ]);

  it('按名字 / 描述 / 标签搜索', () => {
    expect(ids(filterCatalog(catalog, { query: 'browser' }))).toEqual(['browser']);
    expect(ids(filterCatalog(catalog, { query: 'obsidian' }))).toEqual(['note-manager']);
    expect(ids(filterCatalog(catalog, { query: 'arxiv' }))).toEqual(['arxiv']);
    expect(ids(filterCatalog(catalog, { query: '不存在' }))).toEqual([]);
  });

  it('view=enabled 按全局是否启用过滤', () => {
    expect(ids(filterCatalog(catalog, { view: 'enabled' }))).toEqual(['browser']);
    expect(ids(filterCatalog(catalog, { view: 'available' }))).toEqual([
      'arxiv',
      'note-manager',
    ]);
  });

  it('指定 agent 时按该 agent 的软链状态过滤', () => {
    expect(ids(filterCatalog(catalog, { agent: 'codex', view: 'enabled' }))).toEqual([
      'browser',
    ]);
    expect(ids(filterCatalog(catalog, { agent: 'codex', view: 'available' }))).toEqual([
      'arxiv',
      'note-manager',
    ]);
    // claude 的 note-manager 是本地副本，不算启用
    expect(ids(filterCatalog(catalog, { agent: 'claude', view: 'enabled' }))).toEqual([
      'browser',
    ]);
  });

  it('filter=untagged / 来源过滤', () => {
    expect(ids(filterCatalog(catalog, { filter: 'untagged' }))).toEqual(['arxiv']);
    expect(ids(filterCatalog(catalog, { filter: 'git' }))).toEqual(['arxiv']);
    expect(ids(filterCatalog(catalog, { filter: 'skills.sh' }))).toEqual(['browser']);
    expect(ids(filterCatalog(catalog, { filter: 'local' }))).toEqual(['note-manager']);
  });

  it('多选标签必须全部命中', () => {
    expect(ids(filterCatalog(catalog, { tags: ['search'] }))).toEqual(['browser']);
    expect(ids(filterCatalog(catalog, { tags: ['search', 'web'] }))).toEqual(['browser']);
    expect(ids(filterCatalog(catalog, { tags: ['search', 'manage'] }))).toEqual([]);
  });

  it('预设（profile.skills）过滤', () => {
    expect(
      ids(filterCatalog(catalog, { presetSkillNames: ['note-manager', 'arxiv'] })),
    ).toEqual(['arxiv', 'note-manager']);
    expect(ids(filterCatalog(catalog, { presetSkillNames: ['none'] }))).toEqual([]);
  });

  it('启用优先排序，再按名字', () => {
    const sorted = sortSkills(catalog.skills);
    expect(ids(sorted)).toEqual(['browser', 'arxiv', 'note-manager']);
    expect(ids(sortSkills(catalog.skills, 'name'))).toEqual([
      'arxiv',
      'browser',
      'note-manager',
    ]);
  });

  it('不修改入参', () => {
    const before = ids(catalog.skills);
    filterCatalog(catalog, { view: 'enabled' });
    expect(ids(catalog.skills)).toEqual(before);
  });
});

describe('catalogStats / catalogAgentStats', () => {
  const catalog = makeCatalog([
    makeSkill('a', { agents: { ...allNone(), claude: 'linked', codex: 'linked' } }),
    makeSkill('b', { agents: { ...allNone(), claude: 'local' }, inLibrary: false }),
    makeSkill('c', { inLibrary: true }),
    makeSkill('d', { agents: { ...allNone(), pi: 'local' }, inLibrary: false }),
  ]);

  it('全局统计', () => {
    const stats = catalogStats(catalog);
    expect(stats.total).toBe(4);
    expect(stats.inLibrary).toBe(2);
    expect(stats.enabled).toBe(1);
    expect(stats.available).toBe(3);
    expect(stats.localOnly).toBe(2);
    expect(stats.links).toBe(2);
    expect(stats.localLinks).toBe(2);
  });

  it('单 agent 统计（total / managed / inSync）', () => {
    expect(catalogAgentStats(catalog, 'claude')).toEqual({
      agent: 'claude',
      total: 2,
      linked: 1,
      local: 1,
      managed: 1,
      inSync: 1,
    });
    expect(catalogAgentStats(catalog, 'codex').inSync).toBe(1);
    expect(catalogAgentStats(catalog, 'gemini').total).toBe(0);
  });

  it('skill 级辅助函数', () => {
    const [a, , , d] = catalog.skills;
    expect(skillEnabledAnywhere(a)).toBe(true);
    expect(linkedAgentIds(a)).toEqual(['claude', 'codex']);
    expect(skillAgentCount(a)).toBe(2);
    expect(skillEnabledAnywhere(d)).toBe(false);
  });
});

describe('collectTags / toggle helpers', () => {
  const skills = [
    makeSkill('a', { tags: ['search', 'web', 'search'] }),
    makeSkill('b', { tags: ['web', 'manage'] }),
    makeSkill('c', { tags: [] }),
  ];

  it('去重并按标签名排序统计', () => {
    expect(collectTags(skills)).toEqual([
      { tag: 'manage', count: 1 },
      { tag: 'search', count: 1 },
      { tag: 'web', count: 2 },
    ]);
  });

  it('toggleTag / toggleInList 返回新数组', () => {
    const base = ['a'];
    const added = toggleTag(base, 'b');
    expect(added).toEqual(['a', 'b']);
    expect(base).toEqual(['a']);
    expect(toggleTag(added, 'a')).toEqual(['b']);
    expect(toggleInList([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleInList([1, 2], 2)).toEqual([1]);
  });

  it('来源标签与比例', () => {
    expect(sourceLabel('local')).toBe('本地');
    expect(sourceLabel('git')).toBe('Git');
    expect(sourceLabel('skills.sh')).toBe('skills.sh');
    expect(ratioPercent(1, 4)).toBe(25);
    expect(ratioPercent(3, 0)).toBe(0);
    expect(ratioPercent(10, 4)).toBe(100);
  });
});

describe('parseSkillMdMeta tags', () => {
  it('解析 inline / 逗号 / 多行 tags', () => {
    expect(
      parseSkillMdMeta('---\nname: a\ntags: [search, web]\n---\n# body').tags,
    ).toEqual(['search', 'web']);
    expect(
      parseSkillMdMeta('---\nname: a\ntags: search, web\n---\n# body').tags,
    ).toEqual(['search', 'web']);
    expect(
      parseSkillMdMeta('---\nname: a\ntags:\n  - search\n  - "web"\n---\n# body').tags,
    ).toEqual(['search', 'web']);
    expect(parseSkillMdMeta('---\nname: a\ntags: []\n---\n').tags).toEqual([]);
    expect(parseSkillMdMeta('---\nname: a\n---\n').tags).toBeUndefined();
  });
});