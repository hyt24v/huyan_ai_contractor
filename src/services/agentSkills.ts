/** Skills 管理服务：fsPort + skills.ts 纯逻辑的粘合层 */
import { invoke } from '@tauri-apps/api/core';
import { AGENTS, SKILL_LIBRARY_DIR, type AgentId } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  computeSkillMatrix,
  linkPointsToLibrary,
  parseGitTreeUrl,
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
      throw new Error(`${agent.id} 中已存在同名本地 skill（${skillName}），请先在详情中处理`);
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
  if (await fs.exists(dest)) throw new Error(`中央库已存在 ${skillName}`);
  await fs.copyDir(src, dest);
  await fs.remove(src, true);
  await fs.symlink(dest, src);
}

/** 用中央库版本替换 agent 的本地副本：删除本地目录并建立软链（不可恢复，UI 需先确认） */
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
  if (isLink || (await fs.exists(src))) await fs.remove(src, true);
  await fs.symlink(dest, src);
}

/** 从 GitHub 克隆到中央库。支持 /tree/<branch>/<subdir> 子目录链接（合集仓库） */
export async function installFromGit(
  url: string,
  skillName: string,
  fs: FsPort = tauriFs,
): Promise<void> {
  const dest = await absPath(`${SKILL_LIBRARY_DIR}/${skillName}`);
  if (await fs.exists(dest)) throw new Error(`中央库已存在 ${skillName}`);

  const tree = parseGitTreeUrl(url);
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
  // 根目录没有：看看是不是合集仓库（skill 在一层子目录里）
  const subdirs = (await fs.readDir(dest)).filter((e) => e.isDirectory);
  const withSkill: string[] = [];
  for (const d of subdirs) {
    if (await fs.exists(`${dest}/${d.name}/SKILL.md`)) withSkill.push(d.name);
  }
  await fs.remove(dest, true);
  if (withSkill.length > 0) {
    const base = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
    const more = withSkill.length > 1 ? `（还有 ${withSkill.slice(1, 5).join('、')} 等 ${withSkill.length} 个）` : '';
    throw new Error(
      `该仓库是 skill 合集，根目录没有 SKILL.md。请改用子目录链接安装，如：${base}/tree/main/${withSkill[0]}${more}`,
    );
  }
  throw new Error('克隆成功但目录下没有 SKILL.md，不是合法 skill');
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
