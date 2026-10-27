import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { isTauri } from '@tauri-apps/api/core';
import {
  Download,
  Gauge,
  ListPlus,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import ConfirmApplyDialog from '../components/ConfirmApplyDialog';
import ProviderTable, { type RowTestResult } from '../components/providers/ProviderTable';
import { agentById, type AgentId } from '../lib/agents';
import { downloadText } from '../lib/json';
import {
  API_LABEL,
  PROVIDER_APIS,
  createProvider,
  emptyStore,
  exportStoreJson,
  importStoreJson,
  isActive,
  maskKey,
  normalizeModels,
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
import { PROVIDER_PRESETS, presetById } from '../lib/providerPresets';
import { fetchModels, testEndpoint } from '../lib/providerApi';
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

/** 支持模型服务写入/查看的 agent（PROVIDER_TARGETS 登记顺序即清单排序顺序） */
const PROVIDER_AGENTS = Object.keys(PROVIDER_TARGETS) as AgentId[];

const emptyDraft = (): ProviderInput => ({
  name: '',
  agent: 'claude',
  baseUrl: '',
  apiKey: '',
  model: '',
  models: [],
  api: 'openai-responses',
});

const providerToDraft = (p: Provider): ProviderInput => ({
  name: p.name,
  agent: p.agent,
  baseUrl: p.baseUrl,
  apiKey: p.apiKey ?? '',
  model: p.model ?? '',
  models: p.models ? [...p.models] : [],
  api: p.api ?? 'openai-responses',
});

export default function ProvidersPage() {
  const [store, setStore] = useState<ProviderStore | null>(null);
  const [current, setCurrent] = useState<Partial<Record<AgentId, ReadResult>>>({});
  const [error, setError] = useState('');
  const { toast, showToast } = useToast(3000);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ProviderInput | null>(null);
  const [applyTarget, setApplyTarget] = useState<Provider | null>(null);
  // 预设模板 + 测速 + 模型拉取（借鉴 cc-switch）
  const [presetId, setPresetId] = useState('custom');
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  /** 手动输入的模型名（拉取接口不兼容时的兑底入口） */
  const [manualModel, setManualModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // 行内测速结果（provider id → 结果）
  const [rowTestingId, setRowTestingId] = useState<string | null>(null);
  const [rowTestResults, setRowTestResults] = useState<Record<string, RowTestResult>>({});

  /** 行内测速：测试该 provider 端点的连通性与延迟（借鉴 cc-switch 端点测速） */
  const testOne = useCallback(async (p: Provider) => {
    setRowTestingId(p.id);
    try {
      const r = await testEndpoint(p.baseUrl, p.apiKey, p.api);
      setRowTestResults((prev) => ({ ...prev, [p.id]: { text: r.message, ok: r.ok } }));
    } finally {
      setRowTestingId(null);
    }
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [agentFilter, setAgentFilter] = useState<'all' | AgentId>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const next = await loadStore();
      setStore(next);
      setCurrent(await readAllCurrent(PROVIDER_AGENTS, undefined, next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStore(emptyStore());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentStore = store ?? emptyStore();

  // 单屏清单：按 agent（PROVIDER_TARGETS 登记顺序）再按名称排序，顶部 pills 筛选
  const sortedProviders = useMemo(() => {
    const order = (id: AgentId) => {
      const i = PROVIDER_AGENTS.indexOf(id);
      return i === -1 ? PROVIDER_AGENTS.length : i;
    };
    return [...currentStore.providers].sort(
      (a, b) => order(a.agent) - order(b.agent) || a.name.localeCompare(b.name),
    );
  }, [currentStore.providers]);

  const visibleProviders = useMemo(
    () =>
      agentFilter === 'all'
        ? sortedProviders
        : sortedProviders.filter((p) => p.agent === agentFilter),
    [agentFilter, sortedProviders],
  );

  const openNew = useCallback(() => {
    setDraft(emptyDraft());
    setEditingId(null);
    setFormError('');
    setShowKey(false);
    setPresetId('custom');
    setModelsList([]);
    setModelsMsg('');
    setTestMsg(null);
    setManualModel('');
  }, []);

  const openEdit = useCallback((p: Provider) => {
    setDraft(providerToDraft(p));
    setEditingId(p.id);
    setFormError('');
    setShowKey(false);
    setPresetId('custom');
    setModelsList([]);
    setModelsMsg('');
    setTestMsg(null);
    setManualModel('');
  }, []);

  /** 选预设：自动填名称（未填时）+ Base URL + 建议模型并入模型列表（借鉴 cc-switch 预设一键添加） */
  const applyPreset = useCallback(
    (id: string) => {
      setPresetId(id);
      const preset = presetById(id);
      if (!preset || !draft) return;
      setDraft({
        ...draft,
        name: draft.name || preset.name,
        baseUrl: preset.baseUrl,
        model: draft.model || preset.models[0] || '',
        models: normalizeModels([...(draft.models ?? []), ...preset.models]) ?? [],
      });
      setTestMsg(null);
      setModelsMsg('');
    },
    [draft],
  );

  const runTest = useCallback(async () => {
    if (!draft) return;
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await testEndpoint(draft.baseUrl, draft.apiKey, draft.api);
      setTestMsg({ text: r.message, ok: r.ok });
    } finally {
      setTesting(false);
    }
  }, [draft]);

  const pullModels = useCallback(async () => {
    if (!draft) return;
    setFetchingModels(true);
    setModelsMsg('');
    try {
      const r = await fetchModels(draft.baseUrl, draft.apiKey, draft.api);
      setModelsList(r.models);
      setModelsMsg(r.ok ? r.message : `${r.message}（可手动输入模型名添加）`);
    } finally {
      setFetchingModels(false);
    }
  }, [draft]);

  /** 表单内模型列表操作（cc-switch 式：一个服务挂多个模型，★ 为默认；只能从拉取列表选择） */
  const addModel = useCallback(
    (name: string) => {
      if (!draft) return;
      if (!name || (draft.models ?? []).includes(name)) return;
      const models = [...(draft.models ?? []), name];
      setDraft({ ...draft, models, model: draft.model || name });
    },
    [draft],
  );

  const removeModel = useCallback(
    (name: string) => {
      if (!draft) return;
      const rest = (draft.models ?? []).filter((m) => m !== name);
      setDraft({
        ...draft,
        models: rest,
        model: draft.model === name ? (rest[0] ?? '') : draft.model,
      });
    },
    [draft],
  );

  const setDefaultModel = useCallback(
    (name: string) => {
      if (draft) setDraft({ ...draft, model: name });
    },
    [draft],
  );

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
      // 编辑的是当前生效的 provider 时提醒：agent 配置文件不会自动回写，需重新「应用」
      const stillActive = existing && isActive(next, provider);
      showToast(
        existing
          ? stillActive
            ? '已更新模型服务；该服务正在生效中，需重新「应用」才会写入 Agent 配置'
            : '已更新模型服务'
          : '已新增模型服务',
      );
      void refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [currentStore.providers, draft, editingId, refresh, showToast]);

  // 「先看后切」：清单「生效」单选只打开预览弹窗，确认后才写入 agent 配置（借鉴 cc-switch）
  const doApply = useCallback(
    async (p: Provider) => {
      setApplyTarget(null);
      setBusy(true);
      try {
        const result = await applyProvider(p);
        if (!result.ok) {
          showToast(`应用失败：${result.message}`, 'err');
          return;
        }
        const next = await setActive(p.agent, p.id);
        setStore(next);
        const reads = await readAllCurrent(PROVIDER_AGENTS, undefined, next);
        setCurrent(reads);
        showToast(result.message);
      } catch (e) {
        showToast(`应用失败：${e instanceof Error ? e.message : String(e)}`, 'err');
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
        showToast(`删除失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  const exportAll = useCallback(() => {
    if (currentStore.providers.length === 0) {
      showToast('清单为空，无可导出内容', 'err');
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
          showToast(`导入失败：${result.error}`, 'err');
          return;
        }
        await saveStore(result.store);
        setStore(result.store);
        showToast(`已导入 ${result.imported} 个模型服务（同 ID 已覆盖）`);
        void refresh();
      } catch (e) {
        showToast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      } finally {
        setBusy(false);
      }
    },
    [currentStore, refresh, showToast],
  );

  // 空状态主行动：把 agent 配置文件里已有的模型服务读进来登记（借鉴 cc-switch 空状态即引导）
  const importCurrent = useCallback(
    async (agent: AgentId) => {
      const read = current[agent];
      if (!read?.found) return;
      setBusy(true);
      try {
        const provider = createProvider(
          {
            name: `${agentById(agent).name} 当前配置`,
            agent,
            baseUrl: read.current.baseUrl ?? '',
            apiKey: '', // 安全起见不代为搬运明文 Key，用户编辑时自行补
            model: read.current.model ?? '',
            api: 'openai-responses',
          },
          new Date(),
          currentStore.providers.map((p) => p.id),
        );
        if (validateProvider(provider).length > 0) {
          showToast('当前配置缺少 baseUrl，无法导入', 'err');
          return;
        }
        await upsertProvider(provider);
        showToast(`已导入 ${agentById(agent).name} 的当前配置（请补充 API Key）`);
        void refresh();
      } catch (e) {
        showToast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      } finally {
        setBusy(false);
      }
    },
    [current, currentStore.providers, refresh, showToast],
  );

  const total = currentStore.providers.length;
  // 空状态下可「导入文件中的当前配置」的 agent（筛选到单个 agent 时只留它）
  const importableAgents = PROVIDER_AGENTS.filter(
    (a) =>
      current[a]?.found &&
      (agentFilter === 'all' || agentFilter === a) &&
      !currentStore.providers.some((p) => p.agent === a),
  );

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
          {toast && (
            <span
              className={`font-medium ${
                toast.tone === 'err' ? 'text-destructive' : 'text-success'
              }`}
            >
              {toast.msg}
            </span>
          )}
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

      {/* Agent 筛选 pills */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {(['all', ...PROVIDER_AGENTS] as const).map((id) => {
          const selected = agentFilter === id;
          const count =
            id === 'all'
              ? total
              : currentStore.providers.filter((p) => p.agent === id).length;
          return (
            <button
              key={id}
              onClick={() => setAgentFilter(id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                selected
                  ? 'border-primary/60 bg-primary/10 font-medium text-primary'
                  : 'border-input text-muted-foreground hover:bg-accent'
              }`}
            >
              {id === 'all' ? '全部' : agentById(id).name}
              <span className="ml-1 font-mono text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {store === null ? (
          <div className="py-16 text-center text-xs text-muted-foreground">读取中…</div>
        ) : visibleProviders.length === 0 ? (
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-xs text-muted-foreground">
              <Server className="h-4 w-4" />
              {total === 0
                ? '还没有模型服务。新增后可一键写入对应 Agent 的配置文件。'
                : '该 Agent 下暂无模型服务。'}
              {importableAgents.map((a) => (
                <button
                  key={a}
                  onClick={() => void importCurrent(a)}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-input px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  导入 {agentById(a).name} 文件中的当前配置
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ProviderTable
            store={currentStore}
            providers={visibleProviders}
            busy={busy}
            onApply={setApplyTarget}
            onEdit={openEdit}
            onDelete={(p) => void deleteOne(p)}
            onTest={(p) => void testOne(p)}
            testingId={rowTestingId}
            testResults={rowTestResults}
          />
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center border-t bg-card px-3 text-xs text-muted-foreground">
        「应用」会写入该 Agent 的配置文件并标记为当前；Claude 合并 env、Codex 行级改写 TOML、Pi upsert
        models.json。Cursor / Gemini 暂不支持写入。
      </div>

      {/* 应用确认弹窗（P0-2 先看后切） */}
      {applyTarget && (
        <ConfirmApplyDialog
          title={`应用模型服务「${applyTarget.name}」`}
          preview={
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">目标 Agent</span>
                <span className="font-medium">{agentById(applyTarget.agent).name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">配置文件</span>
                <code className="truncate font-mono text-[11px]">
                  {providerTarget(applyTarget.agent).file}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">Base URL</span>
                <code className="truncate font-mono text-[11px]">{applyTarget.baseUrl}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">模型</span>
                <span className="font-mono text-[11px]">
                  {applyTarget.model || '未指定'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">API Key</span>
                <span className="font-mono text-[11px]">{maskKey(applyTarget.apiKey)}</span>
              </div>
            </div>
          }
          consequences={[
            `写入 ${agentById(applyTarget.agent).name} 的配置文件并设为当前生效`,
            '原文件内容自动备份到 ~/.ai-baogongtou/provider-backups/',
            '生效方式因 Agent 而异：Claude 即时热重载，Codex / Pi 需重开会话',
          ]}
          confirmLabel="确认应用"
          busy={busy}
          onConfirm={() => void doApply(applyTarget)}
          onCancel={() => setApplyTarget(null)}
        />
      )}

      {/* 新增 / 编辑弹窗 */}
      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            // 防止误点遮罩丢失表单
            if (window.confirm('放弃当前编辑内容？')) setDraft(null);
          }}
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
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">预设模板</span>
                <select
                  value={presetId}
                  onChange={(e) => applyPreset(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="custom">自定义（手动填写）</option>
                  {PROVIDER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {presetId !== 'custom' && presetById(presetId)?.site && (
                  <a
                    href={presetById(presetId)!.site}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[11px] text-primary hover:underline"
                  >
                    去 {presetById(presetId)!.name} 获取 API Key →
                  </a>
                )}
              </label>
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
                  {PROVIDER_AGENTS.map((id) => (
                    <option key={id} value={id}>
                      {agentById(id).name}
                      {PROVIDER_TARGETS[id].writable ? '' : `（${UNSUPPORTED_NOTE}）`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Base URL *</span>
                <div className="flex gap-1.5">
                  <input
                    value={draft.baseUrl}
                    onChange={(e) => {
                      setDraft({ ...draft, baseUrl: e.target.value });
                      setTestMsg(null);
                    }}
                    placeholder="https://api.example.com"
                    spellCheck={false}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => void runTest()}
                    disabled={testing || !draft.baseUrl.trim()}
                    title="测试端点连通性与延迟"
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-[11px] transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    {testing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Gauge className="h-3 w-3" />
                    )}
                    测速
                  </button>
                </div>
                {testMsg && (
                  <div
                    className={`text-[11px] ${testMsg.ok ? 'text-success' : 'text-warning'}`}
                  >
                    {testMsg.text}
                  </div>
                )}
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
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-xs text-muted-foreground">
                  模型列表（可选，一个服务可挂多个模型；★ 为默认模型；可从拉取列表选择或手动输入）
                </span>
                {(draft.models ?? []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(draft.models ?? []).map((m) => {
                      const isDefault =
                        draft.model === m ||
                        (!draft.model && m === (draft.models ?? [])[0]);
                      return (
                        <span
                          key={m}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px]"
                        >
                          <button
                            type="button"
                            onClick={() => setDefaultModel(m)}
                            title={isDefault ? '默认模型' : '设为默认模型'}
                            aria-label={`将 ${m} 设为默认模型`}
                            className="shrink-0 text-muted-foreground/60 transition-colors hover:text-primary"
                          >
                            <Star
                              className={`h-3 w-3 ${isDefault ? 'fill-primary text-primary' : ''}`}
                            />
                          </button>
                          <span className="max-w-52 truncate font-mono">{m}</span>
                          <button
                            type="button"
                            onClick={() => removeModel(m)}
                            title="移除该模型"
                            aria-label={`移除模型 ${m}`}
                            className="shrink-0 text-muted-foreground/60 transition-colors hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addModel(e.target.value);
                    }}
                    disabled={modelsList.length === 0}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <option value="">
                      {modelsList.length > 0
                        ? `从拉取结果中选择（${modelsList.filter((m) => !(draft.models ?? []).includes(m)).length} 个可添加）…`
                        : '先点击右侧「拉取」获取模型列表'}
                    </option>
                    {modelsList
                      .filter((m) => !(draft.models ?? []).includes(m))
                      .map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void pullModels()}
                    disabled={fetchingModels || !draft.baseUrl.trim()}
                    title="从该供应商拉取模型列表（/v1/models）"
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-[11px] transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ListPlus className="h-3 w-3" />
                    )}
                    拉取
                  </button>
                  <input
                    value={manualModel}
                    onChange={(e) => setManualModel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addModel(manualModel.trim());
                        setManualModel('');
                      }
                    }}
                    placeholder="手动输入模型名"
                    spellCheck={false}
                    className="h-8 w-36 shrink-0 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      addModel(manualModel.trim());
                      setManualModel('');
                    }}
                    disabled={!manualModel.trim()}
                    title="手动添加模型名（拉取接口不兼容时使用）"
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-input px-2 text-[11px] transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    添加
                  </button>
                </div>
                {modelsMsg && (
                  <div className="text-[11px] text-muted-foreground">{modelsMsg}</div>
                )}
              </div>

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

            {!PROVIDER_TARGETS[draft.agent]?.writable && (
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
