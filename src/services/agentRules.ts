/** 规则库服务：中心库读写 + 各 agent 规则文件软链管理 */
import type { AgentId } from '../lib/agents';
import { promptTargetFile, PROMPT_TARGETS } from '../lib/agentTargets';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  currentVersionId,
  emptyRulesLibrary,
  normalizeRule,
  parseRulesLibrary,
  ruleCentralFileName,
  ruleHistoryRelPath,
  serializeRulesLibrary,
  versionMetaOf,
  type RuleEntry,
  type RulesLibrary,
  type RuleVersionMeta,
} from '../lib/rules';

const CENTRAL_DIR = '.ai-baogongtou';
const RULES_DIR = `${CENTRAL_DIR}/rules`;
const RULES_INDEX = `${CENTRAL_DIR}/rules.json`;
const BACKUP_DIR = `${CENTRAL_DIR}/rules-backups`;

async function indexPath(): Promise<string> {
  return absPath(RULES_INDEX);
}

export async function rulesDirPath(fs: FsPort = tauriFs): Promise<string> {
  const dir = await absPath(RULES_DIR);
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  return dir;
}

export async function loadRulesLibrary(fs: FsPort = tauriFs): Promise<RulesLibrary> {
  const p = await indexPath();
  if (!(await fs.exists(p))) return emptyRulesLibrary();
  try {
    return parseRulesLibrary(await fs.readText(p));
  } catch {
    return emptyRulesLibrary();
  }
}

export async function saveRulesLibrary(
  lib: RulesLibrary,
  fs: FsPort = tauriFs,
): Promise<void> {
  const p = await indexPath();
  const dir = p.slice(0, p.lastIndexOf('/'));
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  await fs.writeText(p, serializeRulesLibrary(lib));
}

/** 规则的中心库文件绝对路径 */
export async function ruleCentralPath(id: string, fs: FsPort = tauriFs): Promise<string> {
  return `${await rulesDirPath(fs)}/${ruleCentralFileName(id)}`;
}

/** 内容覆盖前备份目标文件到 rules-backups（仅真实文件需要，软链不需要） */
async function backupTarget(agent: AgentId, content: string, fs: FsPort): Promise<void> {
  const dir = await absPath(BACKUP_DIR);
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+$/, '')
    .slice(0, 14);
  await fs.writeText(`${dir}/${agent}-${stamp}.md`, content);
}

/** fs.isSymlink 可选（mock 未实现时用 readLink 探测兜底：能读出链接目标即软链） */
async function isSymlinkSafe(path: string, fs: FsPort): Promise<boolean> {
  if (fs.isSymlink) return fs.isSymlink(path);
  try {
    await fs.readLink(path);
    return true;
  } catch {
    return false;
  }
}

export interface RuleSyncResult {
  agent: AgentId;
  file: string;
  status: 'linked' | 'unchanged' | 'error';
  error?: string;
}

/**
 * 把规则以软链形式写入指定 agent 的规则文件。
 * 安全约定（AGENTS.md）：目标文件已存在且不是软链（真实文件）时，绝不覆盖——报错让用户自己处理。
 */
export async function linkRuleToAgent(
  rule: RuleEntry,
  agent: AgentId,
  fs: FsPort = tauriFs,
): Promise<RuleSyncResult> {
  const rel = promptTargetFile(agent);
  const target = await absPath(rel);
  const central = await ruleCentralPath(rule.id, fs);
  try {
    // 1. 中心库文件落盘
    const content = rule.content.endsWith('\n') ? rule.content : `${rule.content}\n`;
    await fs.writeText(central, content);
    // 2. 目标已是软链 → 指向当前中心库文件即可（内容一致则不动）
    if (await isSymlinkSafe(target, fs)) {
      const link = await fs.readLink(target);
      if (link === central) return { agent, file: rel, status: 'unchanged' };
      await fs.remove(target, false); // 软链可直接删
    } else if (await fs.exists(target)) {
      // 真实文件：内容相同 → 备份后收养为软链（行为不变）；不同则拒绝覆盖
      const existing = await fs.readText(target);
      if (existing === content) {
        await backupTarget(agent, existing, fs);
        await fs.remove(target, false);
        await fs.symlink(central, target);
        return { agent, file: rel, status: 'linked' };
      }
      return {
        agent,
        file: rel,
        status: 'error',
        error: `目标已存在真实文件（${rel}），为避免覆盖你的内容未做修改；请先备份后手动移除`,
      };
    }
    // 3. 建软链
    const parent = target.slice(0, target.lastIndexOf('/'));
    if (!(await fs.exists(parent))) await fs.mkdir(parent);
    await fs.symlink(central, target);
    return { agent, file: rel, status: 'linked' };
  } catch (e) {
    return { agent, file: rel, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** 断开 agent 的链接：只删软链，目标若是真实文件则不动 */
export async function unlinkRuleFromAgent(
  _rule: RuleEntry,
  agent: AgentId,
  fs: FsPort = tauriFs,
): Promise<RuleSyncResult> {
  const rel = promptTargetFile(agent);
  const target = await absPath(rel);
  try {
    if (await isSymlinkSafe(target, fs)) {
      await fs.remove(target, false);
    }
    return { agent, file: rel, status: 'unchanged' };
  } catch (e) {
    return { agent, file: rel, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** 保存规则（更新中心库文件 + 索引）。已链接的 agent 软链自动跟随中心库内容，无需重建 */
export async function saveRule(
  rule: RuleEntry,
  fs: FsPort = tauriFs,
): Promise<RulesLibrary> {
  const lib = await loadRulesLibrary(fs);
  const now = new Date().toISOString();
  const idx = lib.rules.findIndex((r) => r.id === rule.id);
  const prev = idx >= 0 ? lib.rules[idx] : null;
  // 内容变化 → 自动记一个版本快照（当前内容 = 最新一版）
  let versions: RuleVersionMeta[] = rule.versions ?? [];
  const contentChanged = prev !== null && prev.content !== rule.content;
  if (contentChanged) {
    versions = [...versions, versionMetaOf(rule.content, now)];
  }
  const next = normalizeRule({ ...rule, updatedAt: now, versions });
  // 中心库文件先落盘（软链目标），再更新索引
  const central = await ruleCentralPath(next.id, fs);
  const content = next.content.endsWith('\n') ? next.content : `${next.content}\n`;
  const existingCentral = (await fs.exists(central)) ? await fs.readText(central) : null;
  if (existingCentral !== content) {
    await fs.writeText(central, content);
  }
  if (contentChanged) {
    // 历史快照落盘（best-effort，失败不阻塞保存）
    try {
      const meta = versions[versions.length - 1];
      const histAbs = `${await rulesDirPath(fs)}/${ruleHistoryRelPath(next.id, meta.id)}`;
      const histDir = histAbs.slice(0, histAbs.lastIndexOf('/'));
      if (!(await fs.exists(histDir))) await fs.mkdir(histDir);
      await fs.writeText(histAbs, content);
      // 版本上限 50：裁剪最旧的快照文件
      const overflow = next.versions.slice(0, Math.max(0, next.versions.length - 50));
      for (const old of overflow) {
        const p = `${await rulesDirPath(fs)}/${ruleHistoryRelPath(next.id, old.id)}`;
        if (await fs.exists(p)) await fs.remove(p, false);
      }
      if (overflow.length > 0) {
        next.versions = next.versions.slice(-50);
      }
    } catch {
      // 快照失败不影响主保存
    }
  }
  const rules = idx >= 0 ? lib.rules.map((r, i) => (i === idx ? next : r)) : [...lib.rules, next];
  const nextLib: RulesLibrary = { version: 1, rules };
  await saveRulesLibrary(nextLib, fs);
  return nextLib;
}

/** 删除规则：先断掉所有软链，再删中心库文件和索引条目 */
export async function deleteRule(id: string, fs: FsPort = tauriFs): Promise<RulesLibrary> {
  const lib = await loadRulesLibrary(fs);
  const rule = lib.rules.find((r) => r.id === id);
  if (!rule) return lib;
  for (const [agent, enabled] of Object.entries(rule.agents)) {
    if (enabled) {
      await unlinkRuleFromAgent(rule, agent as AgentId, fs);
    }
  }
  const central = await ruleCentralPath(id, fs);
  if (await fs.exists(central)) await fs.remove(central, false);
  const next: RulesLibrary = { version: 1, rules: lib.rules.filter((r) => r.id !== id) };
  await saveRulesLibrary(next, fs);
  return next;
}

/** 修改规则的 agent 勾选，并按需建/删软链 */
export async function setRuleAgentEnabled(
  id: string,
  agent: AgentId,
  enabled: boolean,
  fs: FsPort = tauriFs,
): Promise<RulesLibrary> {
  const lib = await loadRulesLibrary(fs);
  const rule = lib.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`规则不存在：${id}`);
  const next = normalizeRule({
    ...rule,
    agents: { ...rule.agents, [agent]: enabled },
    updatedAt: new Date().toISOString(),
  });
  if (enabled) {
    const r = await linkRuleToAgent(next, agent, fs);
    if (r.status === 'error') throw new Error(r.error);
    next.syncs = {
      ...next.syncs,
      [agent]: { version: currentVersionId(next) ?? next.updatedAt, at: new Date().toISOString() },
    };
  } else {
    await unlinkRuleFromAgent(next, agent, fs);
    const syncs = { ...next.syncs };
    delete syncs[agent];
    next.syncs = syncs;
  }
  const nextLib: RulesLibrary = {
    version: 1,
    rules: lib.rules.map((r) => (r.id === id ? next : r)),
  };
  await saveRulesLibrary(nextLib, fs);
  return nextLib;
}

/** 全量同步：把所有已启用 agent 的软链对齐到中心库当前内容 */
export async function syncRule(id: string, fs: FsPort = tauriFs): Promise<RuleSyncResult[]> {
  const lib = await loadRulesLibrary(fs);
  const rule = lib.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`规则不存在：${id}`);
  const targets = (Object.entries(rule.agents) as Array<[AgentId, boolean]>)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const results: RuleSyncResult[] = [];
  const syncs = { ...rule.syncs };
  const now = new Date().toISOString();
  const ver = currentVersionId(rule) ?? rule.updatedAt;
  for (const t of targets) {
    const r = await linkRuleToAgent(rule, t, fs);
    results.push(r);
    if (r.status !== 'error') syncs[t] = { version: ver, at: now };
  }
  const next = normalizeRule({ ...rule, syncs });
  const nextLib: RulesLibrary = {
    version: 1,
    rules: lib.rules.map((r) => (r.id === id ? next : r)),
  };
  await saveRulesLibrary(nextLib, fs);
  return results;
}

/** 历史版本列表（新的在前） */
export function listRuleVersions(rule: RuleEntry): RuleVersionMeta[] {
  return [...rule.versions].reverse();
}

/** 读取某个历史版本的内容 */
export async function readRuleVersion(
  ruleId: string,
  versionId: string,
  fs: FsPort = tauriFs,
): Promise<string> {
  const p = `${await rulesDirPath(fs)}/${ruleHistoryRelPath(ruleId, versionId)}`;
  return fs.readText(p);
}

/** 回滚到某个历史版本（内容读出来后走 saveRule，会再记一个新版本，非破坏性） */
export async function restoreRuleVersion(
  ruleId: string,
  versionId: string,
  fs: FsPort = tauriFs,
): Promise<RulesLibrary> {
  const lib = await loadRulesLibrary(fs);
  const rule = lib.rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`规则不存在：${ruleId}`);
  const content = await readRuleVersion(ruleId, versionId, fs);
  return saveRule({ ...rule, content }, fs);
}

/** 读取 agent 当前规则文件内容（软链穿透读中心库内容；不存在返回 null） */
export async function readRuleTarget(
  agent: AgentId,
  fs: FsPort = tauriFs,
): Promise<string | null> {
  const file = await absPath(promptTargetFile(agent));
  try {
    if (!(await fs.exists(file))) return null;
    return await fs.readText(file);
  } catch {
    return null;
  }
}

// —— 从现有项目导入规则文件 ——

/** 项目级规则文件的常见文件名（按优先级排序） */
export const PROJECT_RULE_CANDIDATES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'QWEN.md',
  'IFLOW.md',
  '.cursorrules',
  '.windsurfrules',
] as const;

export interface ProjectRuleFile {
  /** 相对项目根的路径 */
  file: string;
  /** 内容大小（字节） */
  size: number;
}

/**
 * 扫描项目目录里的规则文件（项目目录在 fs scope 外，调用方传 rawFs）。
 * 检查根目录常见文件名 + .cursor/rules/ 下的 .md/.mdc。
 */
export async function scanProjectRuleFiles(
  projectDir: string,
  fs: FsPort,
): Promise<ProjectRuleFile[]> {
  const dir = projectDir.replace(/\/+$/, '');
  const found: ProjectRuleFile[] = [];
  for (const name of PROJECT_RULE_CANDIDATES) {
    const p = `${dir}/${name}`;
    try {
      if (await fs.exists(p)) {
        const text = await fs.readText(p);
        if (text.trim()) found.push({ file: name, size: text.length });
      }
    } catch {
      // 单个文件不可读不影响其他
    }
  }
  try {
    const cursorRules = `${dir}/.cursor/rules`;
    if (await fs.exists(cursorRules)) {
      for (const e of await fs.readDir(cursorRules)) {
        if (!e.isDirectory && /\.(md|mdc)$/i.test(e.name)) {
          found.push({ file: `.cursor/rules/${e.name}`, size: 0 });
        }
      }
    }
  } catch {
    // .cursor/rules 不可读忽略
  }
  return found;
}

/**
 * 把项目里的规则文件导入中心库：读取内容 → 新建规则。
 * 返回新建的规则条目。
 */
export async function importProjectRule(
  projectDir: string,
  file: string,
  readFs: FsPort,
  libFs: FsPort = tauriFs,
): Promise<RuleEntry> {
  const dir = projectDir.replace(/\/+$/, '');
  const content = await readFs.readText(`${dir}/${file}`);
  if (!content.trim()) throw new Error(`${file} 内容为空`);
  const projectName = dir.split('/').pop() ?? 'project';
  const rule: RuleEntry = normalizeRule({
    id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${projectName} / ${file}`,
    content,
    tags: [projectName],
    description: `导入自 ${dir}/${file}`,
    agents: {},
  });
  await saveRule(rule, libFs);
  return rule;
}

// —— 提示词页并入：导入各 agent 现有的提示词文件 ——

export interface ImportPromptsResult {
  imported: string[];
  skipped: string[];
  empty: string[];
  failed: Array<{ agent: string; error: string }>;
}

/**
 * 扫描所有可写 agent 的现有提示词文件，导入为中心库规则并收养为软链。
 * 幂等：内容已存在于库中的跳过。
 */
export async function importExistingAgentPrompts(fs: FsPort = tauriFs): Promise<ImportPromptsResult> {
  const result: ImportPromptsResult = { imported: [], skipped: [], empty: [], failed: [] };
  const knownContents = new Set<string>();
  try {
    const lib = await loadRulesLibrary(fs);
    for (const r of lib.rules) knownContents.add(r.content.trim());
  } catch {
    // 空库
  }
  for (const t of PROMPT_TARGETS) {
    if (!t.writable || !t.file) continue;
    try {
      const content = await readRuleTarget(t.agent, fs);
      if (!content || !content.trim()) {
        result.empty.push(t.agent);
        continue;
      }
      if (knownContents.has(content.trim())) {
        result.skipped.push(t.agent);
        continue;
      }
      const rule = normalizeRule({
        id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${t.label} 提示词`,
        content: content.replace(/\n+$/, ''),
        tags: ['agent 提示词'],
        description: `导入自 ~/${t.file}`,
        agents: {},
      });
      await saveRule(rule, fs);
      await setRuleAgentEnabled(rule.id, t.agent, true, fs);
      knownContents.add(content.trim());
      result.imported.push(t.agent);
    } catch (e) {
      result.failed.push({ agent: t.agent, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

export { backupTarget };
