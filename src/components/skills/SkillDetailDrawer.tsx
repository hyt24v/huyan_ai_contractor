/** Skill 详情抽屉：文件树浏览(SKILL.md 等 md 渲染预览)、查看路径 / 来源 / 标签、逐 agent 启用禁用 */
import { useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  Cable,
  FileText,
  FolderInput,
  Folder,
  GitBranch,
  Globe2,
  Loader2,
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
  isTextFileName,
  listSkillFiles,
  readSkillFileText,
  type SkillFileEntry,
} from '../../services/skillCatalog';
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
  linked: '已启用',
  local: '本地副本',
  none: '未启用',
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

  // 打开时加载文件树,默认选中 SKILL.md(没有则第一个 md)
  useEffect(() => {
    if (!open || !skill) return;
    let alive = true;
    setFiles(null);
    setSelected(null);
    setFileContent('');
    setFileError('');
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
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">部署状态</span>
              {skill.inLibrary && (
                <ActionButton
                  icon={Cable}
                  disabled={busy}
                  onClick={onSyncAll}
                >
                  全部启用
                </ActionButton>
              )}
            </div>
            <div className="space-y-1">
              {visibleAgents.map((a) => {
                const state = skill.agents[a.id];
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
                          启用
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
              })}
            </div>
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
              <div className="overflow-hidden rounded-md border">
                {/* 文件树 */}
                <div className="max-h-56 overflow-auto border-b bg-muted/20 py-1">
                  {files.map((f) => {
                    const name = f.path.replace(/\/$/, '').split('/').pop() ?? f.path;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        disabled={f.isDirectory}
                        onClick={() => setSelected(f.path)}
                        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] transition-colors ${
                          f.isDirectory
                            ? 'cursor-default font-medium text-muted-foreground'
                            : selected === f.path
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-accent/60'
                        }`}
                        style={{ paddingLeft: `${8 + f.depth * 14}px` }}
                      >
                        {f.isDirectory ? (
                          <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate font-mono">{name}</span>
                      </button>
                    );
                  })}
                </div>
                {/* 预览区 */}
                <div className="max-h-[45vh] overflow-auto p-3">
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
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5">
                      {fileContent}
                    </pre>
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