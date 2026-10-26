/**
 * AI 助手对话 Dock（F3 骨架，AI-P0）：
 * 右侧浮起面板（dbx 范式：圆角描边无阴影），非流式对话，
 * 会话按 scope（当前工具页）内存保持，切换页面不丢上下文。
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, SendHorizonal, Trash2, X } from 'lucide-react';
import { chat } from '../services/ai/client';
import { buildSystemPrompt } from '../services/ai/prompts';
import {
  appendMessage,
  clearSession,
  useAiMessages,
} from '../services/ai/session';
import { getAiSettings, onSettingsChanged } from '../lib/settings';
import { loadStore } from '../services/providers';
import type { Provider } from '../lib/providers';
import { Button } from './ui/controls';

interface AiDockProps {
  open: boolean;
  onClose: () => void;
  /** 会话作用域：当前工具页名（切换页面各自保留会话） */
  scope: string;
}

export default function AiDock({ open, onClose, scope }: AiDockProps) {
  const messages = useAiMessages(scope);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<Provider | null | undefined>(undefined);
  const [model, setModel] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 读取 AI 设置 → 解析 provider（设置变更时重新解析）
  useEffect(() => {
    if (!open) return;
    const resolve = async () => {
      const s = getAiSettings();
      setModel(s.model ?? '');
      if (!s.providerId) {
        setProvider(null);
        return;
      }
      try {
        const store = await loadStore();
        setProvider(store.providers.find((p) => p.id === s.providerId) ?? null);
      } catch {
        setProvider(null);
      }
    };
    void resolve();
    return onSettingsChanged(() => void resolve());
  }, [open]);

  // 新消息滚动到底部；打开时聚焦输入框
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const effectiveModel = model || provider?.model || '';

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!provider) return; // 未配置时输入区已被占位提示替换
    setInput('');
    setSending(true);
    appendMessage(scope, { role: 'user', content: text });
    try {
      const history = [
        { role: 'system' as const, content: buildSystemPrompt({ toolName: scope }) },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ];
      const r = await chat(provider, history, { model: effectiveModel });
      if (r.ok) {
        appendMessage(scope, { role: 'assistant', content: r.text });
      } else {
        appendMessage(scope, {
          role: 'assistant',
          content: r.error ?? '未知错误',
          error: true,
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-content"
      aria-label="AI 助手"
    >
      {/* header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">AI 助手</span>
          {provider && effectiveModel && (
            <span className="truncate text-[11px] font-normal text-muted-foreground">
              · {provider.name}/{effectiveModel}
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => clearSession(scope)}
            title="清空当前会话"
            aria-label="清空当前会话"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            title="关闭"
            aria-label="关闭 AI 助手"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {provider === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              尚未配置 AI 助手
              <br />
              请到「设置 → AI 助手」选择服务商与模型
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              你好，我是内置助手
              <br />
              可以问我配置、Skills、MCP 相关问题
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[92%] whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'self-end bg-primary text-primary-foreground'
                    : m.error
                      ? 'self-start border border-destructive/40 bg-destructive/10 text-destructive'
                      : 'self-start bg-accent/60 text-foreground'
                }`}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-1.5 self-start px-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                思考中…
              </div>
            )}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border/40 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={provider ? '输入消息，Enter 发送 / Shift+Enter 换行' : '先在设置中配置 AI 助手'}
            disabled={!provider || sending}
            rows={2}
            className="min-h-[36px] flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-ring disabled:opacity-50"
          />
          <Button
            variant="default"
            size="icon-sm"
            onClick={() => void send()}
            disabled={!provider || sending || !input.trim()}
            title="发送"
            aria-label="发送"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizonal className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </aside>
  );
}
