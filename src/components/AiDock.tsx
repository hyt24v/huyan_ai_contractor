/**
 * AI 助手对话 Dock（F3，对齐 dbx AiAssistant 形态）：
 * - 右侧浮起面板（dbx 范式：圆角描边无阴影），左边缘可拖宽（240–640，localStorage 持久化），可最大化占满主区
 * - 顶栏 h-10 + h-6 ghost 图标按钮排（清空/最大化/关闭），标题 text-xs
 * - 空态：Bot opacity-30 + 圆形建议 chips（点击直接发送）
 * - 气泡：用户 bg-primary / AI bg-muted，rounded-lg px-3 py-2 text-xs
 * - composer：rounded-md border bg-background 容器 = 自动增高 textarea + action row（模型名 + 圆形发送钮）
 * 非流式对话；会话按 scope（当前工具页）内存保持，切换页面不丢上下文。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  Bot,
  Loader2,
  Maximize2,
  Minimize2,
  Trash2,
  X,
} from 'lucide-react';
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

const WIDTH_KEY = 'huyan_tool:ai_dock_width';
const MIN_WIDTH = 240;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 320;

const loadWidth = (): number => {
  const v = Number(localStorage.getItem(WIDTH_KEY));
  return v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
};

/** dbx 顶栏 ghost 图标按钮统一尺寸 */
const HEADER_BTN =
  'flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
/** dbx 空态建议 chip */
const CHIP =
  'rounded-full border border-border/80 bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground';

export default function AiDock({ open, onClose, scope }: AiDockProps) {
  const messages = useAiMessages(scope);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<Provider | null | undefined>(undefined);
  const [model, setModel] = useState<string>('');
  const [width, setWidth] = useState(loadWidth);
  const [maximized, setMaximized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

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

  // 自动增高 textarea（dbx composer 行为，上限 120px）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input, open]);

  if (!open) return null;

  const effectiveModel = model || provider?.model || '';

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending || !provider) return;
    setInput('');
    setSending(true);
    appendMessage(scope, { role: 'user', content });
    try {
      const history = [
        { role: 'system' as const, content: buildSystemPrompt({ toolName: scope }) },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
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

  // 左边缘拖拽调宽
  const onDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (startX - ev.clientX)));
      setWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const suggestions = [
    `介绍一下「${scope}」的用法`,
    '帮我写一个 Skill',
    '什么是 MCP？',
  ];

  return (
    <aside
      className={`relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-content ${
        maximized ? 'min-w-0 flex-1' : ''
      }`}
      style={maximized ? undefined : { width }}
      aria-label="AI 助手"
    >
      {/* 左边缘拖拽手柄（最大化时隐藏） */}
      {!maximized && (
        <div
          onPointerDown={onDragStart}
          className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/30"
          title="拖动调整宽度"
        />
      )}

      {/* 顶栏（dbx：h-10 border-b px-3 + h-6 ghost 按钮排）；标题区兼窗口拖拽区 */}
      <div
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border/40 px-3"
      >
        <span className="flex min-w-0 flex-1 items-center truncate text-xs font-medium">
          AI 助手
          {provider && effectiveModel && (
            <span className="ml-1.5 truncate font-normal text-muted-foreground">
              · {provider.name}/{effectiveModel}
            </span>
          )}
        </span>
        <button
          onClick={() => clearSession(scope)}
          title="清空当前会话"
          aria-label="清空当前会话"
          className={HEADER_BTN}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setMaximized((v) => !v)}
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
          aria-pressed={maximized}
          className={HEADER_BTN}
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onClose}
          title="关闭"
          aria-label="关闭 AI 助手"
          className={HEADER_BTN}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 消息区 / 空态 */}
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground">
          <Bot className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">
            {provider === null ? '尚未配置 AI 助手' : '你好，我是内置助手'}
          </p>
          <div className="mt-5 flex max-w-[95%] flex-wrap justify-center gap-2">
            {provider === null ? (
              <button className={CHIP} onClick={() => navigate('/settings/ai')}>
                去「设置 → AI 助手」配置
              </button>
            ) : (
              suggestions.map((s) => (
                <button
                  key={s}
                  className={CHIP}
                  disabled={sending}
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex w-full max-w-[95%] min-w-0 flex-col">
                  <div
                    className={`w-full whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed [overflow-wrap:anywhere] ${
                      m.error
                        ? 'border border-destructive/40 bg-destructive/10 text-destructive'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ),
            )}
            {sending && (
              <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                思考中…
              </div>
            )}
          </div>
        </div>
      )}

      {/* composer（dbx：rounded-md border bg-background 容器 = textarea + action row） */}
      <div className="shrink-0 border-t border-border/40 p-2">
        <div className="rounded-md border border-border bg-background px-2 pb-1 pt-1.5 focus-within:border-ring">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={
              provider
                ? '输入消息，Enter 发送 / Shift+Enter 换行'
                : '先在设置中配置 AI 助手'
            }
            disabled={!provider || sending}
            rows={1}
            className="mb-1 max-h-[120px] w-full resize-none bg-transparent text-xs leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {provider
                ? `${provider.name}${effectiveModel ? ` · ${effectiveModel}` : ''}`
                : '未配置服务商'}
            </span>
            <Button
              variant="default"
              size="icon-sm"
              onClick={() => void send(input)}
              disabled={!provider || sending || !input.trim()}
              title="发送"
              aria-label="发送"
              className="h-7 w-7 rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
