import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { AlertTriangle, History, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { SegmentedControl, Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import DiffView from '../components/DiffView';
import { AGENTS, type AgentId } from '../lib/agents';
import { snapshotDisplayTime, type SnapshotRecord } from '../lib/backups';
import type { CentralManifest, CentralServer } from '../lib/mcp';
import { computeMcpDiff, type McpDiff, type PerAgentServers } from '../lib/mcpDiff';
import { distribute, loadManifest, saveManifest, scanMcp } from '../services/agentMcp';
import {
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
  restoreSnapshot,
} from '../services/backups';
import { isTauri } from '@tauri-apps/api/core';

const AGENT_SHORT: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  pi: 'Pi',
  cursor: 'Cursor',
  gemini: 'Gemini',
};

interface EditDraft {
  name: string;
  type: 'stdio' | 'http';
  command: string;
  args: string;
  env: string; // KEY=VALUE 每行一个
  url: string;
  headers: string;
  agents: Partial<Record<AgentId, boolean>>;
  originalName?: string; // 编辑已有 server 时用于重命名
}

const emptyDraft = (): EditDraft => ({
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
  agents: {},
});

function parseKvLines(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function kvToText(map?: Record<string, string>): string {
  if (!map) return '';
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function draftToServer(d: EditDraft): CentralServer | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: '名称不能为空' };
  if (/[\[\].]/.test(name)) return { error: '名称不能含 . [ ]' };
  if (d.type === 'stdio' && !d.command.trim()) return { error: 'stdio 类型需要 command' };
  if (d.type === 'http' && !d.url.trim()) return { error: 'http 类型需要 url' };
  return {
    name,
    type: d.type,
    ...(d.type === 'stdio'
      ? {
          command: d.command.trim(),
          args: d.args.trim() ? d.args.trim().split(/\s+/) : undefined,
          env: parseKvLines(d.env),
        }
      : { url: d.url.trim(), headers: parseKvLines(d.headers) }),
    agents: d.agents,
  };
}

function serverToDraft(s: CentralServer): EditDraft {
  return {
    name: s.name,
    type: s.type,
    command: s.command ?? '',
    args: (s.args ?? []).join(' '),
    env: kvToText(s.env),
    url: s.url ?? '',
    headers: kvToText(s.headers),
    agents: { ...s.agents },
    originalName: s.name,
  };
}

export default function McpManagerPage() {
  const [manifest, setManifest] = useState<CentralManifest | null>(null);
  const [error, setError] = useState('');
  const { toast, showToast } = useToast(2500);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [current, setCurrent] = useState<PerAgentServers>({});
  const [installed, setInstalled] = useState<AgentId[]>([]);
  const [diff, setDiff] = useState<McpDiff | null>(null);
  const [driftCount, setDriftCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SnapshotRecord[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);


  const refresh = useCallback(async () => {
    setError('');
    try {
      const snap = await scanMcp();
      // 以已保存的中央清单为准：清单里有、磁盘配置里缺失的 server 也要保留在页面中，
      // 否则「保存并分发」无法用它修复漂移。
      const persisted = await loadManifest();
      const pageServers: CentralServer[] = persisted.servers.map(
        (p) => snap.manifest.servers.find((m) => m.name === p.name) ?? p,
      );
      for (const m of snap.manifest.servers) {
        if (!pageServers.some((x) => x.name === m.name)) pageServers.push(m);
      }
      setManifest({ servers: pageServers });
      setCurrent(snap.current ?? {});
      setInstalled(snap.installed ?? []);
      const installedDefs = AGENTS.filter((a) => snap.installed?.includes(a.id));
      setDriftCount(
        persisted.servers.length > 0
          ? computeMcpDiff(persisted, snap.current ?? {}, installedDefs).summary.changedAgents
          : 0,
      );
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback((fn: (m: CentralManifest) => CentralManifest) => {
    setManifest((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }, []);

  const toggleAgent = useCallback(
    (serverName: string, agent: AgentId) => {
      mutate((m) => ({
        servers: m.servers.map((s) =>
          s.name === serverName
            ? { ...s, agents: { ...s.agents, [agent]: !s.agents[agent] } }
            : s,
        ),
      }));
    },
    [mutate],
  );

  const removeServer = useCallback(
    (name: string) => {
      mutate((m) => ({ servers: m.servers.filter((s) => s.name !== name) }));
    },
    [mutate],
  );

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const result = draftToServer(draft);
    if ('error' in result) {
      showToast(result.error, 'err');
      return;
    }
    // 重命名查重：新名字不能撞上别的已有 server
    if (
      draft.originalName !== result.name &&
      manifest?.servers.some((s) => s.name === result.name)
    ) {
      showToast(`已存在同名 server「${result.name}」，请换个名字`, 'err');
      return;
    }
    mutate((m) => {
      const servers = draft.originalName
        ? m.servers.map((s) => (s.name === draft.originalName ? result : s))
        : [...m.servers.filter((s) => s.name !== result.name), result];
      return { servers };
    });
    setDraft(null);
  }, [draft, manifest, mutate, showToast]);

  /** 「保存并分发」第一步：先算差异，无变更直接提示，有变更打开预览 */
  const applyAll = useCallback(() => {
    if (!manifest) return;
    const installedDefs = AGENTS.filter((a) => installed.includes(a.id));
    const nextDiff = computeMcpDiff(manifest, current, installedDefs);
    if (!nextDiff.summary.hasChanges) {
      showToast('无变更，无需分发');
      setDirty(false);
      return;
    }
    setDiff(nextDiff);
  }, [manifest, current, installed, showToast]);

  /** 预览确认后：快照 → 写中央清单 → 分发 → 刷新 */
  const confirmDistribute = useCallback(async () => {
    if (!manifest) return;
    setBusy(true);
    try {
      const snapshot = await createSnapshot(undefined, '分发前自动快照');
      await pruneSnapshots();
      await saveManifest(manifest);
      const { written, skipped, errors } = await distribute(manifest);
      const errList = Object.entries(errors)
        .map(([a, e]) => `${AGENT_SHORT[a as AgentId]}: ${e}`)
        .join('；');
      const skipNote =
        skipped.length > 0
          ? `；跳过未安装：${skipped.map((a) => AGENT_SHORT[a]).join('、')}`
          : '';
      showToast(
        errList
          ? `已快照 ${snapshot}；写入 ${written.length} 个 agent；失败：${errList}${skipNote}`
          : written.length > 0
            ? `已快照 ${snapshot}，分发到 ${written.map((a) => AGENT_SHORT[a]).join('、')}${skipNote}`
            : `已保存中央清单（快照 ${snapshot}），无文件需写入${skipNote}`,
      );
      setDiff(null);
      setDirty(false);
      await refresh();
    } catch (e) {
      showToast(`分发失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [manifest, refresh, showToast]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryBusy(true);
    try {
      setHistory(await listSnapshots());
    } catch (e) {
      showToast(`读取快照失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    } finally {
      setHistoryBusy(false);
    }
  }, [showToast]);

  const rollback = useCallback(
    async (record: SnapshotRecord) => {
      if (!window.confirm(`确定回滚到快照 ${snapshotDisplayTime(record)}？当前配置将被覆盖。`)) {
        return;
      }
      setHistoryBusy(true);
      try {
        const safety = await createSnapshot(undefined, `回滚前自动快照（${snapshotDisplayTime(record)}）`);
        const result = await restoreSnapshot(undefined, record.id);
        const parts = [`已回滚 ${result.restored.length} 个文件`];
        if (result.removed.length > 0) parts.push(`删除快照后新增 ${result.removed.length} 个`);
        if (result.missing.length > 0) parts.push(`${result.missing.length} 个失败`);
        showToast(`${parts.join('，')}；回滚前状态已快照 ${safety}`);
        setHistoryOpen(false);
        await refresh();
      } catch (e) {
        showToast(`回滚失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      } finally {
        setHistoryBusy(false);
      }
    },
    [refresh, showToast],
  );

  const servers = manifest?.servers ?? [];

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={() => void refresh()} title="重新扫描各 agent 配置">
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
          刷新
        </ToolbarButton>
        <ToolbarButton onClick={() => setDraft(emptyDraft())}>
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          新增 Server
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => void openHistory()} title="查看配置快照并回滚">
          <History className="mr-1 inline h-3.5 w-3.5" />
          历史
        </ToolbarButton>
        <ToolbarButton
          primary
          disabled={busy || (!dirty && driftCount === 0)}
          onClick={applyAll}
        >
          <Send className="mr-1 inline h-3.5 w-3.5" />
          保存并分发
        </ToolbarButton>
        {dirty && <span className="text-xs text-warning">有未分发变更</span>}
        {toast && (
          <span
            className={`ml-auto text-xs font-medium ${
              toast.tone === 'err' ? 'text-destructive' : 'text-success'
            }`}
          >
            {toast.msg}
          </span>
        )}
      </Toolbar>

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
          {!isTauri() && '（此功能仅在桌面 App 中可用）'}
        </div>
      )}

      {driftCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-warning/10 px-4 py-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>检测到 {driftCount} 个 agent 配置与中央清单不一致</span>
          <span className="text-warning/70">
            可点「保存并分发」按中央清单覆盖，或「刷新」重新导入
          </span>
        </div>
      )}

      {/* 编辑面板 */}
      {draft && (
        <div className="shrink-0 space-y-2 border-b bg-muted/30 p-4">
          <div className="flex items-center gap-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="server 名（如 context7）"
              className="h-8 w-56 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <SegmentedControl<'stdio' | 'http'>
              options={[
                { value: 'stdio', label: 'stdio（本地命令）' },
                { value: 'http', label: 'http（远程 URL）' },
              ]}
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
            />
            <div className="ml-auto flex gap-2">
              <ToolbarButton onClick={() => setDraft(null)}>取消</ToolbarButton>
              <ToolbarButton primary onClick={saveDraft}>
                确定
              </ToolbarButton>
            </div>
          </div>
          {draft.type === 'stdio' ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                placeholder="command，如 npx / codegraph"
                className="h-8 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                value={draft.args}
                onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                placeholder="args，空格分隔，如 -y @upstash/context7-mcp"
                className="h-8 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <textarea
                value={draft.env}
                onChange={(e) => setDraft({ ...draft, env: e.target.value })}
                placeholder={'环境变量，每行 KEY=VALUE'}
                rows={3}
                className="col-span-2 rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              <input
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="url，如 https://mcp.example.com/sse"
                className="h-8 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <textarea
                value={draft.headers}
                onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
                placeholder={'HTTP 头，每行 KEY=VALUE（如 Authorization=Bearer xxx）'}
                rows={2}
                className="rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>启用到：</span>
            {AGENTS.map((a) => (
              <label key={a.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={draft.agents[a.id] ?? false}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      agents: { ...draft.agents, [a.id]: e.target.checked },
                    })
                  }
                />
                {AGENT_SHORT[a.id]}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* server 列表 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Server</th>
              <th className="w-16 px-2 py-2 font-medium">类型</th>
              <th className="px-2 py-2 font-medium">命令 / URL</th>
              {AGENTS.map((a) => (
                <th key={a.id} className="w-16 px-1 py-2 text-center font-medium">
                  {AGENT_SHORT[a.id]}
                </th>
              ))}
              <th className="w-20 px-2 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.name} className="border-b transition-colors hover:bg-muted/40">
                <td className="px-4 py-1.5 font-mono text-[13px]">{s.name}</td>
                <td className="px-2 py-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      s.type === 'http'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {s.type}
                  </span>
                </td>
                <td className="max-w-0 truncate px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {s.type === 'http'
                    ? s.url
                    : `${s.command ?? ''} ${(s.args ?? []).join(' ')}`.trim()}
                </td>
                {AGENTS.map((a) => (
                  <td key={a.id} className="px-1 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={s.agents[a.id] ?? false}
                      onChange={() => toggleAgent(s.name, a.id)}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => setDraft(serverToDraft(s))}
                    title="编辑"
                    className="mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeServer(s.name)}
                    title="从清单删除（分发后各 agent 同步移除）"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {manifest ? '清单为空，点「新增 Server」或「刷新」从现有配置导入' : '扫描中…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex h-7 shrink-0 items-center border-t bg-card px-3 text-xs text-muted-foreground">
        勾选 = 分发时写入该 agent 配置文件；取消勾选并分发 = 从该 agent 移除。写入前自动备份（.bak.时间戳）
      </div>

      {diff && (
        <DiffView
          diff={diff}
          busy={busy}
          onCancel={() => setDiff(null)}
          onConfirm={() => void confirmDistribute()}
        />
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">配置快照历史</h2>
              <span className="text-xs text-muted-foreground">
                回滚会覆盖当前各 agent 的 MCP 配置文件
              </span>
              <button
                onClick={() => setHistoryOpen(false)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {historyBusy && history.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">读取中…</div>
              )}
              {!historyBusy && history.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  暂无快照。分发前和每 6 小时会自动创建快照。
                </div>
              )}
              {history.map((record) => {
                const existing = record.files.filter((f) => f.exists);
                return (
                  <div
                    key={record.id}
                    className="flex items-center gap-3 border-b px-4 py-2.5 text-xs last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{snapshotDisplayTime(record)}</span>
                        {record.label && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {record.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {existing.length > 0
                          ? existing.map((f) => f.file).join('、')
                          : record.id}
                      </div>
                    </div>
                    <ToolbarButton
                      disabled={historyBusy || existing.length === 0}
                      onClick={() => void rollback(record)}
                    >
                      回滚
                    </ToolbarButton>
                  </div>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
              <span>共 {history.length} 个快照，默认只保留最新 20 个</span>
              <span>目录：~/.ai-baogongtou/backups/</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
