import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import CommandPalette from './CommandPalette';
import ThemeSwitcher from './ThemeSwitcher';
import UpdateChecker from './UpdateChecker';
import { useAutoBackup } from '../hooks/useAutoBackup';
import { TOOLS } from '../lib/tools';
import logo from '../../src-tauri/icons/icon.png';

const SIDEBAR_KEY = 'huyan_tool:sidebar_collapsed';

function getInitialCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === '1';
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const location = useLocation();
  const currentTool = TOOLS.find((t) => location.pathname.startsWith(t.path));

  // 桌面端每 6 小时自动快照一次 MCP 配置
  useAutoBackup();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // ⌘B / Ctrl+B 快速收起/展开导航面板
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
    <div className="flex h-full bg-background">
      {/* Activity Bar（图标条） */}
      <div className="flex w-12 shrink-0 flex-col items-center border-r border-border/40 bg-activitybar py-2">
        <img
          src={logo}
          alt="AI包工头"
          className="mb-2 h-7 w-7 shrink-0 rounded-[7px] object-cover shadow-sm"
        />
        <nav className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
          {TOOLS.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              title={t.name}
              aria-label={t.name}
              className={({ isActive }) =>
                `relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-[-6px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <t.icon className="h-4 w-4" />
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <ThemeSwitcher />
      </div>

      {/* 导航面板（可收起） */}
      {!collapsed && (
        <aside className="flex w-44 shrink-0 flex-col border-r border-border/40 bg-sidebar">
          <div className="flex h-11 shrink-0 items-center px-4">
            <span className="truncate text-sm font-semibold tracking-tight">
              AI包工头
            </span>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              工作台
            </div>
            {TOOLS.map((t) => (
              <NavLink
                key={t.path}
                to={t.path}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  }`
                }
              >
                <t.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t.name}</span>
              </NavLink>
            ))}
          </nav>
          <div className="shrink-0 space-y-1 border-t border-border/40 p-2">
            <UpdateChecker />
            <div className="px-2 text-[11px] text-muted-foreground">
              纯本地 · 数据不出本机
            </div>
          </div>
        </aside>
      )}

      {/* 主区域：主角卡片 */}
      <div className="min-w-0 flex-1 p-2.5">
        <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={`${collapsed ? '展开' : '收起'}导航面板 (⌘B)`}
                aria-label={`${collapsed ? '展开' : '收起'}导航面板`}
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
            <span className="text-[11px] text-muted-foreground">⌘K 命令面板</span>
          </header>
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}
