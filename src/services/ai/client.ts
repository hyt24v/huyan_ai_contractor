/**
 * AI 聊天客户端：把三种 ProviderApi 协议适配成统一的 chat()。
 * 请求经 Rust http_request 转发（webview fetch 有 CORS 限制）；
 * API Key 只在这里交给 Rust 侧拼请求头，绝不写日志。
 * AI-P0 非流式（ureq SSE 支持有限），超时默认 120s。
 */
import { listen } from '@tauri-apps/api/event';
import { aiSseAbort, aiSseRequest, httpPost } from '../../lib/providerApi';
import type { ModelParams, Provider, ProviderApi } from '../../lib/providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  ok: boolean;
  /** 成功时的助手回复文本 */
  text: string;
  /** 推理模型的思考过程（reasoning_content / thinking / reasoning summary） */
  reasoning?: string;
  status?: number;
  elapsedMs?: number;
  /** 用户主动中止（保留已生成的部分内容） */
  aborted?: boolean;
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

function completionsRequest(
  model: string,
  messages: ChatMessage[],
  stream = false,
  params?: ModelParams,
): string {
  // 参数缺省不携带——服务商用其原始默认配置
  return JSON.stringify({
    model,
    messages,
    stream,
    ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params?.topP !== undefined ? { top_p: params.topP } : {}),
    ...(params?.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
  });
}

/** 非流式响应解析：{ text, reasoning }；null = 结构不符 */
type ParsedReply = { text: string; reasoning?: string };

function completionsResponse(body: string): ParsedReply | null {
  try {
    const parsed = JSON.parse(body) as {
      choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[];
    };
    const message = parsed.choices?.[0]?.message;
    const content = message?.content;
    let text: string | null = null;
    if (typeof content === 'string') text = content;
    // 部分实现 content 是分段数组
    else if (Array.isArray(content)) {
      text = content
        .map((p) => (p && typeof p === 'object' ? (p as { text?: unknown }).text : null))
        .filter((t): t is string => typeof t === 'string')
        .join('');
    }
    if (text === null) return null;
    const reasoning =
      typeof message?.reasoning_content === 'string' && message.reasoning_content
        ? message.reasoning_content
        : undefined;
    return { text, ...(reasoning ? { reasoning } : {}) };
  } catch {
    return null;
  }
}

function responsesRequest(
  model: string,
  messages: ChatMessage[],
  stream = false,
  params?: ModelParams,
): string {
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
  return JSON.stringify({
    model,
    input,
    stream,
    ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params?.topP !== undefined ? { top_p: params.topP } : {}),
    ...(params?.maxTokens !== undefined
      ? { max_output_tokens: params.maxTokens }
      : {}),
  });
}

function responsesResponse(body: string): ParsedReply | null {
  try {
    const parsed = JSON.parse(body) as {
      output_text?: unknown;
      output?: {
        type?: string;
        summary?: { type?: string; text?: unknown }[];
        content?: { type?: string; text?: unknown }[];
      }[];
    };
    const text =
      typeof parsed.output_text === 'string' && parsed.output_text
        ? parsed.output_text
        : (() => {
            const texts = (parsed.output ?? [])
              .filter((o) => o.type === 'message')
              .flatMap((o) => o.content ?? [])
              .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
              .map((c) => c.text as string);
            return texts.length ? texts.join('') : null;
          })();
    if (text === null) return null;
    const reasoning = (parsed.output ?? [])
      .filter((o) => o.type === 'reasoning')
      .flatMap((o) => o.summary ?? [])
      .filter((s) => typeof s.text === 'string')
      .map((s) => s.text as string)
      .join('\n');
    return { text, ...(reasoning ? { reasoning } : {}) };
  } catch {
    return null;
  }
}

function anthropicRequest(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  stream = false,
  params?: ModelParams,
): string {
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
    stream,
    ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params?.topP !== undefined ? { top_p: params.topP } : {}),
  });
}

function anthropicResponse(body: string): ParsedReply | null {
  try {
    const parsed = JSON.parse(body) as {
      content?: { type?: string; text?: unknown; thinking?: unknown }[];
    };
    const texts = (parsed.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
    if (!texts.length) return null;
    const thinking = (parsed.content ?? [])
      .filter((c) => c.type === 'thinking' && typeof c.thinking === 'string')
      .map((c) => c.thinking as string)
      .join('\n');
    return { text: texts.join(''), ...(thinking ? { reasoning: thinking } : {}) };
  } catch {
    return null;
  }
}

// ---------- 统一入口 ----------

export interface ChatOptions {
  /** 覆盖 provider.model（设置页 AI 节里单独选择的模型） */
  model?: string;
  maxTokens?: number;
  /** 按模型的参数覆盖（Provider.modelParams[effectiveModel]）；缺省不发送 */
  params?: ModelParams;
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

  const req = buildRequest(provider, messages, opts, false);

  try {
    const r = await httpPost(req.url, req.body, {
      apiKey: api === 'anthropic-messages' ? undefined : provider.apiKey,
      headers: req.headers,
      timeoutMs,
    });
    if (r.status !== 200) {
      return { ok: false, text: '', status: r.status, elapsedMs: r.elapsed_ms, error: extractError(r.status, r.body) };
    }
    const parsed = req.parse(r.body);
    if (parsed === null || !parsed.text.trim()) {
      return { ok: false, text: '', status: r.status, elapsedMs: r.elapsed_ms, error: '响应格式无法解析（非预期结构）' };
    }
    return {
      ok: true,
      text: parsed.text,
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      status: r.status,
      elapsedMs: r.elapsed_ms,
    };
  } catch (e) {
    return { ok: false, text: '', error: `请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------- 请求构造（非流式/流式共用） ----------

interface BuiltRequest {
  url: string;
  body: string;
  headers?: Record<string, string>;
  parse: (raw: string) => ParsedReply | null;
}

function buildRequest(
  provider: Provider,
  messages: ChatMessage[],
  opts: ChatOptions | undefined,
  stream: boolean,
): BuiltRequest {
  const api: ProviderApi = provider.api ?? 'openai-completions';
  const model = (opts?.model ?? provider.model ?? '').trim();
  switch (api) {
    case 'openai-responses':
      return {
        url: endpointUrl(provider.baseUrl, 'responses'),
        body: responsesRequest(model, messages, stream, opts?.params),
        parse: responsesResponse,
      };
    case 'anthropic-messages':
      return {
        url: endpointUrl(provider.baseUrl, 'messages'),
        body: anthropicRequest(
          model,
          messages,
          opts?.maxTokens ?? opts?.params?.maxTokens ?? 8192,
          stream,
          opts?.params,
        ),
        // Anthropic 用 x-api-key 鉴权，不走 Bearer
        headers: {
          'x-api-key': provider.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        parse: anthropicResponse,
      };
    default:
      return {
        url: endpointUrl(provider.baseUrl, 'chat/completions'),
        body: completionsRequest(model, messages, stream, opts?.params),
        parse: completionsResponse,
      };
  }
}

// ---------- SSE 流式 ----------

/** 单个 SSE data: 载荷的解析结果 */
export interface StreamDelta {
  text?: string;
  reasoning?: string;
  /** 流正常结束（[DONE] / message_stop / response.completed） */
  done?: boolean;
  /** 流内错误（供应商返回 error 事件） */
  failed?: string;
}

/** 按协议解析一行 SSE data: 载荷；null = 与本协议无关的控制帧 */
export function parseStreamData(api: ProviderApi, data: string): StreamDelta | null {
  if (data === '[DONE]') return { done: true };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (api) {
    case 'openai-responses': {
      const type = typeof obj.type === 'string' ? obj.type : '';
      if (type === 'response.output_text.delta' && typeof obj.delta === 'string') {
        return { text: obj.delta };
      }
      if (type === 'response.reasoning_summary_text.delta' && typeof obj.delta === 'string') {
        return { reasoning: obj.delta };
      }
      if (type === 'response.completed') return { done: true };
      if (type === 'response.failed' || type === 'error') {
        const msg =
          (obj.response as { error?: { message?: unknown } } | undefined)?.error?.message ??
          (obj.error as { message?: unknown } | undefined)?.message ??
          obj.message;
        return { failed: typeof msg === 'string' && msg ? msg : '供应商返回错误事件' };
      }
      return null;
    }
    case 'anthropic-messages': {
      const type = typeof obj.type === 'string' ? obj.type : '';
      if (type === 'content_block_delta') {
        const delta = obj.delta as { type?: string; text?: unknown; thinking?: unknown } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') return { text: delta.text };
        if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          return { reasoning: delta.thinking };
        }
        return null;
      }
      if (type === 'message_stop') return { done: true };
      if (type === 'error') {
        const msg = (obj.error as { message?: unknown } | undefined)?.message;
        return { failed: typeof msg === 'string' && msg ? msg : '供应商返回错误事件' };
      }
      return null;
    }
    // openai-completions 及其它 OpenAI 兼容协议
    default: {
      const choice = (obj.choices as { delta?: Record<string, unknown> }[] | undefined)?.[0];
      const delta = choice?.delta;
      if (!delta) return null;
      const text = typeof delta.content === 'string' ? delta.content : undefined;
      const reasoning =
        typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined;
      return text || reasoning ? { ...(text ? { text } : {}), ...(reasoning ? { reasoning } : {}) } : null;
    }
  }
}

interface SseEventPayload {
  id: string;
  kind: 'data' | 'body' | 'done' | 'aborted' | 'error';
  data?: string;
  status?: number;
  body?: string;
  message?: string;
}

export interface ChatStreamOptions extends ChatOptions {
  /** 每个增量到达时回调（text / reasoning 增量） */
  onDelta?: (delta: { text?: string; reasoning?: string }) => void;
}

export interface StreamHandle {
  done: Promise<ChatResult>;
  /** 用户主动停止（保留已生成内容） */
  abort: () => void;
}

/**
 * 流式对话：Rust 侧逐行透传 SSE data: 载荷，这里按协议增量解析。
 * 供应商不支持流式（返回非 SSE）时自动回退为非流式整包解析。
 */
export function chatStream(
  provider: Provider,
  messages: ChatMessage[],
  opts?: ChatStreamOptions,
): StreamHandle {
  const api: ProviderApi = provider.api ?? 'openai-completions';
  const model = (opts?.model ?? provider.model ?? '').trim();
  const streamId = `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  if (!model) {
    return {
      done: Promise.resolve({
        ok: false,
        text: '',
        error: '未指定模型：请在设置 → AI 助手中选择模型',
      }),
      abort: () => undefined,
    };
  }

  const req = buildRequest(provider, messages, opts, true);
  let text = '';
  let reasoning = '';

  const done = new Promise<ChatResult>((resolve) => {
    let unlisten: (() => void) | undefined;
    let settled = false;
    const finish = (r: ChatResult) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      resolve(r);
    };

    listen<SseEventPayload>('ai-sse', (event) => {
      const p = event.payload;
      if (p.id !== streamId) return;
      switch (p.kind) {
        case 'data': {
          if (typeof p.data !== 'string') return;
          const delta = parseStreamData(api, p.data);
          if (!delta) return;
          if (delta.failed) {
            finish({ ok: false, text, ...(reasoning ? { reasoning } : {}), error: delta.failed });
            return;
          }
          if (delta.text) text += delta.text;
          if (delta.reasoning) reasoning += delta.reasoning;
          if (delta.text || delta.reasoning) {
            opts?.onDelta?.({ ...(delta.text ? { text: delta.text } : {}), ...(delta.reasoning ? { reasoning: delta.reasoning } : {}) });
          }
          if (delta.done) {
            finish({ ok: true, text, ...(reasoning ? { reasoning } : {}) });
          }
          return;
        }
        case 'body': {
          // 供应商不支持流式：整包回退到非流式解析
          const status = p.status ?? 0;
          const rawBody = p.body ?? '';
          if (status !== 200) {
            finish({ ok: false, text: '', status, error: extractError(status, rawBody) });
            return;
          }
          const parsed = req.parse(rawBody);
          if (parsed === null || !parsed.text.trim()) {
            finish({ ok: false, text: '', status, error: '响应格式无法解析（非预期结构）' });
            return;
          }
          opts?.onDelta?.({ text: parsed.text, ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}) });
          finish({
            ok: true,
            text: parsed.text,
            ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
            status,
          });
          return;
        }
        case 'done': {
          if (!text.trim() && !reasoning.trim()) {
            finish({ ok: false, text: '', status: p.status, error: '响应为空（供应商可能不支持流式输出）' });
            return;
          }
          finish({ ok: true, text, ...(reasoning ? { reasoning } : {}), status: p.status });
          return;
        }
        case 'aborted': {
          finish({ ok: true, text, ...(reasoning ? { reasoning } : {}), aborted: true });
          return;
        }
        case 'error': {
          finish({
            ok: false,
            text,
            ...(reasoning ? { reasoning } : {}),
            error: p.message ?? '流式请求失败',
          });
          return;
        }
      }
    })
      .then((fn) => {
        unlisten = fn;
        return aiSseRequest(streamId, req.url, req.body, {
          apiKey: api === 'anthropic-messages' ? undefined : provider.apiKey,
          headers: req.headers,
        });
      })
      .catch((e) => {
        finish({ ok: false, text: '', error: `请求失败：${e instanceof Error ? e.message : String(e)}` });
      });
  });

  return {
    done,
    abort: () => {
      void aiSseAbort(streamId).catch(() => undefined);
    },
  };
}
