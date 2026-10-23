import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUpCircle,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  GitBranch,
  Globe2,
  Grid2x2,
  Layers,
  Library,
  List,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { SegmentedControl } from '../components/Toolbar';
import SkillAuditDrawer from '../components/SkillAuditDrawer';
import AddSkillsPicker from '../components/skills/AddSkillsPicker';
import AgentBadge, { agentName } from '../components/skills/AgentBadge';
import SkillCard, { TagPill } from '../components/skills/SkillCard';
import SkillDetailDrawer from '../components/skills/SkillDetailDrawer';
import SkillGrid from '../components/skills/SkillGrid';
import { AGENTS, type AgentId } from '../lib/agents';
import type {
  CatalogFilter,
  CatalogSkill,
  CatalogView,
  SkillCatalog,
} from '../lib/skillCatalog';
import {
  catalogStats,
  collectTags,
  filterCatalog,
  ratioPercent,
  skillEnabledAnywhere,
  toggleInList,
  toggleTag,
} from '../lib/skillCatalog';
import type { Profile } from '../lib/profiles';
import type { AuditReport } from '../lib/skillAudit';
import type { SkillRepo } from '../lib/skillRegistry';
import { skillNameFromGitUrl } from '../lib/skills';
import {
  adoptSkill,
  disableSkill,
  enableSkill,
  installFromGit,
  skillGitStatus,
  updateSkillFromGit,
  type SkillsSnapshot,
} from '../services/agentSkills';
import { scanSkillCatalog } from '../services/skillCatalog';
import { auditSnapshot } from '../services/skillAudit';
import { listCurated, searchRepos } from '../services/skillRegistry';
import { loadProfiles } from '../services/profiles';
import { isTauri } from '@tauri-apps/api/core';

type NavKey = 'library' | 'agents' | 'install' | AgentId;
type LayoutMode = 'grid' | 'list';
type MarketSource = 'curated' | 'github' | 'fallback';

const AGENT_IDS = AGENTS.map((a) => a.id);

const SOURCE_FILTERS: { value: CatalogFilter; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'local', label: '本地' },
  { value: 'git', label: 'Git' },
  { value: 'skills.sh', label: 'skills.sh' },
  { value: 'untagged', label: '无标签' },
];

const VIEW_OPTIONS: { value: CatalogView; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'available', label: '未启用' },
];

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? 'bg-accent font-medium text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' && (
        <span className="text-[11px] tabular-nums text-muted-foreground/70">{count}</span>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  count,
  icon,
  onClick,
}: {
  label: string;
  active?: boolean;
  count?: number;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {icon}
      {label}
      {typeof count === 'number' && (
        <span className="tabular-nums opacity-60">{count}</span>
      )}
    </button>
  );
}

function IconButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-xs transition-colors disabled:opacity-40 ${
        active
          ? 'border-border bg-accent text-foreground'
          : 'border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  disabled,
  icon,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

export default function SkillsManagerPage() {
  const [snap, setSnap] = useState<SkillsSnapshot | null>(null);
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [nav, setNav] = useState<NavKey>('library');
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<CatalogView>('all');
  const [sourceFilter, setSourceFilter] = useState<CatalogFilter>('all');
  const [tags, setTags] = useState<string[]>([]);
  const [presetId, setPresetId] = useState('all');
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchAgent, setBatchAgent] = useState<AgentId | 'all'>('all');
  const [detailName, setDetailName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAgents, setPickerAgents] = useState<AgentId[]>(['claude']);

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const [installUrl, setInstallUrl] = useState('');
  const [marketQuery, setMarketQuery] = useState('');
  const [marketRepos, setMarketRepos] = useState<SkillRepo[]>(() => listCurated());
  const [marketSource, setMarketSource] = useState<MarketSource>('curated');
  const [marketError, setMarketError] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketTag, setMarketTag] = useState('all');

  const showToast = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const next = await scanSkillCatalog();
      setSnap(next.snapshot);
      setCatalog(next.catalog);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    loadProfiles()
      .then((store) => {
        if (alive) setProfiles(store.profiles);
      })
      .catch(() => {
        // 浏览器 / 无配置文件时忽略
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async (fn: () => Promise<string | void>, okMsg: string) => {
      setBusy(true);
      try {
        const msg = await fn();
        showToast(typeof msg === 'string' && msg ? msg : okMsg);
        await refresh();
      } catch (e) {
        showToast(`操作失败：${errMsg(e)}`, 'err');
      } finally {
        setBusy(false);
      }
    },
    [refresh, showToast],
  );

  const activeAgent: AgentId | null =
    nav === 'library' || nav === 'agents' || nav === 'install' ? null : nav;
  const stats = useMemo(() => (catalog ? catalogStats(catalog) : null), [catalog]);
  const activeStats = activeAgent && stats ? stats.byAgent[activeAgent] : null;
  const activeDef = activeAgent ? AGENTS.find((a) => a.id === activeAgent) ?? null : null;
  const preset = profiles.find((p) => p.id === presetId) ?? null;

  const tagSource = useMemo(() => {
    const all = catalog?.skills ?? [];
    return activeAgent ? all.filter((s) => s.agents[activeAgent] !== 'none') : all;
  }, [catalog, activeAgent]);
  const allTags = useMemo(() => collectTags(tagSource), [tagSource]);

  const visible = useMemo(() => {
    if (!catalog) return [];
    return filterCatalog(catalog, {
      query,
      view,
      agent: activeAgent ?? 'all',
      filter: sourceFilter,
      tags,
      ...(preset ? { presetSkillNames: preset.skills } : {}),
      sort: activeAgent ? 'name' : 'enabled',
    });
  }, [catalog, query, view, activeAgent, sourceFilter, tags, preset]);

  const detail = detailName && catalog
    ? catalog.skills.find((s) => s.name === detailName) ?? null
    : null;

  const findSkill = useCallback(
    (name: string): CatalogSkill | undefined => catalog?.skills.find((s) => s.name === name),
    [catalog],
  );

  const selectNav = (key: NavKey) => {
    setNav(key);
    setSelected(new Set());
  };

  const togglePreset = (id: string) => {
    setPresetId((prev) => (prev === id ? 'all' : id));
    setNav('library');
    setSelected(new Set());
  };

  const clearFilters = () => {
    setQuery('');
    setView('all');
    setSourceFilter('all');
    setTags([]);
    setPresetId('all');
  };

  const openPicker = (agent?: AgentId) => {
    setPickerAgents(agent ? [agent] : ['claude']);
    setPickerOpen(true);
  };

  // ---- 启用 / 禁用 / 收编 ----
  const setAgentState = useCallback(
    (name: string, agent: AgentId, enable: boolean) => {
      const skill = findSkill(name);
      if (!skill) return;
      if (enable && !skill.inLibrary) {
        showToast('本地技能需先收编到中央库才能启用', 'err');
        return;
      }
      if (enable && skill.agents[agent] === 'local' && skill.inLibrary) {
        showToast('该 Agent 是本地副本，中央库已有同名 skill，请在详情中处理', 'err');
        return;
      }
      void run(async () => {
        if (enable) {
          if (skill.agents[agent] === 'local') await adoptSkill(name, agent);
          else await enableSkill(name, agent);
        } else {
          await disableSkill(name, agent);
        }
      }, enable ? `已在 ${agentName(agent)} 启用 ${name}` : `已在 ${agentName(agent)} 禁用 ${name}`);
    },
    [findSkill, run, showToast],
  );

  const adoptOne = useCallback(
    (name: string, agent: AgentId) => {
      const skill = findSkill(name);
      if (skill?.inLibrary) {
        showToast('中央库已有同名 skill，无法收编', 'err');
        return;
      }
      void run(() => adoptSkill(name, agent), `已收编 ${name} 到中央库`);
    },
    [findSkill, run, showToast],
  );

  const toggleAllAgents = useCallback(
    (name: string) => {
      const skill = findSkill(name);
      if (!skill) return;
      const enabled = skillEnabledAnywhere(skill);
      if (!enabled && !skill.inLibrary) {
        showToast('本地技能需先收编到中央库', 'err');
        return;
      }
      void run(async () => {
        if (enabled) {
          for (const agent of AGENTS) {
            if (skill.agents[agent.id] === 'linked') await disableSkill(name, agent.id);
          }
        } else {
          for (const agent of AGENTS) {
            if (skill.agents[agent.id] === 'none') await enableSkill(name, agent.id);
          }
        }
      }, enabled ? `已禁用 ${name} 的全部链接` : `已将 ${name} 启用到全部 Agent`);
    },
    [findSkill, run, showToast],
  );

  const syncAll = useCallback(
    (name: string) => {
      const skill = findSkill(name);
      if (!skill?.inLibrary) {
        showToast('先收编到中央库才能同步', 'err');
        return;
      }
      void run(async () => {
        for (const agent of AGENTS) {
          if (skill.agents[agent.id] === 'none') await enableSkill(name, agent.id);
        }
      }, `已将 ${name} 同步到全部 Agent`);
    },
    [findSkill, run, showToast],
  );

  const batchApply = (mode: 'enable' | 'disable') => {
    if (selected.size === 0) return;
    const targets: AgentId[] = batchAgent === 'all' ? AGENT_IDS : [batchAgent];
    void run(async () => {
      for (const name of selected) {
        const skill = findSkill(name);
        if (!skill) continue;
        if (mode === 'enable' && !skill.inLibrary) continue;
        for (const agent of targets) {
          const state = skill.agents[agent];
          if (mode === 'enable') {
            if (state === 'none') await enableSkill(name, agent);
          } else if (state === 'linked') {
            await disableSkill(name, agent);
          }
        }
      }
    }, `已批量${mode === 'enable' ? '启用' : '禁用'} ${selected.size} 个 skill`);
    setSelected(new Set());
  };

  const deployFromPicker = (names: string[], agents: AgentId[]) => {
    void run(async () => {
      let ok = 0;
      let skipped = 0;
      const failed: string[] = [];
      for (const name of names) {
        const skill = findSkill(name);
        if (!skill?.inLibrary) { skipped++; continue; }
        for (const agent of agents) {
          // 只部署到尚未启用的 agent；本地副本（local）跳过，绝不覆盖用户数据
          if (skill.agents[agent] !== 'none') { skipped++; continue; }
          try {
            await enableSkill(name, agent);
            ok++;
          } catch (e) {
            failed.push(`${name}→${agent}: ${errMsg(e)}`);
          }
        }
      }
      if (failed.length > 0) {
        throw new Error(`成功 ${ok} 项；失败 ${failed.length} 项：${failed.slice(0, 3).join('；')}`);
      }
      return `已部署 ${ok} 项${skipped > 0 ? `，跳过 ${skipped} 项（已在库外/已启用）` : ''}`;
    }, `已部署 ${names.length} 个 skill 到 ${agents.length} 个 Agent`);
    setPickerOpen(false);
  };

  // ---- Git 更新 ----
  const updateOne = useCallback(
    async (name: string) => {
      setUpdating(true);
      try {
        const before = await skillGitStatus(name);
        await updateSkillFromGit(name);
        const after = await skillGitStatus(name);
        showToast(before === after ? `${name} 已是最新` : `${name} 已更新 ${before} → ${after}`);
        await refresh();
      } catch (e) {
        showToast(`更新 ${name} 失败：${errMsg(e)}`, 'err');
      } finally {
        setUpdating(false);
      }
    },
    [refresh, showToast],
  );

  const checkUpdates = useCallback(async () => {
    if (!catalog) return;
    const names = catalog.skills.filter((s) => s.gitRemote).map((s) => s.name);
    if (names.length === 0) {
      showToast('中央库没有可更新的 git 仓库');
      return;
    }
    setUpdating(true);
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
      setUpdating(false);
    }
    await refresh();
    if (changed.length > 0) {
      showToast(`更新 ${changed.length} 个：${changed.slice(0, 3).join('，')}`);
    } else if (failed.length > 0) {
      showToast(`检查完成，${failed.length} 个失败：${failed.slice(0, 3).join('、')}`, 'err');
    } else {
      showToast(`已检查 ${names.length} 个仓库，全部是最新`);
    }
  }, [catalog, refresh, showToast]);

  // ---- 安装 ----
  const installFromUrl = () => {
    const name = skillNameFromGitUrl(installUrl);
    if (!name) {
      showToast('无法从 URL 解析 skill 名', 'err');
      return;
    }
    void run(() => installFromGit(installUrl.trim(), name), `已安装 ${name} 到中央库`);
    setInstallUrl('');
  };

  const installRepo = (repo: SkillRepo) => {
    const name = skillNameFromGitUrl(repo.url);
    if (!name) {
      showToast('无法从仓库地址解析 skill 名', 'err');
      return;
    }
    void run(() => installFromGit(repo.url, name), `已安装 ${name} 到中央库`);
  };

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

  const marketTags = useMemo(() => {
    const set = new Set<string>();
    for (const repo of marketRepos) for (const tag of repo.tags) set.add(tag);
    return [...set].sort();
  }, [marketRepos]);

  const filteredRepos =
    marketTag === 'all' ? marketRepos : marketRepos.filter((r) => r.tags.includes(marketTag));

  const runAudit = useCallback(async () => {
    if (!snap) {
      showToast('扫描尚未完成，请稍后再试', 'err');
      return;
    }
    setAuditOpen(true);
    setAuditLoading(true);
    try {
      setAuditReport(await auditSnapshot(snap));
    } catch (e) {
      setAuditReport(null);
      showToast(`审计失败：${errMsg(e)}`, 'err');
    } finally {
      setAuditLoading(false);
    }
  }, [snap, showToast]);

  // ---- 统计 ----
  const libraryCount = stats?.inLibrary ?? 0;
  const totalCount = stats?.total ?? 0;
  const filtersActive =
    query.trim() !== '' ||
    view !== 'all' ||
    sourceFilter !== 'all' ||
    tags.length > 0 ||
    presetId !== 'all';

  const sourceLabelText =
    marketSource === 'github'
      ? 'GitHub 搜索结果'
      : marketSource === 'fallback'
        ? '内置精选（GitHub 不可用）'
        : '内置精选';

  const renderTagsAndFilters = () => (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {profiles.length > 0 && (
        <>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            预设
          </span>
          {profiles.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              count={p.skills.length}
              active={presetId === p.id}
              icon={<Layers className="h-3 w-3" />}
              onClick={() => togglePreset(p.id)}
            />
          ))}
          <span className="mx-1 h-3 w-px bg-border" />
        </>
      )}
      {SOURCE_FILTERS.map((f) => (
        <Chip
          key={f.value}
          label={f.label}
          active={sourceFilter === f.value}
          onClick={() =>
            setSourceFilter((prev) => (prev === f.value ? 'all' : f.value))
          }
        />
      ))}
      {allTags.length > 0 && <span className="mx-1 h-3 w-px bg-border" />}
      {allTags.slice(0, 14).map((t) => (
        <TagPill
          key={t.tag}
          tag={t.tag}
          count={t.count}
          active={tags.includes(t.tag)}
          onClick={() => setTags((prev) => toggleTag(prev, t.tag))}
        />
      ))}
      {filtersActive && (
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3 w-3" />
          清除筛选
        </button>
      )}
    </div>
  );

  const renderHeader = () => {
    if (nav === 'install') {
      return (
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">安装 Skills</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            从 GitHub / 内置精选克隆到中央库，再分发到各 Agent
          </p>
        </div>
      );
    }
    if (nav === 'agents') {
      return (
        <div>
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-lg font-semibold tracking-tight">全部 Agent</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {AGENTS.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            选择 Agent 进入工作区，查看已装 skills 与同步状态
          </p>
        </div>
      );
    }
    if (activeAgent && activeDef && activeStats) {
      return (
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentBadge agent={activeAgent} state="linked" size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {activeDef.name}
              </h1>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {activeStats.total}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                ~/{activeDef.skillsDir}
              </code>
              <span className="text-muted-foreground/40">·</span>
              <span>
                {activeStats.total} / {activeStats.managed} 已托管 / {activeStats.inSync} 已同步
              </span>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <Layers className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">中央库</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {libraryCount}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              ~/ai-skills
            </code>
            <span className="text-muted-foreground/40">·</span>
            <span>
              已启用 {stats?.enabled ?? 0} / 共 {totalCount} 个
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (nav === 'agents') {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((agent) => {
            const st = stats?.byAgent[agent.id];
            const total = st?.total ?? 0;
            const pct = ratioPercent(st?.inSync ?? 0, total);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectNav(agent.id)}
                className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-ring/60 hover:shadow-md"
              >
                <AgentBadge
                  agent={agent.id}
                  state={(st?.linked ?? 0) > 0 ? 'linked' : 'none'}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{agent.name}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {total} 个 skill · {st?.inSync ?? 0} 已同步
                    {st?.local ? ` · ${st.local} 本地` : ''}
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-success transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                    ~/{agent.skillsDir}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      );
    }

    if (nav === 'install') {
      return (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={marketQuery}
                  onChange={(e) => setMarketQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !marketLoading) void doSearch();
                  }}
                  placeholder="搜索 skill 仓库，如 claude skills / mcp"
                  className="h-8 w-full rounded-md border border-input bg-transparent pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <PrimaryButton
                onClick={() => void doSearch()}
                disabled={marketLoading}
                icon={
                  marketLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )
                }
              >
                {marketLoading ? '搜索中…' : '搜索'}
              </PrimaryButton>
              <span className="text-[11px] text-muted-foreground">{sourceLabelText}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip
                label="全部标签"
                active={marketTag === 'all'}
                onClick={() => setMarketTag('all')}
              />
              {marketTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  active={marketTag === tag}
                  onClick={() => setMarketTag((prev) => (prev === tag ? 'all' : tag))}
                />
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                从 GitHub URL 安装
              </span>
              <input
                value={installUrl}
                onChange={(e) => setInstallUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy && installUrl.trim()) installFromUrl();
                }}
                placeholder="https://github.com/owner/skill-repo"
                className="h-8 min-w-[220px] flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <GhostButton
                onClick={installFromUrl}
                disabled={busy || !installUrl.trim()}
                icon={<Download className="h-3.5 w-3.5" />}
              >
                安装到中央库
              </GhostButton>
            </div>

            {marketError && (
              <div className="mt-2 rounded-md bg-warning px-2 py-1.5 text-[11px] text-warning-foreground">
                {marketError}
              </div>
            )}
          </div>

          {filteredRepos.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-card/40 px-4 py-12 text-center text-xs text-muted-foreground">
              {marketLoading ? '搜索中…' : '没有匹配的仓库，换个关键词或标签试试'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {filteredRepos.map((repo) => {
                const name = skillNameFromGitUrl(repo.url);
                const installed = Boolean(
                  name && catalog?.skills.some((s) => s.name === name && s.inLibrary),
                );
                return (
                  <div
                    key={repo.url}
                    className="flex flex-col rounded-lg border bg-card p-3 shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold">{repo.name}</span>
                          {typeof repo.stars === 'number' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Star className="h-3 w-3" />
                              {repo.stars >= 1000
                                ? `${(repo.stars / 1000).toFixed(1)}k`
                                : repo.stars}
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                            {repo.description}
                          </p>
                        )}
                      </div>
                      {installed ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] text-success">
                          <Check className="h-3 w-3" />
                          已安装
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => installRepo(repo)}
                          title="克隆到中央库"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-medium text-success transition hover:bg-success/20 disabled:opacity-40"
                        >
                          <Download className="h-3 w-3" />
                          安装
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {repo.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[10px] text-muted-foreground">
                      <span className="truncate font-mono">{repo.url}</span>
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noreferrer"
                        title="在浏览器中打开"
                        className="shrink-0 rounded p-0.5 hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (loading && !catalog) {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[150px] animate-pulse rounded-lg border bg-muted/30"
            />
          ))}
        </div>
      );
    }

    return (
      <SkillGrid
        layout={layout}
        isEmpty={visible.length === 0}
        empty={
          <div className="mx-auto mt-12 max-w-md rounded-xl border border-dashed bg-card/40 px-6 py-10 text-center">
            <Package className="mx-auto h-10 w-10 text-muted-foreground/30" />
            <h3 className="mt-3 text-sm font-semibold">
              {filtersActive ? '没有匹配的 skill' : '这里还没有 skill'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {filtersActive
                ? '换个关键词、标签或来源试试，也可以清除全部筛选。'
                : activeAgent
                  ? '去中央库挑选已有 skill，或先从 GitHub 安装。'
                  : '从 GitHub / 内置精选安装 skill 到中央库。'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {filtersActive && (
                <GhostButton onClick={clearFilters} icon={<X className="h-3.5 w-3.5" />}>
                  清除筛选
                </GhostButton>
              )}
              <PrimaryButton
                onClick={() => selectNav('install')}
                icon={<Download className="h-3.5 w-3.5" />}
              >
                安装 Skills
              </PrimaryButton>
            </div>
          </div>
        }
      >
        {visible.map((skill) => (
          <SkillCard
            key={skill.name}
            skill={skill}
            layout={layout}
            selected={selected.has(skill.name)}
            busy={busy}
            {...(activeAgent ? { focusAgent: activeAgent } : {})}
            onOpen={() => setDetailName(skill.name)}
            onToggleSelect={() =>
              setSelected((prev) => new Set(toggleInList([...prev], skill.name)))
            }
            onToggleAll={() => toggleAllAgents(skill.name)}
            onToggleAgent={(agent) =>
              setAgentState(skill.name, agent, skill.agents[agent] !== 'linked')
            }
            onAdopt={(agent) => adoptOne(skill.name, agent)}
            onSyncAll={() => syncAll(skill.name)}
            onUpdate={() => void updateOne(skill.name)}
          />
        ))}
      </SkillGrid>
    );
  };

  return (
    <div className="flex h-full">
      {/* 页内二级导航（桌面） */}
      <aside className="hidden w-[190px] shrink-0 flex-col border-r bg-card/50 md:flex">
        <div className="p-2">
          <NavItem
            icon={<Library />}
            label="中央库"
            count={libraryCount}
            active={nav === 'library'}
            onClick={() => selectNav('library')}
          />
          <NavItem
            icon={<Globe2 />}
            label="全部 Agent"
            count={AGENTS.length}
            active={nav === 'agents'}
            onClick={() => selectNav('agents')}
          />
        </div>

        <div className="border-t px-2 pb-1">
          <SectionLabel>Agent 工作区</SectionLabel>
          {AGENTS.map((agent) => (
            <NavItem
              key={agent.id}
              icon={<AgentBadge agent={agent.id} state="linked" />}
              label={agent.name}
              count={stats?.byAgent[agent.id].total ?? 0}
              active={nav === agent.id}
              onClick={() => selectNav(agent.id)}
            />
          ))}
        </div>

        {profiles.length > 0 && (
          <div className="border-t px-2 pb-1">
            <SectionLabel>预设</SectionLabel>
            {profiles.map((p) => (
              <NavItem
                key={p.id}
                icon={<Layers />}
                label={p.name}
                count={p.skills.length}
                active={presetId === p.id}
                onClick={() => togglePreset(p.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-auto border-t p-2">
          <NavItem
            icon={<Download />}
            label="安装 Skills"
            active={nav === 'install'}
            onClick={() => selectNav('install')}
          />
          <NavItem
            icon={<ShieldCheck />}
            label="审计"
            active={auditOpen}
            onClick={() => void runAudit()}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 小屏：横向滚动 tabs */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card px-2 py-1.5 md:hidden">
          <Chip label="中央库" active={nav === 'library'} onClick={() => selectNav('library')} />
          <Chip
            label="全部 Agent"
            active={nav === 'agents'}
            onClick={() => selectNav('agents')}
          />
          {AGENTS.map((agent) => (
            <Chip
              key={agent.id}
              label={agent.name}
              active={nav === agent.id}
              onClick={() => selectNav(agent.id)}
            />
          ))}
          <Chip
            label="安装 Skills"
            active={nav === 'install'}
            onClick={() => selectNav('install')}
          />
          <Chip label="审计" onClick={() => void runAudit()} />
        </div>

        <header className="shrink-0 border-b bg-card/60 px-4 py-2.5">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">{renderHeader()}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(nav === 'library' || activeAgent) && (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={activeAgent ? '搜索该 Agent 的 skills…' : '搜索中央库 skills…'}
                      className="h-8 w-52 rounded-md border border-input bg-transparent pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />
                  <div className="inline-flex items-center gap-0.5 rounded-md border border-input p-0.5">
                    <button
                      type="button"
                      title="卡片视图"
                      aria-label="卡片视图"
                      onClick={() => setLayout('grid')}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                        layout === 'grid'
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Grid2x2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="列表视图"
                      aria-label="列表视图"
                      onClick={() => setLayout('list')}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                        layout === 'list'
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}

              {activeAgent && (
                <PrimaryButton
                  onClick={() => openPicker(activeAgent)}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  Add Skill
                </PrimaryButton>
              )}
              {nav !== 'install' && (
                <GhostButton
                  onClick={() => selectNav('install')}
                  icon={<Download className="h-3.5 w-3.5" />}
                  title="安装 Skills"
                >
                  安装 Skills
                </GhostButton>
              )}
              <GhostButton
                onClick={() => void runAudit()}
                disabled={!snap || auditLoading}
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                title="审计 skill 库与 agent 本地 skills"
              >
                审计
              </GhostButton>
              {nav === 'library' && (
                <IconButton
                  title="检查 Git 更新"
                  disabled={!catalog || updating || busy}
                  onClick={() => void checkUpdates()}
                >
                  {updating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                  )}
                </IconButton>
              )}
              <IconButton
                title="重新扫描"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </IconButton>
            </div>
          </div>
          {(nav === 'library' || activeAgent) && renderTagsAndFilters()}
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              扫描失败：{error}
              {!isTauri() && '（此功能仅在桌面 App 中可用）'}
            </div>
          )}
          {renderBody()}
        </div>

        <div className="flex h-7 shrink-0 items-center gap-2 border-t bg-card px-3 text-[11px] text-muted-foreground">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success/15 text-[8px] text-success">
            ●
          </span>
          启用 = 在 Agent skills 目录建立指向中央库的软链；禁用只删链接，中央库内容不受影响
        </div>
      </div>

      {/* 批量操作栏 */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-2 shadow-xl">
          <span className="whitespace-nowrap text-xs font-medium">
            已选 {selected.size} 个
          </span>
          <select
            value={batchAgent}
            onChange={(e) =>
              setBatchAgent(e.target.value === 'all' ? 'all' : (e.target.value as AgentId))
            }
            className="h-7 rounded-md border border-input bg-card px-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="批量操作目标 Agent"
          >
            <option value="all">全部 Agent</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => batchApply('enable')}
            className="inline-flex h-7 items-center rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            启用
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => batchApply('disable')}
            className="inline-flex h-7 items-center rounded-full border border-input px-2.5 text-[11px] font-medium hover:bg-accent disabled:opacity-40"
          >
            禁用
          </button>
          <button
            type="button"
            title="清除选择"
            aria-label="清除选择"
            onClick={() => setSelected(new Set())}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-md border px-3 py-2 text-xs shadow-lg ${
            toast.tone === 'err'
              ? 'border-destructive/40 bg-card text-destructive'
              : 'border-success/40 bg-card text-success'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <SkillAuditDrawer
        open={auditOpen}
        report={auditReport}
        loading={auditLoading}
        onClose={() => setAuditOpen(false)}
        onRescan={() => void runAudit()}
      />

      <SkillDetailDrawer
        open={Boolean(detail)}
        skill={detail}
        busy={busy || updating}
        onClose={() => setDetailName(null)}
        onToggleAgent={(agent) => {
          if (!detail) return;
          setAgentState(detail.name, agent, detail.agents[agent] !== 'linked');
        }}
        onAdopt={(agent) => {
          if (detail) adoptOne(detail.name, agent);
        }}
        onSyncAll={() => {
          if (detail) syncAll(detail.name);
        }}
        onUpdate={() => {
          if (detail) void updateOne(detail.name);
        }}
      />

      <AddSkillsPicker
        open={pickerOpen}
        skills={catalog?.skills ?? []}
        initialAgents={pickerAgents}
        busy={busy}
        onClose={() => setPickerOpen(false)}
        onDeploy={deployFromPicker}
      />
    </div>
  );
}