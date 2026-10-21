import { useCallback, useEffect, useState } from 'react';
import {
  Cable,
  FolderInput,
  Link2,
  RefreshCw,
  Download,
  CircleCheck,
} from 'lucide-react';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import { AGENTS, type AgentId } from '../lib/agents';
import { skillNameFromGitUrl } from '../lib/skills';
import {
  adoptSkill,
  disableSkill,
  enableSkill,
  scanAll,
  installFromGit,
  type SkillsSnapshot,
} from '../services/agentSkills';

const AGENT_SHORT: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  pi: 'Pi',
  cursor: 'Cursor',
  gemini: 'Gemini',
};

export default function SkillsManagerPage() {
  const [snap, setSnap] = useState<SkillsSnapshot | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [installUrl, setInstallUrl] = useState('');
  const [filter, setFilter] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      setSnap(await scanAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        showToast(`失败：${e instanceof Error ? e.message : String(e)}`);
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

  const rows = (snap?.rows ?? []).filter(
    (r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <ToolbarButton onClick={() => void refresh()} title="重新扫描">
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
          刷新
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
          <span className="ml-auto text-xs font-medium text-success">{toast}</span>
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
          {error}（此功能仅在桌面 App 中可用）
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
              <th className="w-28 px-2 py-2 text-center font-medium">操作</th>
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
                <td className="px-2 py-1.5 text-center">
                  <button
                    disabled={busy || !row.inLibrary}
                    onClick={() => syncAll(row.name)}
                    title="启用到全部 agent"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    <Cable className="h-3 w-3" />
                    全同步
                  </button>
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
    </div>
  );
}
