/** Skill 审计服务：从扫描快照采集 SKILL.md 元信息与软链目标，交给纯逻辑判定 */
import { AGENTS } from '../lib/agents';
import { absPath, tauriFs, type DirItem, type FsPort } from '../lib/fsPort';
import {
  auditSkills,
  metaKey,
  type AuditReport,
  type SkillMeta,
  type SkillMetaMap,
  type SymlinkTargetMap,
} from '../lib/skillAudit';
import type { SkillsSnapshot } from './agentSkills';

const SKILL_MD = 'SKILL.md';

/** 采集单个 skill 目录的 SKILL.md 信息（读不到不抛错，交给审计判定） */
export async function collectSkillMeta(dir: string, fs: FsPort = tauriFs): Promise<SkillMeta> {
  const missing: SkillMeta = { dirExists: false, skillMdExists: false, readable: false, fileCount: 0 };
  try {
    if (!(await fs.exists(dir))) return missing;
  } catch {
    return missing;
  }

  let entries: DirItem[] = [];
  try {
    entries = await fs.readDir(dir);
  } catch {
    // 目录不可读时按空目录处理，后续会命中 unreadable / missing-skill-md
  }

  const skillMd = `${dir}/${SKILL_MD}`;
  let skillMdExists = entries.some((e) => e.name === SKILL_MD);
  if (!skillMdExists) {
    try {
      skillMdExists = await fs.exists(skillMd);
    } catch {
      skillMdExists = false;
    }
  }

  let readable = false;
  let content: string | undefined;
  if (skillMdExists) {
    try {
      content = await fs.readText(skillMd);
      readable = true;
    } catch {
      readable = false;
    }
  }

  return {
    dirExists: true,
    skillMdExists,
    readable,
    fileCount: entries.length,
    ...(content !== undefined ? { content } : {}),
  };
}

/**
 * 审计当前快照。
 * - 中央库 skill：采集 SKILL.md（linked 的 agent 不重复采集，内容归属中央库）
 * - agent 本地 skill：采集 SKILL.md + 软链目标
 */
export async function auditSnapshot(
  snapshot: SkillsSnapshot,
  fs: FsPort = tauriFs,
): Promise<AuditReport> {
  const metaMap: SkillMetaMap = {};
  const linkTargets: SymlinkTargetMap = {};

  for (const name of snapshot.librarySkills) {
    metaMap[metaKey('library', name)] = await collectSkillMeta(
      `${snapshot.libraryAbs}/${name}`,
      fs,
    );
  }

  for (const scan of snapshot.scans) {
    const agent = AGENTS.find((a) => a.id === scan.agent);
    if (!agent) continue;
    const dirAbs = await absPath(agent.skillsDir);
    for (const entry of scan.skills) {
      const path = `${dirAbs}/${entry.name}`;
      const key = metaKey(scan.agent, entry.name);
      if (entry.kind === 'local') {
        metaMap[key] = await collectSkillMeta(path, fs);
        // 指向库外的软链也要记录目标（真实目录 readLink 会失败，忽略即可）
        try {
          linkTargets[key] = { target: await fs.readLink(path) };
        } catch {
          // 不是软链
        }
      } else {
        try {
          linkTargets[key] = { target: await fs.readLink(path) };
        } catch (e) {
          linkTargets[key] = { error: e instanceof Error ? e.message : String(e) };
        }
      }
    }
  }

  return auditSkills(
    {
      libraryAbs: snapshot.libraryAbs,
      librarySkills: snapshot.librarySkills,
      scans: snapshot.scans,
    },
    metaMap,
    linkTargets,
  );
}