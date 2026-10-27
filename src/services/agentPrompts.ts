/** 提示词管理服务：prompts.ts 纯逻辑 + 目标文件读写/备份 */
import type { AgentId } from '../lib/agents';
import { promptTargetFile } from '../lib/agentTargets';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  activeForAgent,
  emptyPromptLibrary,
  normalizeLibrary,
  parseLibrary,
  serializeLibrary,
  setActivePrompt,
  type PromptEntry,
  type PromptLibrary,
} from '../lib/prompts';

export const CENTRAL_DIR = '.ai-baogongtou';
const PROMPTS_FILE = `${CENTRAL_DIR}/prompts.json`;
export const PROMPT_BACKUP_DIR = `${CENTRAL_DIR}/prompt-backups`;

export interface ApplyPromptResult {
  /** 目标文件绝对路径 */
  file: string;
  /** 备份文件绝对路径（原文件不存在时为 null） */
  backup: string | null;
}

export interface ClearPromptResult {
  file: string;
  /** 恢复的备份路径（没有备份、仅清空时为 null） */
  restored: string | null;
  /** 清空前留下的备份（恢复场景为 null） */
  backup: string | null;
}

export async function promptFilePath(agent: AgentId): Promise<string> {
  // 不可写的 agent（如 Cursor）在这里抛错，阻断后续一切写操作
  return absPath(promptTargetFile(agent));
}

export async function promptBackupDir(): Promise<string> {
  return absPath(PROMPT_BACKUP_DIR);
}

/** 备份保留策略：每个前缀只留最近 N 份（文件名内嵌固定宽度时间戳，字典序即时间序） */
const KEEP_BACKUPS = 20;

async function pruneBackups(prefix: string, fs: FsPort): Promise<void> {
  try {
    const dir = await promptBackupDir();
    if (!(await fs.exists(dir))) return;
    const names = (await fs.readDir(dir))
      .filter((e) => !e.isDirectory && e.name.startsWith(prefix))
      .map((e) => e.name)
      .sort();
    for (let i = 0; i < names.length - KEEP_BACKUPS; i++) {
      await fs.remove(`${dir}/${names[i]}`, false);
    }
  } catch {
    // 清理失败不影响主流程
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parentOf(file: string): string {
  return file.slice(0, file.lastIndexOf('/'));
}

async function ensureParentDir(file: string, fs: FsPort): Promise<void> {
  const dir = parentOf(file);
  if (dir && !(await fs.exists(dir))) await fs.mkdir(dir);
}

/** 本地时间戳，带毫秒，保证同一秒内多次备份也不同名 */
function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`
  );
}

/** 写备份到 ~/.ai-baogongtou/prompt-backups/<agent>-<timestamp>.md，返回绝对路径 */
async function writeBackup(
  agent: AgentId,
  content: string,
  fs: FsPort,
): Promise<string> {
  const dir = await promptBackupDir();
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  const base = `${agent}-${stamp(new Date())}`;
  let path = `${dir}/${base}.md`;
  let i = 2;
  while (await fs.exists(path)) {
    path = `${dir}/${base}-${i}.md`;
    i += 1;
  }
  await fs.writeText(path, content);
  await pruneBackups(`${agent}-`, fs);
  return path;
}

/** 库文件本身写前也备份一份（防止损坏/覆盖导致提示词丢失） */
async function backupLibraryFile(fs: FsPort): Promise<void> {
  const file = await absPath(PROMPTS_FILE);
  if (!(await fs.exists(file))) return;
  // 备份失败会直接抛出，保证不会出现“没备份就覆盖”
  const content = await fs.readText(file);
  if (!content.trim()) return;
  const dir = await promptBackupDir();
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  let path = `${dir}/prompts-library-${stamp(new Date())}.json`;
  let i = 2;
  while (await fs.exists(path)) {
    path = `${dir}/prompts-library-${stamp(new Date())}-${i}.json`;
    i += 1;
  }
  await fs.writeText(path, content);
  await pruneBackups('prompts-library-', fs);
}

export async function loadPromptLibrary(fs: FsPort = tauriFs): Promise<PromptLibrary> {
  const file = await absPath(PROMPTS_FILE);
  if (!(await fs.exists(file))) return emptyPromptLibrary();
  const text = await fs.readText(file);
  try {
    return parseLibrary(text);
  } catch {
    // 损坏时按空库加载（保存时会先把损坏文件备份到 prompt-backups）
    return emptyPromptLibrary();
  }
}

export async function savePromptLibrary(
  lib: PromptLibrary,
  fs: FsPort = tauriFs,
): Promise<void> {
  const file = await absPath(PROMPTS_FILE);
  await ensureParentDir(file, fs);
  await backupLibraryFile(fs);
  await fs.writeText(file, serializeLibrary(normalizeLibrary(lib)));
}

/** 读取 agent 当前提示词文件；文件不存在返回 null */
export async function readCurrentPrompt(
  agent: AgentId,
  fs: FsPort = tauriFs,
): Promise<string | null> {
  const file = await promptFilePath(agent);
  if (!(await fs.exists(file))) return null;
  return fs.readText(file);
}

/**
 * 只写目标文件（写前备份旧内容），不更新提示词库。
 * 套餐批量应用时配合单次 savePromptLibrary 使用，避免每条都全量备份库文件。
 * 任何一步失败都会抛出（不会出现"没备份就覆盖"）。
 */
export async function writePromptFile(
  agent: AgentId,
  prompt: PromptEntry,
  fs: FsPort = tauriFs,
): Promise<ApplyPromptResult> {
  if (!prompt.content.trim()) throw new Error('提示词内容为空，拒绝写入');
  const file = await promptFilePath(agent);
  const existing = (await fs.exists(file)) ? await fs.readText(file) : null;
  // 与写入内容同口径比较（写入时会补尾部换行），避免重复应用同一提示词产生相同备份
  const finalContent = prompt.content.endsWith('\n')
    ? prompt.content
    : `${prompt.content}\n`;
  const backup =
    existing !== null && existing !== finalContent
      ? await writeBackup(agent, existing, fs)
      : null;
  await ensureParentDir(file, fs);
  await fs.writeText(file, finalContent);
  return { file, backup };
}

/**
 * 应用提示词：先把现有内容备份，再写入目标文件，并记录为该 agent 的 active。
 * 任何一步失败都会抛出（不会出现"没备份就覆盖"）。
 */
export async function applyPrompt(
  agent: AgentId,
  prompt: PromptEntry,
  fs: FsPort = tauriFs,
): Promise<ApplyPromptResult> {
  // 先加载并校验库，库损坏时拒绝写文件（避免出现文件已写但库未更新的不一致）
  const lib = await loadPromptLibrary(fs);
  const result = await writePromptFile(agent, prompt, fs);
  await savePromptLibrary(setActivePrompt(lib, agent, prompt.id), fs);
  return result;
}

/** 最近的备份（新的在前，绝对路径） */
export async function listPromptBackups(
  agent: AgentId,
  fs: FsPort = tauriFs,
): Promise<string[]> {
  const dir = await promptBackupDir();
  if (!(await fs.exists(dir))) return [];
  const entries = await fs.readDir(dir);
  return entries
    .filter((e) => !e.isDirectory && e.name.startsWith(`${agent}-`) && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a))
    .map((name) => `${dir}/${name}`);
}

/** 当前启用的提示词（用于 UI 展示） */
export function activePromptFor(lib: PromptLibrary, agent: AgentId): PromptEntry | undefined {
  return activeForAgent(lib, agent);
}

/**
 * 清除提示词：
 * 1. 有备份 → 恢复最近一份，并把该备份消费掉（再次清除会继续往前回退）；
 * 2. 无备份 → 清空目标文件（清空前留一份备份）。
 */
export async function clearPrompt(
  agent: AgentId,
  fs: FsPort = tauriFs,
): Promise<ClearPromptResult> {
  const file = await promptFilePath(agent);
  const backups = await listPromptBackups(agent, fs);
  if (backups.length > 0) {
    const latest = backups[0];
    const content = await fs.readText(latest);
    await ensureParentDir(file, fs);
    await fs.writeText(file, content);
    await fs.remove(latest, false);
    const lib = await loadPromptLibrary(fs);
    if (lib.active[agent]) {
      await savePromptLibrary(setActivePrompt(lib, agent, null), fs);
    }
    return { file, restored: latest, backup: null };
  }
  const exists = await fs.exists(file);
  const existing = exists ? await fs.readText(file) : '';
  const backup =
    existing.trim().length > 0 ? await writeBackup(agent, existing, fs) : null;
  if (exists) {
    await fs.writeText(file, '');
  }
  // active 本就无映射时跳过库保存（避免什么都没清也白产生一份库备份）
  const lib = await loadPromptLibrary(fs);
  if (lib.active[agent]) {
    await savePromptLibrary(setActivePrompt(lib, agent, null), fs);
  }
  return { file, restored: null, backup };
}

/** 供 UI 显示的简短错误信息 */
export function describePromptError(e: unknown): string {
  return errMsg(e);
}