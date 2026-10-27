import { useState } from 'react';
import { AlertTriangle, Info, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { agentShortName } from '../lib/agents';
import type { AuditIssue, AuditReport, AuditSeverity } from '../lib/skillAudit';

const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
};

const SEVERITY_STYLE: Record<AuditSeverity, string> = {
  error: 'bg-destructive/15 text-destructive',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-muted text-muted-foreground',
};

const SEVERITY_ICON: Record<AuditSeverity, typeof AlertTriangle> = {
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

type Filter = 'all' | AuditSeverity;

function scoreTone(score: number): { text: string; bar: string; label: string } {
  if (score >= 85) return { text: 'text-success', bar: 'bg-success', label: '良好' };
  if (score >= 60) return { text: 'text-warning-foreground', bar: 'bg-warning-foreground', label: '需要关注' };
  return { text: 'text-destructive', bar: 'bg-destructive', label: '问题较多' };
}

export interface SkillAuditDrawerProps {
  open: boolean;
  report: AuditReport | null;
  loading: boolean;
  onClose: () => void;
  onRescan: () => void;
}

/** 右侧滑出式审计面板：评分 + 严重级别筛选 + 问题列表 */
export default function SkillAuditDrawer({
  open,
  report,
  loading,
  onClose,
  onRescan,
}: SkillAuditDrawerProps) {
  const [filter, setFilter] = useState<Filter>('all');

  if (!open) return null;

  const issues: AuditIssue[] = report?.issues ?? [];
  const counts = report?.counts ?? { error: 0, warning: 0, info: 0 };
  const score = report?.score ?? 0;
  const tone = scoreTone(score);
  const visible = filter === 'all' ? issues : issues.filter((i) => i.severity === filter);

  const chip = (value: Filter, label: string, count: number) => (
    <button
      key={value}
      onClick={() => setFilter(value)}
      className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
        filter === value
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {label}
      <span className={filter === value ? 'opacity-80' : 'opacity-60'}>{count}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-[460px] max-w-full flex-col border-l bg-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-success" />
          <span className="text-sm font-semibold">Skill 审计</span>
          <button
            onClick={onClose}
            title="关闭"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 border-b px-4 py-3">
          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">审计中…</div>
          ) : report ? (
            <>
              <div className="flex items-end gap-3">
                <span className={`text-4xl font-bold tabular-nums ${tone.text}`}>{score}</span>
                <span className="mb-1 text-xs text-muted-foreground">/ 100 · {tone.label}</span>
                <span className="mb-1 ml-auto text-xs text-muted-foreground">
                  共 {issues.length} 个问题
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${tone.bar} transition-all`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chip('all', '全部', issues.length)}
                {chip('error', SEVERITY_LABEL.error, counts.error)}
                {chip('warning', SEVERITY_LABEL.warning, counts.warning)}
                {chip('info', SEVERITY_LABEL.info, counts.info)}
              </div>
            </>
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">暂无审计结果</div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {report && visible.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              {issues.length === 0 ? '没有发现问题，skill 库很干净' : '该级别下没有问题'}
            </div>
          )}
          <ul className="divide-y">
            {visible.map((issue) => {
              const Icon = SEVERITY_ICON[issue.severity];
              return (
                <li key={issue.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <Icon
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        issue.severity === 'error'
                          ? 'text-destructive'
                          : issue.severity === 'warning'
                            ? 'text-warning-foreground'
                            : 'text-muted-foreground'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[13px] font-medium">{issue.skill}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            SEVERITY_STYLE[issue.severity]
                          }`}
                        >
                          {SEVERITY_LABEL[issue.severity]}
                        </span>
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {issue.code}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground/90">{issue.message}</p>
                      {issue.detail && (
                        <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                          {issue.detail}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {issue.agent ? agentShortName(issue.agent) : '中央库'}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          <button
            disabled={loading}
            onClick={onRescan}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新审计
          </button>
          <span className="text-[11px] text-muted-foreground">
            检查 SKILL.md、软链、重复与可疑内容，不修改任何文件
          </span>
        </div>
      </aside>
    </div>
  );
}