import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  HeartPulse,
  Info,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Toolbar, ToolbarButton } from '../components/Toolbar';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge';
import { AGENTS } from '../lib/agents';
import { agentLabel, type HealthReport, type Severity } from '../lib/diagnostics';
import { runDiagnostics } from '../services/diagnostics';
import { setHealthIssueCount } from '../lib/healthStatus';
import { isTauri } from '@tauri-apps/api/core';

const SEVERITY_META: Record<Severity, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  error: { label: '错误', tone: 'error', icon: CircleAlert },
  warning: { label: '警告', tone: 'warning', icon: TriangleAlert },
  info: { label: '提示', tone: 'info', icon: Info },
};

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];

function scoreTone(score: number): BadgeTone {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'error';
}

const scoreCircleClass = (score: number): string =>
  score >= 90
    ? 'bg-success/10 text-success'
    : score >= 70
      ? 'bg-warning text-warning-foreground'
      : 'bg-destructive/10 text-destructive';

export default function HealthPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const run = await runDiagnostics();
      setReport(run.report);
      // 发布聚合计数（activitybar 徽标）：错误+警告计入「需要关注」
      setHealthIssueCount(run.report.counts.error + run.report.counts.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = report
    ? report.counts.error > 0
      ? '存在需要修复的问题，建议先处理错误项。'
      : report.counts.warning > 0
        ? '整体可用，有几条建议可以进一步优化。'
        : '一切正常，Skills 与 MCP 配置都很健康。'
    : '';

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={() => void refresh()} disabled={busy} title="重新检查">
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          重新检查
        </ToolbarButton>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          只读诊断，不会修改任何配置
        </span>
      </Toolbar>

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          检查失败：{error}
          {!isTauri() && '（此功能仅在桌面 App 中可用）'}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {!report && busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            正在检查 Skills 与 MCP 配置…
          </div>
        )}

        {report && (
          <>
            {/* 总览 */}
            <section className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div
                  className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full ${scoreCircleClass(report.score)}`}
                >
                  <span className="text-xl font-semibold leading-none">{report.score}</span>
                  <span className="mt-0.5 text-[10px] opacity-80">/ 100</span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <HeartPulse className="h-4 w-4 text-muted-foreground" />
                    <h1 className="text-sm font-medium">健康评分</h1>
                    <StatusBadge tone={scoreTone(report.score)}>{report.grade} 级</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                  <StatusBadge tone="error">{report.counts.error} 错误</StatusBadge>
                  <StatusBadge tone="warning">{report.counts.warning} 警告</StatusBadge>
                  <StatusBadge tone="info">{report.counts.info} 提示</StatusBadge>
                  <StatusBadge tone={report.backups.enabled ? 'neutral' : 'neutral'}>
                    <Archive className="h-3 w-3" />
                    {report.backups.enabled
                      ? `备份 ${report.backups.count} 个${report.backups.latest ? ` · 最近 ${report.backups.latest}` : ''}`
                      : '备份未启用'}
                  </StatusBadge>
                </div>
              </div>
            </section>

            {/* 问题清单 */}
            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-medium">问题清单</h2>
                <span className="text-xs text-muted-foreground">
                  共 {report.issues.length} 条
                </span>
              </div>
              {report.issues.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <CircleCheck className="h-6 w-6 text-success" />
                  <div className="text-sm font-medium">未发现问题</div>
                  <div className="text-xs text-muted-foreground">
                    Skills 与 MCP 配置看起来都很健康。
                  </div>
                </div>
              ) : (
                <div>
                  {SEVERITIES.map((severity) => {
                    const items = report.issues.filter((i) => i.severity === severity);
                    if (items.length === 0) return null;
                    const meta = SEVERITY_META[severity];
                    const Icon = meta.icon;
                    return (
                      <div key={severity} className="border-b last:border-b-0">
                        <div className="flex items-center gap-1.5 bg-muted/40 px-4 py-1.5">
                          <Icon
                            className={`h-3.5 w-3.5 ${
                              severity === 'error'
                                ? 'text-destructive'
                                : severity === 'warning'
                                  ? 'text-warning-foreground'
                                  : 'text-muted-foreground'
                            }`}
                          />
                          <span className="text-xs font-medium">{meta.label}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {items.length}
                          </span>
                        </div>
                        <ul>
                          {items.map((issue) => (
                            <li key={issue.id} className="border-b px-4 py-2.5 last:border-b-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[13px] font-medium">{issue.title}</span>
                                {issue.agent && (
                                  <StatusBadge tone="neutral">
                                    {agentLabel(issue.agent)}
                                  </StatusBadge>
                                )}
                                {issue.skill && (
                                  <StatusBadge tone="neutral">{issue.skill}</StatusBadge>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                {issue.detail}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 每个 agent 的配置状态 */}
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium">Agent 配置</h2>
                <div className="flex items-center gap-3 text-xs">
                  <Link
                    to="/skills"
                    className="inline-flex items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Skills 管理
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                  <Link
                    to="/mcp"
                    className="inline-flex items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    MCP 管理
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {AGENTS.map((agent) => {
                  const row = report.agents.find((r) => r.agent === agent.id);
                  return (
                    <div key={agent.id} className="rounded-lg border bg-card p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium">{agent.name}</span>
                        {!row?.configExists ? (
                          <StatusBadge tone="neutral">未配置 MCP</StatusBadge>
                        ) : row.configParsable ? (
                          <StatusBadge tone="success">配置正常</StatusBadge>
                        ) : (
                          <StatusBadge tone="error">解析失败</StatusBadge>
                        )}
                      </div>
                      <dl className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-baseline justify-between gap-2">
                          <dt>配置文件</dt>
                          <dd
                            className="truncate font-mono text-[11px]"
                            title={row?.configError ?? `~/${agent.mcpFile}`}
                          >
                            ~/{agent.mcpFile}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt>Skills 目录</dt>
                          <dd>
                            {!row
                              ? '未知'
                              : row.skillsDirExists
                                ? `${row.skillCount} 个（${row.linkedCount} 链接 / ${row.localCount} 本地）`
                                : '未发现'}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt>MCP servers</dt>
                          <dd>{row?.mcpServerCount ?? 0} 个</dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 说明 */}
            <section className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
                <Info className="h-3.5 w-3.5" />
                诊断说明
              </div>
              本页只读：检查 Skill 软链、SKILL.md、中央库一致性、MCP 清单与各 agent 配置差异，
              不会写入或修复任何文件。修复请在 <Link to="/skills" className="underline">Skills 管理</Link>{' '}
              或 <Link to="/mcp" className="underline">MCP 管理</Link> 中进行。
              评分按错误 15 分、警告 5 分、提示 1 分扣减，90 分以上为 A。
            </section>
          </>
        )}
      </div>
    </div>
  );
}