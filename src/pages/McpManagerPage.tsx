import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { SegmentedControl, Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import { AGENTS, type AgentId } from '../lib/agents';
import type { CentralManifest, CentralServer } from '../lib/mcp';
import { distribute, saveManifest, scanMcp } from '../services/agentMcp';

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
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [dirty, setDirty] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const snap = await scanMcp();
      setManifest(snap.manifest);
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
      showToast(result.error);
      return;
    }
    mutate((m) => {
      const servers = draft.originalName
        ? m.servers.map((s) => (s.name === draft.originalName ? result : s))
        : [...m.servers.filter((s) => s.name !== result.name), result];
      return { servers };
    });
    setDraft(null);
  }, [draft, mutate, showToast]);

  const applyAll = useCallback(async () => {
    if (!manifest) return;
    setBusy(true);
    try {
      await saveManifest(manifest);
      const { written, errors } = await distribute(manifest);
      const errList = Object.entries(errors)
        .map(([a, e]) => `${AGENT_SHORT[a as AgentId]}: ${e}`)
        .join('；');
      showToast(
        errList
          ? `已写入 ${written.length} 个 agent；失败：${errList}`
          : written.length > 0
            ? `已分发到 ${written.map((a) => AGENT_SHORT[a]).join('、')}（原文件已备份 .bak）`
            : '无变更',
      );
      setDirty(false);
      await refresh();
    } catch (e) {
      showToast(`分发失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [manifest, refresh, showToast]);

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
        <ToolbarButton primary disabled={busy || !dirty} onClick={() => void applyAll()}>
          <Send className="mr-1 inline h-3.5 w-3.5" />
          保存并分发
        </ToolbarButton>
        {dirty && <span className="text-xs text-warning">有未分发变更</span>}
        {toast && (
          <span className="ml-auto text-xs font-medium text-success">{toast}</span>
        )}
      </Toolbar>

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}（此功能仅在桌面 App 中可用）
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
    </div>
  );
}
