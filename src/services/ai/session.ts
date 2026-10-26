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
}

const MAX_MESSAGES = 40;

const sessions = new Map<string, AiMessage[]>();
const listeners = new Set<() => void>();
let seq = 0;

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function listMessages(scope: string): readonly AiMessage[] {
  return sessions.get(scope) ?? [];
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

export function clearSession(scope: string): void {
  if (sessions.delete(scope)) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook：订阅某 scope 的消息列表 */
export function useAiMessages(scope: string): readonly AiMessage[] {
  return useSyncExternalStore(subscribe, () => listMessages(scope));
}
