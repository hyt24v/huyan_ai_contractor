/** Skill 详情抽屉：文件树浏览(SKILL.md 等 md 渲染预览)、查看路径 / 来源 / 标签、逐 agent 部署移除 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  Cable,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  FolderInput,
  Folder,
  GitBranch,
  Globe2,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { AgentId } from '../../lib/agents';
import { useAgents } from '../../hooks/useAgents';
import {
  skillEnabledAnywhere,
  sourceLabel,
  type CatalogSkill,
  type SkillSource,
} from '../../lib/skillCatalog';
import type { SkillAgentState } from '../../lib/skills';
import {
  detectFileLanguage,
  isTextFileName,
  listSkillFiles,
  readSkillFileText,
  type SkillFileEntry,
} from '../../services/skillCatalog';
import CodeEditor from '../CodeEditor';
import MarkdownPreview from '../MarkdownPreview';
import AgentBadge from './AgentBadge';
import { TagPill } from './SkillCard';

const SOURCE_ICON: Record<SkillSource, typeof Folder> = {
  local: Folder,
  git: GitBranch,
  'skills.sh': Globe2,
  unknown: Folder,
};

const STATE_LABEL: Record<SkillAgentState, string> = {
  linked: '已部署',
  local: '本地副本',
  none: '未部署',
};

const STATE_TONE: Record<SkillAgentState, string> = {
  linked: 'bg-success/15 text-success',
  local: 'bg-warning text-warning-foreground',
  none: 'bg-muted text-muted-foreground',
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function ActionButton({
  onClick,
  disabled,
  danger,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: typeof Cable;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-40 ${
        danger
          ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
          : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </button>
  );
}

export interface SkillDetailDrawerProps {
  open: boolean;
  skill: CatalogSkill | null;
  busy?: boolean;
  onClose: () => void;
  onToggleAgent: (agent: AgentId) => void;
  onAdopt: (agent: AgentId) => void;
  /** 中央库已有同名 skill 时：删除本地副本，改用中央库软链 */
  onReplaceWithLibrary: (agent: AgentId) => void;
  onSyncAll: () => void;
  onUpdate: () => void;
}

export default function SkillDetailDrawer({
  open,
  skill,
  busy,
  onClose,
  onToggleAgent,
  onAdopt,
  onReplaceWithLibrary,
  onSyncAll,
  onUpdate,
}: SkillDetailDrawerProps) {
  const visibleAgents = useAgents();
  const [files, setFiles] = useState<SkillFileEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [agentQuery, setAgentQuery] = useState('');
  const [showUndeployed, setShowUndeployed] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set());

  // 打开时加载文件树,默认选中 SKILL.md(没有则第一个 md)
  useEffect(() => {
    if (!open || !skill) return;
    let alive = true;
    setFiles(null);
    setSelected(null);
    setFileContent('');
    setFileError('');
    setAgentQuery('');
    setShowUndeployed(false);
    setCollapsedDirs(new Set());
    listSkillFiles(skill)
      .then((list) => {
        if (!alive) return;
        setFiles(list);
        const flat = list.filter((f) => !f.isDirectory);
        const def =
          flat.find((f) => f.path === 'SKILL.md') ??
          flat.find((f) => f.path.toLowerCase().endsWith('.md'));
        if (def) setSelected(def.path);
      })
      .catch((e: unknown) => {
        if (alive) setFileError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [open, skill]);

  // 选中文件后加载内容
  useEffect(() => {
    if (!open || !skill || !selected) return;
    // 非文本文件不读取（服务层会 throw），交给下方「不支持预览」分支展示
    if (!isTextFileName(selected)) {
      setFileContent('');
      setFileError('');
      setFileLoading(false);
      return;
    }
    let alive = true;
    setFileLoading(true);
    setFileContent('');
    setFileError('');
    readSkillFileText(skill, selected)
      .then((text) => {
        if (alive) setFileContent(text);
      })
      .catch((e: unknown) => {
        if (alive) setFileError(errMsg(e));
      })
      .finally(() => {
        if (alive) setFileLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, skill, selected]);

  const toggleDir = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /** 折叠过滤：任一祖先目录被折叠则隐藏 */
  const visibleFiles = useMemo(() => {
    if (!files) return null;
    if (collapsedDirs.size === 0) return files;
    return files.filter((f) => {
      const parts = f.path.replace(/\/$/, '').split('/');
      parts.pop();
      let prefix = '';
      for (const part of parts) {
        prefix += `${part}/`;
        if (collapsedDirs.has(prefix)) return false;
      }
      return true;
    });
  }, [files, collapsedDirs]);

  if (!open || !skill) return null;

  const SourceIcon = SOURCE_ICON[skill.source];
  const enabled = skillEnabledAnywhere(skill);
  const agentPath =
    skill.libraryPath ?? Object.values(skill.agentPaths).find((p): p is string => !!p);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={`${skill.name} 详情`}
        className="absolute right-0 top-0 flex h-full w-full max-w-[680px] flex-col border-l bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-start gap-2 border-b px-4 py-3">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              enabled ? 'bg-success' : 'bg-muted-foreground/30'
            }`}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-sm font-semibold">{skill.name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <SourceIcon className="h-3 w-3" />
              {sourceLabel(skill.source)}
              <span className="text-muted-foreground/40">·</span>
              {skill.inLibrary ? '中央库' : '仅本地'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {skill.tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {skill.tags.map((tag) => (
                <TagPill key={tag} tag={tag} />
              ))}
            </div>
          )}

          <dl className="space-y-1.5 text-[11px]">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">路径</dt>
              <dd className="min-w-0 flex-1 break-all font-mono text-[10px] leading-4">
                {agentPath ?? '—'}
              </dd>
            </div>
            {skill.gitRemote && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">Git 远端</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-[10px] leading-4">
                  {skill.gitRemote}
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">Agent</dt>
              <dd className="min-w-0 flex-1">
                {visibleAgents.filter((a) => (skill.agents[a.id] ?? 'none') !== 'none').length === 0
                  ? '尚未部署到任何 Agent'
                  : visibleAgents.filter((a) => (skill.agents[a.id] ?? 'none') !== 'none')
                      .map((a) => a.name)
                      .join('、')}
              </dd>
            </div>
          </dl>

          <div className="mt-3 border-t pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">部署状态</span>
              <span className="flex items-center gap-1.5">
                {visibleAgents.length > 8 && (
                  <span className="relative">
                    <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={agentQuery}
                      onChange={(e) => setAgentQuery(e.target.value)}
                      placeholder="搜索 Agent…"
                      className="h-6 w-32 rounded-md border border-input bg-transparent pl-5 pr-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </span>
                )}
                {skill.inLibrary && (
                  <ActionButton
                    icon={Cable}
                    disabled={busy}
                    onClick={onSyncAll}
                  >
                    全部部署
                  </ActionButton>
                )}
              </span>
            </div>
            {(() => {
              const needle = agentQuery.trim().toLowerCase();
              const matched = needle
                ? visibleAgents.filter(
                    (a) => a.name.toLowerCase().includes(needle) || a.id.includes(needle),
                  )
                : visibleAgents;
              const deployed = matched.filter(
                (a) => (skill.agents[a.id] ?? 'none') !== 'none',
              );
              const undeployed = matched.filter(
                (a) => (skill.agents[a.id] ?? 'none') === 'none',
              );
              // 未部署的 agent 可能几十个：默认折叠，搜索时强制展开匹配项
              const expandNone = showUndeployed || needle !== '' || undeployed.length <= 8;
              const renderRow = (a: (typeof visibleAgents)[number]) => {
                const state = skill.agents[a.id] ?? 'none';
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                  >
                    <AgentBadge agent={a.id} state={state} />
                    <span className="text-xs font-medium">{a.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATE_TONE[state]}`}
                    >
                      {STATE_LABEL[state]}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      {state === 'none' && skill.inLibrary && (
                        <ActionButton
                          disabled={busy}
                          onClick={() => onToggleAgent(a.id)}
                        >
                          部署
                        </ActionButton>
                      )}
                      {state === 'local' && !skill.inLibrary && (
                        <ActionButton
                          icon={FolderInput}
                          disabled={busy}
                          onClick={() => onAdopt(a.id)}
                        >
                          收编
                        </ActionButton>
                      )}
                      {state === 'local' && skill.inLibrary && (
                        <ActionButton
                          danger
                          icon={Cable}
                          disabled={busy}
                          onClick={() => onReplaceWithLibrary(a.id)}
                        >
                          改用中央库
                        </ActionButton>
                      )}
                      {state === 'linked' && (
                        <ActionButton
                          danger
                          icon={Trash2}
                          disabled={busy}
                          onClick={() => onToggleAgent(a.id)}
                        >
                          删除链接
                        </ActionButton>
                      )}
                    </div>
                  </div>
                );
              };
              return (
                <div className="space-y-1">
                  {deployed.map(renderRow)}
                  {undeployed.length > 0 && !expandNone && (
                    <button
                      type="button"
                      onClick={() => setShowUndeployed(true)}
                      className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronDown className="h-3 w-3" />
                      展开未部署的 {undeployed.length} 个 Agent
                    </button>
                  )}
                  {expandNone && undeployed.map(renderRow)}
                  {expandNone && undeployed.length > 8 && !agentQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => setShowUndeployed(false)}
                      className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronUp className="h-3 w-3" />
                      收起未部署的 {undeployed.length} 个 Agent
                    </button>
                  )}
                  {matched.length === 0 && (
                    <div className="rounded-md border border-dashed px-2 py-4 text-center text-[11px] text-muted-foreground">
                      没有匹配的 Agent
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                文件{files ? `(${files.filter((f) => !f.isDirectory).length})` : ''}
              </span>
              {fileLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            {!files ? (
              <div className="rounded-md border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
                读取中…
              </div>
            ) : files.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
                该 skill 不在本机或目录为空
              </div>
            ) : (
              <div className="flex h-[46vh] overflow-hidden rounded-md border">
                {/* 文件树（左侧，目录可折叠） */}
                <div className="w-48 shrink-0 overflow-auto border-r bg-muted/20 py-1">
                  {visibleFiles!.map((f) => {
                    const name = f.path.replace(/\/$/, '').split('/').pop() ?? f.path;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => (f.isDirectory ? toggleDir(f.path) : setSelected(f.path))}
                        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] transition-colors ${
                          f.isDirectory
                            ? 'font-medium text-foreground/80 hover:bg-accent/60'
                            : selected === f.path
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-accent/60'
                        }`}
                        style={{ paddingLeft: `${8 + f.depth * 14}px` }}
                      >
                        {f.isDirectory ? (
                          <>
                            {collapsedDirs.has(f.path) ? (
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            <Folder className="h-3 w-3 shrink-0 text-primary/70" />
                          </>
                        ) : (
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate font-mono">{name}</span>
                      </button>
                    );
                  })}
                </div>
                {/* 预览区（右侧） */}
                <div className="min-w-0 flex-1 overflow-auto p-3">
                  {fileError ? (
                    <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                      {fileError}
                    </div>
                  ) : !selected ? (
                    <div className="py-6 text-center text-[11px] text-muted-foreground">
                      选择左侧文件查看内容
                    </div>
                  ) : fileLoading ? (
                    <div className="py-6 text-center text-[11px] text-muted-foreground">
                      读取中…
                    </div>
                  ) : selected.toLowerCase().endsWith('.md') ? (
                    <MarkdownPreview content={fileContent} />
                  ) : isTextFileName(selected) ? (
                    <div className="-m-3 h-full">
                      <CodeEditor
                        value={fileContent}
                        onChange={() => undefined}
                        language={detectFileLanguage(selected, fileContent)}
                        readOnly
                      />
                    </div>
                  ) : (
                    <div className="py-6 text-center text-[11px] text-muted-foreground">
                      该文件类型不支持预览
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          {skill.gitRemote && (
            <button
              type="button"
              disabled={busy}
              onClick={onUpdate}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-3 text-xs font-medium hover:bg-accent disabled:opacity-40"
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
              从 Git 更新
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            关闭
          </button>
        </div>
      </aside>
    </div>
  );
}