import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { useFileWatch } from '../hooks/useFileWatch';
import {
  BookOpen,
  CircleCheck,
  Copy as CopyIcon,
  Eraser,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import type { AgentId } from '../lib/agents';
import { AGENTS } from '../lib/agents';
import { PROMPT_TARGETS } from '../lib/agentTargets';
import { useAgents } from '../hooks/useAgents';
import {
  addPrompt,
  duplicatePrompt,
  emptyPromptLibrary,
  nextAvailableName,
  removePrompt,
  updatePrompt,
  validatePromptDraft,
  type PromptEntry,
  type PromptLibrary,
} from '../lib/prompts';
import {
  applyPrompt,
  clearPrompt,
  loadPromptLibrary,
  promptFilePath,
  readCurrentPrompt,
  savePromptLibrary,
} from '../services/agentPrompts';
import { isTauri } from '@tauri-apps/api/core';

interface AgentFileState {
  path: string;
  exists: boolean;
  chars: number;
  /** 最近一次读到的磁盘内容，用于回声过滤（自己写入触发的 fs 事件直接忽略） */
  text: string | null;
}

const ERR_HINT = '（此功能仅在桌面 App 中可用）';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function PromptsPage() {
  // 提示词只支持有落盘文件的 agent(PROMPT_TARGETS),且在可见列表内
  // useMemo 稳定引用:inline filter 每次渲染都是新数组,喂给 hook 依赖会造成无限循环(见 MCP 页 451a043)
  const agents = useAgents();
  const visibleAgents = useMemo(
    () => agents.filter((a) => PROMPT_TARGETS.some((t) => t.agent === a.id)),
    [agents],
  );
  const [lib, setLib] = useState<PromptLibrary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agentFiles, setAgentFiles] = useState<Partial<Record<AgentId, AgentFileState>>>({});
  const { toast, showToast } = useToast(2600);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'updated'>('name');
  /** 外部变更高亮的 agent（5 秒后自动消退，ColaMD 式环境化指示） */
  const [externalChanged, setExternalChanged] = useState<ReadonlySet<AgentId>>(new Set());
  const agentFilesRef = useRef(agentFiles);
  agentFilesRef.current = agentFiles;
  /** 自己写入的时间戳：fs watch 回声在此短窗口内直接忽略 */
  const recentWritesRef = useRef(new Map<AgentId, number>());
  /** 外部变更高亮的消退计时器（卸载时统一清理） */
  const highlightTimersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const t of highlightTimersRef.current) window.clearTimeout(t);
    },
    [],
  );

  const notify = useCallback(
    (msg: string, ok = true) => showToast(msg, ok ? 'ok' : 'err'),
    [showToast],
  );

  const populate = useCallback((prompt: PromptEntry | null) => {
    setSelectedId(prompt?.id ?? null);
    setName(prompt?.name ?? '');
    setDescription(prompt?.description ?? '');
    setContent(prompt?.content ?? '');
    setDirty(false);
  }, []);

  const loadAgentFiles = useCallback(async () => {
    const next: Partial<Record<AgentId, AgentFileState>> = {};
    for (const target of PROMPT_TARGETS) {
      if (!target.writable || !target.file) continue;
      let path: string = target.file;
      try {
        path = await promptFilePath(target.agent);
      } catch {
        // 非 Tauri 环境取不到 home，仍显示相对路径
      }
      try {
        const text = await readCurrentPrompt(target.agent);
        next[target.agent] = { path, exists: text !== null, chars: text?.length ?? 0, text };
      } catch {
        next[target.agent] = { path, exists: false, chars: 0, text: null };
      }
    }
    setAgentFiles(next);
  }, []);

  const loadAndSelectFirst = useCallback(async () => {
    setError('');
    try {
      const loaded = await loadPromptLibrary();
      setLib(loaded);
      populate(loaded.prompts[0] ?? null);
      await loadAgentFiles();
    } catch (e) {
      setLib(emptyPromptLibrary());
      setError(errorText(e));
    }
  }, [loadAgentFiles, populate]);

  useEffect(() => {
    void loadAndSelectFirst();
  }, [loadAndSelectFirst]);

  // ---------- 磁盘变更自动同步（P0-1，借鉴 ColaMD） ----------
  const watchedPaths = visibleAgents
    .map((a) => agentFiles[a.id]?.path)
    .filter((p): p is string => Boolean(p));

  const handleExternalChange = useCallback(
    async (path: string, kind: 'modified' | 'removed') => {
      const target = PROMPT_TARGETS.find(
        (t) => t.writable && agentFilesRef.current[t.agent]?.path === path,
      );
      if (!target) return;
      // 自己写入触发的回声：写入后短窗口内的事件直接忽略，避免误报「外部修改」
      const lastWrite = recentWritesRef.current.get(target.agent);
      if (lastWrite !== undefined && Date.now() - lastWrite < 1500) return;
      let text: string | null = null;
      try {
        text = await readCurrentPrompt(target.agent);
      } catch {
        text = null;
      }
      if (text === (agentFilesRef.current[target.agent]?.text ?? null)) return; // 自己写入的回声
      setAgentFiles((cur) => ({
        ...cur,
        [target.agent]: { path, exists: text !== null, chars: text?.length ?? 0, text },
      }));
      setExternalChanged((cur) => new Set(cur).add(target.agent));
      const timer = window.setTimeout(() => {
        setExternalChanged((cur) => {
          const next = new Set(cur);
          next.delete(target.agent);
          return next;
        });
      }, 5000);
      highlightTimersRef.current.push(timer);
      notify(
        `${target.agent} 的提示词文件已被外部${kind === 'removed' ? '删除' : '修改'}，状态已同步`,
      );
    },
    [notify],
  );

  useFileWatch(watchedPaths, handleExternalChange);

  // 未保存修改时拦截关闭窗口
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const current = lib?.prompts.find((p) => p.id === selectedId) ?? null;

  const confirmDiscard = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm('当前修改尚未保存，确定放弃？');
  }, [dirty]);

  const selectPrompt = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      const prompt = lib?.prompts.find((p) => p.id === id);
      if (!prompt) return;
      if (!confirmDiscard()) return;
      populate(prompt);
    },
    [confirmDiscard, lib, populate, selectedId],
  );

  const save = useCallback(async () => {
    if (!lib || !selectedId) return;
    const draft = { name, content, description };
    const v = validatePromptDraft(draft);
    if (!v.ok) {
      notify(v.errors.join('；'), false);
      return;
    }
    setBusy(true);
    try {
      // 保存前重读磁盘上的最新库再合并，避免内存旧库覆盖外部修改
      const fresh = await loadPromptLibrary();
      const next = updatePrompt(fresh, selectedId, draft);
      await savePromptLibrary(next);
      setLib(next);
      setDirty(false);
      notify('已保存到提示词库');
    } catch (e) {
      notify(`保存失败：${errorText(e)}`, false);
    } finally {
      setBusy(false);
    }
  }, [content, description, lib, name, notify, selectedId]);

  const create = useCallback(async () => {
    if (!lib || !confirmDiscard()) return;
    setBusy(true);
    try {
      const fresh = await loadPromptLibrary();
      const promptName = nextAvailableName(
        '未命名提示词',
        fresh.prompts.map((p) => p.name),
      );
      const { library, prompt } = addPrompt(fresh, {
        name: promptName,
        content: '# 新提示词\n\n',
        description: '',
      });
      await savePromptLibrary(library);
      setLib(library);
      populate(prompt);
      notify('已新建提示词');
    } catch (e) {
      notify(`新建失败：${errorText(e)}`, false);
    } finally {
      setBusy(false);
    }
  }, [confirmDiscard, lib, notify, populate]);

  const duplicate = useCallback(async () => {
    if (!lib || !selectedId || !confirmDiscard()) return;
    setBusy(true);
    try {
      const fresh = await loadPromptLibrary();
      const { library, prompt } = duplicatePrompt(fresh, selectedId);
      await savePromptLibrary(library);
      setLib(library);
      populate(prompt);
      notify('已复制提示词');
    } catch (e) {
      notify(`复制失败：${errorText(e)}`, false);
    } finally {
      setBusy(false);
    }
  }, [confirmDiscard, lib, notify, populate, selectedId]);

  const remove = useCallback(async () => {
    if (!lib || !selectedId) return;
    const target = lib.prompts.find((p) => p.id === selectedId);
    if (!target) return;
    if (!window.confirm(`删除提示词「${target.name}」？已写入 agent 的文件不受影响。`)) return;
    setBusy(true);
    try {
      const fresh = await loadPromptLibrary();
      const index = fresh.prompts.findIndex((p) => p.id === selectedId);
      if (index < 0) {
        // 已被外部删除，直接按最新库刷新
        setLib(fresh);
        populate(fresh.prompts[0] ?? null);
        notify('该提示词已不存在，已刷新列表', false);
        return;
      }
      const next = removePrompt(fresh, selectedId);
      await savePromptLibrary(next);
      setLib(next);
      const fallback = next.prompts[Math.min(index, next.prompts.length - 1)] ?? null;
      populate(fallback);
      notify('已删除');
    } catch (e) {
      notify(`删除失败：${errorText(e)}`, false);
    } finally {
      setBusy(false);
    }
  }, [lib, notify, populate, selectedId]);

  const applyToAgent = useCallback(
    async (agent: AgentId) => {
      if (!current) return;
      if (dirty) {
        notify('请先保存修改，再应用到 agent', false);
        return;
      }
      setBusy(true);
      try {
        recentWritesRef.current.set(agent, Date.now());
        const result = await applyPrompt(agent, current);
        // 先把预期新文本写进 ref，堵住 fs watch 回声比较旧值的时序窗口
        const written = current.content.endsWith('\n')
          ? current.content
          : `${current.content}\n`;
        const prev = agentFilesRef.current[agent];
        agentFilesRef.current = {
          ...agentFilesRef.current,
          [agent]: {
            path: prev?.path ?? result.file,
            exists: true,
            chars: written.length,
            text: written,
          },
        };
        await loadAgentFiles();
        setLib(await loadPromptLibrary());
        notify(
          `已写入 ${result.file}${result.backup ? '（原文件已备份）' : ''}`,
        );
      } catch (e) {
        notify(`写入失败：${errorText(e)}`, false);
      } finally {
        setBusy(false);
      }
    },
    [current, dirty, loadAgentFiles, notify],
  );

  const clearForAgent = useCallback(
    async (agent: AgentId) => {
      if (!window.confirm('清除提示词文件？若有备份将恢复最近一份备份。')) return;
      setBusy(true);
      try {
        recentWritesRef.current.set(agent, Date.now());
        const result = await clearPrompt(agent);
        await loadAgentFiles();
        setLib(await loadPromptLibrary());
        notify(
          result.restored
            ? `已恢复备份：${result.restored}`
            : `已清空${result.backup ? '（原内容已备份）' : ''}`,
        );
      } catch (e) {
        notify(`清除失败：${errorText(e)}`, false);
      } finally {
        setBusy(false);
      }
    },
    [loadAgentFiles, notify],
  );

  const prompts = lib?.prompts ?? [];
  // 列表搜索（名称/描述，大小写不敏感）+ 排序
  const visiblePrompts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? prompts.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description ?? '').toLowerCase().includes(q),
        )
      : prompts;
    return [...list].sort(
      sortBy === 'updated'
        ? (a, b) => b.updatedAt.localeCompare(a.updatedAt)
        : (a, b) => a.name.localeCompare(b.name),
    );
  }, [prompts, query, sortBy]);
  const activeFor = (agent: AgentId): string | undefined => lib?.active[agent];

  // 空状态主行动：把各 agent 现有的提示词文件（CLAUDE.md 等）一键收进库（借鉴 cc-switch 空状态即引导）
  const importFromAgents = useCallback(async () => {
    if (!lib) return;
    setBusy(true);
    try {
      let next = lib;
      let count = 0;
      for (const target of PROMPT_TARGETS) {
        if (!target.writable || !target.file) continue;
        if (!visibleAgents.some((a) => a.id === target.agent)) continue;
        const text = await readCurrentPrompt(target.agent);
        if (!text?.trim()) continue;
        const agentLabel = AGENTS.find((a) => a.id === target.agent)?.name ?? target.agent;
        const res = addPrompt(next, {
          name: nextAvailableName(
            `${agentLabel} 现有提示词`,
            next.prompts.map((p) => p.name),
          ),
          content: text,
          description: `从 ${target.file} 导入`,
        });
        next = res.library;
        count++;
      }
      if (count === 0) {
        notify('各 agent 都没有可导入的提示词文件', false);
        return;
      }
      await savePromptLibrary(next);
      setLib(next);
      populate(next.prompts[0] ?? null);
      notify(`已导入 ${count} 个 agent 的现有提示词`);
    } catch (e) {
      notify(`导入失败：${errorText(e)}`, false);
    } finally {
      setBusy(false);
    }
  }, [lib, notify, populate, visibleAgents]);

  return (
    <div className="flex h-full">
      {/* 左侧提示词库 */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            提示词库
          </span>
          <button
            onClick={() => void create()}
            disabled={busy || !lib}
            title="新建提示词"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索提示词…"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'updated')}
            title="排序方式"
            aria-label="排序方式"
            className="h-8 shrink-0 rounded-md border border-input bg-transparent px-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="name">按名称</option>
            <option value="updated">最近更新</option>
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {visiblePrompts.map((p) => {
            const used = Object.values(lib?.active ?? {}).filter((id) => id === p.id).length;
            return (
              <button
                key={p.id}
                onClick={() => selectPrompt(p.id)}
                className={`mb-1 flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors ${
                  p.id === selectedId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60'
                }`}
              >
                <span className="flex w-full items-center gap-1 text-[13px] font-medium">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="mt-0.5 flex w-full items-center gap-2 pl-5 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {p.description || new Date(p.updatedAt).toLocaleString()}
                  </span>
                  {used > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-success/15 px-1.5 text-success">
                      {used} 个 agent
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {lib && prompts.length > 0 && visiblePrompts.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              没有匹配的提示词
            </div>
          )}
          {lib && prompts.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              还没有提示词
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <button
                  onClick={() => void create()}
                  disabled={busy}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  新建第一个提示词
                </button>
                <button
                  onClick={() => void importFromAgents()}
                  disabled={busy}
                  className="rounded-md border border-input px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  从各 agent 导入现有文件
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          共 {prompts.length} 条 · 库文件 ~/.ai-baogongtou/prompts.json
        </div>
      </aside>

      {/* 右侧编辑器 + 应用区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            disabled={!current}
            placeholder="提示词名称"
            className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            disabled={!current}
            placeholder="描述（可选）"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <ToolbarButton
            primary
            onClick={() => void save()}
            disabled={busy || !current || !dirty}
            title="保存到提示词库"
          >
            <Save className="mr-1 inline h-3.5 w-3.5" />
            保存
          </ToolbarButton>
          <ToolbarButton
            onClick={() => void duplicate()}
            disabled={busy || !current}
            title="复制当前提示词"
          >
            <CopyIcon className="mr-1 inline h-3.5 w-3.5" />
            复制
          </ToolbarButton>
          <ToolbarButton
            onClick={() => void remove()}
            disabled={busy || !current}
            title="删除当前提示词"
          >
            <Trash2 className="mr-1 inline h-3.5 w-3.5" />
            删除
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            onClick={() => {
              if (confirmDiscard()) void loadAndSelectFirst();
            }}
            disabled={busy}
          >
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
            刷新
          </ToolbarButton>
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
            {!isTauri() && ERR_HINT}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col p-3">
          {current ? (
            <>
              <div className="mb-1.5 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span>Markdown 内容</span>
                {dirty && (
                  <span className="rounded-full bg-warning px-1.5 py-0.5 text-warning-foreground">
                    未保存
                  </span>
                )}
                <span className="ml-auto">
                  {content.length} 字符 · 更新于 {new Date(current.updatedAt).toLocaleString()}
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                placeholder="支持 Markdown / AGENTS.md 内容"
                className="min-h-0 flex-1 resize-none rounded-md border border-input bg-background p-3 font-mono text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              从左侧选择提示词，或点击「新建」开始
            </div>
          )}
        </div>

        {/* 应用到各 agent */}
        <div className="flex max-h-64 shrink-0 flex-col border-t bg-card">
          <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <CircleCheck className="h-3.5 w-3.5 text-success" />
            应用到 Agent（写入前自动备份到 ~/.ai-baogongtou/prompt-backups/）
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
            {visibleAgents.map((agent) => {
              const target = PROMPT_TARGETS.find((t) => t.agent === agent.id);
              const writable = target?.writable ?? false;
              const file = agentFiles[agent.id];
              const activeId = activeFor(agent.id);
              const activeName = prompts.find((p) => p.id === activeId)?.name;
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 border-b py-1.5 last:border-b-0"
                >
                  <div className="flex w-24 shrink-0 items-center gap-1.5 text-[13px] font-medium">
                    {externalChanged.has(agent.id) && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning"
                        title="文件刚被外部修改"
                      />
                    )}
                    {agent.name}
                  </div>
                  <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {writable
                      ? (file?.path ?? target?.file)
                      : (target?.hint ?? '不支持写入')}
                  </code>
                  <div className="w-40 shrink-0 truncate text-[11px] text-muted-foreground">
                    {!writable ? (
                      '请在应用内设置'
                    ) : activeName ? (
                      <span className="text-success">已启用：{activeName}</span>
                    ) : file?.exists ? (
                      `现有文件 ${file.chars} 字符`
                    ) : (
                      '文件不存在'
                    )}
                  </div>
                  <button
                    disabled={busy || !current || dirty || !writable}
                    onClick={() => void applyToAgent(agent.id)}
                    title={dirty ? '请先保存修改' : '备份后写入该 agent'}
                    className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    启用
                  </button>
                  <button
                    disabled={busy || !writable}
                    onClick={() => void clearForAgent(agent.id)}
                    title="恢复最近备份；没有备份则清空（清空前会备份）"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    <Eraser className="h-3 w-3" />
                    清除
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}