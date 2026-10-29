import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CornerDownLeft,
  MoonStar,
  Palette,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { TOOLS } from '../lib/tools';
import { THEMES } from '../lib/themes';
import {
  previewTheme,
  setThemeForAppearance,
  setThemeMode,
} from '../hooks/useThemeSettings';

/** 顶栏按钮等外部入口触发命令面板开关的自定义事件 */
export const TOGGLE_COMMAND_PALETTE_EVENT = 'huyan:toggle-command-palette';

/** 命令面板「收起/展开导航面板」动作广播，由 Layout 监听后切换侧栏 */
export const TOGGLE_SIDEBAR_EVENT = 'huyan:toggle-sidebar';

interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
  /** 高亮（方向键/悬停）时触发，用于主题实时预览 */
  onHighlight?: () => void;
  /** 分组（空查询时显示组头） */
  group: '页面' | '主题' | '操作';
  /** 右侧快捷键提示 */
  kbd?: string;
}

/** 子序列模糊匹配：返回命中下标，null 表示不匹配 */
function fuzzyIndices(query: string, text: string): number[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const idx: number[] = [];
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) {
      idx.push(i);
      qi += 1;
    }
  }
  return qi === q.length ? idx : null;
}

/** 子序列模糊匹配：返回分数，-1 表示不匹配 */
function fuzzyScore(query: string, text: string): number {
  const idx = fuzzyIndices(query, text);
  if (!idx) return -1;
  if (idx.length === 0) return 0;
  let score = 0;
  let lastIndex = -2;
  for (const i of idx) {
    score += 1;
    if (i === lastIndex + 1) score += 2; // 连续命中加分
    if (i === 0) score += 2; // 前缀命中加分
    lastIndex = i;
  }
  return score;
}

/** 命中字符高亮（借鉴 oil-find Presentation.highlightRanges） */
function Highlighted({ text, indices }: { text: string; indices: number[] | null }) {
  if (!indices || indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-primary">
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </>
  );
}

const RECENTS_KEY = 'huyan_tool:palette-recents';

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, 6);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等场景写入失败，忽略
  }
}

function bestScore(query: string, item: PaletteItem): number {
  return Math.max(
    fuzzyScore(query, item.title),
    fuzzyScore(query, item.subtitle),
    item.keywords ? fuzzyScore(query, item.keywords) : -1,
  );
}

const Kbd = ({ children }: { children: string }) => (
  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
    {children}
  </kbd>
);

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => {
    setOpen(false);
    previewTheme(null);
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const toolItems: PaletteItem[] = TOOLS.map((tool) => ({
      id: `tool:${tool.path}`,
      title: tool.name,
      subtitle: '打开页面',
      keywords: `页面 导航 ${tool.path}`,
      icon: tool.icon,
      group: '页面',
      run: () => {
        close();
        navigate(tool.path);
      },
    }));
    const themeItems: PaletteItem[] = THEMES.map((theme) => ({
      id: `theme:${theme.id}`,
      title: `主题：${theme.name}`,
      subtitle: theme.appearance === 'dark' ? '切换为深色主题' : '切换为浅色主题',
      keywords: `theme 主题 外观 ${theme.name} ${theme.id}`,
      icon: Palette,
      onHighlight: () => previewTheme(theme.id),
      run: () => {
        setThemeForAppearance(theme.appearance, theme.id);
        setThemeMode(theme.appearance);
        close();
      },
      group: '主题',
    }));
    return [
      ...toolItems,
      ...themeItems,
      {
        id: 'action:settings',
        title: '打开设置',
        subtitle: '外观/更新/Agent/备份',
        keywords: 'settings 设置 preferences 偏好',
        icon: Settings,
        group: '操作' as const,
        kbd: '⌘,',
        run: () => {
          close();
          navigate('/settings');
        },
      },
      {
        id: 'action:theme',
        title: '外观设置',
        subtitle: '主题与明暗模式',
        keywords: 'theme dark light 深色 浅色 外观 设置',
        icon: MoonStar,
        group: '操作' as const,
        run: () => {
          close();
          navigate('/settings/appearance');
        },
      },
      {
        id: 'action:sidebar',
        title: '收起/展开导航面板',
        subtitle: '切换左侧导航',
        keywords: 'sidebar 侧栏 导航 收起 展开',
        icon: PanelLeft,
        group: '操作' as const,
        kbd: '⌘B',
        run: () => {
          close();
          window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT));
        },
      },
      {
        id: 'action:reload',
        title: '刷新当前页',
        subtitle: '重新加载应用',
        keywords: 'reload refresh 刷新 重载',
        icon: RefreshCw,
        group: '操作' as const,
        run: () => {
          close();
          window.location.reload();
        },
      },
    ];
  }, [close, navigate]);

  const results = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    if (!q) {
      // 空查询 = 最近使用在前（借鉴 oil-find：面板一打开就有价值）
      const recents = loadRecents();
      const rank = new Map(recents.map((id, i) => [id, i]));
      return [...items].sort(
        (a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999),
      );
    }
    return items
      .map((item) => ({ item, score: bestScore(q, item) }))
      .filter((entry) => entry.score >= 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-Hans-CN'),
      )
      .map((entry) => entry.item);
  }, [items, query]);

  // 全局快捷键：⌘K / Ctrl+K 开关，Esc 关闭；自定义事件供顶栏按钮触发。
  // 所有关闭路径统一走 close()，保证主题实时预览被还原（previewTheme(null)）。
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const toggle = () => {
      if (openRef.current) close();
      else setOpen(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(TOGGLE_COMMAND_PALETTE_EVENT, toggle);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(TOGGLE_COMMAND_PALETTE_EVENT, toggle);
    };
  }, [close]);

  // 打开时重置输入与选中项
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // 高亮项变化时触发实时预览（主题命令）
  useEffect(() => {
    if (!open) return;
    results[active]?.onHighlight?.();
  }, [active, open, results]);

  // 选中项滚动到可视区
  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open, results]);

  if (!open) return null;

  const activate = (index: number) => {
    const item = results[index];
    if (!item) return;
    pushRecent(item.id);
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 px-4 pt-[15vh] backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              // IME 保护：中文输入法组字期间，方向键/回车归输入法（借鉴 oil-find hasMarkedText）
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (results.length > 0) setActive((i) => (i + 1) % results.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (results.length > 0) {
                  setActive((i) => (i - 1 + results.length) % results.length);
                }
              } else if (e.key === 'Enter') {
                e.preventDefault();
                activate(active);
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={
              results[active] ? `command-palette-item-${results[active].id}` : undefined
            }
            aria-label="搜索命令"
            placeholder="搜索页面或命令…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Kbd>ESC</Kbd>
        </div>

        <div id="command-palette-list" role="listbox" aria-label="命令列表" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              <div>没有匹配的命令</div>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <span>试试：</span>
                {['主题', '设置', 'JSON'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setQuery(s);
                      setActive(0);
                    }}
                    className="rounded-full border border-input px-2 py-0.5 text-[11px] transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {results.map((item, index) => {
            const Icon = item.icon;
            const selected = index === active;
            // 空查询（最近使用排序）时按分组显示组头；搜索时平坦列表
            const showGroup = !query.trim() && (index === 0 || results[index - 1].group !== item.group);
            return (
              <div key={item.id}>
                {showGroup && (
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 first:pt-1">
                    {item.group}
                  </div>
                )}
              <button
                key={item.id}
                id={`command-palette-item-${item.id}`}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => activate(index)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                  selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/60'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    <Highlighted
                      text={item.title}
                      indices={query.trim() ? fuzzyIndices(query, item.title) : null}
                    />
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
                {item.kbd && <Kbd>{item.kbd}</Kbd>}
                {selected && !item.kbd && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            选择
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd>
            打开
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            ⌘K / Ctrl+K 随时唤起
          </span>
        </div>
      </div>
    </div>
  );
}