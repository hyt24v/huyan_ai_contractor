/** Skills 管理服务：fsPort + skills.ts 纯逻辑的粘合层 */
import { invoke } from '@tauri-apps/api/core';
import { AGENTS, SKILL_LIBRARY_DIR, type AgentId } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  computeSkillMatrix,
  linkPointsToLibrary,
  parseGitTreeUrl,
  isValidSkillName,
  parseSkillMdMeta,
  type AgentSkillsScan,
  type SkillRow,
} from '../lib/skills';

export interface SkillsSnapshot {
  libraryAbs: string;
  librarySkills: string[];
  scans: AgentSkillsScan[];
  rows: SkillRow[];
}

export async function scanAll(fs: FsPort = tauriFs): Promise<SkillsSnapshot> {
  const libraryAbs = await absPath(SKILL_LIBRARY_DIR);
  // 中央库
  if (!(await fs.exists(libraryAbs))) await fs.mkdir(libraryAbs);
  const libEntries = await fs.readDir(libraryAbs);
  const librarySkills = libEntries.filter((e) => e.isDirectory).map((e) => e.name);

  // 各 agent(只扫描「显示中」的 agent,可见性在设置-Agent 管理里调)
  const scans: AgentSkillsScan[] = [];
  for (const agent of effectiveAgents()) {
    const dirAbs = await absPath(agent.skillsDir);
    const dirExists = await fs.exists(dirAbs);
    const skills: AgentSkillsScan['skills'] = [];
    if (dirExists) {
      const entries = await fs.readDir(dirAbs);
      for (const e of entries) {
        if (!e.isDirectory && !e.isSymlink) continue;
        if (e.isSymlink) {
          try {
            const target = await fs.readLink(`${dirAbs}/${e.name}`);
            if (linkPointsToLibrary(target, libraryAbs)) {
              skills.push({ name: e.name, kind: 'linked' });
            } else {
              skills.push({ name: e.name, kind: 'local' });
            }
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
  return { libraryAbs, librarySkills, scans, rows: computeSkillMatrix(librarySkills, scans) };
}

/** 启用：在 agent 目录建软链指向中央库 */
export async function enableSkill(
  skillName: string,
  agentId: AgentId,
  fs: FsPort = tauriFs,
): Promise<void> {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未知 agent: ${agentId}`);
  const target = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  const linkDir = await absPath(agent.skillsDir);
  await fs.mkdir(linkDir);
  const link = `${linkDir}/${skillName}`;
  if (fs.isSymlink) {
    // 软链（含失效软链，exists 对坏软链返回 false）只删链接本身
    if (await fs.isSymlink(link)) await fs.remove(link, true);
    else if (await fs.exists(link)) {
      // 真实目录/文件：绝不静默删除用户本地数据
      throw new Error(
        `目标路径已被本地 skill 占用：${link}（真实目录不会被覆盖；可在详情中「收编到中央库」，或手动移走该目录）`,
      );
    }
  } else if (await fs.exists(link)) {
    await fs.remove(link, true);
  }
  await fs.symlink(target, link);
}

/** 禁用：移除 agent 目录里的软链 */
export async function disableSkill(
  skillName: string,
  agentId: AgentId,
  fs: FsPort = tauriFs,
): Promise<void> {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未知 agent: ${agentId}`);
  const link = await absPath(`${agent.skillsDir}/${skillName}`);
  if (fs.isSymlink) {
    // 只移除软链（含失效软链）；真实目录是用户本地数据，不动
    if (await fs.isSymlink(link)) await fs.remove(link, true);
  } else if (await fs.exists(link)) {
    await fs.remove(link, true);
  }
}

/** 收编：把 agent 本地 skill 拷入中央库并替换为软链 */
export async function adoptSkill(
  skillName: string,
  agentId: AgentId,
  fs: FsPort = tauriFs,
): Promise<void> {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未知 agent: ${agentId}`);
  const src = await absPath(`${agent.skillsDir}/${skillName}`);
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (await fs.exists(dest))
    throw new Error(`中央库已存在同名 skill：${dest}（请先处理中央库里的同名目录）`);
  await fs.copyDir(src, dest);
  await fs.remove(src, true);
  try {
    await fs.symlink(dest, src);
  } catch (e) {
    // 软链失败时回滚：把中央库副本拷回原位，避免用户数据只留在中央库
    await fs.copyDir(dest, src).catch(() => {});
    await fs.remove(dest, true).catch(() => {});
    throw e;
  }
}

/** 用中央库版本替换 agent 的本地副本：真实目录先自动备份（选前快照）再替换为软链 */
export async function replaceLocalWithLibrary(
  skillName: string,
  agentId: AgentId,
  fs: FsPort = tauriFs,
): Promise<void> {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error(`未知 agent: ${agentId}`);
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (!(await fs.exists(dest))) throw new Error(`中央库不存在 ${skillName}`);
  const src = await absPath(`${agent.skillsDir}/${skillName}`);
  const isLink = fs.isSymlink ? await fs.isSymlink(src) : false;
  if (!isLink && (await fs.exists(src))) {
    // 真实目录是用户数据：替换前自动备份到 skill-backups（借鉴 skills-manager「选前先快照」）
    const backupDir = await absPath('.ai-baogongtou/skill-backups');
    if (!(await fs.exists(backupDir))) await fs.mkdir(backupDir);
    // 毫秒精度，避免同秒两次备份互相覆盖
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    await fs.copyDir(src, `${backupDir}/${skillName}-${agentId}-${stamp}`);
  }
  if (isLink || (await fs.exists(src))) await fs.remove(src, true);
  await fs.symlink(dest, src);
}

/** 从 GitHub 克隆到中央库。支持 /tree/<branch>/<subdir> 子目录链接（合集仓库） */
export async function installFromGit(
  url: string,
  skillName: string,
  fs: FsPort = tauriFs,
): Promise<void> {
  if (!isValidSkillName(skillName))
    throw new Error(`不合法的 skill 名：${skillName}（仅允许字母/数字开头，含字母数字与 _ . -）`);
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (await fs.exists(dest))
    throw new Error(`中央库已存在同名 skill：${dest}（请先处理中央库里的同名目录）`);

  const tree = parseGitTreeUrl(url);
  if (!tree && /\/tree\/[^/]+\/.+/.test(url.trim()))
    throw new Error('子目录链接不合法：路径不允许包含 . / .. 段');
  if (tree) {
    // 合集仓库的子目录：克隆整个仓库到临时目录，再把子目录拷入中央库
    const tmp = await absPath(`${SKILL_LIBRARY_DIR}/.tmp-clone-${skillName}`);
    await fs.remove(tmp, true).catch(() => {});
    try {
      await fs.gitClone(tree.repoUrl, tmp);
      const src = `${tmp}/${tree.subdir}`;
      if (!(await fs.exists(`${src}/SKILL.md`))) {
        throw new Error(`子目录 ${tree.subdir} 下没有 SKILL.md，不是合法 skill`);
      }
      await fs.copyDir(src, dest);
    } finally {
      await fs.remove(tmp, true).catch(() => {});
    }
    return;
  }

  await fs.gitClone(url, dest);
  // 校验必须有 SKILL.md
  if (await fs.exists(`${dest}/SKILL.md`)) return;
  // 根目录没有：扫合集仓库（SKILL.md 可能在一层或两层深处，如 skills/<name>/SKILL.md）
  const withSkill = await findSkillSubdirs(dest, fs);
  await fs.remove(dest, true);
  if (withSkill.length > 0) {
    const base = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
    const more = withSkill.length > 1 ? `（还有 ${withSkill.slice(1, 5).join('、')} 等 ${withSkill.length} 个）` : '';
    throw new Error(
      `${COLLECTION_REPO_HINT}：${base}/tree/main/${withSkill[0]}${more}`,
    );
  }
  throw new Error('克隆成功但目录下没有 SKILL.md，不是合法 skill');
}

/** 合集仓库错误提示前缀（页面据此识别并弹出 skill 选择器） */
export const COLLECTION_REPO_HINT = '该仓库是 skill 合集，根目录没有 SKILL.md。请选择其中一个安装，如';

/**
 * 克隆仓库到临时目录，列出其中所有 skill（含 SKILL.md 的子目录，最多扫两层）。
 * 用于合集仓库的安装选择器。返回相对路径列表（如 ['skills/brainstorming']）；
 * 根目录本身是 skill 时返回空数组。
 */
export async function listRepoSkills(
  url: string,
  fs: FsPort = tauriFs,
): Promise<string[]> {
  const tmp = await absPath(
    `${SKILL_LIBRARY_DIR}/.tmp-preview-${Date.now().toString(36)}`,
  );
  await fs.remove(tmp, true).catch(() => {});
  try {
    await fs.gitClone(url, tmp);
    if (await fs.exists(`${tmp}/SKILL.md`)) return [];
    return await findSkillSubdirs(tmp, fs);
  } finally {
    await fs.remove(tmp, true).catch(() => {});
  }
}

/** 扫描仓库内最多两层深、含 SKILL.md 的子目录，返回排序后的相对路径 */
async function findSkillSubdirs(root: string, fs: FsPort): Promise<string[]> {
  const found: string[] = [];
  const level1 = (await fs.readDir(root)).filter((e) => e.isDirectory);
  for (const d1 of level1) {
    if (d1.name.startsWith('.') || d1.name === 'node_modules') continue;
    if (await fs.exists(`${root}/${d1.name}/SKILL.md`)) {
      found.push(d1.name);
      continue;
    }
    // 第二层：合集仓库常见的 skills/<name>/ 结构
    let level2: Awaited<ReturnType<FsPort['readDir']>> = [];
    try {
      level2 = (await fs.readDir(`${root}/${d1.name}`)).filter((e) => e.isDirectory);
    } catch {
      continue;
    }
    for (const d2 of level2) {
      if (d2.name.startsWith('.')) continue;
      if (await fs.exists(`${root}/${d1.name}/${d2.name}/SKILL.md`)) {
        found.push(`${d1.name}/${d2.name}`);
      }
    }
  }
  return found.sort();
}

/** 中央库 skill 目录（不存在则报错） */
async function librarySkillPath(skillName: string, fs: FsPort): Promise<string> {
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (!(await fs.exists(dest))) throw new Error(`中央库不存在 ${skillName}`);
  return dest;
}

/** git pull --ff-only 更新库内 skill，返回命令输出 */
export async function updateSkillFromGit(
  skillName: string,
  fs: FsPort = tauriFs,
): Promise<string> {
  const path = await librarySkillPath(skillName, fs);
  return (await invoke<string>('git_pull', { path })).trim();
}

/** 读取库内 skill 的 origin 地址；非 git 仓库会抛错 */
export async function skillGitRemote(
  skillName: string,
  fs: FsPort = tauriFs,
): Promise<string> {
  const path = await librarySkillPath(skillName, fs);
  return (await invoke<string>('git_remote', { path })).trim();
}

/** 读取库内 skill 当前 commit 短 hash；非 git 仓库会抛错 */
export async function skillGitStatus(
  skillName: string,
  fs: FsPort = tauriFs,
): Promise<string> {
  const path = await librarySkillPath(skillName, fs);
  return (await invoke<string>('git_head', { path })).trim();
}

/** 读取 skill 描述（库优先，其次任一 agent 本地） */
export async function readSkillMeta(
  name: string,
  snapshot: SkillsSnapshot,
  fs: FsPort = tauriFs,
): Promise<{ description?: string }> {
  const candidates: string[] = [];
  if (snapshot.librarySkills.includes(name)) candidates.push(`${snapshot.libraryAbs}/${name}/SKILL.md`);
  for (const scan of snapshot.scans) {
    const entry = scan.skills.find((s) => s.name === name);
    if (entry) {
      const agent = AGENTS.find((a) => a.id === scan.agent);
      if (agent) candidates.push(`${await absPath(agent.skillsDir)}/${name}/SKILL.md`);
    }
  }
  for (const p of candidates) {
    try {
      if (await fs.exists(p)) {
        const meta = parseSkillMdMeta(await fs.readText(p));
        if (meta.description) return { description: meta.description };
      }
    } catch {
      // 读不到就试下一个
    }
  }
  return {};
}
