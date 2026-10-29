import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, History, ListFilter, Pencil, Plus, RefreshCw, Send, Trash2, Undo2 } from 'lucide-react';
import { SegmentedControl, Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import { Button } from '../components/ui/controls';
import { Dialog, Popover } from '../components/ui/overlay';
import { EmptyState } from '../components/ui/states';
import DiffView from '../components/DiffView';
import { agentShortName, hasMcpSupport, type AgentId } from '../lib/agents';
import { useAgents } from '../hooks/useAgents';
import { snapshotDisplayTime, type SnapshotRecord } from '../lib/backups';
import { joinArgs, splitArgs, type CentralManifest, type CentralServer } from '../lib/mcp';
import { computeMcpDiff, type McpDiff, type PerAgentServers } from '../lib/mcpDiff';
import { distribute, loadManifest, peekMcpSnapshot, saveManifest, scanMcp } from '../services/agentMcp';
import {
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
  restoreSnapshot,
} from '../services/backups';
import { isTauri } from '@tauri-apps/api/core';

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
          args: d.args.trim() ? splitArgs(d.args.trim()) : undefined,
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
    args: joinArgs(s.args ?? []),
    env: kvToText(s.env),
    url: s.url ?? '',
    headers: kvToText(s.headers),
    agents: { ...s.agents },
    originalName: s.name,
  };
}

/** 打开编辑时，清单里缺失的字段从 agent 实际配置带入（密钥等常只存在于 agent 配置文件里） */
function serverToDraftMerged(s: CentralServer, current: PerAgentServers): EditDraft {
  const d = serverToDraft(s);
  const enabled = Object.entries(s.agents).filter(([, v]) => v).map(([k]) => k);
  const candidates = enabled.length > 0 ? enabled : Object.keys(current);
  for (const id of candidates) {
    const spec = current[id as AgentId]?.[s.name];
    if (!spec) continue;
    if (!d.env.trim() && spec.env && Object.keys(spec.env).length > 0) d.env = kvToText(spec.env);
    if (!d.headers.trim() && spec.headers && Object.keys(spec.headers).length > 0) d.headers = kvToText(spec.headers);
    if (!d.command.trim() && spec.command) d.command = spec.command;
    if (!d.args.trim() && spec.args && spec.args.length > 0) d.args = joinArgs(spec.args);
    if (!d.url.trim() && spec.url) d.url = spec.url;
  }
  return d;
}

export default function McpManagerPage() {
  const agents = useAgents();
  // 必须 useMemo 稳定引用：inline filter 每次渲染都产生新数组，
  // 会使 refresh 的 useCallback 依赖失效 → useEffect 每次渲染都重跑 → 无限扫描循环，
  // 表现为勾选框点了立即被重置、主线程被扫描占满
  const mcpAgents = useMemo(() => agents.filter(hasMcpSupport), [agents]);
  const [manifest, setManifest] = useState<CentralManifest | null>(
    () => peekMcpSnapshot()?.manifest ?? null,
  );
  const [error, setError] = useState('');
  // 有缓存快照先展示（页面切回秒开），后台 refresh 再校正
  const [scanErrors, setScanErrors] = useState<Record<string, string>>(
    () => peekMcpSnapshot()?.errors ?? {},
  );
  const { toast, showToast } = useToast(2500);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [current, setCurrent] = useState<PerAgentServers>(() => peekMcpSnapshot()?.current ?? {});
  const [installed, setInstalled] = useState<AgentId[]>(() => peekMcpSnapshot()?.installed ?? []);
  const [diff, setDiff] = useState<McpDiff | null>(null);
  const [driftCount, setDriftCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SnapshotRecord[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  // busy 的 ref 镜像：refresh 回调里做并发保护用
  const busyRef = useRef(false);
  // 列头筛选 Popover 的定位锚点（只用于浮层定位，不参与逻辑）
  const nameFilterAnchorRef = useRef<HTMLTableCellElement>(null);
  const typeFilterAnchorRef = useRef<HTMLTableCellElement>(null);
  // 矩阵表：搜索过滤 + 列头批量（可撤销，只作用于筛选结果，借鉴 cc-switch）
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'agents'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [typeFilter, setTypeFilter] = useState<'all' | 'stdio' | 'http'>('all');
  const [filterMenu, setFilterMenu] = useState<'name' | 'type' | null>(null);

  const toggleSort = (key: 'name' | 'agents') => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir(key === 'agents' ? 'desc' : 'asc');
    }
  };

  const sortIcon = (key: 'name' | 'agents') =>
    sortBy !== key ? (
      <ArrowUpDown className="h-3 w-3 opacity-40" />
    ) : sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    );
  const [colMenu, setColMenu] = useState<AgentId | null>(null);
  const [lastBatch, setLastBatch] = useState<{
    manifest: CentralManifest;
    label: string;
  } | null>(null);


  const refresh = useCallback(async () => {
    // 分发/回滚进行中禁止刷新（会 setDirty(false) 丢掉未保存标记）
    if (busyRef.current) return;
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
      setScanErrors(snap.errors ?? {});
      const installedDefs = mcpAgents.filter((a) => snap.installed?.includes(a.id));
      setDriftCount(
        persisted.servers.length > 0
          ? computeMcpDiff(persisted, snap.current ?? {}, installedDefs).summary.changedAgents
          : 0,
      );
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mcpAgents]);

  /** 工具栏「刷新」：有未分发编辑时先确认，避免静默丢弃 */
  const onRefreshClick = useCallback(() => {
    if (busyRef.current) {
      showToast('操作进行中，请稍候');
      return;
    }
    if (dirty && !window.confirm('有未分发的编辑，刷新将丢弃这些修改。确定刷新？')) {
      return;
    }
    void refresh();
  }, [dirty, refresh, showToast]);

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
      if (
        !window.confirm(
          `确定从中央清单删除「${name}」？下次「保存并分发」时会从所有 agent 配置中移除它。`,
        )
      ) {
        return;
      }
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

  /** 「保存并分发」第一步：先算差异；无文件变更也要把清单落盘，否则编辑会丢 */
  const applyAll = useCallback(async () => {
    if (!manifest || busyRef.current) return;
    const installedDefs = mcpAgents.filter((a) => installed.includes(a.id));
    const nextDiff = computeMcpDiff(manifest, current, installedDefs);
    if (!nextDiff.summary.hasChanges) {
      busyRef.current = true;
      setBusy(true);
      try {
        await saveManifest(manifest);
        showToast('无文件变更，中央清单已保存');
        setDirty(false);
      } catch (e) {
        showToast(`保存清单失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }
    setDiff(nextDiff);
  }, [manifest, current, installed, mcpAgents, showToast]);

  /** 预览确认后：快照 → 写中央清单 → 分发 → 刷新 */
  const confirmDistribute = useCallback(async () => {
    if (!manifest || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const snapshot = await createSnapshot(undefined, '分发前自动快照');
      await pruneSnapshots();
      await saveManifest(manifest);
      const { written, skipped, errors } = await distribute(manifest);
      const errList = Object.entries(errors)
        .map(([a, e]) => `${agentShortName(a as AgentId)}: ${e}`)
        .join('；');
      const skipNote =
        skipped.length > 0
          ? `；跳过未安装：${skipped.map((a) => agentShortName(a)).join('、')}`
          : '';
      showToast(
        errList
          ? `已快照 ${snapshot}；写入 ${written.length} 个 agent；失败：${errList}${skipNote}`
          : written.length > 0
            ? `已快照 ${snapshot}，分发到 ${written.map((a) => agentShortName(a)).join('、')}${skipNote}`
            : `已保存中央清单（快照 ${snapshot}），无文件需写入${skipNote}`,
      );
      setDiff(null);
      setDirty(false);
      busyRef.current = false;
      setBusy(false);
      await refresh();
    } catch (e) {
      showToast(`分发失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      busyRef.current = false;
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
      if (busyRef.current) return;
      if (
        !window.confirm(
          `确定回滚到快照 ${snapshotDisplayTime(record)}？当前配置将被覆盖，快照时点不存在的配置文件将被删除。`,
        )
      ) {
        return;
      }
      busyRef.current = true;
      setHistoryBusy(true);
      try {
        const safety = await createSnapshot(undefined, `回滚前自动快照（${snapshotDisplayTime(record)}）`);
        await pruneSnapshots();
        const result = await restoreSnapshot(undefined, record.id);
        const parts = [`已回滚 ${result.restored.length} 个文件`];
        if (result.removed.length > 0) parts.push(`删除快照后新增 ${result.removed.length} 个`);
        if (result.missing.length > 0) parts.push(`${result.missing.length} 个失败`);
        showToast(`${parts.join('，')}；回滚前状态已快照 ${safety}`);
        setHistoryOpen(false);
        busyRef.current = false;
        setHistoryBusy(false);
        await refresh();
      } catch (e) {
        showToast(`回滚失败：${e instanceof Error ? e.message : String(e)}`, 'err');
        busyRef.current = false;
        setHistoryBusy(false);
      }
    },
    [refresh, showToast],
  );

  const servers = manifest?.servers ?? [];
  const filteredServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = servers.filter(
      (s) =>
        (typeFilter === 'all' || s.type === typeFilter) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          (s.url ?? '').toLowerCase().includes(q) ||
          (s.command ?? '').toLowerCase().includes(q)),
    );
    matched.sort((a, b) => {
      let c = 0;
      if (sortBy === 'agents') {
        const ca = Object.values(a.agents).filter(Boolean).length;
        const cb = Object.values(b.agents).filter(Boolean).length;
        c = ca - cb;
      } else {
        c = a.name.localeCompare(b.name);
      }
      return sortDir === 'asc' ? c : -c;
    });
    return matched;
  }, [servers, query, sortBy, sortDir, typeFilter]);

  /** 列头批量：把某 agent 列的勾选统一设置，只作用于当前筛选结果，可撤销 */
  const batchSetAgent = useCallback(
    (agent: AgentId, value: boolean) => {
      if (!manifest) return;
      const names = new Set(filteredServers.map((s) => s.name));
      setLastBatch({
        manifest,
        label: `${agentShortName(agent)} ${value ? '全部勾选' : '全部取消'}（${names.size} 个筛选结果）`,
      });
      mutate((m) => ({
        servers: m.servers.map((s) =>
          names.has(s.name) ? { ...s, agents: { ...s.agents, [agent]: value } } : s,
        ),
      }));
      setColMenu(null);
    },
    [manifest, filteredServers, mutate],
  );

  const undoBatch = useCallback(() => {
    if (!lastBatch) return;
    setManifest(lastBatch.manifest);
    setDirty(true);
    setLastBatch(null);
    showToast('已撤销批量操作');
  }, [lastBatch, showToast]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={onRefreshClick} title="重新扫描各 agent 配置">
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
          onClick={() => void applyAll()}
        >
          <Send className="mr-1 inline h-3.5 w-3.5" />
          保存并分发
        </ToolbarButton>
        {dirty && <span className="text-xs text-warning">有未分发变更</span>}
        {lastBatch && (
          <ToolbarButton onClick={undoBatch} title={`撤销：${lastBatch.label}`}>
            <Undo2 className="mr-1 inline h-3.5 w-3.5" />
            撤销批量
          </ToolbarButton>
        )}
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

      {Object.keys(scanErrors).length > 0 && (
        <div className="shrink-0 border-b bg-warning/10 px-4 py-1.5 text-xs text-warning">
          部分 agent 扫描失败：
          {Object.entries(scanErrors)
            .map(([id, msg]) => `${id}（${msg}）`)
            .join('；')}
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
                placeholder="args，空格分隔；含空格的参数用引号包裹"
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
            {mcpAgents.map((a) => (
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
                {agentShortName(a.id)}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* server 列表 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
            <tr className="text-left text-xs text-muted-foreground">
              <th ref={nameFilterAnchorRef} className="relative w-44 whitespace-nowrap px-4 py-2 font-medium">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => toggleSort('name')}
                  >
                    Server {sortIcon('name')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setFilterMenu(filterMenu === 'name' ? null : 'name')}
                    title="筛选"
                    className={query.trim() ? 'text-primary' : 'text-muted-foreground/50'}
                  >
                    <ListFilter className="h-3 w-3" />
                  </Button>
                </div>
                <Popover
                  open={filterMenu === 'name'}
                  onClose={() => setFilterMenu(null)}
                  anchor={nameFilterAnchorRef.current}
                  className="w-52 p-2 shadow-lg"
                >
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="筛选名称/URL/命令…"
                    className="h-7 w-full rounded border border-input bg-transparent px-2 font-mono text-xs font-normal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </Popover>
              </th>
              <th ref={typeFilterAnchorRef} className="relative w-20 whitespace-nowrap px-2 py-2 font-medium">
                <div className="flex items-center gap-1">
                  类型
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setFilterMenu(filterMenu === 'type' ? null : 'type')}
                    title="筛选类型"
                    className={typeFilter !== 'all' ? 'text-primary' : 'text-muted-foreground/50'}
                  >
                    <ListFilter className="h-3 w-3" />
                  </Button>
                </div>
                <Popover
                  open={filterMenu === 'type'}
                  onClose={() => setFilterMenu(null)}
                  anchor={typeFilterAnchorRef.current}
                  className="w-28 overflow-hidden py-1 shadow-lg"
                >
                  {(['all', 'stdio', 'http'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTypeFilter(t);
                        setFilterMenu(null);
                      }}
                      className={`w-full px-2.5 py-1.5 text-left text-xs font-normal hover:bg-accent ${typeFilter === t ? 'text-primary' : ''}`}
                    >
                      {t === 'all' ? '全部' : t}
                    </button>
                  ))}
                </Popover>
              </th>
              <th className="w-56 whitespace-nowrap px-2 py-2 font-medium">命令 / URL</th>
              <th className="w-12 whitespace-nowrap px-1 py-2 text-center font-medium">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => toggleSort('agents')}
                  title="按启用的 agent 数排序"
                >
                  启用 {sortIcon('agents')}
                </Button>
              </th>
              {mcpAgents.map((a) => (
                <th key={a.id} className="relative whitespace-nowrap px-2 py-2 text-center font-medium">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setColMenu(colMenu === a.id ? null : a.id)}
                    title="点击展开批量操作（只作用于当前筛选结果）"
                  >
                    {agentShortName(a.id)}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  {colMenu === a.id && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setColMenu(null)} />
                      <div className="absolute left-1/2 top-full z-30 w-40 -translate-x-1/2 overflow-hidden rounded-md border bg-card py-1 text-left shadow-lg">
                        <button
                          type="button"
                          onClick={() => batchSetAgent(a.id, true)}
                          className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                        >
                          全部勾选
                        </button>
                        <button
                          type="button"
                          onClick={() => batchSetAgent(a.id, false)}
                          className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                        >
                          全部取消
                        </button>
                        {query.trim() && (
                          <div className="border-t px-2.5 py-1 text-[10px] text-muted-foreground">
                            只作用于 {filteredServers.length} 个筛选结果
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </th>
              ))}
              <th className="w-20 whitespace-nowrap px-2 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredServers.map((s) => (
              <tr key={s.name} className="border-b transition-colors hover:bg-muted/40">
                <td className="max-w-[240px] truncate px-4 py-1.5 font-mono text-[13px]" title={s.name}>
                  {s.name}
                </td>
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
                <td className="px-1 py-1.5 text-center text-xs text-muted-foreground">
                  {Object.values(s.agents).filter(Boolean).length}
                </td>
                {mcpAgents.map((a) => (
                  <td key={a.id} className="px-1 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={s.agents[a.id] ?? false}
                      onChange={() => toggleAgent(s.name, a.id)}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDraft(serverToDraftMerged(s, current))}
                    title="编辑"
                    className="mr-1 text-muted-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeServer(s.name)}
                    title="从清单删除（分发后各 agent 同步移除）"
                    className="text-muted-foreground hover:!bg-destructive/10 hover:!text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {filteredServers.length === 0 && (
              <tr>
                <td colSpan={5 + mcpAgents.length}>
                  <EmptyState
                    title={
                      manifest
                        ? query.trim()
                          ? `没有匹配「${query.trim()}」的 server`
                          : '清单为空，点「新增 Server」或「刷新」从现有配置导入'
                        : '扫描中…'
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex h-7 shrink-0 items-center border-t bg-card px-3 text-xs text-muted-foreground">
        勾选 = 分发时写入该 agent 配置文件；取消勾选并分发 = 从该 agent 移除。写入前自动快照 + 保留最近 5 份 .bak
      </div>

      {diff && (
        <DiffView
          diff={diff}
          busy={busy}
          onCancel={() => setDiff(null)}
          onConfirm={() => void confirmDistribute()}
        />
      )}

      <Dialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width="max-w-2xl"
        title={
          <span className="flex items-baseline gap-2">
            配置快照历史
            <span className="text-[11px] font-normal text-muted-foreground">
              回滚会覆盖当前各 agent 的 MCP 配置文件
            </span>
          </span>
        }
        footer={
          <div className="flex w-full items-center justify-between text-[11px] font-normal text-muted-foreground">
            <span>共 {history.length} 个快照，默认只保留最新 20 个</span>
            <span>目录：~/.ai-baogongtou/backups/</span>
          </div>
        }
      >
        {historyBusy && history.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">读取中…</div>
        )}
        {!historyBusy && history.length === 0 && (
          <EmptyState title="暂无快照" description="分发前和每 6 小时会自动创建快照。" />
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
      </Dialog>
    </div>
  );
}
