/** Skill 市场服务：GitHub 搜索 + 内置精选兜底 */
import { invoke, isTauri } from '@tauri-apps/api/core';
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

interface RustHttpResponse {
  status: number;
  body: string;
}

/**
 * GET 请求：桌面端走 Rust http_request（与 AI 模块同一网络栈，统一超时），
 * 浏览器/测试环境走注入的 fetch（带 AbortController 超时）。
 */
async function requestGet(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: string }> {
  if (isTauri()) {
    const r = await invoke<RustHttpResponse>('http_request', {
      url,
      authorization: null,
      method: null,
      body: null,
      timeout_ms: TIMEOUT_MS,
      headers: { Accept: 'application/vnd.github+json' },
    });
    return { status: r.status, body: r.body };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 搜索可安装的 skill 仓库。
 * 网络失败、非 2xx（含 GitHub 403 限流）时回退到内置精选（按查询过滤）。
 */
export async function searchRepos(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoSearchResult> {
  try {
    const { status, body } = await requestGet(searchQueryUrl(query), fetchImpl);
    if (status < 200 || status >= 300) {
      const detail = status === 403 || status === 429 ? 'GitHub 限流' : `HTTP ${status}`;
      return {
        repos: mergeSearchResults(listCurated(), [], query),
        source: 'fallback',
        error: detail,
      };
    }
    const parsed = parseGitHubSearch(body);
    return { repos: mergeSearchResults(listCurated(), parsed, query), source: 'github' };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    const msg = e instanceof Error ? e.message : String(e);
    return {
      repos: mergeSearchResults(listCurated(), [], query),
      source: 'fallback',
      error: aborted ? '请求超时' : msg,
    };
  }
}
