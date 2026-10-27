/**
 * AI 对话会话存储：每个「作用域」（scope，如当前工具页 id）一条会话，内存态。
 * 切换页面不丢上下文；应用重启即清空（AI-P0 不持久化）。
 * 超出 MAX_MESSAGES 时从头裁剪，控制 token 体积。
 */
import { useSyncExternalStore } from 'react';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /**  assistant 消息标记为失败（HTTP 错误等），UI 染红 */
  error?: boolean;
  /** 推理模型的思考过程，UI 折叠展示 */
  reasoning?: string;
  /** 正在流式生成中 */
  streaming?: boolean;
  /** 本条消息实际使用的模型 */
  model?: string;
}

const MAX_MESSAGES = 40;

/** 稳定的空数组引用：useSyncExternalStore 的 getSnapshot 必须返回缓存值，否则无限重渲染 */
const EMPTY_MESSAGES: readonly AiMessage[] = Object.freeze([]);

const sessions = new Map<string, AiMessage[]>();
const listeners = new Set<() => void>();
let seq = 0;

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function listMessages(scope: string): readonly AiMessage[] {
  return sessions.get(scope) ?? EMPTY_MESSAGES;
}

export function appendMessage(
  scope: string,
  msg: Omit<AiMessage, 'id' | 'ts'>,
): AiMessage {
  const full: AiMessage = { ...msg, id: `m${Date.now()}-${seq++}`, ts: Date.now() };
  const list = [...(sessions.get(scope) ?? []), full];
  sessions.set(scope, list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list);
  notify();
  return full;
}

/** 更新某条消息（流式增量渲染用）：按 id 局部 patch，生成新数组引用触发订阅 */
export function updateMessage(
  scope: string,
  id: string,
  patch: Partial<Omit<AiMessage, 'id' | 'role' | 'ts'>>,
): void {
  const list = sessions.get(scope);
  if (!list) return;
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const next = [...list];
  next[idx] = { ...next[idx], ...patch };
  sessions.set(scope, next);
  notify();
}

export function clearSession(scope: string): void {
  if (sessions.delete(scope)) notify();
}

// ---------- 每会话模型覆盖（对话中临时切换模型，不改全局默认） ----------

const modelOverrides = new Map<string, string>();

export function getModelOverride(scope: string): string | undefined {
  return modelOverrides.get(scope);
}

export function setModelOverride(scope: string, model: string): void {
  modelOverrides.set(scope, model);
  notify();
}

/** 清除会话的模型覆盖（如服务商切换后 override 的模型已不存在） */
export function clearModelOverride(scope: string): void {
  if (modelOverrides.delete(scope)) notify();
}

/** React hook：订阅某 scope 的模型覆盖 */
export function useModelOverride(scope: string): string | undefined {
  return useSyncExternalStore(subscribe, () => getModelOverride(scope));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook：订阅某 scope 的消息列表 */
export function useAiMessages(scope: string): readonly AiMessage[] {
  return useSyncExternalStore(subscribe, () => listMessages(scope));
}
