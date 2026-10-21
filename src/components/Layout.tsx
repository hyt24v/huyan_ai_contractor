import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Braces, Cable, Moon, Puzzle, Sun, Wrench } from 'lucide-react';

export const TOOLS = [
  { path: '/json', name: 'JSON 编辑器', icon: Braces },
  { path: '/skills', name: 'Skills 管理', icon: Puzzle },
  { path: '/mcp', name: 'MCP 管理', icon: Cable },
];

const THEME_KEY = 'huyan_tool:theme';

function getInitialDark(): boolean {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export default function Layout() {
  const [dark, setDark] = useState(getInitialDark);
  const location = useLocation();
  const currentTool = TOOLS.find((t) => location.pathname.startsWith(t.path));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="flex h-full">
      {/* 侧边栏（cc-switch 风格） */}
      <aside className="flex w-52 shrink-0 flex-col border-r bg-card">
        <div className="flex h-12 items-center gap-2 border-b px-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Wrench className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">
            AI包工头
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <div className="px-2 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            数据工具
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
              {t.name}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-[11px] text-muted-foreground">
          纯本地 · 数据不出本机
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
          <span className="text-sm font-medium tracking-tight">
            {currentTool?.name ?? '工具'}
          </span>
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
    </div>
  );
}
