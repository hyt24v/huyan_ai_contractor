/**
 * 供应商 API 探测：经 Rust http_request 转发（绕开 webview CORS）。
 * 用于端点测速和 /v1/models 模型列表自动获取（借鉴 cc-switch）。
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

interface HttpResponse {
  status: number;
  elapsed_ms: number;
  body: string;
}

/** 通用 HTTP 转发：默认 GET；body 非空时 POST JSON；AI 长生成用 timeoutMs 调大超时 */
async function httpRequest(
  url: string,
  opts?: {
    apiKey?: string;
    method?: string;
    body?: string;
    timeoutMs?: number;
    /** 额外请求头（如 Anthropic 的 x-api-key / anthropic-version），优先级高于 Bearer */
    headers?: Record<string, string>;
  },
): Promise<HttpResponse> {
  return invoke<HttpResponse>('http_request', {
    url,
    authorization: opts?.apiKey || null,
    method: opts?.method ?? null,
    body: opts?.body ?? null,
    timeout_ms: opts?.timeoutMs ?? null,
    headers: opts?.headers ?? null,
  });
}

async function httpGet(url: string, apiKey?: string): Promise<HttpResponse> {
  return httpRequest(url, { apiKey });
}

/** POST JSON 并读取响应（AI 聊天等），timeoutMs 默认 120s */
export async function httpPost(
  url: string,
  body: string,
  opts?: { apiKey?: string; timeoutMs?: number; headers?: Record<string, string> },
): Promise<HttpResponse> {
  return httpRequest(url, { ...opts, method: 'POST', body });
}

/** 由 baseUrl 推导 /models 地址：已含版本段（/v1、/v4…）则直接拼，否则补 /v1 */
export function modelsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return /\/v\d+[a-z]*$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

export interface EndpointTestResult {
  ok: boolean;
  /** HTTP 状态码（网络失败时无） */
  status?: number;
  /** 往返耗时毫秒（网络失败时无） */
  elapsedMs?: number;
  /** 人类可读的结论 */
  message: string;
}

/** 端点测速：GET models 端点，测可用性和延迟 */
export async function testEndpoint(
  baseUrl: string,
  apiKey?: string,
): Promise<EndpointTestResult> {
  if (!isTauri()) return { ok: false, message: '仅桌面 App 可用' };
  if (!baseUrl.trim()) return { ok: false, message: 'Base URL 为空' };
  try {
    const r = await httpGet(modelsUrl(baseUrl), apiKey);
    if (r.status === 200) {
      return { ok: true, status: r.status, elapsedMs: r.elapsed_ms, message: `✓ 可用 · ${r.elapsed_ms}ms` };
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, status: r.status, elapsedMs: r.elapsed_ms, message: `端点可达（${r.elapsed_ms}ms），但鉴权失败（${r.status}）：检查 API Key` };
    }
    if (r.status === 404) {
      return { ok: false, status: r.status, elapsedMs: r.elapsed_ms, message: `端点存在但无 models 接口（404）· ${r.elapsed_ms}ms` };
    }
    return { ok: false, status: r.status, elapsedMs: r.elapsed_ms, message: `HTTP ${r.status} · ${r.elapsed_ms}ms` };
  } catch (e) {
    return { ok: false, message: `连接失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface FetchModelsResult {
  ok: boolean;
  models: string[];
  message: string;
}

/** 拉取模型列表（OpenAI 兼容 /v1/models） */
export async function fetchModels(
  baseUrl: string,
  apiKey?: string,
): Promise<FetchModelsResult> {
  if (!isTauri()) return { ok: false, models: [], message: '仅桌面 App 可用' };
  if (!baseUrl.trim()) return { ok: false, models: [], message: 'Base URL 为空' };
  try {
    const r = await httpGet(modelsUrl(baseUrl), apiKey);
    if (r.status !== 200) {
      const hint =
        r.status === 401 || r.status === 403
          ? '鉴权失败，检查 API Key'
          : `HTTP ${r.status}`;
      return { ok: false, models: [], message: hint };
    }
    const parsed: unknown = JSON.parse(r.body);
    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return { ok: false, models: [], message: '响应不是 OpenAI 兼容格式' };
    }
    const models = data
      .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === 'string')
      .sort((a, b) => a.localeCompare(b));
    if (models.length === 0) return { ok: false, models: [], message: '模型列表为空' };
    return { ok: true, models, message: `拉取到 ${models.length} 个模型` };
  } catch (e) {
    return { ok: false, models: [], message: `请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}
