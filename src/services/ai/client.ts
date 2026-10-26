/**
 * AI 聊天客户端：把三种 ProviderApi 协议适配成统一的 chat()。
 * 请求经 Rust http_request 转发（webview fetch 有 CORS 限制）；
 * API Key 只在这里交给 Rust 侧拼请求头，绝不写日志。
 * AI-P0 非流式（ureq SSE 支持有限），超时默认 120s。
 */
import { httpPost } from '../../lib/providerApi';
import type { Provider, ProviderApi } from '../../lib/providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  ok: boolean;
  /** 成功时的助手回复文本 */
  text: string;
  status?: number;
  elapsedMs?: number;
  /** 失败时的人类可读错误 */
  error?: string;
}

const AI_TIMEOUT_MS = 120_000;

/** 由 baseUrl 推导端点：已含版本段（/v1、/v4…）则直接拼，否则补 /v1 */
function endpointUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return /\/v\d+[a-z]*$/i.test(base) ? `${base}/${path}` : `${base}/v1/${path}`;
}

/** 从错误响应体里尽量抠出人类可读信息 */
function extractError(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const err = (parsed as { error?: { message?: unknown }; message?: unknown })?.error;
    const msg =
      (err && typeof err === 'object' ? err.message : null) ??
      (parsed as { message?: unknown })?.message;
    if (typeof msg === 'string' && msg) return `HTTP ${status}：${msg}`;
  } catch {
    // body 不是 JSON
  }
  const snippet = body.trim().slice(0, 200);
  return snippet ? `HTTP ${status}：${snippet}` : `HTTP ${status}`;
}

// ---------- 协议适配 ----------

function completionsRequest(model: string, messages: ChatMessage[]): string {
  return JSON.stringify({ model, messages, stream: false });
}

function completionsResponse(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    // 部分实现 content 是分段数组
    if (Array.isArray(content)) {
      return content
        .map((p) => (p && typeof p === 'object' ? (p as { text?: unknown }).text : null))
        .filter((t): t is string => typeof t === 'string')
        .join('');
    }
    return null;
  } catch {
    return null;
  }
}

function responsesRequest(model: string, messages: ChatMessage[]): string {
  const input = messages.map((m) => ({
    type: 'message',
    role: m.role,
    content: [
      {
        type: m.role === 'assistant' ? 'output_text' : 'input_text',
        text: m.content,
      },
    ],
  }));
  return JSON.stringify({ model, input, stream: false });
}

function responsesResponse(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      output_text?: unknown;
      output?: {
        type?: string;
        content?: { type?: string; text?: unknown }[];
      }[];
    };
    if (typeof parsed.output_text === 'string' && parsed.output_text) {
      return parsed.output_text;
    }
    const texts = (parsed.output ?? [])
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
      .map((c) => c.text as string);
    return texts.length ? texts.join('') : null;
  } catch {
    return null;
  }
}

function anthropicRequest(model: string, messages: ChatMessage[], maxTokens: number): string {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: turns,
    stream: false,
  });
}

function anthropicResponse(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      content?: { type?: string; text?: unknown }[];
    };
    const texts = (parsed.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
    return texts.length ? texts.join('') : null;
  } catch {
    return null;
  }
}

// ---------- 统一入口 ----------

export interface ChatOptions {
  /** 覆盖 provider.model（设置页 AI 节里单独选择的模型） */
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * 发起一轮对话（非流式）。provider.api 缺省按 openai-completions 处理。
 * 失败不抛异常，返回 { ok: false, error }。
 */
export async function chat(
  provider: Provider,
  messages: ChatMessage[],
  opts?: ChatOptions,
): Promise<ChatResult> {
  const api: ProviderApi = provider.api ?? 'openai-completions';
  const model = (opts?.model ?? provider.model ?? '').trim();
  if (!model) {
    return { ok: false, text: '', error: '未指定模型：请在设置 → AI 助手中选择模型' };
  }
  const timeoutMs = opts?.timeoutMs ?? AI_TIMEOUT_MS;

  let url: string;
  let body: string;
  let headers: Record<string, string> | undefined;
  let parse: (raw: string) => string | null;

  switch (api) {
    case 'openai-responses':
      url = endpointUrl(provider.baseUrl, 'responses');
      body = responsesRequest(model, messages);
      parse = responsesResponse;
      break;
    case 'anthropic-messages':
      url = endpointUrl(provider.baseUrl, 'messages');
      body = anthropicRequest(model, messages, opts?.maxTokens ?? 4096);
      // Anthropic 用 x-api-key 鉴权，不走 Bearer
      headers = {
        'x-api-key': provider.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      };
      parse = anthropicResponse;
      break;
    default:
      url = endpointUrl(provider.baseUrl, 'chat/completions');
      body = completionsRequest(model, messages);
      parse = completionsResponse;
      break;
  }

  try {
    const r = await httpPost(url, body, {
      apiKey: api === 'anthropic-messages' ? undefined : provider.apiKey,
      headers,
      timeoutMs,
    });
    if (r.status !== 200) {
      return { ok: false, text: '', status: r.status, elapsedMs: r.elapsed_ms, error: extractError(r.status, r.body) };
    }
    const text = parse(r.body);
    if (text === null || !text.trim()) {
      return { ok: false, text: '', status: r.status, elapsedMs: r.elapsed_ms, error: '响应格式无法解析（非预期结构）' };
    }
    return { ok: true, text, status: r.status, elapsedMs: r.elapsed_ms };
  } catch (e) {
    return { ok: false, text: '', error: `请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}
