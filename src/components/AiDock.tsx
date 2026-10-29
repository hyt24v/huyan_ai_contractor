/**
 * AI 助手对话 Dock（F3，对齐 dbx AiAssistant 形态）：
 * - 右侧浮起面板（dbx 范式：圆角描边无阴影），左边缘可拖宽（240–640，localStorage 持久化），可最大化占满主区
 * - 顶栏 h-10 + h-6 ghost 图标按钮排（清空/最大化/关闭），标题 text-xs
 * - 空态：Bot opacity-30 + 圆形建议 chips（点击直接发送）
 * - 气泡：用户 bg-primary / AI bg-muted，rounded-lg px-3 py-2 text-xs；推理模型的思考过程折叠展示
 * - composer：rounded-md border bg-background 容器 = 自动增高 textarea + action row（模型选择器 + 圆形发送/停止钮）
 * - 流式输出（SSE 经 Rust 侧转发，实时增量渲染）；生成中可点击停止
 * - 模型可在对话中临时切换（仅当前会话生效，不改全局默认）；会话按 scope 内存保持，切换页面不丢上下文
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { chatStream, type StreamHandle } from '../services/ai/client';
import { buildSystemPrompt } from '../services/ai/prompts';
import {
  appendMessage,
  clearModelOverride,
  clearSession,
  setModelOverride,
  updateMessage,
  useAiMessages,
  useModelOverride,
} from '../services/ai/session';
import { getAiSettings, onSettingsChanged, SETTINGS_CHANGED_EVENT } from '../lib/settings';
import { loadStore, patchProvider } from '../services/providers';
import type { ModelParams, Provider } from '../lib/providers';
import ModelParamsEditor from './ModelParamsEditor';
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


export default function AiDock({ open, onClose, scope }: AiDockProps) {
  const messages = useAiMessages(scope);
  const modelOverride = useModelOverride(scope);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [provider, setProvider] = useState<Provider | null | undefined>(undefined);
  const [model, setModel] = useState<string>('');
  const [width, setWidth] = useState(loadWidth);
  const [maximized, setMaximized] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);
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

  // 关闭面板时中止进行中的流
  useEffect(() => {
    if (!open && streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
      setStreaming(false);
    }
  }, [open]);

  // 消息更新（含流式增量）滚动到底部；打开时聚焦输入框
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);
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

  // 服务商切换 / 模型列表变动后，过期的会话模型覆盖自动清除，避免向服务商发不存在的模型名
  useEffect(() => {
    if (!modelOverride || provider === undefined) return;
    const opts = new Set(
      [
        ...(provider?.models ?? []),
        ...(provider?.model ? [provider.model] : []),
        ...(model ? [model] : []),
      ].filter(Boolean),
    );
    if (!opts.has(modelOverride)) clearModelOverride(scope);
  }, [modelOverride, provider, model, scope]);

  if (!open) return null;

  const modelOptions = [
    ...new Set(
      [
        ...(provider?.models ?? []),
        ...(provider?.model ? [provider.model] : []),
        ...(model ? [model] : []),
      ].filter(Boolean),
    ),
  ];
  // 对话内临时切换优先（模型已不在服务商列表时忽略，由上方 effect 清除），其次 AI 设置默认，最后服务商默认
  const effectiveModel =
    (modelOverride && modelOptions.includes(modelOverride) ? modelOverride : '') ||
    model ||
    provider?.model ||
    '';

  const lastMsg = messages[messages.length - 1];
  const waitingReply =
    streaming && lastMsg?.streaming && !lastMsg.content && !lastMsg.reasoning;

  const stop = () => {
    streamRef.current?.abort();
  };

  /** 保存当前模型的参数覆盖（补丁式合并到磁盘最新 store，避免覆盖其它视图的并发改动） */
  const saveParams = (next: ModelParams | undefined) => {
    if (!provider || !effectiveModel) return;
    const modelKey = effectiveModel;
    // 本地先更新保证 UI 即时反馈；磁盘合并后广播设置变更，驱动各视图重新解析
    const local = { ...(provider.modelParams ?? {}) };
    if (next) local[modelKey] = next;
    else delete local[modelKey];
    setProvider({
      ...provider,
      modelParams: Object.keys(local).length > 0 ? local : undefined,
    });
    void patchProvider(provider.id, (cur) => {
      const modelParams = { ...(cur.modelParams ?? {}) };
      if (next) modelParams[modelKey] = next;
      else delete modelParams[modelKey];
      return {
        modelParams: Object.keys(modelParams).length > 0 ? modelParams : undefined,
      };
    })
      .then(() => window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT)))
      .catch(() => undefined);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming || !provider) return;
    setInput('');
    setModelPickerOpen(false);
    setParamsOpen(false);
    appendMessage(scope, { role: 'user', content });
    const placeholder = appendMessage(scope, {
      role: 'assistant',
      content: '',
      streaming: true,
      model: effectiveModel || undefined,
    });
    setStreaming(true);
    // 增量累积在本地，避免每条 delta 全量重扫历史
    let textAcc = '';
    let reasoningAcc = '';
    try {
      const history = [
        { role: 'system' as const, content: buildSystemPrompt({ toolName: scope }) },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
      ];
      const handle = chatStream(provider, history, {
        model: effectiveModel,
        params: provider.modelParams?.[effectiveModel],
        onDelta: (d) => {
          if (d.text) textAcc += d.text;
          if (d.reasoning) reasoningAcc += d.reasoning;
          if (d.text || d.reasoning) {
            updateMessage(scope, placeholder.id, {
              content: textAcc,
              reasoning: reasoningAcc || undefined,
            });
          }
        },
      });
      streamRef.current = handle;
      const r = await handle.done;
      if (r.aborted) {
        updateMessage(scope, placeholder.id, {
          content: textAcc || '（已停止）',
          reasoning: reasoningAcc || undefined,
          streaming: false,
        });
      } else if (r.ok) {
        updateMessage(scope, placeholder.id, {
          content: r.text,
          reasoning: r.reasoning,
          streaming: false,
        });
      } else {
        updateMessage(scope, placeholder.id, {
          content: r.error ?? '未知错误',
          error: true,
          streaming: false,
        });
      }
    } finally {
      streamRef.current = null;
      setStreaming(false);
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
      className={`relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-content ${
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
        <span
          data-tauri-drag-region
          className="flex min-w-0 flex-1 items-center truncate text-xs font-medium"
        >
          AI 助手
          {provider && effectiveModel && (
            <span
              data-tauri-drag-region
              className="ml-1.5 truncate font-normal text-muted-foreground"
            >
              · {provider.name}/{effectiveModel}
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => clearSession(scope)}
          title="清空当前会话"
          aria-label="清空当前会话"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => setMaximized((v) => !v)}
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
          aria-pressed={maximized}
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={onClose}
          title="关闭"
          aria-label="关闭 AI 助手"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
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
              <Button variant="outline" size="sm" className="rounded-full px-3 text-muted-foreground" onClick={() => navigate('/settings/ai')}>
                去「设置 → AI 助手」配置
              </Button>
            ) : (
              suggestions.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  className="rounded-full px-3 text-muted-foreground"
                  disabled={streaming}
                  onClick={() => void send(s)}
                >
                  {s}
                </Button>
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
                  {m.reasoning && (
                    <details
                      key={m.streaming ? 'streaming' : 'done'}
                      open={m.streaming ? true : undefined}
                      className="mb-1 text-[11px] text-muted-foreground"
                    >
                      <summary className="cursor-pointer select-none">
                        思考过程{m.streaming && !m.content ? '…' : ''}
                      </summary>
                      <div className="mt-1 whitespace-pre-wrap break-words border-l-2 border-border/60 pl-2 leading-relaxed [overflow-wrap:anywhere]">
                        {m.reasoning}
                      </div>
                    </details>
                  )}
                  <div
                    className={`w-full whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed [overflow-wrap:anywhere] ${
                      m.error
                        ? 'border border-destructive/40 bg-destructive/10 text-destructive'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {m.content}
                    {m.streaming && m.content && (
                      <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
                    )}
                  </div>
                  {m.model && (
                    <span className="mt-0.5 px-1 text-[10px] text-muted-foreground/60">
                      {m.model}
                    </span>
                  )}
                </div>
              ),
            )}
            {waitingReply && (
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
        <div className="rounded-md border border-border bg-background px-2 pb-1 pt-1.5 transition-colors focus-within:border-ring">
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
            disabled={!provider}
            rows={1}
            className="mb-1 max-h-[120px] w-full resize-none bg-transparent text-xs leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="flex min-w-0 items-center gap-1.5">
            {/* 模型选择器（dbx：outline xs + chevron + popover） */}
            <div className="relative min-w-0 flex-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setModelPickerOpen((v) => !v)}
                disabled={!provider}
                title="切换模型（仅当前会话生效）"
                className="max-w-full text-muted-foreground"
              >
                <span className="truncate">
                  {effectiveModel || (provider ? '使用服务商默认模型' : '未配置服务商')}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </Button>
              {modelPickerOpen && provider && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPickerOpen(false)}
                  />
                  <div className="absolute bottom-full left-0 z-30 mb-1 max-h-48 w-60 overflow-y-auto rounded-xl border border-border/70 bg-card p-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                    {modelOptions.length === 0 ? (
                      <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        无可切换模型——到「设置 → AI 助手」的模型列表添加
                      </p>
                    ) : (
                      modelOptions.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setModelOverride(scope, m);
                            setModelPickerOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                        >
                          <span className="truncate">{m}</span>
                          {m === effectiveModel && (
                            <Check className="h-3 w-3 shrink-0 text-primary" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            {/* 参数设置 popover（当前模型的 temperature/topP/maxTokens 覆盖） */}
            <div className="relative shrink-0">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setParamsOpen((v) => !v)}
                disabled={!provider || !effectiveModel}
                title="模型参数（留空 = 服务商默认）"
                aria-label="模型参数"
                className="relative text-muted-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {provider?.modelParams?.[effectiveModel] && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </Button>
              {paramsOpen && provider && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setParamsOpen(false)}
                  />
                  <div className="absolute bottom-full right-0 z-30 mb-1 w-64 rounded-xl border border-border/70 bg-card p-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                    <div className="mb-2 truncate text-[11px] font-medium">
                      {effectiveModel} 参数
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        留空 = 默认
                      </span>
                    </div>
                    <ModelParamsEditor
                      key={effectiveModel}
                      compact
                      params={provider.modelParams?.[effectiveModel]}
                      onChange={saveParams}
                    />
                  </div>
                </>
              )}
            </div>
            <Button
              variant={streaming ? 'destructive' : 'default'}
              size="icon-sm"
              onClick={() => (streaming ? stop() : void send(input))}
              disabled={!provider || (!streaming && !input.trim())}
              title={streaming ? '停止生成' : '发送'}
              aria-label={streaming ? '停止生成' : '发送'}
              className="rounded-full"
            >
              {streaming ? (
                <Square className="h-3 w-3" />
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
