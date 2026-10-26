import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Settings, Sparkles, ArrowUpCircle, Search } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';
import AiDock from './AiDock';
import CommandPalette, { TOGGLE_COMMAND_PALETTE_EVENT } from './CommandPalette';
import UpdateDialog from './UpdateDialog';
import WhatsNewDialog from './WhatsNewDialog';
import { useAutoBackup } from '../hooks/useAutoBackup';
import { TOOLS, TOOL_GROUPS } from '../lib/tools';
import { checkForUpdate, currentVersion } from '../lib/updater';
import { isTauri } from '@tauri-apps/api/core';
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
  const [whatsNew, setWhatsNew] = useState<{ version: string; body: string } | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [autoBackup, setAutoBackup] = useState(getAutoBackupEnabled);
  const [aiDockOpen, setAiDockOpen] = useState(false);
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
    // dbx 范式：chrome 外壳底色 + gap-1 p-1 留缝，各面板为独立圆角描边卡片
    <div className="flex h-full gap-1 bg-chrome p-1">
      {/* 单一侧栏：展开 w-52（图标+文字），折叠 w-12（纯图标条）；顶部避让 macOS 红绿灯（兼拖拽区） */}
      <aside
        className={`flex shrink-0 flex-col rounded-lg border border-border/40 bg-sidebar transition-[width] duration-200 ${
          collapsed ? 'w-12' : 'w-52'
        }`}
      >
        {/* Logo 区：展开时位于红绿灯右侧，折叠时居中于红绿灯下方 */}
        <div
          data-tauri-drag-region
          className={`flex shrink-0 items-center ${
            collapsed ? 'justify-center pb-2 pt-9' : 'gap-2.5 pb-2 pl-[84px] pr-3 pt-2.5'
          }`}
        >
          <img
            src={logo}
            alt="AI包工头"
            className="h-7 w-7 shrink-0 rounded-[7px] object-cover"
          />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">
              AI包工头
            </span>
          )}
        </div>

        {/* 工具导航：分组列表；折叠时分组标题退化为分隔线、文字退化为 tooltip */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {TOOL_GROUPS.map((group) => (
            <div key={group}>
              {collapsed ? (
                <div className="mx-1 my-2 border-t border-border/40" />
              ) : (
                <div className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-1">
                  {group}
                </div>
              )}
              {TOOLS.flatMap((t) =>
                t.group !== group
                  ? []
                  : [
                      <NavLink
                        key={t.path}
                        to={t.path}
                        title={collapsed ? t.name : undefined}
                        aria-label={t.name}
                        className={({ isActive }) =>
                          `mb-0.5 flex items-center rounded-md transition-colors ${
                            collapsed
                              ? 'h-9 justify-center'
                              : 'gap-2.5 px-2.5 py-2 text-[13px]'
                          } ${
                            isActive
                              ? 'bg-accent font-medium text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                          }`
                        }
                      >
                        <t.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <span className="truncate">{t.name}</span>
                        )}
                      </NavLink>,
                    ],
              )}
            </div>
          ))}
        </nav>

        {/* 底部：AI 助手 + 设置（更新红点），展开时附「纯本地」注脚 */}
        <div
          className={`shrink-0 border-t border-border/40 ${
            collapsed ? 'flex flex-col items-center gap-1 py-2' : 'space-y-0.5 p-2'
          }`}
        >
          <button
            onClick={() => setAiDockOpen((v) => !v)}
            title={collapsed ? 'AI 助手' : undefined}
            aria-label="AI 助手"
            className={`flex items-center rounded-md transition-colors ${
              collapsed
                ? 'h-9 w-9 justify-center'
                : 'w-full gap-2.5 px-2.5 py-2 text-[13px]'
            } ${
              aiDockOpen
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            {!collapsed && <span>AI 助手</span>}
          </button>
          <NavLink
            to="/settings"
            title={collapsed ? '设置 (⌘,)' : undefined}
            aria-label="设置"
            className={({ isActive }) =>
              `relative flex items-center rounded-md transition-colors ${
                collapsed
                  ? 'h-9 w-9 justify-center'
                  : 'w-full gap-2.5 px-2.5 py-2 text-[13px]'
              } ${
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && <span>设置</span>}
            {hasUpdate && (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </NavLink>
          {!collapsed && (
            <div className="px-2.5 pt-1.5 text-[11px] text-muted-foreground">
              纯本地 · 数据不出本机
            </div>
          )}
        </div>
      </aside>

      {/* 主区域：内容面板（浮在 chrome 外壳上，无阴影） */}
      <div className="min-w-0 flex-1">
        <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-content">
          {/* 顶栏兼 Tauri 拖拽区（dbx 范式 U8）：右侧收命令面板/更新入口 */}
          <header
            data-tauri-drag-region
            className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 pl-3 pr-2"
          >
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
              <span className="truncate text-sm font-semibold tracking-tight">
                {isSettings ? '设置' : (currentTool?.name ?? '工具')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {hasUpdate && (
                <button
                  onClick={() => navigate('/settings/updates')}
                  title="发现新版本，点击查看"
                  aria-label="有新版本可用"
                  className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ArrowUpCircle className="h-4 w-4" />
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive" />
                </button>
              )}
              <button
                onClick={() =>
                  window.dispatchEvent(new Event(TOGGLE_COMMAND_PALETTE_EVENT))
                }
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="命令面板"
              >
                <Search className="h-3.5 w-3.5" />
                <kbd className="rounded border border-border/60 bg-muted/50 px-1 font-sans text-[10px]">
                  ⌘K
                </kbd>
              </button>
            </div>
          </header>
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
      {/* AI 助手 dock：右侧浮起面板（AI-P0 对话骨架） */}
      <AiDock
        open={aiDockOpen}
        onClose={() => setAiDockOpen(false)}
        scope={isSettings ? '设置' : (currentTool?.name ?? '工具')}
      />
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
