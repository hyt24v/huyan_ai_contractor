import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';
import CommandPalette from './CommandPalette';
import UpdateDialog from './UpdateDialog';
import WhatsNewDialog from './WhatsNewDialog';
import { useAutoBackup } from '../hooks/useAutoBackup';
import { TOOLS, TOOL_GROUPS } from '../lib/tools';
import { checkForUpdate, currentVersion } from '../lib/updater';
import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  dismissUpdate,
  getAutoBackupEnabled,
  getAutoCheckUpdate,
  isUpdateDismissed,
  onSettingsChanged,
} from '../lib/settings';
import { refreshAgentVisibility } from '../lib/agentVisibility';
import {
  getHealthIssueCount,
  onHealthIssueCount,
} from '../lib/healthStatus';
import logo from '../../src-tauri/icons/icon.png';

const SIDEBAR_KEY = 'huyan_tool:sidebar_collapsed';

function getInitialCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === '1';
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [whatsNew, setWhatsNew] = useState<{ version: string; body: string } | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [autoBackup, setAutoBackup] = useState(getAutoBackupEnabled);
  const [healthIssues, setHealthIssues] = useState(getHealthIssueCount);
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

  // 健康检查「需要关注」聚合计数（借鉴 fanbox「谁在等我」徽标）
  useEffect(
    () => onHealthIssueCount(() => setHealthIssues(getHealthIssueCount())),
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

  // 更新后首次启动：拉取当前版本的 release notes 展示「本次更新了什么」（借鉴 ColaMD）
  useEffect(() => {
    if (!appVersion) return;
    const SEEN_KEY = 'huyan_tool:seen-version';
    const seen = localStorage.getItem(SEEN_KEY);
    if (seen === appVersion) return;
    // 首次安装（无 seen）只记录不打扰
    if (!seen) {
      localStorage.setItem(SEEN_KEY, appVersion);
      return;
    }
    localStorage.setItem(SEEN_KEY, appVersion);
    if (!isTauri()) return;
    fetch(
      `https://api.github.com/repos/hyt24v/huyan_ai_contractor/releases/tags/v${appVersion}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { body?: string } | null) => {
        if (data?.body) setWhatsNew({ version: appVersion, body: data.body });
      })
      .catch(() => undefined); // 网络失败静默跳过
  }, [appVersion]);

  // 托盘菜单「健康检查」：后端显示主窗口后发 navigate 事件，这里跳转到对应路由
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    void listen<string>('navigate', (ev) => {
      if (ev.payload) navigate(ev.payload);
    }).then((u) => {
      if (disposed) u();
      else unlisten = u;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);

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
                  {t.path === '/health' && healthIssues > 0 && (
                    <span
                      className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-bold text-warning-foreground"
                      title={`${healthIssues} 项需要关注`}
                    >
                      {healthIssues > 99 ? '99+' : healthIssues}
                    </span>
                  )}
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

      {/* 导航面板（可收起）：纯文字，图标由左侧 activitybar 承担，避免同一工具出现两个图标 */}
      {!collapsed && (
        <aside className="flex w-48 shrink-0 flex-col border-r border-border/40 bg-sidebar">
          <nav className="flex-1 overflow-y-auto px-2.5 pb-2 pt-2">
            {TOOL_GROUPS.map((group) => (
              <div key={group}>
                <div className="px-2 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-0">
                  {group}
                </div>
                {TOOLS.flatMap((t) =>
                  t.group !== group
                    ? []
                    : [
                        <NavLink
                          key={t.path}
                          to={t.path}
                          className={({ isActive }) =>
                            `mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-all duration-150 ${
                              isActive
                                ? 'bg-accent font-medium text-accent-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                            }`
                          }
                        >
                          <span className="truncate">{t.name}</span>
                          {t.path === '/health' && healthIssues > 0 && (
                            <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">
                              {healthIssues > 99 ? '99+' : healthIssues}
                            </span>
                          )}
                        </NavLink>,
                      ],
                )}
              </div>
            ))}
          </nav>
          <div className="shrink-0 border-t border-border/40 p-3 text-[11px] text-muted-foreground">
            纯本地 · 数据不出本机
          </div>
        </aside>
      )}

      {/* 主区域：主角卡片 */}
      <div className="min-w-0 flex-1 p-3">
        <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-md">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-4">
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
              <span className="truncate text-[15px] font-semibold tracking-tight">
                AI包工头
                <span className="mx-1.5 text-muted-foreground/40">/</span>
                <span className="text-muted-foreground">
                  {isSettings ? '设置' : (currentTool?.name ?? '工具')}
                </span>
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
      {whatsNew && !pendingUpdate && (
        <WhatsNewDialog
          version={whatsNew.version}
          body={whatsNew.body}
          onClose={() => setWhatsNew(null)}
        />
      )}
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
