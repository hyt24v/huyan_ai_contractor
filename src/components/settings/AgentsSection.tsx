/** 设置-Agent 管理:56 个 agent 全量列表,自由选择哪些在工具中显示;支持紧凑卡片/高密度列表两种视图 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  CircleOff,
  LayoutGrid,
  List,
  Loader2,
  RotateCcw,
  Search,
} from 'lucide-react';
import { AGENTS, hasMcpSupport, type AgentDef } from '../../lib/agents';
import { PROMPT_TARGETS } from '../../lib/agentTargets';
import {
  detectedAgentIds,
  effectiveAgents,
  isAgentVisibilityCustomized,
  refreshAgentVisibility,
  resetAgentVisibility,
  setAgentEnabled,
} from '../../lib/agentVisibility';
import { onSettingsChanged } from '../../lib/settings';
import { useToast } from '../../hooks/useToast';
import { Toggle } from './ui';

const homeTilde = (p: string) => `~/${p}`;

const VIEW_KEY = 'huyan_tool:agents_view';
type ViewMode = 'cards' | 'list';
function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

/** 能力项:Skills 所有 agent 都支持;MCP/提示词按注册表 */
function capabilitiesOf(a: AgentDef): Array<{ key: string; label: string; to: string; ok: boolean }> {
  return [
    { key: 'skills', label: 'Skills', to: '/skills', ok: true },
    { key: 'mcp', label: 'MCP', to: '/mcp', ok: hasMcpSupport(a) },
    { key: 'prompt', label: '提示词', to: '/prompts', ok: PROMPT_TARGETS.some((t) => t.agent === a.id) },
  ];
}

function pathsTitle(a: AgentDef): string {
  const promptTarget = PROMPT_TARGETS.find((t) => t.agent === a.id);
  return [
    `Skills: ${homeTilde(a.skillsDir)}`,
    `MCP: ${a.mcpFile ? homeTilde(a.mcpFile) : '暂不支持(配置路径未知)'}`,
    `提示词: ${promptTarget?.file ? homeTilde(promptTarget.file) : promptTarget ? '不落盘,需在应用内设置' : '暂不支持'}`,
  ].join('\n');
}

function StatusDot({ detected }: { detected: boolean }) {
  return (
    <span
      title={detected ? '已检测到' : '未检测到'}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${detected ? 'bg-primary' : 'bg-muted-foreground/40'}`}
    />
  );
}

/** 能力 chips:支持且已启用 → 可点击直达;支持但未启用 → 静态;不支持 → 更淡 */
function CapabilityChips({ agent, enabled, dense }: { agent: AgentDef; enabled: boolean; dense?: boolean }) {
  const cls = (ok: boolean) =>
    `inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] transition-colors ${
      ok
        ? enabled
          ? 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
          : 'bg-muted text-muted-foreground'
        : 'bg-muted/40 text-muted-foreground/40'
    }`;
  return (
    <div className={`flex items-center ${dense ? 'gap-0.5' : 'gap-1'}`}>
      {capabilitiesOf(agent).map((c) =>
        c.ok && enabled ? (
          <Link key={c.key} to={c.to} className={cls(true)} title={`前往${c.label}管理`}>
            {dense ? c.label.slice(0, 1) : c.label}
          </Link>
        ) : (
          <span key={c.key} className={cls(c.ok)} title={c.ok ? c.label : `${c.label}暂不支持`}>
            {dense ? c.label.slice(0, 1) : c.label}
          </span>
        ),
      )}
    </div>
  );
}

export default function AgentsSection() {
  const [detected, setDetected] = useState<string[]>(() => detectedAgentIds());
  const [enabledIds, setEnabledIds] = useState<string[]>(() =>
    effectiveAgents().map((a) => a.id),
  );
  const [customized, setCustomized] = useState(() => isAgentVisibilityCustomized());
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<ViewMode>(loadView);
  const { toast, showToast } = useToast();

  // 打开时重新检测一次本机 agent
  useEffect(() => {
    setRefreshing(true);
    refreshAgentVisibility()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, []);

  // 开关变化后同步本地状态
  useEffect(
    () =>
      onSettingsChanged(() => {
        setEnabledIds(effectiveAgents().map((a) => a.id));
        setCustomized(isAgentVisibilityCustomized());
        setDetected(detectedAgentIds());
      }),
    [],
  );

  const onToggle = useCallback(
    (id: string, on: boolean) => {
      setAgentEnabled(id, on);
      showToast(on ? '已加入显示' : '已隐藏,各管理页不再显示该 agent');
    },
    [showToast],
  );

  const onReset = useCallback(() => {
    resetAgentVisibility();
    showToast('已恢复为「显示检测到的 agent」');
  }, [showToast]);

  const redetect = useCallback(() => {
    setRefreshing(true);
    refreshAgentVisibility()
      .then(() => showToast('检测完成'))
      .catch(() => showToast('检测失败', 'err'))
      .finally(() => setRefreshing(false));
  }, [showToast]);

  const switchView = useCallback((v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const q = query.trim().toLowerCase();
  const detectedSet = new Set(detected);
  const enabledSet = new Set(enabledIds);
  const list = AGENTS.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q),
  ).sort((a, b) => {
    // 显示中 > 检测到 > 其余;组内保持注册表顺序
    const score = (x: AgentDef) =>
      (enabledSet.has(x.id) ? 2 : 0) + (detectedSet.has(x.id) ? 1 : 0);
    return score(b) - score(a);
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        共支持 {AGENTS.length} 个 agent。默认显示「检测到的」;用开关自由选择哪些出现在
        Skills/MCP/提示词等管理页。
        {!customized && '当前为自动模式。'}
      </p>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 agent…"
            className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={redetect}
          disabled={refreshing}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-xs hover:bg-accent disabled:opacity-40"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          重新检测
        </button>
        {customized && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-xs hover:bg-accent"
          >
            恢复自动
          </button>
        )}
        {/* 卡片/列表切换 */}
        <div className="flex overflow-hidden rounded-md border border-border/60">
          {(
            [
              { v: 'cards' as const, icon: LayoutGrid, label: '卡片视图' },
              { v: 'list' as ViewMode, icon: List, label: '列表视图' },
            ] as const
          ).map(({ v, icon: Icon, label }) => (
            <button
              key={v}
              type="button"
              title={label}
              onClick={() => switchView(v)}
              className={`flex h-8 w-8 items-center justify-center transition-colors ${
                view === v
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {view === 'cards' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const isEnabled = enabledSet.has(a.id);
            return (
              <div
                key={a.id}
                title={pathsTitle(a)}
                className={`rounded-lg border px-3 py-2 transition-colors ${
                  isEnabled
                    ? 'border-border/60 bg-card'
                    : 'border-border/40 bg-card/50 opacity-75'
                }`}
              >
                <div className="flex items-center gap-2">
                  <StatusDot detected={detectedSet.has(a.id)} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {a.name}
                  </span>
                  <Toggle
                    checked={isEnabled}
                    onChange={(on) => onToggle(a.id, on)}
                    label={`显示 ${a.name}`}
                  />
                </div>
                <div className="mt-1.5">
                  <CapabilityChips agent={a} enabled={isEnabled} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1">
          {list.map((a) => {
            const isEnabled = enabledSet.has(a.id);
            return (
              <div
                key={a.id}
                title={pathsTitle(a)}
                className={`flex h-9 items-center gap-2 rounded-md border px-3 transition-colors ${
                  isEnabled
                    ? 'border-border/60 bg-card'
                    : 'border-border/40 bg-card/50 opacity-75'
                }`}
              >
                <StatusDot detected={detectedSet.has(a.id)} />
                <span className="w-36 shrink-0 truncate text-xs font-medium text-foreground">
                  {a.name}
                </span>
                <CapabilityChips agent={a} enabled={isEnabled} dense />
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-muted-foreground">
                  {homeTilde(a.skillsDir)}
                </span>
                <Toggle
                  checked={isEnabled}
                  onChange={(on) => onToggle(a.id, on)}
                  label={`显示 ${a.name}`}
                />
              </div>
            );
          })}
        </div>
      )}
      {list.length === 0 && (
        <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
          没有匹配的 agent
        </div>
      )}

      <p className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-primary" /> 圆点亮=本机已检测到
        </span>
        <span className="inline-flex items-center gap-1">
          <CircleOff className="h-3 w-3" /> 圆点灰=未检测到
        </span>
        <span>悬停查看各配置路径</span>
      </p>

      {toast && (
        <div
          className={`w-fit rounded-md border px-3 py-1.5 text-xs shadow-lg ${
            toast.tone === 'err'
              ? 'border-destructive/40 bg-destructive text-destructive-foreground'
              : 'bg-card text-foreground'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
