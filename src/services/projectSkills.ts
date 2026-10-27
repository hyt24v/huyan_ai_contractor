/**
 * 项目工作区服务层（复刻 skills-manager 的项目库模型）：
 * 项目 = 用户显式关联的磁盘目录；项目级 skills 目录 = <项目>/<agent.skillsDir>
 * （与全局同构，base 从 $HOME 换成项目根）。
 * 项目路径在 plugin-fs scope 之外，统一走 rawFs（自定义 Rust 命令）。
 */
import { AGENTS, SKILL_LIBRARY_DIR, type AgentId } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import { absPath, home, rawFs, tauriFs } from '../lib/fsPort';
import {
  linkPointsToLibrary,
  type AgentSkillsScan,
  type SkillScanEntry,
} from '../lib/skills';

export interface LinkedProject {
  path: string;
  addedAt: string;
}

const PROJECTS_FILE = '.ai-baogongtou/projects.json';

// ---------- 关联项目列表持久化 ----------

export async function loadProjects(): Promise<LinkedProject[]> {
  const file = await absPath(PROJECTS_FILE);
  if (!(await tauriFs.exists(file))) return [];
  try {
    const raw: unknown = JSON.parse(await tauriFs.readText(file));
    if (!raw || typeof raw !== 'object') return [];
    const list = (raw as { projects?: unknown }).projects;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is LinkedProject =>
        Boolean(p) && typeof p === 'object' && typeof (p as LinkedProject).path === 'string',
    );
  } catch {
    return [];
  }
}

export async function saveProjects(projects: LinkedProject[]): Promise<void> {
  const dir = await absPath('.ai-baogongtou');
  if (!(await tauriFs.exists(dir))) await tauriFs.mkdir(dir);
  await tauriFs.writeText(
    await absPath(PROJECTS_FILE),
    JSON.stringify({ projects }, null, 2),
  );
}

/** 关联项目：展开 ~、验证存在且是目录后追加；已关联则原样返回 */
export async function addProject(path: string): Promise<LinkedProject[]> {
  let clean = path.trim().replace(/[\\/]+$/, '');
  if (!clean) throw new Error('路径不能为空');
  // 支持 ~ 开头（展开为家目录）
  if (clean === '~') clean = await home();
  else if (clean.startsWith('~/') || clean.startsWith('~\\'))
    clean = await absPath(clean.slice(2));
  if (!(await rawFs.exists(clean))) throw new Error(`目录不存在：${clean}`);
  // path_exists 对文件也为 true，必须用 readDir 验证确为目录
  try {
    await rawFs.readDir(clean);
  } catch {
    throw new Error(`不是目录：${clean}`);
  }
  const projects = await loadProjects();
  if (projects.some((p) => p.path === clean)) return projects;
  const next = [...projects, { path: clean, addedAt: new Date().toISOString() }];
  await saveProjects(next);
  return next;
}

/** 取消关联（只删登记，不动磁盘上任何文件） */
export async function removeProject(path: string): Promise<LinkedProject[]> {
  const next = (await loadProjects()).filter((p) => p.path !== path);
  await saveProjects(next);
  return next;
}

// ---------- 项目扫描 ----------

/**
 * 扫描项目目录下各可见 agent 的项目级 skills 目录。
 * 项目级路径 = <项目根>/<agent.skillsDir>（如 myproj/.claude/skills）。
 */
export async function scanProject(projectPath: string): Promise<AgentSkillsScan[]> {
  const libraryAbs = await absPath(SKILL_LIBRARY_DIR);
  const scans: AgentSkillsScan[] = [];
  for (const agent of effectiveAgents()) {
    const dirAbs = `${projectPath}/${agent.skillsDir}`;
    const dirExists = await rawFs.exists(dirAbs);
    const skills: SkillScanEntry[] = [];
    if (dirExists) {
      for (const e of await rawFs.readDir(dirAbs)) {
        if (!e.isDirectory && !e.isSymlink) continue;
        if (e.isSymlink) {
          try {
            const target = await rawFs.readLink(`${dirAbs}/${e.name}`);
            skills.push({
              name: e.name,
              kind: linkPointsToLibrary(target, libraryAbs) ? 'linked' : 'local',
            });
          } catch {
            skills.push({ name: e.name, kind: 'local' });
          }
        } else {
          skills.push({ name: e.name, kind: 'local' });
        }
      }
    }
    scans.push({ agent: agent.id, dirExists, skills });
  }
  return scans;
}

// ---------- 项目层操作（与全局 agent 操作同构，base 换成项目根） ----------

function agentDef(agentId: AgentId) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未知 agent: ${agentId}`);
  return agent;
}

/** 部署：中央库 → 项目（软链）。目标已有真实目录时拒绝并指名路径（红线：不覆盖用户数据） */
export async function deployToProject(
  skillName: string,
  projectPath: string,
  agentId: AgentId,
): Promise<void> {
  const agent = agentDef(agentId);
  const target = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (!(await tauriFs.exists(target)))
    throw new Error(`中央库不存在 ${skillName}，请先安装或收编`);
  const linkDir = `${projectPath}/${agent.skillsDir}`;
  await rawFs.mkdir(linkDir);
  const link = `${linkDir}/${skillName}`;
  if (await rawFs.isSymlink?.(link)) {
    await rawFs.remove(link, true);
  } else if (await rawFs.exists(link)) {
    throw new Error(
      `目标路径已被本地 skill 占用：${link}（真实目录不会被覆盖；可先「收编到中央库」或手动移走）`,
    );
  }
  await rawFs.symlink(target, link);
}

/** 移除：只删项目里的软链；真实目录是用户数据，不动 */
export async function removeFromProject(
  skillName: string,
  projectPath: string,
  agentId: AgentId,
): Promise<void> {
  const agent = agentDef(agentId);
  const link = `${projectPath}/${agent.skillsDir}/${skillName}`;
  if (await rawFs.isSymlink?.(link)) await rawFs.remove(link, true);
}

/** 收编：项目真实目录 → 拷入中央库 + 原位置替换为软链 */
export async function adoptFromProject(
  skillName: string,
  projectPath: string,
  agentId: AgentId,
): Promise<void> {
  const agent = agentDef(agentId);
  const src = `${projectPath}/${agent.skillsDir}/${skillName}`;
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (await tauriFs.exists(dest))
    throw new Error(`中央库已存在同名 skill：${dest}（请先处理中央库里的同名目录）`);
  await rawFs.copyDir(src, dest);
  await rawFs.remove(src, true);
  try {
    await rawFs.symlink(dest, src);
  } catch (e) {
    // 软链失败时回滚：把中央库副本拷回原位，避免用户数据只留在中央库
    await rawFs.copyDir(dest, src).catch(() => {});
    await tauriFs.remove(dest, true).catch(() => {});
    throw e;
  }
}

/** 用中央库版本替换项目里的真实目录：先备份再替换为软链（选前快照，可恢复） */
export async function replaceProjectWithLibrary(
  skillName: string,
  projectPath: string,
  agentId: AgentId,
): Promise<void> {
  const agent = agentDef(agentId);
  const src = `${projectPath}/${agent.skillsDir}/${skillName}`;
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (!(await tauriFs.exists(dest))) throw new Error(`中央库不存在 ${skillName}`);
  const isLink = (await rawFs.isSymlink?.(src)) ?? false;
  if (!isLink && (await rawFs.exists(src))) {
    const backupDir = await absPath('.ai-baogongtou/skill-backups');
    if (!(await tauriFs.exists(backupDir))) await tauriFs.mkdir(backupDir);
    // 毫秒精度，避免同秒两次备份互相覆盖
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    await rawFs.copyDir(src, `${backupDir}/${skillName}-project-${agentId}-${stamp}`);
  }
  if (isLink || (await rawFs.exists(src))) await rawFs.remove(src, true);
  await rawFs.symlink(dest, src);
}
