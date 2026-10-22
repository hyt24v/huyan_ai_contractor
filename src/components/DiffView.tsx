import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { AgentDiff, DiffLine, DiffStatus, McpDiff } from '../lib/mcpDiff';
import { ToolbarButton } from './Toolbar';

const STATUS_LABEL: Record<DiffStatus, string> = {
  added: '新增',
  removed: '移除',
  changed: '修改',
  unchanged: '未变化',
};

const STATUS_BADGE: Record<DiffStatus, string> = {
  added: 'bg-success/10 text-success',
  removed: 'bg-destructive/10 text-destructive',
  changed: 'bg-warning/10 text-warning',
  unchanged: 'bg-muted text-muted-foreground',
};

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  added: 'bg-success/10 text-success',
  removed: 'bg-destructive/10 text-destructive',
  changed: 'bg-warning/10 text-warning',
  context: 'text-muted-foreground',
};

const LINE_SIGN: Record<DiffLine['kind'], string> = {
  added: '+',
  removed: '-',
  changed: '~',
  context: ' ',
};

const hasChanges = (a: AgentDiff): boolean =>
  a.added.length + a.removed.length + a.changed.length > 0;

function SummaryChips({ agent }: { agent: AgentDiff }) {
  const items: DiffStatus[] = ['added', 'removed', 'changed', 'unchanged'];
  const counts: Record<DiffStatus, number> = {
    added: agent.added.length,
    removed: agent.removed.length,
    changed: agent.changed.length,
    unchanged: agent.unchanged.length,
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items
        .filter((s) => counts[s] > 0)
        .map((s) => (
          <span
            key={s}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[s]}`}
          >
            {STATUS_LABEL[s]} {counts[s]}
          </span>
        ))}
      {!hasChanges(agent) && (
        <span className="text-xs text-muted-foreground">无需变更</span>
      )}
    </div>
  );
}

function ServerRows({ agent }: { agent: AgentDiff }) {
  const visible = agent.servers.filter((s) => s.status !== 'unchanged');
  if (visible.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        该 agent 配置已与中央清单一致
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3">
      {visible.map((server) => (
        <div key={server.name} className="overflow-hidden rounded-md border">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
            <span className="font-mono text-xs font-medium">{server.name}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[server.status]}`}
            >
              {STATUS_LABEL[server.status]}
            </span>
          </div>
          <div className="divide-y font-mono text-[11px]">
            {server.lines.map((line, i) => (
              <div
                key={`${server.name}-${i}`}
                className={`flex gap-2 px-2.5 py-1 ${LINE_CLASS[line.kind]}`}
              >
                <span className="w-2 shrink-0 select-none opacity-70">{LINE_SIGN[line.kind]}</span>
                <span className="whitespace-pre-wrap break-all">{line.text}</span>
              </div>
            ))}
            {server.lines.length === 0 && (
              <div className="px-2.5 py-1 text-muted-foreground">（无字段差异）</div>
            )}
          </div>
        </div>
      ))}
      {agent.untracked.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          另有 {agent.untracked.length} 个未纳入中央清单的配置（{agent.untracked.join('、')}
          ），本次不会改动。
        </div>
      )}
    </div>
  );
}

export interface DiffViewProps {
  diff: McpDiff;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 分发前差异预览弹窗 */
export default function DiffView({ diff, busy, onConfirm, onCancel }: DiffViewProps) {
  const firstChanged = diff.perAgent.findIndex(hasChanges);
  const [active, setActive] = useState(firstChanged >= 0 ? firstChanged : 0);
  const agent = diff.perAgent[active];
  const { summary } = diff;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">分发预览</h2>
          <span className="text-xs text-muted-foreground">
            新增 {summary.added} · 移除 {summary.removed} · 修改 {summary.changed} · 未变化{' '}
            {summary.unchanged}
          </span>
          <button
            onClick={onCancel}
            title="关闭"
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1.5">
          {diff.perAgent.map((a, i) => (
            <button
              key={a.agent}
              onClick={() => setActive(i)}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                i === active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {a.name}
              {hasChanges(a) && (
                <span className="rounded-full bg-warning/15 px-1.5 text-[10px] text-warning">
                  {a.added.length + a.removed.length + a.changed.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {agent && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">~/{agent.file}</span>
              <div className="ml-auto">
                <SummaryChips agent={agent} />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <ServerRows agent={agent} />
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t bg-muted/20 px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            确认后将先创建配置快照，再写入各 agent 配置文件。
          </span>
          <div className="ml-auto flex gap-2">
            <ToolbarButton onClick={onCancel} disabled={busy}>
              取消
            </ToolbarButton>
            <ToolbarButton primary onClick={onConfirm} disabled={busy}>
              <Check className="mr-1 inline h-3.5 w-3.5" />
              {busy ? '分发中…' : '确认分发'}
            </ToolbarButton>
          </div>
        </div>
      </div>
    </div>
  );
}