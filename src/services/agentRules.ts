/** 规则库服务：中心库读写 + 各 agent 规则文件软链管理 */
import type { AgentId } from '../lib/agents';
import { promptTargetFile } from '../lib/agentTargets';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  emptyRulesLibrary,
  normalizeRule,
  parseRulesLibrary,
  ruleCentralFileName,
  serializeRulesLibrary,
  type RuleEntry,
  type RulesLibrary,
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
      // 真实文件：内容相同视为已链接（不动），不同则拒绝覆盖
      const existing = await fs.readText(target);
      if (existing === content) return { agent, file: rel, status: 'unchanged' };
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
  const next = normalizeRule({ ...rule, updatedAt: now });
  const idx = lib.rules.findIndex((r) => r.id === next.id);
  // 中心库文件先落盘（软链目标），再更新索引
  const central = await ruleCentralPath(next.id, fs);
  const content = next.content.endsWith('\n') ? next.content : `${next.content}\n`;
  const existingCentral = (await fs.exists(central)) ? await fs.readText(central) : null;
  if (existingCentral !== content) {
    await fs.writeText(central, content);
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
  } else {
    await unlinkRuleFromAgent(next, agent, fs);
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
  for (const t of targets) {
    results.push(await linkRuleToAgent(rule, t, fs));
  }
  return results;
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

export { backupTarget };
