/**
 * Skills 目录服务：在 scanAll 快照之上补齐描述、标签、来源，供卡片网格使用。
 * 读不到 SKILL.md / git 信息时降级为空值，绝不因单个 skill 抛错拖垮整个目录。
 */
import { AGENTS, type AgentId } from '../lib/agents';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import type {
  CatalogSkill,
  SkillCatalog,
  SkillSource,
} from '../lib/skillCatalog';
import { parseSkillMdMeta, type SkillAgentState } from '../lib/skills';
import { scanAll, skillGitRemote, type SkillsSnapshot } from './agentSkills';

export interface SkillCatalogScan {
  snapshot: SkillsSnapshot;
  catalog: SkillCatalog;
}

interface SkillMetaRead {
  description?: string;
  tags: string[];
  content: string;
}

/** 依次尝试候选 SKILL.md，第一个可读的生效 */
async function readMeta(fs: FsPort, paths: readonly string[]): Promise<SkillMetaRead> {
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    try {
      if (!(await fs.exists(path))) continue;
      const content = await fs.readText(path);
      const meta = parseSkillMdMeta(content);
      return { description: meta.description, tags: meta.tags ?? [], content };
    } catch {
      // 坏软链 / 权限不足：继续尝试下一个候选
    }
  }
  return { tags: [], content: '' };
}

async function gitRemoteOf(name: string, fs: FsPort): Promise<string | undefined> {
  try {
    const remote = await skillGitRemote(name, fs);
    return remote ? remote : undefined;
  } catch {
    // 非 git 仓库或非 Tauri 环境
    return undefined;
  }
}

/** 库内 skill：有 git 远端才是 git / skills.sh；否则视为本地 */
export function detectSkillSource(
  inLibrary: boolean,
  gitRemote?: string,
  content = '',
): SkillSource {
  if (!inLibrary || !gitRemote) return 'local';
  if (/skills\.sh/i.test(gitRemote) || /skills\.sh/i.test(content)) return 'skills.sh';
  return 'git';
}

/** 把扫描快照 enrich 成目录。每个 skill 只读一次 SKILL.md（库优先，其次 agent 本地） */
export async function buildSkillCatalog(
  snapshot: SkillsSnapshot,
  fs: FsPort = tauriFs,
): Promise<SkillCatalog> {
  const agentDirs = {} as Record<AgentId, string>;
  for (const agent of AGENTS) {
    agentDirs[agent.id] = await absPath(agent.skillsDir);
  }

  const skills = await Promise.all(
    snapshot.rows.map(async (row): Promise<CatalogSkill> => {
      const libraryPath = row.inLibrary ? `${snapshot.libraryAbs}/${row.name}` : undefined;
      const agentPaths: Partial<Record<AgentId, string>> = {};
      const metaPaths: string[] = [];
      if (libraryPath) metaPaths.push(`${libraryPath}/SKILL.md`);

      for (const scan of snapshot.scans) {
        const state = row.agents[scan.agent];
        if (state === 'none') continue;
        const dir = `${agentDirs[scan.agent]}/${row.name}`;
        agentPaths[scan.agent] = dir;
        // linked 软链指向库内同一份 SKILL.md，只需读库内一次
        if (state === 'local') metaPaths.push(`${dir}/SKILL.md`);
      }

      const meta = await readMeta(fs, metaPaths);
      const gitRemote = row.inLibrary ? await gitRemoteOf(row.name, fs) : undefined;
      const agents = {} as Record<AgentId, SkillAgentState>;
      for (const agent of AGENTS) {
        agents[agent.id] = row.agents[agent.id] ?? 'none';
      }

      return {
        name: row.name,
        ...(meta.description ? { description: meta.description } : {}),
        tags: meta.tags,
        source: detectSkillSource(row.inLibrary, gitRemote, meta.content),
        ...(gitRemote ? { gitRemote } : {}),
        inLibrary: row.inLibrary,
        agents,
        ...(libraryPath ? { libraryPath } : {}),
        agentPaths,
      };
    }),
  );

  return {
    libraryAbs: snapshot.libraryAbs,
    skills,
    generatedAt: new Date().toISOString(),
  };
}

/** 扫描一次并生成目录（页面刷新入口） */
export async function scanSkillCatalog(fs: FsPort = tauriFs): Promise<SkillCatalogScan> {
  const snapshot = await scanAll(fs);
  return { snapshot, catalog: await buildSkillCatalog(snapshot, fs) };
}

/** 读取某个 skill 的 SKILL.md 原始内容（详情抽屉预览用） */
export async function readSkillMd(skill: CatalogSkill, fs: FsPort = tauriFs): Promise<string> {
  const paths: string[] = [];
  if (skill.libraryPath) paths.push(`${skill.libraryPath}/SKILL.md`);
  for (const agent of AGENTS) {
    const dir = skill.agentPaths[agent.id];
    if (dir) paths.push(`${dir}/SKILL.md`);
  }
  const meta = await readMeta(fs, paths);
  return meta.content;
}