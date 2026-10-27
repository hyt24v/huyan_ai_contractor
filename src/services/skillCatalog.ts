/**
 * Skills 目录服务：在 scanAll 快照之上补齐描述、标签、来源，供卡片网格使用。
 * 读不到 SKILL.md / git 信息时降级为空值，绝不因单个 skill 抛错拖垮整个目录。
 */
import type { AgentId } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import { absPath, tauriFs, type FsPort, type DirItem } from '../lib/fsPort';
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
  const visible = effectiveAgents();
  const agentDirs = {} as Record<AgentId, string>;
  for (const agent of visible) {
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
      for (const agent of visible) {
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

  // 最后修改时间（「最近更新」排序用）：一次性批量查询，失败/不支持时静默降级
  if (fs.mtimeMs) {
    try {
      const dirs = skills
        .map((s) => skillDirOf(s))
        .filter((p): p is string => Boolean(p));
      const mtimes = await fs.mtimeMs(dirs);
      for (const skill of skills) {
        const dir = skillDirOf(skill);
        const mtime = dir ? mtimes[dir] : undefined;
        if (typeof mtime === 'number') skill.mtimeMs = mtime;
      }
    } catch {
      // 非 Tauri 环境 / 命令不可用：目录照常返回，只是没有 mtime
    }
  }

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
  for (const agent of effectiveAgents()) {
    const dir = skill.agentPaths[agent.id];
    if (dir) paths.push(`${dir}/SKILL.md`);
  }
  const meta = await readMeta(fs, paths);
  return meta.content;
}

/** 该 skill 的实际目录：优先中央库,否则任一 agent 下的本地副本 */
export function skillDirOf(skill: CatalogSkill): string | null {
  return (
    skill.libraryPath ??
    Object.values(skill.agentPaths).find((p): p is string => !!p) ??
    null
  );
}

export interface SkillFileEntry {
  /** 相对 skill 根目录的路径(目录以 / 结尾) */
  path: string;
  isDirectory: boolean;
  depth: number;
}

const SKILL_TREE_MAX_DEPTH = 6;
const SKILL_TREE_MAX_ENTRIES = 500;

/**
 * 列出 skill 目录下全部文件(深度优先,目录在前)。
 * 超限截断并跳过 .git;单目录读取失败降级为空,不拖垮整个列表。
 */
export async function listSkillFiles(
  skill: CatalogSkill,
  fs: FsPort = tauriFs,
): Promise<SkillFileEntry[]> {
  const root = skillDirOf(skill);
  if (!root) return [];
  const out: SkillFileEntry[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > SKILL_TREE_MAX_DEPTH || out.length >= SKILL_TREE_MAX_ENTRIES) return;
    let entries: DirItem[];
    try {
      entries = await fs.readDir(dir);
    } catch {
      return;
    }
    const dirs = entries.filter((e) => e.isDirectory && e.name !== '.git');
    const files = entries.filter((e) => !e.isDirectory);
    for (const d of dirs) {
      if (out.length >= SKILL_TREE_MAX_ENTRIES) return;
      const rel = `${prefix}${d.name}/`;
      out.push({ path: rel, isDirectory: true, depth });
      await walk(`${dir}/${d.name}`, rel, depth + 1);
    }
    for (const f of files) {
      if (out.length >= SKILL_TREE_MAX_ENTRIES) return;
      out.push({ path: `${prefix}${f.name}`, isDirectory: false, depth });
    }
  };
  await walk(root, '', 0);
  return out;
}

const TEXT_FILE_MAX_BYTES = 512 * 1024;
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sh', 'bash', 'zsh',
  'css', 'html', 'sql', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'rb',
]);

/** 判断文件名是否按文本预览(看扩展名;无扩展名视为文本,如 LICENSE) */
export function isTextFileName(name: string): boolean {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return ext === '' || TEXT_EXTENSIONS.has(ext);
}

/** 读取 skill 内文件文本;非文本/超限抛错(调用方提示不支持预览) */
export async function readSkillFileText(
  skill: CatalogSkill,
  relPath: string,
  fs: FsPort = tauriFs,
): Promise<string> {
  const root = skillDirOf(skill);
  if (!root) throw new Error('该 skill 不在本机');
  const name = relPath.split('/').pop() ?? relPath;
  if (!isTextFileName(name)) throw new Error('该文件类型不支持预览');
  const text = await fs.readText(`${root}/${relPath}`);
  if (text.length > TEXT_FILE_MAX_BYTES) throw new Error('文件过大,不支持预览(>512KB)');
  return text;
}