import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../hooks/useToast';
import {
  AlertTriangle,
  CircleAlert,
  Copy as CopyIcon,
  Download,
  Layers,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import ConfirmApplyDialog from '../components/ConfirmApplyDialog';
import { agentShortName, type AgentId } from '../lib/agents';
import { PROMPT_TARGETS } from '../lib/agentTargets';
import { PROVIDER_TARGETS, type ProviderTarget } from '../lib/providerTargets';
import { useAgents } from '../hooks/useAgents';
import {
  addProfile,
  duplicateProfile,
  emptyProfileStore,
  mergeProfileStores,
  parseProfiles,
  removeProfile,
  serializeProfiles,
  summarizeProfile,
  updateProfile,
  validateProfileDraft,
  type Profile,
  type ProfileDraft,
  type ProfileStore,
} from '../lib/profiles';
import type { PromptLibrary } from '../lib/prompts';
import { scanAll } from '../services/agentSkills';
import { scanMcp } from '../services/agentMcp';
import { loadPromptLibrary } from '../services/agentPrompts';
import { loadStore as loadProviderStore } from '../services/providers';
import type { ProviderStore } from '../lib/providers';
import { applyProfile, loadProfiles, saveProfiles } from '../services/profiles';
import { isTauri } from '@tauri-apps/api/core';

interface DraftState {
  name: string;
  description: string;
  skills: string[];
  mcpServers: string[];
  prompts: Partial<Record<AgentId, string>>;
  providers: Partial<Record<AgentId, string>>;
}

interface ModalState {
  mode: 'create' | 'edit';
  /** 编辑时的套餐 id */
  id?: string;
  draft: DraftState;
  error: string;
}

interface ApplyReport {
  profileName: string;
  applied: string[];
  errors: string[];
}

const emptyDraft = (): DraftState => ({
  name: '',
  description: '',
  skills: [],
  mcpServers: [],
  prompts: {},
  providers: {},
});

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function draftOf(profile: Profile): DraftState {
  return {
    name: profile.name,
    description: profile.description ?? '',
    skills: [...profile.skills],
    mcpServers: [...profile.mcpServers],
    prompts: { ...profile.prompts },
    providers: { ...(profile.providers ?? {}) },
  };
}

function toDraft(d: DraftState): ProfileDraft {
  return {
    name: d.name,
    description: d.description,
    skills: d.skills,
    mcpServers: d.mcpServers,
    prompts: d.prompts,
    providers: d.providers,
  };
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export default function ProfilesPage() {
  const [store, setStore] = useState<ProfileStore>(emptyProfileStore());
  const [loaded, setLoaded] = useState(false);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [mcpNames, setMcpNames] = useState<string[]>([]);
  const [promptLib, setPromptLib] = useState<PromptLibrary | null>(null);
  const [providerStore, setProviderStore] = useState<ProviderStore>({ providers: [], active: {} });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [applyTarget, setApplyTarget] = useState<Profile | null>(null);
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast, showToast } = useToast(2800);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name'>('name');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const visibleAgents = useAgents();
  // 套餐只开放「可写」的 agent：提示词走 PROMPT_TARGETS，模型服务走 PROVIDER_TARGETS
  const promptAgents = visibleAgents.filter(
    (a) => PROMPT_TARGETS.find((t) => t.agent === a.id)?.writable === true,
  );
  const providerTargets = PROVIDER_TARGETS as Partial<Record<AgentId, ProviderTarget>>;
  const providerAgents = visibleAgents.filter(
    (a) => providerTargets[a.id]?.writable === true,
  );

  const notify = useCallback(
    (msg: string, ok = true) => showToast(msg, ok ? 'ok' : 'err'),
    [showToast],
  );

  const refresh = useCallback(async () => {
    setError('');
    const [storeRes, skillsRes, mcpRes, libRes, providerRes] = await Promise.allSettled([
      loadProfiles(),
      scanAll(),
      scanMcp(),
      loadPromptLibrary(),
      loadProviderStore(),
    ]);
    if (storeRes.status === 'fulfilled') {
      setStore(storeRes.value);
    } else {
      setStore(emptyProfileStore());
      setError(errorText(storeRes.reason));
    }
    setSkillNames(
      skillsRes.status === 'fulfilled'
        ? [...skillsRes.value.librarySkills].sort((a, b) => a.localeCompare(b))
        : [],
    );
    setMcpNames(
      mcpRes.status === 'fulfilled'
        ? mcpRes.value.manifest.servers.map((s) => s.name).sort((a, b) => a.localeCompare(b))
        : [],
    );
    setPromptLib(libRes.status === 'fulfilled' ? libRes.value : null);
    setProviderStore(
      providerRes.status === 'fulfilled' ? providerRes.value : { providers: [], active: {} },
    );
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 保存前重读磁盘上的最新 store 再应用变更，避免内存旧数据覆盖外部修改
  const persist = useCallback(
    async (mutate: (fresh: ProfileStore) => ProfileStore, okMsg: string) => {
      setBusy(true);
      try {
        const fresh = await loadProfiles();
        const next = mutate(fresh);
        await saveProfiles(next);
        setStore(next);
        notify(okMsg);
      } catch (e) {
        notify(`保存失败：${errorText(e)}`, false);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const openCreate = useCallback(() => {
    setModal({ mode: 'create', draft: emptyDraft(), error: '' });
  }, []);

  const openEdit = useCallback((profile: Profile) => {
    setModal({ mode: 'edit', id: profile.id, draft: draftOf(profile), error: '' });
  }, []);

  const saveModal = useCallback(async () => {
    if (!modal) return;
    const draft = toDraft(modal.draft);
    const v = validateProfileDraft(draft, store.profiles, modal.mode === 'edit' ? modal.id : undefined);
    if (!v.ok) {
      setModal({ ...modal, error: v.errors.join('；') });
      return;
    }
    setBusy(true);
    try {
      // 保存前重读磁盘上的最新 store，重名/不存在等冲突按最新数据判定
      const fresh = await loadProfiles();
      const next =
        modal.mode === 'edit' && modal.id
          ? updateProfile(fresh, modal.id, draft)
          : addProfile(fresh, draft).store;
      await saveProfiles(next);
      setStore(next);
      setModal(null);
      notify(modal.mode === 'edit' ? '已保存套餐' : '已创建套餐');
    } catch (e) {
      setModal({ ...modal, error: errorText(e) });
    } finally {
      setBusy(false);
    }
  }, [modal, notify, store]);

  const duplicate = useCallback(
    (profile: Profile) => {
      void persist(
        (fresh) => duplicateProfile(fresh, profile.id).store,
        `已复制「${profile.name}」`,
      );
    },
    [persist],
  );

  const remove = useCallback(
    (profile: Profile) => {
      if (!window.confirm(`删除套餐「${profile.name}」？已应用到 agent 的配置不受影响。`)) return;
      void persist((fresh) => removeProfile(fresh, profile.id), '已删除套餐');
    },
    [persist],
  );

  // 「先看后切」：卡片「应用」只打开预览弹窗，真正写入在弹窗确认后执行（借鉴 cc-switch）
  const doApply = useCallback(
    async (profile: Profile) => {
      setApplyTarget(null);
      setBusy(true);
      setReport(null);
      try {
        const result = await applyProfile(profile);
        setReport({ profileName: profile.name, ...result });
        notify(
          result.errors.length > 0
            ? `应用完成，有 ${result.errors.length} 个问题`
            : '套餐已应用',
          result.errors.length === 0,
        );
        setPromptLib(await loadPromptLibrary());
      } catch (e) {
        notify(`应用失败：${errorText(e)}`, false);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const exportJson = useCallback(() => {
    const text = serializeProfiles(store);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-baogongtou-profiles-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [store]);

  const importJson = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const incoming = parseProfiles(await file.text());
        // 保存前重读磁盘上的最新 store，避免覆盖外部修改
        const fresh = await loadProfiles();
        const { store: merged, added } = mergeProfileStores(fresh, incoming);
        await saveProfiles(merged);
        setStore(merged);
        // 引用体检：导入的套餐可能引用本机不存在的 skill/MCP/提示词/模型服务 id
        const skillSet = new Set(skillNames);
        const mcpSet = new Set(mcpNames);
        const promptIds = new Set((promptLib?.prompts ?? []).map((p) => p.id));
        const providerIds = new Set(providerStore.providers.map((p) => p.id));
        let dangling = 0;
        for (const p of added) {
          dangling += p.skills.filter((s) => !skillSet.has(s)).length;
          dangling += p.mcpServers.filter((s) => !mcpSet.has(s)).length;
          dangling += Object.values(p.prompts).filter(
            (id): id is string => typeof id === 'string' && !promptIds.has(id),
          ).length;
          dangling += Object.values(p.providers ?? {}).filter(
            (id): id is string => typeof id === 'string' && !providerIds.has(id),
          ).length;
        }
        notify(
          dangling > 0
            ? `已导入 ${added.length} 个套餐，其中 ${dangling} 条引用（skill/MCP/提示词/模型服务）在本机不存在，应用时会跳过`
            : `已导入 ${added.length} 个套餐`,
          dangling === 0,
        );
      } catch (e) {
        notify(`导入失败：${errorText(e)}`, false);
      } finally {
        setBusy(false);
      }
    },
    [mcpNames, notify, promptLib, providerStore, skillNames],
  );

  const profiles = store.profiles;
  // 卡片搜索（名称/描述，大小写不敏感）+ 排序（目前仅按名称）
  const visibleProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? profiles.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description ?? '').toLowerCase().includes(q),
        )
      : profiles;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, query, sortBy]);
  const promptName = (id: string): string =>
    promptLib?.prompts.find((p) => p.id === id)?.name ?? `未知(${id})`;

  const providerName = (id: string): string =>
    providerStore.providers.find((p) => p.id === id)?.name ?? `未知(${id})`;

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton primary onClick={openCreate} disabled={busy || !loaded}>
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          新建套餐
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => fileInput.current?.click()} disabled={busy}>
          <Upload className="mr-1 inline h-3.5 w-3.5" />
          导入 JSON
        </ToolbarButton>
        <ToolbarButton onClick={exportJson} disabled={busy}>
          <Download className="mr-1 inline h-3.5 w-3.5" />
          导出 JSON
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
          刷新
        </ToolbarButton>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
        <ToolbarDivider />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索套餐…"
          className="h-8 w-40 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'name')}
          title="排序方式"
          aria-label="排序方式"
          className="h-8 rounded-md border border-input bg-transparent px-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="name">按名称</option>
        </select>
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

      {report && (
        <div className="shrink-0 border-b bg-muted/40 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            {report.errors.length > 0 ? (
              <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : (
              <Layers className="h-3.5 w-3.5 shrink-0 text-success" />
            )}
            <span className="font-medium">
              应用「{report.profileName}」：成功 {report.applied.length} 项，失败{' '}
              {report.errors.length} 项
            </span>
            <button
              onClick={() => setReport(null)}
              className="ml-auto rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="关闭应用结果"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {report.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 pl-5 text-destructive">
              {report.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {report.applied.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 pl-5 text-muted-foreground">
              {report.applied.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-3">
        {profiles.length > 0 && visibleProfiles.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground">
            没有匹配的套餐
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-xs text-muted-foreground">
            <Layers className="h-6 w-6 opacity-40" />
            <div>{loaded ? '还没有配置套餐' : '读取中…'}</div>
            {loaded && (
              <button
                onClick={openCreate}
                className="mt-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                新建第一个套餐
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleProfiles.map((profile) => {
              const promptRows = Object.entries(profile.prompts) as [AgentId, string][];
              const providerRows = Object.entries(profile.providers ?? {}) as [AgentId, string][];
              return (
                <div
                  key={profile.id}
                  className="group flex flex-col rounded-lg border bg-card p-3 shadow-sm"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{profile.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {summarizeProfile(profile)}
                      </div>
                    </div>
                  </div>

                  {profile.description && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {profile.description}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1">
                    {profile.skills.slice(0, 4).map((s) => (
                      <span
                        key={`s-${s}`}
                        className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                        title={`Skill: ${s}`}
                      >
                        {s}
                      </span>
                    ))}
                    {profile.skills.length > 4 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        +{profile.skills.length - 4}
                      </span>
                    )}
                    {profile.mcpServers.map((m) => (
                      <span
                        key={`m-${m}`}
                        className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary"
                        title={`MCP: ${m}`}
                      >
                        {m}
                      </span>
                    ))}
                  </div>

                  {promptRows.length > 0 && (
                    <div className="mt-2 space-y-0.5 border-t pt-2 text-[11px] text-muted-foreground">
                      {promptRows.map(([agent, id]) => (
                        <div key={agent} className="flex items-center gap-1 truncate">
                          <span className="w-12 shrink-0 font-medium">
                            {agentShortName(agent)}
                          </span>
                          <span className="truncate">{promptName(id)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {providerRows.length > 0 && (
                    <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                      {providerRows.map(([agent, id]) => (
                        <div key={`p-${agent}`} className="flex items-center gap-1 truncate">
                          <span className="w-12 shrink-0 font-medium">
                            {agentShortName(agent)}
                          </span>
                          <span className="truncate">{providerName(id)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex items-center gap-1.5 pt-3">
                    <button
                      disabled={busy}
                      onClick={() => setApplyTarget(profile)}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      应用
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => openEdit(profile)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs opacity-0 transition-all hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                    >
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => duplicate(profile)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs opacity-0 transition-all hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                    >
                      <CopyIcon className="h-3 w-3" />
                      复制
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => remove(profile)}
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-2 border-t bg-card px-3 text-[11px] text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-warning-foreground" />
        应用套餐 = 按套餐重算可见 agent 的 Skills / MCP / 提示词 / 模型服务；覆盖前自动备份，部分失败会逐条列出
        <span className="ml-auto">
          套餐文件 ~/.ai-baogongtou/profiles.json · 共 {profiles.length} 个
        </span>
      </div>

      {applyTarget && (
        <ConfirmApplyDialog
          title={`应用套餐「${applyTarget.name}」`}
          preview={
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
                  Skills
                  <span className="ml-1 font-mono font-medium">
                    {applyTarget.skills.length}
                  </span>{' '}
                  个（重算可见 agent 的软链）
                </div>
                <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
                  MCP server
                  <span className="ml-1 font-mono font-medium">
                    {applyTarget.mcpServers.length}
                  </span>{' '}
                  个（写回配置）
                </div>
                <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
                  提示词
                  <span className="ml-1 font-mono font-medium">
                    {Object.keys(applyTarget.prompts).length}
                  </span>{' '}
                  条
                </div>
                <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
                  模型服务
                  <span className="ml-1 font-mono font-medium">
                    {Object.keys(applyTarget.providers ?? {}).length}
                  </span>{' '}
                  条
                </div>
              </div>
              {applyTarget.description && (
                <p className="text-muted-foreground">{applyTarget.description}</p>
              )}
            </div>
          }
          consequences={[
            '按套餐重算可见 agent 的 Skills / MCP / 提示词 / 模型服务',
            'Skills 只增删软链，真实目录不会被覆盖；被覆盖的配置文件会先自动备份',
            '部分失败会逐条列出，不影响其他项',
          ]}
          confirmLabel="确认应用套餐"
          busy={busy}
          onConfirm={() => void doApply(applyTarget)}
          onCancel={() => setApplyTarget(null)}
        />
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border bg-card shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">
                {modal.mode === 'edit' ? '编辑套餐' : '新建套餐'}
              </span>
              <button
                onClick={() => setModal(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    套餐名称 *
                  </span>
                  <input
                    value={modal.draft.name}
                    onChange={(e) =>
                      setModal({ ...modal, draft: { ...modal.draft, name: e.target.value } })
                    }
                    placeholder="如：日常开发"
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">描述</span>
                  <input
                    value={modal.draft.description}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        draft: { ...modal.draft, description: e.target.value },
                      })
                    }
                    placeholder="这个套餐解决什么问题"
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
              </div>

              <section>
                <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  Skills（中央库）
                  <span className="font-normal">
                    已选 {modal.draft.skills.length} / 共 {skillNames.length}
                  </span>
                </div>
                {skillNames.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                    中央库暂无 skill（先在 Skills 管理页安装/收编）
                  </div>
                ) : (
                  <div className="grid max-h-36 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
                    {skillNames.map((s) => (
                      <label
                        key={s}
                        className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-accent/50"
                      >
                        <input
                          type="checkbox"
                          checked={modal.draft.skills.includes(s)}
                          onChange={() =>
                            setModal({
                              ...modal,
                              draft: {
                                ...modal.draft,
                                skills: toggle(modal.draft.skills, s),
                              },
                            })
                          }
                          className="h-3.5 w-3.5"
                        />
                        <span className="truncate font-mono text-[11px]">{s}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  MCP Servers（中央清单）
                  <span className="font-normal">
                    已选 {modal.draft.mcpServers.length} / 共 {mcpNames.length}
                  </span>
                </div>
                {mcpNames.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                    中央清单暂无 server（先在 MCP 管理页扫描/新增）
                  </div>
                ) : (
                  <div className="grid max-h-36 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
                    {mcpNames.map((m) => (
                      <label
                        key={m}
                        className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-accent/50"
                      >
                        <input
                          type="checkbox"
                          checked={modal.draft.mcpServers.includes(m)}
                          onChange={() =>
                            setModal({
                              ...modal,
                              draft: {
                                ...modal.draft,
                                mcpServers: toggle(modal.draft.mcpServers, m),
                              },
                            })
                          }
                          className="h-3.5 w-3.5"
                        />
                        <span className="truncate font-mono text-[11px]">{m}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                  提示词（每 agent 一条，可不选）
                </div>
                <div className="space-y-1">
                  {(() => {
                    // 可写的可见 agent；draft 里已有的（如导入的）agent 也保留一行以便查看/清除
                    const rows = promptAgents.map((a) => a.id);
                    for (const key of Object.keys(modal.draft.prompts)) {
                      if (!rows.includes(key)) rows.push(key);
                    }
                    return rows.map((agentId) => {
                      const value = modal.draft.prompts[agentId] ?? '';
                      const options = promptLib?.prompts ?? [];
                      const unknown = value !== '' && !options.some((p) => p.id === value);
                      return (
                        <div key={agentId} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-xs">
                            {agentShortName(agentId)}
                          </span>
                          <select
                            value={value}
                            onChange={(e) => {
                              const prompts = { ...modal.draft.prompts };
                              if (e.target.value) prompts[agentId] = e.target.value;
                              else delete prompts[agentId];
                              setModal({ ...modal, draft: { ...modal.draft, prompts } });
                            }}
                            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="">不设置</option>
                            {unknown && <option value={value}>{promptName(value)}</option>}
                            {options.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    });
                  })()}
                </div>
              </section>

              <section>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                  模型服务（每 agent 一条，可不选）
                </div>
                <div className="space-y-1">
                  {(() => {
                    // 可写的可见 agent；draft 里已有的（如导入的）agent 也保留一行以便查看/清除
                    const rows = providerAgents.map((a) => a.id);
                    for (const key of Object.keys(modal.draft.providers)) {
                      if (!rows.includes(key)) rows.push(key);
                    }
                    return rows.map((agentId) => {
                      const value = modal.draft.providers[agentId] ?? '';
                      const options = providerStore.providers.filter(
                        (p) => p.agent === agentId,
                      );
                      const unknown = value !== '' && !options.some((p) => p.id === value);
                      return (
                        <div key={`provider-${agentId}`} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-xs">
                            {agentShortName(agentId)}
                          </span>
                          <select
                            value={value}
                            onChange={(e) => {
                              const providers = { ...modal.draft.providers };
                              if (e.target.value) providers[agentId] = e.target.value;
                              else delete providers[agentId];
                              setModal({ ...modal, draft: { ...modal.draft, providers } });
                            }}
                            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="">不设置</option>
                            {unknown && <option value={value}>{providerName(value)}</option>}
                            {options.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    });
                  })()}
                </div>
              </section>

              {modal.error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {modal.error}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
              <button
                onClick={() => setModal(null)}
                className="h-8 rounded-md border border-input px-3 text-xs transition-colors hover:bg-accent"
              >
                取消
              </button>
              <button
                disabled={busy}
                onClick={() => void saveModal()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}