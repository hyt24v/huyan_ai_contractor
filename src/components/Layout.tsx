import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';
import CommandPalette from './CommandPalette';
import UpdateDialog from './UpdateDialog';
import { useAutoBackup } from '../hooks/useAutoBackup';
import { TOOLS } from '../lib/tools';
import { checkForUpdate, currentVersion } from '../lib/updater';
import {
  dismissUpdate,
  getAutoBackupEnabled,
  getAutoCheckUpdate,
  isUpdateDismissed,
  onSettingsChanged,
} from '../lib/settings';
import { refreshAgentVisibility } from '../lib/agentVisibility';
import logo from '../../src-tauri/icons/icon.png';

const SIDEBAR_KEY = 'huyan_tool:sidebar_collapsed';

function getInitialCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === '1';
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [autoBackup, setAutoBackup] = useState(getAutoBackupEnabled);
  const location = useLocation();
  const navigate = useNavigate();
  const currentTool = TOOLS.find((t) => location.pathname.startsWith(t.path));
  const isSettings = location.pathname.startsWith('/settings');

  // 桌面端每 6 小时自动快照一次 MCP 配置(可在设置-数据与备份中关闭)
  useAutoBackup(autoBackup);

  // 启动时刷新 agent 检测缓存(自动模式下「检测到的」才显示)
  useEffect(() => {
    refreshAgentVisibility().catch(() => undefined);
  }, []);

  // 设置项变更即时生效(自动备份开关等)
  useEffect(
    () => onSettingsChanged(() => setAutoBackup(getAutoBackupEnabled())),
    [],
  );

  // 启动后静默检查更新:发现新版本弹窗展示更新内容(按版本记忆「稍后提醒」),设置齿轮显示红点
  useEffect(() => {
    currentVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(''));
    if (!getAutoCheckUpdate()) return;
    const t = window.setTimeout(() => {
      checkForUpdate()
        .then((update) => {
          setHasUpdate(!!update);
          if (update && !isUpdateDismissed(update.version)) {
            setPendingUpdate(update);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // ⌘B / Ctrl+B 快速收起/展开导航面板;⌘, 打开设置
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (e.key === ',') {
        e.preventDefault();
        navigate('/settings');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

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
        <NavLink
          to="/settings"
          title="设置 (⌘,)"
          aria-label="设置"
          className={({ isActive }) =>
            `relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`
          }
        >
          <Settings className="h-4 w-4" />
          {hasUpdate && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
          )}
        </NavLink>
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
          <div className="shrink-0 border-t border-border/40 p-3 text-[11px] text-muted-foreground">
            纯本地 · 数据不出本机
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
                {isSettings ? '设置' : (currentTool?.name ?? '工具')}
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
      {pendingUpdate && (
        <UpdateDialog
          update={pendingUpdate}
          currentVersion={appVersion}
          onClose={() => {
            dismissUpdate(pendingUpdate.version);
            setPendingUpdate(null);
          }}
        />
      )}
    </div>
  );
}
