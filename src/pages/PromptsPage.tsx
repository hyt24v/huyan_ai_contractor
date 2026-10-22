import { useCallback, useEffect, useState } from 'react';
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
import { AGENTS, type AgentId } from '../lib/agents';
import { PROMPT_TARGETS } from '../lib/agentTargets';
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
}

const ERR_HINT = '（此功能仅在桌面 App 中可用）';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function PromptsPage() {
  const [lib, setLib] = useState<PromptLibrary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);
  const [agentFiles, setAgentFiles] = useState<Partial<Record<AgentId, AgentFileState>>>({});

  const notify = useCallback((msg: string, ok = true) => {
    setToast(msg);
    setToastOk(ok);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

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
      let path = target.file;
      try {
        path = await promptFilePath(target.agent);
      } catch {
        // 非 Tauri 环境取不到 home，仍显示相对路径
      }
      try {
        const text = await readCurrentPrompt(target.agent);
        next[target.agent] = { path, exists: text !== null, chars: text?.length ?? 0 };
      } catch {
        next[target.agent] = { path, exists: false, chars: 0 };
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
      const next = updatePrompt(lib, selectedId, draft);
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
      const promptName = nextAvailableName(
        '未命名提示词',
        lib.prompts.map((p) => p.name),
      );
      const { library, prompt } = addPrompt(lib, {
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
      const { library, prompt } = duplicatePrompt(lib, selectedId);
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
      const index = lib.prompts.findIndex((p) => p.id === selectedId);
      const next = removePrompt(lib, selectedId);
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
        const result = await applyPrompt(agent, current);
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
  const activeFor = (agent: AgentId): string | undefined => lib?.active[agent];

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
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {prompts.map((p) => {
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
          {lib && prompts.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              还没有提示词，点击右上角「新建」
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
          <span
            className={`ml-auto text-xs font-medium ${
              toastOk ? 'text-success' : 'text-destructive'
            }`}
          >
            {toast}
          </span>
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
            {AGENTS.map((agent) => {
              const file = agentFiles[agent.id];
              const activeId = activeFor(agent.id);
              const activeName = prompts.find((p) => p.id === activeId)?.name;
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 border-b py-1.5 last:border-b-0"
                >
                  <div className="w-24 shrink-0 text-[13px] font-medium">{agent.name}</div>
                  <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {file?.path ?? PROMPT_TARGETS.find((t) => t.agent === agent.id)?.file}
                  </code>
                  <div className="w-40 shrink-0 truncate text-[11px] text-muted-foreground">
                    {activeName ? (
                      <span className="text-success">已启用：{activeName}</span>
                    ) : file?.exists ? (
                      `现有文件 ${file.chars} 字符`
                    ) : (
                      '文件不存在'
                    )}
                  </div>
                  <button
                    disabled={busy || !current || dirty}
                    onClick={() => void applyToAgent(agent.id)}
                    title={dirty ? '请先保存修改' : '备份后写入该 agent'}
                    className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    启用
                  </button>
                  <button
                    disabled={busy}
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