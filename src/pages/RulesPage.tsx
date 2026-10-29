/** 规则库页面：中心库管理 + 各 agent 目标文件软链引用 */
import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, FolderInput, History, Info, Link2, Link2Off, Plus, Save, Tag, Trash2 } from 'lucide-react';
import { agentShortName, type AgentId } from '../lib/agents';
import { useAgents } from '../hooks/useAgents';
import { PROMPT_TARGETS } from '../lib/agentTargets';
import {
  currentVersionId,
  type RuleEntry,
  ruleTargetFiles,
  RULE_FILE_TEMPLATES,
  ruleVersionNumber,
} from '../lib/rules';
import { Button, Input } from '../components/ui/controls';
import { Dialog } from '../components/ui/overlay';
import { EmptyState } from '../components/ui/states';
import { Tabs } from '../components/ui/form';
import { useToast } from '../hooks/useToast';
import {
  deleteRule,
  importExistingAgentPrompts,
  importProjectRule,
  listRuleVersions,
  loadRulesLibrary,
  readRuleVersion,
  restoreRuleVersion,
  saveRule,
  scanProjectRuleFiles,
  setRuleAgentEnabled,
  syncRule,
  type ProjectRuleFile,
  type RuleSyncResult,
} from '../services/agentRules';
import { rawFs } from '../lib/fsPort';
import { pickDirectory } from '../lib/pickDirectory';
import MarkdownPreview from '../components/MarkdownPreview';
import { FloatingToast } from '../components/Toast';

type EditMode = 'edit' | 'split' | 'preview';
const EDIT_MODE_KEY = 'huyan_tool:rules_edit_mode';
const loadEditMode = (): EditMode => {
  try {
    const v = localStorage.getItem(EDIT_MODE_KEY);
    return v === 'edit' || v === 'split' || v === 'preview' ? v : 'split';
  } catch {
    return 'split';
  }
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 有提示词文件的 agent（软链目标候选），按注册顺序 */
const LINKABLE = PROMPT_TARGETS.filter((t) => t.writable && t.file);

function RulesPage() {
  const { toast, showToast } = useToast(2000);
  const agents = useAgents();
  const visibleIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  const [library, setLibrary] = useState<Awaited<ReturnType<typeof loadRulesLibrary>> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  // 编辑草稿（选中规则时同步）
  const [draft, setDraft] = useState<RuleEntry | null>(null);
  const [syncResults, setSyncResults] = useState<RuleSyncResult[] | null>(null);
  // 版本历史
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<{ id: string; content: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  // 从项目导入
  const [importOpen, setImportOpen] = useState(false);
  const [importDir, setImportDir] = useState('');
  const [importFiles, setImportFiles] = useState<ProjectRuleFile[] | null>(null);
  const [importing, setImporting] = useState(false);
  // 内容区编辑/预览模式
  const [editMode, setEditModeState] = useState<EditMode>(loadEditMode);
  const setEditMode = (m: EditMode) => {
    setEditModeState(m);
    try { localStorage.setItem(EDIT_MODE_KEY, m); } catch { /* ignore */ }
  };

  const scanProject = async () => {
    if (!importDir.trim()) return;
    setImporting(true);
    try {
      const files = await scanProjectRuleFiles(importDir.trim(), rawFs);
      setImportFiles(files);
      if (files.length === 0) showToast('该项目下没有找到规则文件', 'err');
    } catch (e) {
      showToast(`扫描失败：${errMsg(e)}`, 'err');
    } finally {
      setImporting(false);
    }
  };

  const doImport = async (file: string) => {
    setImporting(true);
    try {
      const rule = await importProjectRule(importDir.trim(), file, rawFs);
      const lib = await refresh();
      select(rule.id, lib);
      setImportOpen(false);
      setImportFiles(null);
      setImportDir('');
      showToast(`已导入「${rule.name}」`);
    } catch (e) {
      showToast(`导入失败：${errMsg(e)}`, 'err');
    } finally {
      setImporting(false);
    }
  };

  const refresh = async () => {
    const lib = await loadRulesLibrary();
    setLibrary(lib);
    return lib;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh().catch((e) => showToast(`加载失败：${errMsg(e)}`, 'err')); }, []);

  const rules = useMemo(() => library?.rules ?? [], [library]);
  const filtered = useMemo(() => {
    let list = rules;
    if (tagFilter !== 'all') list = list.filter((r) => r.tags.includes(tagFilter));
    const q = query.trim().toLowerCase();
    if (query.trim()) {
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rules, query, tagFilter]);
  const allTags = useMemo(
    () => [...new Set(rules.flatMap((r) => r.tags))].sort(),
    [rules],
  );

  const select = (id: string | null, lib?: Awaited<ReturnType<typeof loadRulesLibrary>>) => {
    setSelectedId(id);
    setSyncResults(null);
    const source = lib ?? library;
    const r = source?.rules.find((x) => x.id === id);
    setDraft(r ? { ...r } : null);
  };

  /** 库操作后合并：保留未保存的本地编辑（名称/标签/描述/内容），只回写服务端状态字段 */
  const mergeSaved = (saved: RuleEntry, prev: RuleEntry): RuleEntry => ({
    ...saved,
    name: prev.name,
    tags: prev.tags,
    description: prev.description,
    content: prev.content,
  });

  const create = () => {
    const r: RuleEntry = {
      id: `rule-${Date.now().toString(36)}`,
      name: '新规则',
      content: '# 项目规则\n\n',
      tags: [],
      description: '',
      agents: {},
      versions: [],
      syncs: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // 立即落库：链接/同步/历史等按钮都要求规则已存在于库中
    void (async () => {
      try {
        const lib = await saveRule(r);
        setLibrary(lib);
        select(r.id, lib);
      } catch (e) {
        showToast(`创建失败：${errMsg(e)}`, 'err');
      }
    })();
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { showToast('规则名称不能为空', 'err'); return; }
    try {
      const lib = await saveRule(draft);
      setLibrary(lib);
      const saved = lib.rules.find((r) => r.id === draft.id);
      if (saved) setDraft({ ...saved });
      showToast('已保存');
    } catch (e) { showToast(`保存失败：${errMsg(e)}`, 'err'); }
  };

  const remove = async () => {
    if (!draft) return;
    if (!confirm(`删除规则「${draft.name}」？\n已建立的软链会被移除，不会删除任何真实文件。`)) return;
    try {
      const lib = await deleteRule(draft.id);
      setLibrary(lib);
      select(null);
      showToast('已删除');
    } catch (e) { showToast(`删除失败：${errMsg(e)}`, 'err'); }
  };

  const toggleAgent = async (agentId: AgentId, enabled: boolean) => {
    if (!draft) return;
    const id = draft.id;
    try {
      const lib = await setRuleAgentEnabled(id, agentId, enabled);
      setLibrary(lib);
      const saved = lib.rules.find((r) => r.id === id);
      // 不覆盖用户未保存的名称/内容编辑
      if (saved) setDraft((prev) => (prev ? mergeSaved(saved, prev) : { ...saved }));
      showToast(enabled ? `已链接到 ${agentShortName(agentId)}` : `已断开 ${agentShortName(agentId)}`);
    } catch (e) { showToast(`操作失败：${errMsg(e)}`, 'err'); }
  };

  const sync = async () => {
    if (!draft) return;
    const id = draft.id;
    try {
      const results = await syncRule(id);
      setSyncResults(results);
      // syncRule 会更新库里的 syncs，重载让版本标识立刻刷新
      const lib = await loadRulesLibrary();
      setLibrary(lib);
      setDraft((prev) => {
        const saved = lib.rules.find((r) => r.id === id);
        return prev && saved ? mergeSaved(saved, prev) : prev;
      });
      const failed = results.filter((r) => r.status === 'error');
      showToast(
        failed.length ? `${failed.length} 个 agent 同步失败` : '同步完成',
        failed.length ? 'err' : 'ok',
      );
    } catch (e) { showToast(`同步失败：${errMsg(e)}`, 'err'); }
  };

  const importPrompts = async () => {
    if (!confirm('扫描所有 agent 的现有提示词文件（CLAUDE.md/AGENTS.md 等），导入为中心库规则并建立软链。\n内容已在库中的会自动跳过，原文件会先备份。继续？')) return;
    try {
      const r = await importExistingAgentPrompts();
      await refresh();
      const parts = [`导入 ${r.imported.length} 个`];
      if (r.skipped.length) parts.push(`跳过 ${r.skipped.length} 个（已存在）`);
      if (r.empty.length) parts.push(`${r.empty.length} 个为空`);
      if (r.failed.length) parts.push(`失败 ${r.failed.length} 个`);
      showToast(parts.join('，'), r.failed.length ? 'err' : 'ok');
    } catch (e) {
      showToast(`导入失败：${errMsg(e)}`, 'err');
    }
  };

  const openHistory = () => {
    setHistoryPreview(null);
    setHistoryOpen(true);
  };

  const previewVersion = async (vid: string) => {
    if (!draft) return;
    try {
      const content = await readRuleVersion(draft.id, vid);
      setHistoryPreview({ id: vid, content });
    } catch (e) {
      showToast(`读取版本失败：${errMsg(e)}`, 'err');
    }
  };

  const restoreVersion = async (vid: string) => {
    if (!draft || restoring) return;
    setRestoring(true);
    try {
      const lib = await restoreRuleVersion(draft.id, vid);
      setLibrary(lib);
      const r = lib.rules.find((x) => x.id === draft.id);
      if (r) setDraft({ ...r });
      setHistoryOpen(false);
      showToast('已回滚（回滚本身也会记为新版本）');
    } catch (e) {
      showToast(`回滚失败：${errMsg(e)}`, 'err');
    } finally {
      setRestoring(false);
    }
  };

  const targetFiles = draft ? ruleTargetFiles(draft) : [];
  const enabledAgents = targetFiles.filter((t) => t.enabled);

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧：规则列表 */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称/描述"
            className="h-8 flex-1"
          />
          <Button size="sm" variant="outline" onClick={create} title="新建规则">
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
            title="从现有项目导入 AGENTS.md 等规则文件"
          >
            <FolderInput className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void importPrompts()}
            title="导入各 agent 现有的提示词文件（CLAUDE.md/AGENTS.md 等）到中心库"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
            {['all', ...allTags].map((t) => (
              <button
                key={t}
                onClick={() => setTagFilter(t)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                  tagFilter === t ? 'pill-active' : 'pill-inactive hover:bg-accent/50'
                }`}
              >
                {t === 'all' ? '全部' : t}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title={rules.length ? '没有匹配的规则' : '还没有规则，点右上角 + 新建'}
            />
          )}
          {filtered.map((r) => {
            const enabledCount = Object.values(r.agents).filter(Boolean).length;
            return (
              <button
                key={r.id}
                onClick={() => select(r.id)}
                className={`mb-1.5 flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${
                  selectedId === r.id
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border/70 bg-card hover:border-border'
                }`}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.name}</span>
                  {enabledCount > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Link2 className="h-3 w-3" />
                      {enabledCount}
                    </span>
                  )}
                </div>
                {r.description && (
                  <div className="truncate text-xs text-muted-foreground">{r.description}</div>
                )}
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span key={t} className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧：编辑器 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!draft ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="选择或新建一条规则"
            description="规则内容集中存放在中心库，勾选 agent 后以软链方式写入其规则文件"
            className="flex-1"
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <span
                className="flex h-8 max-w-72 shrink-0 items-center gap-1.5 truncate px-1 text-sm font-medium"
                title={`规则名称：${draft.name}（不可修改）`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{draft.name}</span>
              </span>
              {draft.tags.length > 0 && (
                <span className="flex shrink-0 items-center gap-1" title="标签（不可修改）">
                  <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                  {draft.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </span>
              )}
              {draft.description && (
                <span
                  className="flex h-8 min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
                  title={`${draft.description}（来源/描述，不可修改）`}
                >
                  <Info className="h-3 w-3 shrink-0" />
                  <span className="truncate">{draft.description}</span>
                </span>
              )}
              <Button size="sm" onClick={save}>
                <Save className="mr-1 h-3.5 w-3.5" />
                保存
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={openHistory}
                disabled={draft.versions.length === 0}
                title={draft.versions.length === 0 ? '保存内容变化后自动生成历史版本' : `${draft.versions.length} 个历史版本`}
              >
                <History className="mr-1 h-3.5 w-3.5" />
                历史
              </Button>
              <Button size="sm" variant="outline" onClick={sync} title="把所有已链接 agent 的目标文件指向中心库当前内容">
                同步
              </Button>
              <Tabs
                items={[
                  { key: 'edit', label: '编辑' },
                  { key: 'split', label: '分屏' },
                  { key: 'preview', label: '预览' },
                ]}
                active={editMode}
                onChange={setEditMode}
                className="shrink-0"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={remove}
                title="删除规则"
                className="text-muted-foreground hover:bg-destructive/10 hover:!text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* agent 链接开关 */}
            <div className="border-b border-border px-4 py-2.5">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                链接到 agent（写入各自的规则文件，软链到中心库）
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LINKABLE.map((t) => {
                  const enabled = draft.agents[t.agent] === true;
                  const installed = visibleIds.has(t.agent);
                  return (
                    <button
                      key={t.agent}
                      disabled={!installed}
                      onClick={() => void toggleAgent(t.agent, !enabled)}
                      title={
                        !installed
                          ? `${t.label} 未检测到（在设置 → Agent 管理中确认启用）`
                          : `${t.label} → ${t.file}`
                      }
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        !installed
                          ? 'cursor-not-allowed border border-border/50 text-muted-foreground/40'
                          : enabled
                            ? 'pill-active'
                            : 'pill-inactive hover:bg-accent/50 hover:text-foreground'
                      }`}
                    >
                      {enabled ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
                      {t.label}
                    </button>
                  );
                })}
              </div>
              {enabledAgents.length > 0 && (
                <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                  {enabledAgents.map((t) => {
                    const syncState = draft.syncs[t.agent];
                    const cur = currentVersionId(draft);
                    const ver = syncState ? ruleVersionNumber(draft, syncState.version) : null;
                    const stale = syncState && cur !== null && syncState.version !== cur;
                    return (
                      <div key={t.agent}>
                        {agentShortName(t.agent)} → <span className="font-mono">~/{t.file}</span>
                        {ver !== null && (
                          <span className={`ml-1.5 rounded px-1 py-px text-[10px] ${stale ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>
                            v{ver}{stale ? ' · 待同步' : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {syncResults && (
                <div className="mt-1.5 space-y-0.5 text-[11px]">
                  {syncResults.map((r) => (
                    <div
                      key={r.agent}
                      className={r.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}
                    >
                      {agentShortName(r.agent)}：
                      {r.status === 'linked'
                        ? '已建立链接'
                        : r.status === 'unchanged'
                          ? '已是最新'
                          : `失败：${r.error}`}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 内容编辑 / 实时预览 */}
            <div className="flex min-h-0 flex-1">
              {editMode !== 'preview' && (
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  placeholder={RULE_FILE_TEMPLATES.codex}
                  className={`min-h-0 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/50 ${
                    editMode === 'split' ? 'w-1/2 border-r border-border' : 'flex-1'
                  }`}
                />
              )}
              {editMode !== 'edit' && (
                <div className={`min-w-0 overflow-y-auto p-4 ${editMode === 'split' ? 'w-1/2' : 'flex-1'}`}>
                  <MarkdownPreview content={draft.content} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 版本历史弹窗 */}
      {historyOpen && draft && (
        <Dialog
          open
          onClose={() => setHistoryOpen(false)}
          title={`版本历史 · ${draft.name}`}
          width="max-w-xl"
        >
          <div className="flex h-[55vh] gap-3">
              {/* 版本列表 */}
              <div className="w-44 shrink-0 overflow-y-auto rounded-md border">
                {listRuleVersions(draft).map((v) => {
                  const no = ruleVersionNumber(draft, v.id);
                  const isCurrent = currentVersionId(draft) === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => void previewVersion(v.id)}
                      className={`flex w-full flex-col gap-0.5 border-b border-border/50 px-2.5 py-2 text-left last:border-b-0 hover:bg-accent ${
                        historyPreview?.id === v.id ? 'bg-accent' : ''
                      }`}
                    >
                      <span className="flex items-center gap-1 text-xs font-medium">
                        v{no ?? '?'}
                        {isCurrent && (
                          <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">当前</span>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {v.createdAt.slice(0, 16).replace('T', ' ')} · {v.size} 字
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* 预览 + 回滚 */}
              <div className="flex min-w-0 flex-1 flex-col">
                {historyPreview ? (
                  <>
                    <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">
                      {historyPreview.content}
                    </pre>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restoring || currentVersionId(draft) === historyPreview.id}
                        onClick={() => void restoreVersion(historyPreview.id)}
                      >
                        回滚到此版本
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                    点击左侧版本预览内容
                  </div>
                )}
              </div>
          </div>
        </Dialog>
      )}

      {importOpen && (
        <Dialog open onClose={() => setImportOpen(false)} title="从项目导入规则">
          <p className="mb-3 text-xs text-muted-foreground">
            输入项目路径，扫描其中的 AGENTS.md / CLAUDE.md / .cursor/rules 等规则文件
          </p>
          <div className="flex gap-2">
              <Input
                value={importDir}
                onChange={(e) => { setImportDir(e.target.value); setImportFiles(null); }}
                placeholder="/Users/you/some-project"
                className="h-8 flex-1 font-mono text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') void scanProject(); }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={importing}
                title="打开系统目录选择器"
                onClick={() => {
                  void pickDirectory('选择项目目录').then((dir) => {
                    if (dir) { setImportDir(dir); setImportFiles(null); }
                  });
                }}
              >
                浏览…
              </Button>
              <Button size="sm" variant="outline" onClick={() => void scanProject()} disabled={importing}>
                扫描
              </Button>
            </div>
            {importFiles && importFiles.length > 0 && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border">
                {importFiles.map((f) => (
                  <button
                    key={f.file}
                    onClick={() => void doImport(f.file)}
                    disabled={importing}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono">{f.file}</span>
                    {f.size > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
        </Dialog>
      )}

      {toast && <FloatingToast toast={toast} />}
    </div>
  );
}

export default RulesPage;
