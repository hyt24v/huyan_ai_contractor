import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CornerDownLeft,
  MoonStar,
  PanelLeft,
  RefreshCw,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { TOOLS } from '../lib/tools';

interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

/** 子序列模糊匹配：返回分数，-1 表示不匹配 */
function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIndex = -2;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] !== q[qi]) continue;
    score += 1;
    if (i === lastIndex + 1) score += 2; // 连续命中加分
    if (i === 0) score += 2; // 前缀命中加分
    lastIndex = i;
    qi += 1;
  }
  return qi === q.length ? score : -1;
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

  const close = useCallback(() => setOpen(false), []);

  const items = useMemo<PaletteItem[]>(() => {
    const toolItems: PaletteItem[] = TOOLS.map((tool) => ({
      id: `tool:${tool.path}`,
      title: tool.name,
      subtitle: '打开页面',
      keywords: `页面 导航 ${tool.path}`,
      icon: tool.icon,
      run: () => {
        close();
        navigate(tool.path);
      },
    }));
    return [
      ...toolItems,
      {
        id: 'action:theme',
        title: '切换主题',
        subtitle: '浅色 / 深色外观',
        keywords: 'theme dark light 深色 浅色 外观',
        icon: MoonStar,
        run: () => {
          close();
          document.querySelector<HTMLElement>('[title="切换主题"]')?.click();
        },
      },
      {
        id: 'action:sidebar',
        title: '收起/展开侧栏',
        subtitle: '切换左侧导航栏（⌘B）',
        keywords: 'sidebar 侧栏 导航 收起 展开',
        icon: PanelLeft,
        run: () => {
          close();
          document.querySelector<HTMLElement>('[title*="侧栏"]')?.click();
        },
      },
      {
        id: 'action:reload',
        title: '刷新当前页',
        subtitle: '重新加载应用',
        keywords: 'reload refresh 刷新 重载',
        icon: RefreshCw,
        run: () => {
          close();
          window.location.reload();
        },
      },
    ];
  }, [close, navigate]);

  const results = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    if (!q) return items;
    return items
      .map((item) => ({ item, score: bestScore(q, item) }))
      .filter((entry) => entry.score >= 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-Hans-CN'),
      )
      .map((entry) => entry.item);
  }, [items, query]);

  // 全局快捷键：⌘K / Ctrl+K 开关，Esc 关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 打开时重置输入与选中项
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // 选中项滚动到可视区
  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open, results]);

  if (!open) return null;

  const activate = (index: number) => {
    results[index]?.run();
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
              没有匹配的命令
            </div>
          )}
          {results.map((item, index) => {
            const Icon = item.icon;
            const selected = index === active;
            return (
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
                  <span className="block truncate text-[13px] font-medium">{item.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
                {selected && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
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