/** 设置-Agent 管理:56 个 agent 全量列表,自由选择哪些在工具中显示;检测到的排前面 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleOff, Loader2, RotateCcw, Search } from 'lucide-react';
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

export default function AgentsSection() {
  const [detected, setDetected] = useState<string[]>(() => detectedAgentIds());
  const [enabledIds, setEnabledIds] = useState<string[]>(() =>
    effectiveAgents().map((a) => a.id),
  );
  const [customized, setCustomized] = useState(() => isAgentVisibilityCustomized());
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
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

  const promptAgents = new Set(PROMPT_TARGETS.map((t) => t.agent));

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        共支持 {AGENTS.length} 个 agent。默认显示「检测到的」;用右侧开关自由选择哪些出现在
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
      </div>

      <div className="space-y-2">
        {list.map((a) => {
          const isDetected = detectedSet.has(a.id);
          const isEnabled = enabledSet.has(a.id);
          const promptTarget = PROMPT_TARGETS.find((t) => t.agent === a.id);
          return (
            <div
              key={a.id}
              className={`rounded-lg border px-4 py-3 transition-colors ${
                isEnabled ? 'border-border/60 bg-card' : 'border-border/40 bg-card/50 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">{a.name}</span>
                  {isDetected ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      <CheckCircle2 className="h-3 w-3" />
                      已检测到
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <CircleOff className="h-3 w-3" />
                      未检测到
                    </span>
                  )}
                </div>
                <Toggle
                  checked={isEnabled}
                  onChange={(on) => onToggle(a.id, on)}
                  label={`显示 ${a.name}`}
                />
              </div>
              <div className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                <div className="truncate">Skills:{homeTilde(a.skillsDir)}</div>
                <div className="truncate">
                  MCP:{a.mcpFile ? homeTilde(a.mcpFile) : '暂不支持(配置路径未知)'}
                </div>
                <div className="truncate">
                  提示词:
                  {promptTarget?.file
                    ? homeTilde(promptTarget.file)
                    : promptTarget
                      ? '不落盘,需在应用内设置'
                      : '暂不支持'}
                </div>
              </div>
              {isEnabled && (
                <div className="mt-2 flex items-center gap-1 text-[11px]">
                  <Link
                    to="/skills"
                    className="flex items-center gap-0.5 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    Skills <ArrowRight className="h-3 w-3" />
                  </Link>
                  {hasMcpSupport(a) && (
                    <Link
                      to="/mcp"
                      className="flex items-center gap-0.5 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                    >
                      MCP <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                  {promptAgents.has(a.id) && (
                    <Link
                      to="/prompts"
                      className="flex items-center gap-0.5 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                    >
                      提示词 <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
            没有匹配的 agent
          </div>
        )}
      </div>

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
