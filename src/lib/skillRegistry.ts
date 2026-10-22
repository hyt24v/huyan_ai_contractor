/**
 * Skill 市场纯逻辑：内置精选仓库、GitHub 搜索 URL 构造、搜索结果解析与合并。
 * 网络请求在 services/skillRegistry.ts。
 */

export interface SkillRepo {
  /** 展示名，通常为 owner/repo；也可直接用仓库名 */
  name: string;
  /** 可 clone 的仓库地址 */
  url: string;
  description: string;
  tags: string[];
  stars?: number;
}

/**
 * 内置精选：GitHub 搜索失败 / 触发限流时的兜底列表。
 * 均为公开的 skill 合集或示例仓库。
 */
export const CURATED_SKILL_REPOS: SkillRepo[] = [
  {
    name: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills',
    description: 'Anthropic 官方 Agent Skills 示例与规范参考',
    tags: ['official', 'anthropic', 'claude'],
    stars: 12000,
  },
  {
    name: 'obra/superpowers',
    url: 'https://github.com/obra/superpowers',
    description: '面向工程流程的 Claude Code skills 合集（规划、调试、评审）',
    tags: ['workflow', 'engineering', 'claude'],
    stars: 8000,
  },
  {
    name: 'ComposioHQ/awesome-claude-skills',
    url: 'https://github.com/ComposioHQ/awesome-claude-skills',
    description: '社区精选 Claude skills 清单，覆盖面广',
    tags: ['awesome-list', 'collection', 'claude'],
    stars: 6000,
  },
  {
    name: 'travisvn/awesome-claude-skills',
    url: 'https://github.com/travisvn/awesome-claude-skills',
    description: '按用途分类的 Claude skills 资源列表',
    tags: ['awesome-list', 'collection'],
    stars: 4000,
  },
  {
    name: 'microsoft/skills',
    url: 'https://github.com/microsoft/skills',
    description: '微软出品的 Agent Skills 示例与工具集成',
    tags: ['official', 'microsoft'],
    stars: 3000,
  },
  {
    name: 'modelcontextprotocol/servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    description: 'MCP 官方 servers 合集，常与 skill 搭配使用',
    tags: ['mcp', 'tools'],
    stars: 30000,
  },
];

const GITHUB_SEARCH_ENDPOINT = 'https://api.github.com/search/repositories';
const PER_PAGE = 12;
const DEFAULT_QUERY = 'claude skills';

/** 构造 GitHub 仓库搜索 URL（排序按 star，固定 12 条） */
export function searchQueryUrl(query: string): string {
  const q = query.trim() || DEFAULT_QUERY;
  return `${GITHUB_SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}&sort=stars&per_page=${PER_PAGE}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function cleanUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
}

function repoFromItem(item: unknown): SkillRepo | null {
  const rec = asRecord(item);
  if (!rec) return null;
  const fullName = typeof rec.full_name === 'string' ? rec.full_name.trim() : '';
  const rawUrl = typeof rec.html_url === 'string' ? rec.html_url.trim() : '';
  const shortName = typeof rec.name === 'string' ? rec.name.trim() : '';
  const url = rawUrl || (fullName ? `https://github.com/${fullName}` : '');
  if (!url) return null;
  const name = fullName || shortName || url.split('/').pop() || '';
  if (!name) return null;

  const description = typeof rec.description === 'string' ? rec.description.trim() : '';
  const topics = Array.isArray(rec.topics)
    ? rec.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 6)
    : [];
  const tags = topics.length > 0 ? topics : typeof rec.language === 'string' && rec.language ? [rec.language] : [];
  const stars = typeof rec.stargazers_count === 'number' && Number.isFinite(rec.stargazers_count)
    ? rec.stargazers_count
    : undefined;

  return {
    name,
    url: cleanUrl(url),
    description,
    tags,
    ...(stars !== undefined ? { stars } : {}),
  };
}

/**
 * 宽松解析 GitHub search API 响应。
 * 支持对象（{items:[...]}）、纯数组、JSON 字符串；任何异常都返回 []。
 */
export function parseGitHubSearch(json: unknown): SkillRepo[] {
  let data = json;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return [];
    }
  }
  const rec = asRecord(data);
  const items = Array.isArray(data) ? data : rec && Array.isArray(rec.items) ? rec.items : [];
  const out: SkillRepo[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const repo = repoFromItem(item);
    if (!repo) continue;
    const key = cleanUrl(repo.url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(repo);
  }
  return out;
}

function matchesQuery(repo: SkillRepo, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    repo.name.toLowerCase().includes(needle) ||
    repo.description.toLowerCase().includes(needle) ||
    repo.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

/**
 * 合并内置精选与 GitHub 结果：
 * - curated 中命中查询的排在前面；
 * - API 结果按 star 降序，URL 去重（忽略大小写 / .git / 尾斜杠）。
 */
export function mergeSearchResults(
  curated: SkillRepo[],
  apiResults: SkillRepo[],
  query = '',
  max = 24,
): SkillRepo[] {
  const out: SkillRepo[] = [];
  const seen = new Set<string>();
  const add = (repo: SkillRepo) => {
    const key = cleanUrl(repo.url).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(repo);
  };
  for (const repo of curated) {
    if (matchesQuery(repo, query)) add(repo);
  }
  const sortedApi = [...apiResults].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  for (const repo of sortedApi) add(repo);
  return out.slice(0, max);
}