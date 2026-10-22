import { describe, expect, it } from 'vitest';
import {
  CURATED_SKILL_REPOS,
  mergeSearchResults,
  parseGitHubSearch,
  searchQueryUrl,
  type SkillRepo,
} from './skillRegistry';

const repo = (over: Partial<SkillRepo> = {}): SkillRepo => ({
  name: 'owner/repo',
  url: 'https://github.com/owner/repo',
  description: '一个 skill 仓库',
  tags: ['skill'],
  ...over,
});

describe('CURATED_SKILL_REPOS', () => {
  it('内置精选非空且 URL 唯一', () => {
    expect(CURATED_SKILL_REPOS.length).toBeGreaterThanOrEqual(5);
    const urls = CURATED_SKILL_REPOS.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const r of CURATED_SKILL_REPOS) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.url.startsWith('https://github.com/')).toBe(true);
      expect(Array.isArray(r.tags)).toBe(true);
    }
  });
});

describe('searchQueryUrl', () => {
  it('编码查询并固定排序与分页', () => {
    const url = searchQueryUrl('claude skills');
    expect(url).toBe(
      'https://api.github.com/search/repositories?q=claude%20skills&sort=stars&per_page=12',
    );
    expect(searchQueryUrl('  中文 skill  ')).toContain(
      'q=%E4%B8%AD%E6%96%87%20skill',
    );
  });

  it('空查询使用默认关键词', () => {
    expect(searchQueryUrl('   ')).toContain('q=claude%20skills');
  });
});

describe('parseGitHubSearch', () => {
  it('解析标准响应', () => {
    const parsed = parseGitHubSearch({
      total_count: 1,
      items: [
        {
          full_name: 'anthropics/skills',
          html_url: 'https://github.com/anthropics/skills',
          description: ' 官方 skills ',
          topics: ['claude', 'skills', 42],
          stargazers_count: 1234,
        },
      ],
    });
    expect(parsed).toEqual([
      {
        name: 'anthropics/skills',
        url: 'https://github.com/anthropics/skills',
        description: '官方 skills',
        tags: ['claude', 'skills'],
        stars: 1234,
      },
    ]);
  });

  it('支持 JSON 字符串与纯数组', () => {
    expect(
      parseGitHubSearch(
        JSON.stringify({
          items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b' }],
        }),
      )[0].name,
    ).toBe('a/b');
    expect(
      parseGitHubSearch([{ name: 'c', html_url: 'https://github.com/x/c' }])[0].name,
    ).toBe('c');
  });

  it('容错：非法输入、缺字段、重复 URL', () => {
    expect(parseGitHubSearch(null)).toEqual([]);
    expect(parseGitHubSearch('not json')).toEqual([]);
    expect(parseGitHubSearch({})).toEqual([]);
    expect(parseGitHubSearch({ items: 'nope' })).toEqual([]);
    expect(parseGitHubSearch({ items: [{ description: 'no url' }] })).toEqual([]);

    const parsed = parseGitHubSearch({
      items: [
        { full_name: 'a/dup', html_url: 'https://github.com/a/dup' },
        { full_name: 'a/dup', html_url: 'https://github.com/a/dup.git' },
        { full_name: 'b/x', html_url: 'https://github.com/b/x', stargazers_count: 'many' },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[1].stars).toBeUndefined();
  });
});

describe('mergeSearchResults', () => {
  it('精选命中项在前，API 结果按 star 降序并去重', () => {
    const curated = [repo({ name: 'curated/hit', url: 'https://github.com/curated/hit' })];
    const api = [
      repo({ name: 'low/stars', url: 'https://github.com/low/stars', stars: 10 }),
      repo({ name: 'high/stars', url: 'https://github.com/high/stars', stars: 900 }),
      repo({ name: 'curated/hit', url: 'https://github.com/curated/hit/', stars: 999 }),
    ];
    const merged = mergeSearchResults(curated, api, 'curated');
    expect(merged.map((r) => r.name)).toEqual([
      'curated/hit',
      'high/stars',
      'low/stars',
    ]);
  });

  it('按名称 / 描述 / 标签过滤精选', () => {
    const curated = [
      repo({ name: 'a/alpha', url: 'https://github.com/a/alpha' }),
      repo({
        name: 'b/beta',
        url: 'https://github.com/b/beta',
        description: 'MCP 工具集',
        tags: ['mcp'],
      }),
    ];
    expect(mergeSearchResults(curated, [], 'alpha').map((r) => r.name)).toEqual(['a/alpha']);
    expect(mergeSearchResults(curated, [], 'mcp').map((r) => r.name)).toEqual(['b/beta']);
    expect(mergeSearchResults(curated, [], 'none')).toEqual([]);
    expect(mergeSearchResults(curated, [], '').map((r) => r.name)).toEqual([
      'a/alpha',
      'b/beta',
    ]);
  });

  it('尊重 max 上限', () => {
    const curated = Array.from({ length: 5 }, (_, i) =>
      repo({ name: `o/r${i}`, url: `https://github.com/o/r${i}` }),
    );
    expect(mergeSearchResults(curated, [], '', 3)).toHaveLength(3);
  });
});