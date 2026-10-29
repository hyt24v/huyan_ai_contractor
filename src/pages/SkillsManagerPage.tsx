import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../hooks/useToast';
import { pickDirectory } from '../lib/pickDirectory';
import {
  ArrowUpCircle,
  Check,
  ChevronRight,
  Crosshair,
  Download,
  ExternalLink,
  Folder,
  FolderGit2,
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
import { SegmentedControl, ToolbarButton } from '../components/Toolbar';
import { Button } from '../components/ui/controls';
import { Dialog } from '../components/ui/overlay';
import { EmptyState, Skeleton } from '../components/ui/states';
import { Select } from '../components/ui/form';
import SkillAuditDrawer from '../components/SkillAuditDrawer';
import AddSkillsPicker from '../components/skills/AddSkillsPicker';
import AgentPickerPopover from '../components/skills/AgentPickerPopover';
import AgentBadge, { agentName } from '../components/skills/AgentBadge';
import SkillCard, { TagPill } from '../components/skills/SkillCard';
import SkillDetailDrawer from '../components/skills/SkillDetailDrawer';
import SkillGrid from '../components/skills/SkillGrid';
import { AGENTS, type AgentId } from '../lib/agents';
import { useAgents } from '../hooks/useAgents';
import { onSettingsChanged } from '../lib/settings';
import {
  PROJECT_STATUS_LABEL,
  computeSkillMatrix,
  projectSkillStatus,
  type AgentSkillsScan,
  type ProjectSkillStatus,
  type SkillAgentState,
} from '../lib/skills';
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
import {
  buildLibrarySections,
  isSectionCollapsed,
  loadCollapsedSkillGroups,
  loadPinnedSkills,
  loadSkillsViewPrefs,
  saveCollapsedSkillGroups,
  savePinnedSkills,
  saveSkillsViewPrefs,
  toggleSectionCollapsed,
  type SkillGroupBy,
  type SkillSection,
  type SkillSortKey,
  type SkillsViewPrefs,
} from '../lib/skillGrouping';
import type { Profile } from '../lib/profiles';
import type { AuditReport } from '../lib/skillAudit';
import type { SkillRepo } from '../lib/skillRegistry';
import { skillNameFromGitUrl } from '../lib/skills';
import {
  adoptSkill,
  replaceLocalWithLibrary,
  disableSkill,
  enableSkill,
  installFromGit,
  listRepoSkills,
  COLLECTION_REPO_HINT,
  skillGitStatus,
  updateSkillFromGit,
} from '../services/agentSkills';
import { peekSkillCatalogScan, scanSkillCatalog } from '../services/skillCatalog';
import { auditSnapshot } from '../services/skillAudit';
import { listCurated, searchRepos } from '../services/skillRegistry';
import {
  adoptFromProject,
  addProject,
  deployToProject,
  loadProjects,
  removeFromProject,
  removeProject,
  replaceProjectWithLibrary,
  scanProject,
  type LinkedProject,
} from '../services/projectSkills';
import { loadProfiles } from '../services/profiles';
import { isTauri } from '@tauri-apps/api/core';
import { FloatingToast } from '../components/Toast';

type NavKey =
  | 'library'
  | 'agents'
  | 'install'
  | 'projects'
  | AgentId
  | `proj:${string}`;
type LayoutMode = 'grid' | 'list';
type MarketSource = 'curated' | 'github' | 'fallback';

const SOURCE_FILTERS: { value: CatalogFilter; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'local', label: '本地' },
  { value: 'git', label: 'Git' },
  { value: 'skills.sh', label: 'skills.sh' },
  { value: 'untagged', label: '无标签' },
];

const VIEW_OPTIONS: { value: CatalogView; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已部署' },
  { value: 'available', label: '未部署' },
];

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 分批渲染：每批追加的卡片数（配合 IntersectionObserver 哨兵） */
const RENDER_BATCH_SIZE = 50;

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
          ? 'pill-active font-medium'
          : 'pill-inactive hover:bg-accent/60 hover:text-foreground'
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ${
        active
          ? 'pill-active font-medium'
          : 'pill-inactive hover:bg-accent hover:text-foreground'
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
    <Button
      variant="outline"
      size="icon"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={active ? 'pill-active' : 'text-muted-foreground'}
    >
      {children}
    </Button>
  );
}

function PrimaryButton({
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
    <Button onClick={onClick} disabled={disabled} title={title} className="gap-1.5 px-3">
      {icon}
      {children}
    </Button>
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
    <Button
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="gap-1.5 px-3"
    >
      {icon}
      {children}
    </Button>
  );
}

export default function SkillsManagerPage() {
  const agents = useAgents();
  const agentIds = agents.map((a) => a.id);
  // 只用于审计按钮的可用性判断，不需要保留快照本体
  const [snapReady, setSnapReady] = useState(false);
  const [catalog, setCatalog] = useState<SkillCatalog | null>(
    () => peekSkillCatalogScan()?.catalog ?? null,
  );
  // 有缓存则先展示缓存、后台静默重扫；无缓存才显示加载态
  const [loading, setLoading] = useState(() => peekSkillCatalogScan() == null);
  const [error, setError] = useState('');
  const { toast, showToast } = useToast(3200);
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

  // 技能库浏览偏好：分组 / 排序 / 聚焦视图（持久化到 localStorage）
  const [viewPrefs, setViewPrefs] = useState<SkillsViewPrefs>(() => loadSkillsViewPrefs());
  const [pinnedNames, setPinnedNames] = useState<string[]>(() => loadPinnedSkills());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string> | null>(() => {
    const ids = loadCollapsedSkillGroups();
    return ids ? new Set(ids) : null;
  });
  // 分批渲染窗口（数量大时只渲染可视区附近，滚动到底再追加）
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // 批量操作目标：默认全部可见 agent
  // null = 未手动选择过（按全部可见 agent 处理）；空 Set = 用户显式清空（此时禁止批量操作）
  const [batchAgents, setBatchAgents] = useState<Set<AgentId> | null>(null);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAgents, setPickerAgents] = useState<AgentId[]>(['claude']);

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const [installUrl, setInstallUrl] = useState('');

  // ---- 项目工作区（复刻 skills-manager 项目库模型） ----
  const [projects, setProjects] = useState<LinkedProject[]>([]);
  const [projectScans, setProjectScans] = useState<AgentSkillsScan[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPath, setLinkPath] = useState('');
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploySkill, setDeploySkill] = useState('');
  const [deployAgent, setDeployAgent] = useState<AgentId>('claude');
  const [marketQuery, setMarketQuery] = useState('');
  const [marketRepos, setMarketRepos] = useState<SkillRepo[]>(() => listCurated());
  const [marketSource, setMarketSource] = useState<MarketSource>('curated');
  const [marketError, setMarketError] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketTag, setMarketTag] = useState('all');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const next = await scanSkillCatalog();
      setSnapReady(true);
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

  // 设置里切换 agent 显示后重扫(可见 agent 列表变了)
  useEffect(
    () => onSettingsChanged(() => void refresh()),
    [refresh],
  );

  useEffect(() => {
    let alive = true;
    loadProfiles()
      .then((store) => {
        if (alive) setProfiles(store.profiles);
      })
      .catch(() => {
        // 浏览器 / 无配置文件时忽略
      });
    loadProjects()
      .then((list) => {
        if (alive) setProjects(list);
      })
      .catch(() => {
        // 首次使用无 projects.json
      });
    return () => {
      alive = false;
    };
  }, []);

  const activeAgent: AgentId | null =
    nav === 'library' ||
    nav === 'agents' ||
    nav === 'install' ||
    nav === 'projects' ||
    nav.startsWith('proj:')
      ? null
      : (nav as AgentId);
  /** 当前项目工作区路径（nav = proj:<path>） */
  const activeProject = nav.startsWith('proj:') ? nav.slice(5) : null;

  // 进入项目页 / 每次操作后重扫项目（与中央库 refresh 同步）
  const refreshProject = useCallback(async () => {
    if (!activeProject) return;
    try {
      setProjectScans(await scanProject(activeProject));
    } catch {
      setProjectScans([]);
    }
  }, [activeProject]);

  useEffect(() => {
    void refreshProject();
  }, [refreshProject]);

  const run = useCallback(
    async (fn: () => Promise<string | void>, okMsg: string) => {
      setBusy(true);
      try {
        const msg = await fn();
        showToast(typeof msg === 'string' && msg ? msg : okMsg);
        await refresh();
        await refreshProject();
      } catch (e) {
        showToast(`操作失败：${errMsg(e)}`, 'err');
      } finally {
        setBusy(false);
      }
    },
    [refresh, refreshProject, showToast],
  );

  const stats = useMemo(() => (catalog ? catalogStats(catalog) : null), [catalog]);
  const activeStats = activeAgent && stats ? stats.byAgent[activeAgent] : null;
  const activeDef = activeAgent ? AGENTS.find((a) => a.id === activeAgent) ?? null : null;
  const preset = profiles.find((p) => p.id === presetId) ?? null;

  const tagSource = useMemo(() => {
    const all = catalog?.skills ?? [];
    return activeAgent ? all.filter((s) => (s.agents[activeAgent] ?? 'none') !== 'none') : all;
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

  const pinnedSet = useMemo(() => new Set(pinnedNames), [pinnedNames]);

  // 技能库视图的分组结果（置顶组 → 聚焦/分组 → 「其他」默认折叠组）
  const librarySections = useMemo<SkillSection[]>(() => {
    if (nav !== 'library') return [];
    return buildLibrarySections(visible, {
      pinned: pinnedSet,
      focus: viewPrefs.focus,
      groupBy: viewPrefs.groupBy,
      sortKey: viewPrefs.sortKey,
    });
  }, [nav, visible, pinnedSet, viewPrefs]);

  const updateViewPrefs = useCallback((patch: Partial<SkillsViewPrefs>) => {
    setViewPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveSkillsViewPrefs(next);
      return next;
    });
  }, []);

  const togglePin = useCallback((name: string) => {
    setPinnedNames((prev) => {
      const next = toggleInList(prev, name);
      savePinnedSkills(next);
      return next;
    });
  }, []);

  const toggleSection = useCallback(
    (section: SkillSection) => {
      setCollapsedGroups((prev) => {
        const next = toggleSectionCollapsed(prev, librarySections, section.id);
        saveCollapsedSkillGroups([...next]);
        return next;
      });
    },
    [librarySections],
  );

  // 筛选 / 视图变化时重置分批渲染窗口
  useEffect(() => {
    setRenderLimit(RENDER_BATCH_SIZE);
  }, [nav, query, view, sourceFilter, tags, presetId, viewPrefs]);

  // 当前视图去掉折叠组后的卡片总数（分批渲染的上限）
  const renderedTotal = useMemo(
    () =>
      nav === 'library'
        ? librarySections.reduce(
            (n, s) => n + (isSectionCollapsed(collapsedGroups, s) ? 0 : s.skills.length),
            0,
          )
        : visible.length,
    [nav, librarySections, collapsedGroups, visible],
  );

  // 哨兵进入视口附近时追加一批；若渲染后哨兵仍在视口内（内容不足一屏 / 组多折叠）继续追加
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || renderLimit >= renderedTotal) return;
    const grow = () => setRenderLimit((n) => n + RENDER_BATCH_SIZE);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) grow();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    if (el.getBoundingClientRect().top < window.innerHeight + 600) grow();
    return () => io.disconnect();
  }, [nav, renderLimit, renderedTotal]);

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

  // ---- 部署 / 移除 / 收编 ----
  const setAgentState = useCallback(
    (name: string, agent: AgentId, enable: boolean) => {
      const skill = findSkill(name);
      if (!skill) return;
      if (enable && !skill.inLibrary) {
        showToast('本地技能需先收编到中央库才能部署', 'err');
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
      }, enable ? `已部署 ${name} 到 ${agentName(agent)}` : `已从 ${agentName(agent)} 移除 ${name}`);
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
      if (
        !window.confirm(
          `将把 ${agentName(agent)} 本地的「${name}」移入中央库，并把原位置替换为软链。继续？`,
        )
      )
        return;
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
        const targets = agents.filter((a) =>
          enabled ? skill.agents[a.id] === 'linked' : skill.agents[a.id] === 'none',
        );
        let ok = 0;
        const failed: string[] = [];
        for (const agent of targets) {
          try {
            if (enabled) await disableSkill(name, agent.id);
            else await enableSkill(name, agent.id);
            ok++;
          } catch (e) {
            failed.push(`${agent.name}: ${errMsg(e)}`);
          }
        }
        if (failed.length > 0) {
          throw new Error(`成功 ${ok}/${targets.length}；${failed.join('；')}`);
        }
      }, enabled ? `已移除 ${name} 的全部链接` : `已将 ${name} 部署到全部 Agent`);
    },
    [agents, findSkill, run, showToast],
  );

  const syncAll = useCallback(
    (name: string) => {
      const skill = findSkill(name);
      if (!skill?.inLibrary) {
        showToast('先收编到中央库才能同步', 'err');
        return;
      }
      void run(async () => {
        const targets = agents.filter((a) => skill.agents[a.id] === 'none');
        let ok = 0;
        const failed: string[] = [];
        for (const agent of targets) {
          try {
            await enableSkill(name, agent.id);
            ok++;
          } catch (e) {
            failed.push(`${agent.name}: ${errMsg(e)}`);
          }
        }
        if (failed.length > 0) {
          throw new Error(`成功 ${ok}/${targets.length}；${failed.join('；')}`);
        }
      }, `已将 ${name} 同步到全部 Agent`);
    },
    [agents, findSkill, run, showToast],
  );

  const batchApply = (mode: 'enable' | 'disable') => {
    if (selected.size === 0) return;
    // null = 未手动选择过，按「全部可见 agent」处理；同时过滤设置里已隐藏的 agent
    const pool = batchAgents === null ? agentIds : [...batchAgents];
    const targets: AgentId[] = pool.filter((id) => agentIds.includes(id));
    if (targets.length === 0) {
      showToast('请先选择至少一个目标 Agent', 'err');
      return;
    }
    void run(async () => {
      let ok = 0;
      const failed: string[] = [];
      for (const name of selected) {
        const skill = findSkill(name);
        if (!skill) continue;
        if (mode === 'enable' && !skill.inLibrary) continue;
        for (const agent of targets) {
          const state = skill.agents[agent];
          try {
            if (mode === 'enable') {
              if (state === 'none') { await enableSkill(name, agent); ok++; }
            } else if (state === 'linked') {
              await disableSkill(name, agent); ok++;
            }
          } catch (e) {
            failed.push(`${name}→${agent}: ${errMsg(e)}`);
          }
        }
      }
      if (failed.length > 0) {
        throw new Error(`成功 ${ok} 项；失败 ${failed.length} 项：${failed.slice(0, 3).join('；')}`);
      }
      return `已${mode === 'enable' ? '部署' : '移除'} ${ok} 项${ok === 0 ? '（状态已符合，无需变更）' : ''}`;
    }, `已批量${mode === 'enable' ? '部署' : '移除'} ${selected.size} 个 skill`);
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
          if ((skill.agents[agent] ?? 'none') !== 'none') { skipped++; continue; }
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
      return `已部署 ${ok} 项${skipped > 0 ? `，跳过 ${skipped} 项（已在库外/已部署）` : ''}`;
    }, `已部署 ${names.length} 个 skill 到 ${agents.length} 个 Agent`);
    setPickerOpen(false);
  };

  // ---- 项目工作区操作（复刻 skills-manager：部署 / 移除 / 收编 / 替换） ----
  const linkProject = useCallback(async () => {
    setBusy(true);
    try {
      const next = await addProject(linkPath);
      setProjects(next);
      setLinkOpen(false);
      setLinkPath('');
      showToast('已关联项目');
    } catch (e) {
      showToast(`关联失败：${errMsg(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  }, [linkPath, showToast]);

  const unlinkProject = useCallback(
    (path: string) => {
      if (!window.confirm(`取消关联项目 ${path}？只移除登记，不改动磁盘文件。`)) return;
      void run(async () => {
        const next = await removeProject(path);
        setProjects(next);
        if (nav === `proj:${path}`) selectNav('projects');
      }, '已取消关联');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nav, run],
  );

  const projectDeploy = useCallback(
    (name: string, agent: AgentId) => {
      if (!activeProject) return;
      void run(
        () => deployToProject(name, activeProject, agent),
        `已部署 ${name} 到项目`,
      );
    },
    [activeProject, run],
  );

  const projectRemove = useCallback(
    (name: string, agent: AgentId) => {
      if (!activeProject) return;
      void run(
        () => removeFromProject(name, activeProject, agent),
        `已移除项目中的 ${name} 链接`,
      );
    },
    [activeProject, run],
  );

  const projectAdopt = useCallback(
    (name: string, agent: AgentId) => {
      if (!activeProject) return;
      if (
        !window.confirm(
          `将把项目中 ${agentName(agent)} 的「${name}」移入中央库，并把原位置替换为软链。继续？`,
        )
      )
        return;
      void run(
        () => adoptFromProject(name, activeProject, agent),
        `已收编 ${name} 到中央库`,
      );
    },
    [activeProject, run],
  );

  const projectReplace = useCallback(
    (name: string, agent: AgentId) => {
      if (!activeProject) return;
      if (
        !window.confirm(
          `将用中央库版本替换项目中的「${name}」。\n项目里的副本会先自动备份到 ~/.ai-baogongtou/skill-backups/（可恢复）。继续？`,
        )
      )
        return;
      void run(
        () => replaceProjectWithLibrary(name, activeProject, agent),
        `已用中央库版本替换项目中的 ${name}`,
      );
    },
    [activeProject, run],
  );

  /** 项目页行：中央库 skill × 可见 agent，带项目三态 */
  const projectRows = useMemo(() => {
    if (!activeProject || !catalog) return [];
    const libNames = catalog.skills.filter((s) => s.inLibrary).map((s) => s.name);
    const rows = computeSkillMatrix(libNames, projectScans);
    return rows.flatMap((row) =>
      agents.map((a) => {
        const state: SkillAgentState = row.agents[a.id] ?? 'none';
        const status: ProjectSkillStatus = projectSkillStatus(row.inLibrary, state);
        return { name: row.name, inLibrary: row.inLibrary, agent: a.id, state, status };
      }),
    );
  }, [activeProject, catalog, projectScans, agents]);

  const librarySkillNames = useMemo(
    () => (catalog?.skills ?? []).filter((s) => s.inLibrary).map((s) => s.name),
    [catalog],
  );

  const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const updateOne = useCallback(
    async (name: string) => {
      setUpdating(true);
      setBusy(true);
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
        setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
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
  // 合集仓库（根目录无 SKILL.md）弹选择器，让用户挑具体 skill
  const [collectionPicker, setCollectionPicker] = useState<{
    base: string;
    skills: string[];
  } | null>(null);

  const installWithPicker = (url: string) => {
    const trimmed = url.trim();
    const name = skillNameFromGitUrl(trimmed);
    if (!name) {
      showToast('无法从 URL 解析 skill 名', 'err');
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        await installFromGit(trimmed, name);
        showToast(`已安装 ${name} 到中央库`);
        await refresh();
        await refreshProject();
      } catch (e) {
        const msg = errMsg(e);
        if (msg.includes(COLLECTION_REPO_HINT)) {
          try {
            const skills = await listRepoSkills(trimmed);
            if (skills.length > 0) {
              const base = trimmed.replace(/\.git$/, '').replace(/\/$/, '');
              setCollectionPicker({ base, skills });
              return;
            }
          } catch (e2) {
            showToast(`扫描合集仓库失败：${errMsg(e2)}`, 'err');
            return;
          }
        }
        showToast(`操作失败：${msg}`, 'err');
      } finally {
        setBusy(false);
      }
    })();
  };

  const installFromUrl = () => {
    if (!skillNameFromGitUrl(installUrl)) {
      showToast('无法从 URL 解析 skill 名', 'err');
      return;
    }
    installWithPicker(installUrl);
    setInstallUrl('');
  };

  const installRepo = (repo: SkillRepo) => {
    if (!skillNameFromGitUrl(repo.url)) {
      showToast('无法从仓库地址解析 skill 名', 'err');
      return;
    }
    installWithPicker(repo.url);
  };

  // 从合集仓库安装选中的 skill（tree 链接的 branch 段不参与克隆，填 main 占位即可）
  const installFromCollection = (sub: string) => {
    if (!collectionPicker) return;
    const name = sub.split('/').pop() ?? sub;
    const url = `${collectionPicker.base}/tree/main/${sub}`;
    setCollectionPicker(null);
    void run(() => installFromGit(url, name), `已安装 ${name} 到中央库`);
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
    setAuditOpen(true);
    setAuditLoading(true);
    try {
      // 重扫文件系统再审计，避免用页面加载时的旧快照（重扫按钮才真的“重扫”）
      const next = await scanSkillCatalog();
      setSnapReady(true);
      setCatalog(next.catalog);
      setAuditReport(await auditSnapshot(next.snapshot));
    } catch (e) {
      setAuditReport(null);
      showToast(`审计失败：${errMsg(e)}`, 'err');
    } finally {
      setAuditLoading(false);
    }
  }, [showToast]);

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
        <Button
          variant="ghost"
          size="xs"
          onClick={clearFilters}
          className="text-muted-foreground"
        >
          <X className="h-3 w-3" />
          清除筛选
        </Button>
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
              {agents.length}
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
              已部署 {stats?.enabled ?? 0} / 共 {totalCount} 个
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (nav === 'projects') {
      return (
        <div>
          {projects.length === 0 ? (
            <EmptyState
              icon={<FolderGit2 className="h-10 w-10" />}
              title="还没有关联项目"
              description="关联项目后，项目里的 .claude/skills 等目录会与中央库双向同步。"
              action={
                <PrimaryButton onClick={() => setLinkOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
                  关联第一个项目
                </PrimaryButton>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => selectNav(`proj:${p.path}`)}
                  className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Folder className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{baseName(p.path)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {p.path}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (activeProject) {
      const rows = projectRows.filter((r) => r.state !== 'none');
      const tone = (s: ProjectSkillStatus) =>
        s === 'synced'
          ? 'bg-success/15 text-success'
          : s === 'diverged'
            ? 'bg-warning text-warning-foreground'
            : 'bg-muted text-muted-foreground';
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <PrimaryButton
              onClick={() => {
                setDeploySkill(librarySkillNames[0] ?? '');
                setDeployAgent(agents[0]?.id ?? 'claude');
                setDeployOpen(true);
              }}
              disabled={busy || librarySkillNames.length === 0 || agents.length === 0}
              title={agents.length === 0 ? '没有可见的 Agent（请在 设置→Agent 管理 中启用）' : undefined}
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              从中央库部署到项目
            </PrimaryButton>
            <GhostButton onClick={() => unlinkProject(activeProject)} disabled={busy}>
              取消关联
            </GhostButton>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title="项目里还没有 skills"
              description="点「从中央库部署到项目」，或把 skill 目录放进项目的 agent skills 目录后刷新。"
              className="rounded-lg border border-dashed"
            />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Skill</th>
                    <th className="w-24 px-2 py-2 font-medium">Agent</th>
                    <th className="w-28 px-2 py-2 font-medium">状态</th>
                    <th className="w-52 px-2 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.name}-${r.agent}`} className="border-t transition-colors hover:bg-muted/40">
                      <td className="px-3 py-1.5 font-mono text-[13px]">{r.name}</td>
                      <td className="px-2 py-1.5">
                        <AgentBadge agent={r.agent} state={r.state} />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${tone(r.status)}`}>
                          {PROJECT_STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {r.status === 'synced' && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            onClick={() => projectRemove(r.name, r.agent)}
                            className="text-muted-foreground"
                          >
                            移除链接
                          </Button>
                        )}
                        {r.status === 'project-only' && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            onClick={() => projectAdopt(r.name, r.agent)}
                          >
                            收编到中央库
                          </Button>
                        )}
                        {r.status === 'diverged' && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            onClick={() => projectReplace(r.name, r.agent)}
                            title="项目副本自动备份后替换为中央库软链"
                            className="border-warning/40 text-warning"
                          >
                            用中央库替换
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    if (nav === 'agents') {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const st = stats?.byAgent[agent.id];
            const total = st?.total ?? 0;
            const pct = ratioPercent(st?.inSync ?? 0, total);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectNav(agent.id)}
                className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
              >
                <AgentBadge
                  agent={agent.id}
                  state={(st?.linked ?? 0) > 0 ? 'linked' : 'none'}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{agent.name}</span>
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
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
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
              <GhostButton
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
              </GhostButton>
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
            <EmptyState
              title={marketLoading ? '搜索中…' : '没有匹配的仓库'}
              description={marketLoading ? undefined : '换个关键词或标签试试'}
              className="rounded-lg border border-dashed"
            />
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
                    className="flex flex-col rounded-xl border border-border/70 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <GitBranch className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium">{repo.name}</span>
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
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          onClick={() => installRepo(repo)}
                          title="克隆到中央库"
                          className="shrink-0"
                        >
                          <Download className="h-3 w-3" />
                          安装
                        </Button>
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
            <Skeleton key={i} className="h-[150px] rounded-lg border" />
          ))}
        </div>
      );
    }

    const renderSkillCard = (skill: CatalogSkill) => (
      <SkillCard
        key={skill.name}
        skill={skill}
        layout={layout}
        selected={selected.has(skill.name)}
        busy={busy}
        pinned={pinnedSet.has(skill.name)}
        onTogglePin={() => togglePin(skill.name)}
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
    );

    const emptyBlock = (
      <EmptyState
        icon={<Package className="h-10 w-10" />}
        title={filtersActive ? '没有匹配的 skill' : '这里还没有 skill'}
        description={
          filtersActive
            ? '换个关键词、标签或来源试试，也可以清除全部筛选。'
            : activeAgent
              ? '去中央库挑选已有 skill，或先从 GitHub 安装。'
              : '从 GitHub / 内置精选安装 skill 到中央库。'
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
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
        }
      />
    );

    if (visible.length === 0) return emptyBlock;

    const sentinel = renderLimit < renderedTotal && (
      <div
        ref={sentinelRef}
        className="flex justify-center py-3 text-[11px] text-muted-foreground"
      >
        下滑加载更多（{Math.min(renderLimit, renderedTotal)}/{renderedTotal}）
      </div>
    );

    // 技能库：置顶组 / 分组 / 聚焦视图，分组可折叠
    if (nav === 'library') {
      const showHeaders = librarySections.some((s) => s.label);
      let budget = renderLimit;
      return (
        <div className="space-y-4">
          {librarySections.map((section) => {
            if (budget <= 0) return null;
            const collapsed = isSectionCollapsed(collapsedGroups, section);
            const shown = collapsed ? [] : section.skills.slice(0, budget);
            if (!collapsed) budget -= section.skills.length;
            return (
              <section key={section.id}>
                {showHeaders && section.label && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section)}
                    aria-expanded={!collapsed}
                    className="mb-1.5 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-semibold text-muted-foreground transition hover:bg-accent/60 hover:text-foreground"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                        collapsed ? '' : 'rotate-90'
                      }`}
                    />
                    {section.id === 'pinned' && (
                      <Star className="h-3 w-3 shrink-0 fill-current text-warning" />
                    )}
                    <span className="truncate">{section.label}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {section.skills.length}
                    </span>
                  </button>
                )}
                {!collapsed && (
                  <SkillGrid layout={layout} isEmpty={false}>
                    {shown.map(renderSkillCard)}
                  </SkillGrid>
                )}
              </section>
            );
          })}
          {sentinel}
        </div>
      );
    }

    // Agent 工作区视图：平铺 + 分批渲染
    return (
      <>
        <SkillGrid layout={layout} isEmpty={false}>
          {visible.slice(0, renderLimit).map(renderSkillCard)}
        </SkillGrid>
        {sentinel}
      </>
    );
  };

  return (
    <div className="flex h-full">
      {/* 页内二级导航（桌面） */}
      <aside className="hidden w-[190px] shrink-0 flex-col border-r bg-card/50 md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto">
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
              count={agents.length}
              active={nav === 'agents'}
              onClick={() => selectNav('agents')}
            />
          </div>

          <div className="border-t px-2 pb-1">
            <SectionLabel>Agent 工作区</SectionLabel>
            {/* 只平铺有 skill 的 agent；其余收进「全部 Agent」页，避免几十个 agent 刷屏 */}
            {agents
              .filter(
                (agent) =>
                  (stats?.byAgent[agent.id]?.total ?? 0) > 0 || nav === agent.id,
              )
              .map((agent) => (
                <NavItem
                  key={agent.id}
                  icon={<AgentBadge agent={agent.id} state="linked" />}
                  label={agent.name}
                  count={stats?.byAgent[agent.id]?.total ?? 0}
                  active={nav === agent.id}
                  onClick={() => selectNav(agent.id)}
                />
              ))}
            {agents.some((a) => (stats?.byAgent[a.id]?.total ?? 0) === 0 && nav !== a.id) && (
              <NavItem
                icon={<ChevronRight />}
                label="更多 Agent…"
                onClick={() => selectNav('agents')}
              />
            )}
          </div>

          {/* 项目工作区（复刻 skills-manager：项目库与中央库双向同步） */}
          <div className="border-t px-2 pb-1">
            <SectionLabel>项目工作区</SectionLabel>
            <NavItem
              icon={<FolderGit2 />}
              label="全部项目"
              count={projects.length}
              active={nav === 'projects'}
              onClick={() => selectNav('projects')}
            />
            {projects.map((p) => (
              <NavItem
                key={p.path}
                icon={<Folder />}
                label={baseName(p.path)}
                active={nav === `proj:${p.path}`}
                onClick={() => selectNav(`proj:${p.path}`)}
              />
            ))}
            <NavItem
              icon={<Plus />}
              label="关联项目…"
              onClick={() => setLinkOpen(true)}
            />
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
        </div>

        <div className="shrink-0 border-t p-2">
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
        {/* 小屏：固定入口 chips + Agent 下拉（几十个 agent 不再横滚刷屏） */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-2 py-1.5 md:hidden">
          <Chip label="中央库" active={nav === 'library'} onClick={() => selectNav('library')} />
          <Chip
            label="全部 Agent"
            active={nav === 'agents'}
            onClick={() => selectNav('agents')}
          />
          <select
            value={activeAgent ?? ''}
            onChange={(e) => {
              if (e.target.value) selectNav(e.target.value as AgentId);
            }}
            title="选择 Agent 工作区"
            className={`h-6 max-w-[140px] rounded-full border px-2 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              activeAgent
                ? 'pill-active'
                : 'border-border bg-card text-muted-foreground'
            }`}
          >
            <option value="">Agent 工作区…</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
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
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="卡片视图"
                      aria-label="卡片视图"
                      onClick={() => setLayout('grid')}
                      className={
                        layout === 'grid'
                          ? 'pill-active'
                          : 'border border-transparent text-muted-foreground'
                      }
                    >
                      <Grid2x2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="列表视图"
                      aria-label="列表视图"
                      onClick={() => setLayout('list')}
                      className={
                        layout === 'list'
                          ? 'pill-active'
                          : 'border border-transparent text-muted-foreground'
                      }
                    >
                      <List className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {nav === 'library' && (
                    <>
                      <Select
                        value={viewPrefs.groupBy}
                        onChange={(e) =>
                          updateViewPrefs({ groupBy: e.target.value as SkillGroupBy })
                        }
                        title="分组方式"
                        aria-label="分组方式"
                        className="w-28"
                      >
                        <option value="none">不分组</option>
                        <option value="tag">按标签分组</option>
                        <option value="source">按来源分组</option>
                      </Select>
                      <Select
                        value={viewPrefs.sortKey}
                        onChange={(e) =>
                          updateViewPrefs({ sortKey: e.target.value as SkillSortKey })
                        }
                        title="组内排序"
                        aria-label="组内排序"
                        className="w-24"
                      >
                        <option value="name">按名称</option>
                        <option value="updated">最近更新</option>
                      </Select>
                      <IconButton
                        title={
                          viewPrefs.focus
                            ? '退出聚焦视图（显示全部）'
                            : '聚焦视图：只看置顶和已部署的 skill'
                        }
                        active={viewPrefs.focus}
                        onClick={() => updateViewPrefs({ focus: !viewPrefs.focus })}
                      >
                        <Crosshair className="h-3.5 w-3.5" />
                      </IconButton>
                    </>
                  )}
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
                disabled={!snapReady || auditLoading}
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
          部署 = 在 Agent skills 目录建立指向中央库的软链；移除只删链接，中央库内容不受影响
        </div>
      </div>

      {/* 批量操作栏 */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-2 shadow-xl">
          <span className="whitespace-nowrap text-xs font-medium">
            已选 {selected.size} 个
          </span>
          <AgentPickerPopover
            agents={agents}
            selected={batchAgents === null ? new Set(agentIds) : batchAgents}
            onChange={(next: Set<AgentId>) => setBatchAgents(next)}
            align="up"
            label="目标 Agent"
            disabled={busy}
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() => batchApply('enable')}
            className="rounded-full text-[11px]"
          >
            部署
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => batchApply('disable')}
            className="rounded-full text-[11px]"
          >
            移除
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="清除选择"
            aria-label="清除选择"
            onClick={() => setSelected(new Set())}
            className="rounded-full text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {toast && <FloatingToast toast={toast} />}

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
        onReplaceWithLibrary={(agent) => {
          if (!detail) return;
          if (
            !window.confirm(
              `将用中央库版本替换 ${agentName(agent)} 中的本地副本「${detail.name}」。\n本地副本会先自动备份到 ~/.ai-baogongtou/skill-backups/（可恢复）。继续？`,
            )
          )
            return;
          void run(
            () => replaceLocalWithLibrary(detail.name, agent),
            `已将 ${agentName(agent)} 的 ${detail.name} 替换为中央库版本`,
          );
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

      {/* 合集仓库 skill 选择器 */}
      {collectionPicker && (
        <Dialog
          open
          onClose={() => setCollectionPicker(null)}
          title="这是一个 skill 合集仓库"
          footer={
            <GhostButton onClick={() => setCollectionPicker(null)}>取消</GhostButton>
          }
        >
          <p className="text-xs text-muted-foreground">
            共发现 {collectionPicker.skills.length} 个 skill，选择要安装的一个：
          </p>
          <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {collectionPicker.skills.map((sub) => (
              <button
                key={sub}
                type="button"
                disabled={busy}
                onClick={() => installFromCollection(sub)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-left text-xs shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] disabled:opacity-40"
              >
                <span className="truncate font-mono">{sub.split('/').pop()}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{sub}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {/* 关联项目对话框 */}
      {linkOpen && (
        <Dialog
          open
          onClose={() => setLinkOpen(false)}
          title="关联项目"
          footer={
            <>
              <ToolbarButton onClick={() => setLinkOpen(false)}>取消</ToolbarButton>
              <ToolbarButton
                primary
                disabled={busy || !linkPath.trim()}
                onClick={() => void linkProject()}
              >
                关联
              </ToolbarButton>
            </>
          }
        >
          <p className="text-xs text-muted-foreground">
            输入项目根目录的绝对路径（如 /Users/you/myproject）。项目里的 .claude/skills 等目录会与中央库双向同步。
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={linkPath}
              onChange={(e) => setLinkPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkPath.trim() && !busy) void linkProject();
              }}
              placeholder="/Users/you/myproject"
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <ToolbarButton
              disabled={busy}
              onClick={() => {
                void pickDirectory('选择项目目录').then((dir) => {
                  if (dir) setLinkPath(dir);
                });
              }}
            >
              浏览…
            </ToolbarButton>
          </div>
        </Dialog>
      )}

      {/* 部署到项目对话框 */}
      {deployOpen && activeProject && (
        <Dialog
          open
          onClose={() => setDeployOpen(false)}
          title="从中央库部署到项目"
          footer={
            <>
              <ToolbarButton onClick={() => setDeployOpen(false)}>取消</ToolbarButton>
              <ToolbarButton
                primary
                disabled={busy || !deploySkill}
                onClick={() => {
                  projectDeploy(deploySkill, deployAgent);
                  setDeployOpen(false);
                }}
              >
                部署
              </ToolbarButton>
            </>
          }
        >
          <p className="text-xs text-muted-foreground">
            在项目的 agent skills 目录建软链指向中央库，改一处处处生效。
          </p>
          <label className="mt-3 block space-y-1">
            <span className="text-xs text-muted-foreground">Skill（中央库）</span>
            <Select
              value={deploySkill}
              onChange={(e) => setDeploySkill(e.target.value)}
            >
              {librarySkillNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </label>
          <label className="mt-2 block space-y-1">
            <span className="text-xs text-muted-foreground">目标 Agent</span>
            <Select
              value={deployAgent}
              onChange={(e) => setDeployAgent(e.target.value as AgentId)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}（{a.skillsDir}）</option>
              ))}
            </Select>
          </label>
        </Dialog>
      )}
    </div>
  );
}