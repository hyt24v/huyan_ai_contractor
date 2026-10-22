/** Skill 市场服务：GitHub 搜索 + 内置精选兜底 */
import {
  CURATED_SKILL_REPOS,
  mergeSearchResults,
  parseGitHubSearch,
  searchQueryUrl,
  type SkillRepo,
} from '../lib/skillRegistry';

export interface RepoSearchResult {
  repos: SkillRepo[];
  source: 'github' | 'fallback';
  /** 回退原因（限流 / 网络失败等），成功时为 undefined */
  error?: string;
}

const TIMEOUT_MS = 6000;

/** 内置精选列表（不发起网络请求） */
export function listCurated(): SkillRepo[] {
  return [...CURATED_SKILL_REPOS];
}

/**
 * 搜索可安装的 skill 仓库。
 * 网络失败、非 2xx（含 GitHub 403 限流）时回退到内置精选（按查询过滤）。
 */
export async function searchRepos(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(searchQueryUrl(query), {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = res.status === 403 || res.status === 429 ? 'GitHub 限流' : `HTTP ${res.status}`;
      return {
        repos: mergeSearchResults(listCurated(), [], query),
        source: 'fallback',
        error: detail,
      };
    }
    const parsed = parseGitHubSearch(await res.json());
    return { repos: mergeSearchResults(listCurated(), parsed, query), source: 'github' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      repos: mergeSearchResults(listCurated(), [], query),
      source: 'fallback',
      error: controller.signal.aborted ? '请求超时' : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}