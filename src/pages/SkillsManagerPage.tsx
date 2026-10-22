import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  Cable,
  CircleCheck,
  Download,
  FolderInput,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Store,
  X,
} from 'lucide-react';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import SkillAuditDrawer from '../components/SkillAuditDrawer';
import { AGENTS, type AgentId } from '../lib/agents';
import type { AuditReport } from '../lib/skillAudit';
import { skillNameFromGitUrl } from '../lib/skills';
import type { SkillRepo } from '../lib/skillRegistry';
import {
  adoptSkill,
  disableSkill,
  enableSkill,
  scanAll,
  installFromGit,
  skillGitRemote,
  skillGitStatus,
  updateSkillFromGit,
  type SkillsSnapshot,
} from '../services/agentSkills';
import { auditSnapshot } from '../services/skillAudit';
import { listCurated, searchRepos } from '../services/skillRegistry';
import { isTauri } from '@tauri-apps/api/core';

const AGENT_SHORT: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  pi: 'Pi',
  cursor: 'Cursor',
  gemini: 'Gemini',
};

type MarketSource = 'curated' | 'github' | 'fallback';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function SkillsManagerPage() {
  const [snap, setSnap] = useState<SkillsSnapshot | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [installUrl, setInstallUrl] = useState('');
  const [filter, setFilter] = useState('');

  // 审计
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // 市场
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');
  const [marketRepos, setMarketRepos] = useState<SkillRepo[]>([]);
  const [marketSource, setMarketSource] = useState<MarketSource>('curated');
  const [marketError, setMarketError] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);

  // git 更新
  const [gitRemotes, setGitRemotes] = useState<Record<string, string>>({});
  const [updateBusy, setUpdateBusy] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const next = await scanAll();
      setSnap(next);
      // 探测哪些库内 skill 是 git 仓库（失败说明不是，忽略）
      const remotes: Record<string, string> = {};
      for (const name of next.librarySkills) {
        try {
          remotes[name] = await skillGitRemote(name);
        } catch {
          // 非 git 仓库
        }
      }
      setGitRemotes(remotes);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<void>, okMsg: string) => {
      setBusy(true);
      try {
        await fn();
        showToast(okMsg);
        await refresh();
      } catch (e) {
        showToast(`失败：${errMsg(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh, showToast],
  );

  const toggle = useCallback(
    (name: string, agent: AgentId, state: string) => {
      if (state === 'linked') {
        void run(() => disableSkill(name, agent), `已在 ${AGENT_SHORT[agent]} 禁用 ${name}`);
      } else if (state === 'none') {
        void run(() => enableSkill(name, agent), `已在 ${AGENT_SHORT[agent]} 启用 ${name}`);
      }
      // local 状态点击不切换，用「收编」按钮
    },
    [run],
  );

  const syncAll = useCallback(
    (name: string) => {
      void run(async () => {
        for (const agent of AGENTS) await enableSkill(name, agent.id);
      }, `已将 ${name} 同步到全部 agent`);
    },
    [run],
  );

  const install = useCallback(() => {
    const name = skillNameFromGitUrl(installUrl);
    if (!name) {
      showToast('无法从 URL 解析 skill 名');
      return;
    }
    void run(async () => {
      await installFromGit(installUrl.trim(), name);
    }, `已安装 ${name} 到中央库`);
    setInstallUrl('');
  }, [installUrl, run, showToast]);

  // ---- 审计 ----
  const runAudit = useCallback(async () => {
    if (!snap) return;
    setAuditOpen(true);
    setAuditLoading(true);
    try {
      setAuditReport(await auditSnapshot(snap));
    } catch (e) {
      setAuditReport(null);
      showToast(`审计失败：${errMsg(e)}`);
    } finally {
      setAuditLoading(false);
    }
  }, [snap, showToast]);

  // ---- 市场 ----
  const openMarket = useCallback(() => {
    setMarketOpen(true);
    setMarketRepos(listCurated());
    setMarketSource('curated');
    setMarketError('');
  }, []);

  const doSearch = useCallback(async () => {
    setMarketLoading(true);
    setMarketError('');
    try {
      const result = await searchRepos(marketQuery);
      setMarketRepos(result.repos);
      setMarketSource(result.source);
      if (result.error) {
        setMarketError(`GitHub 搜索不可用（${result.error}），已展示内置精选`);
      }
    } catch (e) {
      setMarketRepos(listCurated());
      setMarketSource('fallback');
      setMarketError(errMsg(e));
    } finally {
      setMarketLoading(false);
    }
  }, [marketQuery]);

  const installRepo = useCallback(
    (repo: SkillRepo) => {
      const name = skillNameFromGitUrl(repo.url);
      if (!name) {
        showToast('无法从仓库地址解析 skill 名');
        return;
      }
      void run(async () => {
        await installFromGit(repo.url, name);
      }, `已安装 ${name} 到中央库`);
    },
    [run, showToast],
  );

  // ---- git 更新 ----
  const updateOne = useCallback(
    async (name: string) => {
      setUpdateBusy(true);
      try {
        const before = await skillGitStatus(name);
        await updateSkillFromGit(name);
        const after = await skillGitStatus(name);
        showToast(before === after ? `${name} 已是最新` : `${name} 已更新 ${before} → ${after}`);
        await refresh();
      } catch (e) {
        showToast(`更新 ${name} 失败：${errMsg(e)}`);
      } finally {
        setUpdateBusy(false);
      }
    },
    [refresh, showToast],
  );

  const checkUpdates = useCallback(async () => {
    if (!snap) return;
    const names = snap.librarySkills.filter((name) => gitRemotes[name]);
    if (names.length === 0) {
      showToast('中央库没有可更新的 git 仓库');
      return;
    }
    setUpdateBusy(true);
    const changed: string[] = [];
    const failed: string[] = [];
    try {
      for (const name of names) {
        try {
          const before = await skillGitStatus(name);
          await updateSkillFromGit(name);
          const after = await skillGitStatus(name);
          if (before !== after) changed.push(`${name} ${before}→${after}`);
        } catch {
          failed.push(name);
        }
      }
    } finally {
      setUpdateBusy(false);
    }
    await refresh();
    if (changed.length > 0) {
      showToast(`更新 ${changed.length} 个：${changed.join('，')}`);
    } else if (failed.length > 0) {
      showToast(`检查完成，${failed.length} 个失败：${failed.join('、')}`);
    } else {
      showToast(`已检查 ${names.length} 个仓库，全部是最新`);
    }
  }, [snap, gitRemotes, refresh, showToast]);

  const rows = (snap?.rows ?? []).filter(
    (r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const sourceLabel =
    marketSource === 'github'
      ? 'GitHub 搜索结果'
      : marketSource === 'fallback'
        ? '内置精选（GitHub 不可用）'
        : '内置精选';

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={() => void refresh()} title="重新扫描">
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
          刷新
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          onClick={() => void runAudit()}
          disabled={!snap || auditLoading}
          title="审计 skill 库与 agent 本地 skills"
        >
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
          审计
        </ToolbarButton>
        <ToolbarButton onClick={openMarket} title="搜索可安装的 skill 仓库">
          <Store className="mr-1 inline h-3.5 w-3.5" />
          市场
        </ToolbarButton>
        <ToolbarButton
          onClick={() => void checkUpdates()}
          disabled={!snap || updateBusy || busy}
          title="对中央库内 git 仓库执行 git pull --ff-only"
        >
          <ArrowUpCircle className="mr-1 inline h-3.5 w-3.5" />
          检查更新
        </ToolbarButton>
        <ToolbarDivider />
        <input
          value={installUrl}
          onChange={(e) => setInstallUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) install();
          }}
          placeholder="GitHub URL 安装到中央库，如 https://github.com/a/b"
          className="h-8 w-80 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <ToolbarButton primary disabled={busy || !installUrl.trim()} onClick={install}>
          <Download className="mr-1 inline h-3.5 w-3.5" />
          安装
        </ToolbarButton>
        <ToolbarDivider />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤 skill 名…"
          className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {toast && (
          <span className="ml-auto max-w-[40%] truncate text-xs font-medium text-success" title={toast}>
            {toast}
          </span>
        )}
      </Toolbar>

      {snap && (
        <div className="shrink-0 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
          中央库 <code className="rounded bg-muted px-1">{snap.libraryAbs}</code>（可直接 git
          管理）· 库内 {snap.librarySkills.length} 个 · 矩阵共 {snap.rows.length} 个
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
          {!isTauri() && '（此功能仅在桌面 App 中可用）'}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Skill</th>
              <th className="w-20 px-2 py-2 font-medium">来源</th>
              {AGENTS.map((a) => (
                <th key={a.id} className="w-24 px-2 py-2 text-center font-medium">
                  {AGENT_SHORT[a.id]}
                </th>
              ))}
              <th className="w-44 px-2 py-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b transition-colors hover:bg-muted/40">
                <td className="px-4 py-1.5">
                  <span className="font-mono text-[13px]">{row.name}</span>
                </td>
                <td className="px-2 py-1.5">
                  {row.inLibrary ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">
                      <Link2 className="h-3 w-3" />
                      中央库
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      本地
                    </span>
                  )}
                </td>
                {AGENTS.map((a) => {
                  const state = row.agents[a.id];
                  return (
                    <td key={a.id} className="px-2 py-1.5 text-center">
                      {state === 'linked' && (
                        <button
                          disabled={busy}
                          onClick={() => toggle(row.name, a.id, state)}
                          title="已启用（软链），点击禁用"
                          className="inline-flex h-5 w-9 items-center rounded-full bg-success/80 px-0.5 transition-colors"
                        >
                          <span className="h-4 w-4 translate-x-4 rounded-full bg-white shadow transition-transform" />
                        </button>
                      )}
                      {state === 'none' && row.inLibrary && (
                        <button
                          disabled={busy}
                          onClick={() => toggle(row.name, a.id, state)}
                          title="未启用，点击建立软链"
                          className="inline-flex h-5 w-9 items-center rounded-full bg-muted px-0.5 transition-colors"
                        >
                          <span className="h-4 w-4 rounded-full bg-muted-foreground/40 shadow transition-transform" />
                        </button>
                      )}
                      {state === 'none' && !row.inLibrary && (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                      {state === 'local' && (
                        <button
                          disabled={busy || row.inLibrary}
                          onClick={() =>
                            void run(
                              () => adoptSkill(row.name, a.id),
                              `已收编 ${row.name} 到中央库`,
                            )
                          }
                          title={
                            row.inLibrary
                              ? '中央库已有同名 skill'
                              : '拷入中央库并替换为软链'
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                        >
                          <FolderInput className="h-3 w-3" />
                          收编
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-center gap-1">
                    {row.inLibrary && gitRemotes[row.name] && (
                      <button
                        disabled={busy || updateBusy}
                        onClick={() => void updateOne(row.name)}
                        title={`git pull ${gitRemotes[row.name]}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                      >
                        <ArrowUpCircle className="h-3 w-3" />
                        更新
                      </button>
                    )}
                    <button
                      disabled={busy || !row.inLibrary}
                      onClick={() => syncAll(row.name)}
                      title="启用到全部 agent"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      <Cable className="h-3 w-3" />
                      全同步
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {snap ? '没有匹配的 skill' : '扫描中…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-2 border-t bg-card px-3 text-xs text-muted-foreground">
        <CircleCheck className="h-3.5 w-3.5 text-success" />
        启用 = 在 agent 的 skills 目录建立指向中央库的软链；禁用 = 移除软链（库内容不受影响）
      </div>

      <SkillAuditDrawer
        open={auditOpen}
        report={auditReport}
        loading={auditLoading}
        onClose={() => setAuditOpen(false)}
        onRescan={() => void runAudit()}
      />

      {marketOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMarketOpen(false)} />
          <div className="absolute left-1/2 top-1/2 flex max-h-[80vh] w-[720px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-card shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
              <Store className="h-4 w-4 text-success" />
              <span className="text-sm font-semibold">Skill 市场</span>
              <span className="text-[11px] text-muted-foreground">{sourceLabel}</span>
              <button
                onClick={() => setMarketOpen(false)}
                title="关闭"
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
              <input
                value={marketQuery}
                onChange={(e) => setMarketQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !marketLoading) void doSearch();
                }}
                placeholder="搜索 skill 仓库，如 claude skills / mcp"
                className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <ToolbarButton primary disabled={marketLoading} onClick={() => void doSearch()}>
                <Search className="mr-1 inline h-3.5 w-3.5" />
                {marketLoading ? '搜索中…' : '搜索'}
              </ToolbarButton>
            </div>

            {marketError && (
              <div className="shrink-0 border-b bg-warning px-4 py-1.5 text-[11px] text-warning-foreground">
                {marketError}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {marketRepos.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                  {marketLoading ? '搜索中…' : '没有找到仓库，换个关键词试试'}
                </div>
              ) : (
                <ul className="divide-y">
                  {marketRepos.map((repo) => (
                    <li key={repo.url} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-[13px] font-medium">
                            {repo.name}
                          </span>
                          {typeof repo.stars === 'number' && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                              <Star className="h-3 w-3" />
                              {repo.stars >= 1000
                                ? `${(repo.stars / 1000).toFixed(1)}k`
                                : repo.stars}
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{repo.description}</p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {repo.tags.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                          <span className="truncate font-mono text-[10px] text-muted-foreground/60">
                            {repo.url}
                          </span>
                        </div>
                      </div>
                      <button
                        disabled={busy || snap?.librarySkills.includes(skillNameFromGitUrl(repo.url) ?? '')}
                        onClick={() => installRepo(repo)}
                        title={
                          snap?.librarySkills.includes(skillNameFromGitUrl(repo.url) ?? '')
                            ? '中央库已存在同名 skill'
                            : '克隆到中央库'
                        }
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40"
                      >
                        <Download className="h-3 w-3" />
                        安装
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground">
              安装 = git clone 到中央库；随后可在矩阵中启用到各 agent。GitHub 限流时自动回退内置精选。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}