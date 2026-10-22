import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Check,
  Download,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import { AGENTS, agentById, type AgentId } from '../lib/agents';
import { downloadText } from '../lib/json';
import {
  API_LABEL,
  PROVIDER_APIS,
  activeProvider,
  createProvider,
  emptyStore,
  exportStoreJson,
  importStoreJson,
  isActive,
  maskKey,
  updateProvider,
  validateProvider,
  type Provider,
  type ProviderApi,
  type ProviderInput,
  type ProviderStore,
} from '../lib/providers';
import {
  PROVIDER_TARGETS,
  providerTarget,
  UNSUPPORTED_NOTE,
} from '../lib/providerTargets';
import {
  applyProvider,
  loadStore,
  readAllCurrent,
  removeProvider,
  saveStore,
  setActive,
  upsertProvider,
  type ReadResult,
} from '../services/providers';

const emptyDraft = (): ProviderInput => ({
  name: '',
  agent: 'claude',
  baseUrl: '',
  apiKey: '',
  model: '',
  api: 'openai-responses',
});

const providerToDraft = (p: Provider): ProviderInput => ({
  name: p.name,
  agent: p.agent,
  baseUrl: p.baseUrl,
  apiKey: p.apiKey ?? '',
  model: p.model ?? '',
  api: p.api ?? 'openai-responses',
});

function ApiBadge({ api }: { api?: ProviderApi }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
      {api ? API_LABEL[api] : '默认 API'}
    </span>
  );
}

/** 单个 provider 卡片 */
function ProviderCard({
  provider,
  active,
  writable,
  busy,
  onApply,
  onEdit,
  onDelete,
}: {
  provider: Provider;
  active: boolean;
  writable: boolean;
  busy: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border bg-card p-3 transition-shadow ${
        active ? 'border-primary/60 shadow-sm ring-1 ring-primary/30' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{provider.name}</span>
            {active && (
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                当前
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {provider.id}
          </div>
        </div>
      </div>

      <div className="truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px]">
        {provider.baseUrl}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded-full border border-input px-2 py-0.5 font-mono">
          {provider.model || '未指定模型'}
        </span>
        <ApiBadge api={provider.api} />
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <KeyRound className="h-3 w-3 shrink-0" />
        <span className="font-mono">{maskKey(provider.apiKey)}</span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 border-t pt-2">
        <button
          onClick={onApply}
          disabled={busy || !writable}
          title={writable ? '写入该 Agent 的配置文件并设为当前' : UNSUPPORTED_NOTE}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        >
          <Check className="h-3 w-3" />
          应用
        </button>
        <button
          onClick={onEdit}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2.5 text-[11px] transition-colors hover:bg-accent"
        >
          <Pencil className="h-3 w-3" />
          编辑
        </button>
        <button
          onClick={onDelete}
          title="从清单删除（可重新导入，不会改动 Agent 配置文件）"
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
          删除
        </button>
      </div>
    </div>
  );
}

/** 当前配置文件摘要 */
function CurrentLine({ read }: { read?: ReadResult }) {
  if (!read) return null;
  if (read.error) {
    return <span className="text-[11px] text-destructive">读取失败：{read.error}</span>;
  }
  if (!read.found) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {read.file ? '配置文件中尚未写入模型服务' : ''}
      </span>
    );
  }
  const c = read.current;
  return (
    <span className="truncate text-[11px] text-muted-foreground">
      文件中：<span className="font-mono">{c.baseUrl ?? '—'}</span>
      {c.model ? (
        <>
          {' · '}
          <span className="font-mono">{c.model}</span>
        </>
      ) : null}
      {c.hasKey ? ' · 已含 Key' : ''}
    </span>
  );
}

export default function ProvidersPage() {
  const [store, setStore] = useState<ProviderStore | null>(null);
  const [current, setCurrent] = useState<Partial<Record<AgentId, ReadResult>>>({});
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ProviderInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const next = await loadStore();
      setStore(next);
      setCurrent(await readAllCurrent(AGENTS.map((a) => a.id), undefined, next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStore(emptyStore());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentStore = store ?? emptyStore();

  const openNew = useCallback(() => {
    setDraft(emptyDraft());
    setEditingId(null);
    setFormError('');
    setShowKey(false);
  }, []);

  const openEdit = useCallback((p: Provider) => {
    setDraft(providerToDraft(p));
    setEditingId(p.id);
    setFormError('');
    setShowKey(false);
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const errors = validateProvider(draft);
    if (errors.length > 0) {
      setFormError(errors.join('；'));
      return;
    }
    const existing = editingId
      ? currentStore.providers.find((p) => p.id === editingId)
      : undefined;
    const provider = existing
      ? updateProvider(existing, draft, new Date())
      : createProvider(
          draft,
          new Date(),
          currentStore.providers.map((p) => p.id),
        );
    try {
      setBusy(true);
      const next = await upsertProvider(provider);
      setStore(next);
      setDraft(null);
      setEditingId(null);
      showToast(existing ? '已更新模型服务' : '已新增模型服务');
      void refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [currentStore.providers, draft, editingId, refresh, showToast]);

  const applyOne = useCallback(
    async (p: Provider) => {
      if (!PROVIDER_TARGETS[p.agent].writable) {
        showToast(`${agentById(p.agent).name}：${UNSUPPORTED_NOTE}`);
        return;
      }
      setBusy(true);
      try {
        const result = await applyProvider(p);
        if (!result.ok) {
          showToast(`应用失败：${result.message}`);
          return;
        }
        const next = await setActive(p.agent, p.id);
        setStore(next);
        const reads = await readAllCurrent(AGENTS.map((a) => a.id), undefined, next);
        setCurrent(reads);
        showToast(result.message);
      } catch (e) {
        showToast(`应用失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  const deleteOne = useCallback(
    async (p: Provider) => {
      if (!window.confirm(`删除模型服务「${p.name}」？\n仅从本清单移除，不会改动 Agent 配置文件。`))
        return;
      try {
        setBusy(true);
        const next = await removeProvider(p.id);
        setStore(next);
        showToast('已删除');
      } catch (e) {
        showToast(`删除失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  const exportAll = useCallback(() => {
    if (currentStore.providers.length === 0) {
      showToast('清单为空，无可导出内容');
      return;
    }
    if (
      !window.confirm(
        '导出的 JSON 包含明文 API Key！\n请妥善保管，不要提交到代码仓库或分享给他人。继续导出？',
      )
    )
      return;
    downloadText('providers.json', exportStoreJson(currentStore));
    showToast('已导出 providers.json');
  }, [currentStore, showToast]);

  const importFile = useCallback(
    async (file: File) => {
      try {
        setBusy(true);
        const text = await file.text();
        const result = importStoreJson(text, currentStore, new Date());
        if (!result.ok) {
          showToast(`导入失败：${result.error}`);
          return;
        }
        await saveStore(result.store);
        setStore(result.store);
        showToast(`已导入 ${result.imported} 个模型服务（同 ID 已覆盖）`);
        void refresh();
      } catch (e) {
        showToast(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [currentStore, refresh, showToast],
  );

  const total = currentStore.providers.length;

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={() => void refresh()} title="重新读取 providers.json 与各 Agent 配置">
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
          刷新
        </ToolbarButton>
        <ToolbarButton primary onClick={openNew}>
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          新增模型服务
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => fileRef.current?.click()} title="导入包含 providers 数组的 JSON">
          <Upload className="mr-1 inline h-3.5 w-3.5" />
          导入
        </ToolbarButton>
        <ToolbarButton onClick={exportAll} title="导出包含明文 API Key 的 JSON">
          <Download className="mr-1 inline h-3.5 w-3.5" />
          导出
        </ToolbarButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {toast && <span className="font-medium text-success">{toast}</span>}
          <span>{total} 个模型服务</span>
        </div>
      </Toolbar>

      {/* 安全提示 */}
      <div className="flex shrink-0 items-start gap-2 border-b bg-warning/40 px-3 py-2 text-xs text-warning-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          API Key 仅保存在本机{' '}
          <code className="rounded bg-background/60 px-1 font-mono text-[11px]">
            ~/.ai-baogongtou/providers.json
          </code>
          ，不会上传到任何服务器；页面默认脱敏展示。写入 Agent 配置前会自动备份原文件到{' '}
          <code className="rounded bg-background/60 px-1 font-mono text-[11px]">
            ~/.ai-baogongtou/provider-backups/
          </code>
          。导出文件含明文 Key，请勿提交到代码仓库。
        </span>
      </div>

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
          {!isTauri() && '（此功能仅在桌面 App 中可用）'}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {store === null ? (
          <div className="py-16 text-center text-xs text-muted-foreground">读取中…</div>
        ) : (
          <div className="space-y-7">
            {AGENTS.map((agent) => {
              const target = providerTarget(agent.id);
              const list = currentStore.providers.filter((p) => p.agent === agent.id);
              const active = activeProvider(currentStore, agent.id);
              const writable = target.writable;
              return (
                <section key={agent.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold tracking-tight">{agent.name}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {target.file || '—'}
                    </span>
                    {writable ? (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] text-success">
                        可写入
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {UNSUPPORTED_NOTE}
                      </span>
                    )}
                    <CurrentLine read={current[agent.id]} />
                    <button
                      onClick={() => {
                        setDraft({ ...emptyDraft(), agent: agent.id });
                        setEditingId(null);
                        setFormError('');
                        setShowKey(false);
                      }}
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-[11px] transition-colors hover:bg-accent"
                    >
                      <Plus className="h-3 w-3" />
                      添加到 {agent.name}
                    </button>
                  </div>

                  {list.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-xs text-muted-foreground">
                      <Server className="h-4 w-4" />
                      {writable
                        ? '还没有模型服务。新增后可一键写入该 Agent 的配置文件。'
                        : '该 Agent 仅支持查看已有记录，暂不支持写入配置。'}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((p) => (
                        <ProviderCard
                          key={p.id}
                          provider={p}
                          active={isActive(currentStore, p)}
                          writable={writable}
                          busy={busy}
                          onApply={() => void applyOne(p)}
                          onEdit={() => openEdit(p)}
                          onDelete={() => void deleteOne(p)}
                        />
                      ))}
                    </div>
                  )}
                  {!writable && active && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      当前标记：{active.name}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center border-t bg-card px-3 text-xs text-muted-foreground">
        「应用」会写入该 Agent 的配置文件并标记为当前；Claude 合并 env、Codex 行级改写 TOML、Pi upsert
        models.json。Cursor / Gemini 暂不支持写入。
      </div>

      {/* 新增 / 编辑弹窗 */}
      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDraft(null)}
        >
          <div
            className="w-full max-w-lg space-y-3 rounded-lg border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editingId ? '编辑模型服务' : '新增模型服务'}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">
                {editingId ?? '新条目'}
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-1">
                <span className="text-xs text-muted-foreground">名称 *</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="如：公司中转 / 官方直连"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">目标 Agent *</span>
                <select
                  value={draft.agent}
                  onChange={(e) =>
                    setDraft({ ...draft, agent: e.target.value as AgentId })
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {AGENTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {PROVIDER_TARGETS[a.id].writable ? '' : `（${UNSUPPORTED_NOTE}）`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Base URL *</span>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://api.example.com"
                  spellCheck={false}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">API 协议</span>
                <select
                  value={draft.api ?? 'openai-responses'}
                  onChange={(e) =>
                    setDraft({ ...draft, api: e.target.value as ProviderApi })
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {PROVIDER_APIS.map((api) => (
                    <option key={api} value={api}>
                      {API_LABEL[api]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">模型（可选）</span>
                <input
                  value={draft.model ?? ''}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder="如 claude-sonnet-4-5 / gpt-5"
                  spellCheck={false}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">API Key（可选，仅存本机）</span>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey ?? ''}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 pr-14 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-1 top-1 h-6 rounded px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </label>
            </div>

            {!PROVIDER_TARGETS[draft.agent].writable && (
              <div className="rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                {agentById(draft.agent).name}：{UNSUPPORTED_NOTE}。可先登记，后续再手动配置。
              </div>
            )}

            {formError && (
              <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <ToolbarButton onClick={() => setDraft(null)}>取消</ToolbarButton>
              <ToolbarButton primary disabled={busy} onClick={() => void saveDraft()}>
                保存
              </ToolbarButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}