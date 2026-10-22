import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Wrench,
} from 'lucide-react';
import CommandPalette from './CommandPalette';
import { useAutoBackup } from '../hooks/useAutoBackup';
import { TOOLS } from '../lib/tools';

const THEME_KEY = 'huyan_tool:theme';
const SIDEBAR_KEY = 'huyan_tool:sidebar_collapsed';

function getInitialDark(): boolean {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function getInitialCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === '1';
}

export default function Layout() {
  const [dark, setDark] = useState(getInitialDark);
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const location = useLocation();
  const currentTool = TOOLS.find((t) => location.pathname.startsWith(t.path));

  // 桌面端每 6 小时自动快照一次 MCP 配置
  useAutoBackup();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // ⌘B / Ctrl+B 快速收起/展开侧栏
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full">
      {/* 侧边栏（cc-switch 风格，可收起） */}
      <aside
        className={`flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-out ${
          collapsed ? 'w-14' : 'w-52'
        }`}
      >
        <div
          className={`flex h-12 shrink-0 items-center border-b ${
            collapsed ? 'justify-center px-2' : 'gap-2 px-4'
          }`}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Wrench className="h-3.5 w-3.5" />
          </div>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">
              AI包工头
            </span>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {!collapsed ? (
            <div className="px-2 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              工作台
            </div>
          ) : (
            <div className="mx-2 mb-2 border-t" />
          )}
          {TOOLS.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              title={collapsed ? t.name : undefined}
              aria-label={t.name}
              className={({ isActive }) =>
                `mb-0.5 flex items-center rounded-md py-1.5 text-[13px] transition-colors ${
                  collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
                } ${
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`
              }
            >
              <t.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{t.name}</span>}
            </NavLink>
          ))}
        </nav>
        <div
          className={`shrink-0 border-t text-[11px] text-muted-foreground ${
            collapsed ? 'flex justify-center p-3' : 'p-3'
          }`}
          title={collapsed ? '纯本地 · 数据不出本机' : undefined}
        >
          {collapsed ? (
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          ) : (
            '纯本地 · 数据不出本机'
          )}
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={`${collapsed ? '展开' : '收起'}侧栏 (⌘B)`}
              aria-label={`${collapsed ? '展开' : '收起'}侧栏`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <span className="truncate text-sm font-medium tracking-tight">
              {currentTool?.name ?? '工具'}
            </span>
          </div>
          <button
            onClick={() => setDark((d) => !d)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="切换主题"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}