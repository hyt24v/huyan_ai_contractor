/**
 * 模型服务（Provider）管理服务层：
 * 本地 store 读写 + 各 agent 配置文件备份 / 写入 / 现状读取。
 * 所有写入前都会把原文件备份到 ~/.ai-baogongtou/provider-backups/。
 */
import type { AgentId } from '../lib/agents';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import {
  providerBackupName,
  providerTarget,
  type ProviderTarget,
} from '../lib/providerTargets';
import {
  applyProviderText,
  codexEnvKey,
  emptyCurrent,
  emptyStore,
  exportStoreJson,
  normalizeStore,
  PROVIDER_BACKUP_DIR,
  PROVIDER_STORE_FILE,
  providersOf,
  readProviderConfig,
  removeProvider as removeProviderFromStore,
  setActive as setActiveInStore,
  upsertProvider as upsertProviderInStore,
  type CurrentConfig,
  type Provider,
  type ProviderStore,
} from '../lib/providers';

export interface ApplyResult {
  ok: boolean;
  message: string;
  /** 备份文件绝对路径（首次创建配置文件时无备份） */
  backup?: string;
  file?: string;
}

export interface ReadResult {
  found: boolean;
  file: string;
  current: CurrentConfig;
  error?: string;
}

// ---------- store ----------

export async function loadStore(fs: FsPort = tauriFs): Promise<ProviderStore> {
  const p = await absPath(PROVIDER_STORE_FILE);
  if (!(await fs.exists(p))) return emptyStore();
  try {
    const raw: unknown = JSON.parse(await fs.readText(p));
    return normalizeStore(raw, new Date());
  } catch {
    // 文件损坏：回退空清单，不覆盖原文件（用户可手动修复）
    return emptyStore();
  }
}

export async function saveStore(
  store: ProviderStore,
  fs: FsPort = tauriFs,
): Promise<void> {
  const p = await absPath(PROVIDER_STORE_FILE);
  const dir = p.slice(0, p.lastIndexOf('/'));
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  await fs.writeText(p, exportStoreJson(store));
}

export async function upsertProvider(
  provider: Provider,
  fs: FsPort = tauriFs,
): Promise<ProviderStore> {
  const next = upsertProviderInStore(await loadStore(fs), provider);
  await saveStore(next, fs);
  return next;
}

/**
 * 补丁式更新：基于磁盘最新 store 找到目标 provider，用 patch 计算增量字段后合并写回。
 * 避免 AiDock / 设置页 / 模型服务页各自持有旧副本时整体 upsert 互相覆盖
 * （如 AiDock 改 modelParams 时丢掉设置页刚加的 models）。
 */
export async function patchProvider(
  id: string,
  patch: (current: Provider) => Partial<Provider>,
  fs: FsPort = tauriFs,
): Promise<ProviderStore> {
  const store = await loadStore(fs);
  const current = store.providers.find((p) => p.id === id);
  if (!current) return store;
  const merged: Provider = {
    ...current,
    ...patch(current),
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const next = upsertProviderInStore(store, merged);
  await saveStore(next, fs);
  return next;
}

/** 从清单删除（不触碰 agent 的配置文件） */
export async function removeProvider(
  id: string,
  fs: FsPort = tauriFs,
): Promise<ProviderStore> {
  const next = removeProviderFromStore(await loadStore(fs), id);
  await saveStore(next, fs);
  return next;
}

/** 设置某 agent 当前使用的 provider；id=null 清除 */
export async function setActive(
  agent: AgentId,
  id: string | null,
  fs: FsPort = tauriFs,
): Promise<ProviderStore> {
  const next = setActiveInStore(await loadStore(fs), agent, id);
  await saveStore(next, fs);
  return next;
}

// ---------- 配置文件 ----------

const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/'));

/**
 * 先备份再写入。目标文件不存在时跳过备份（没有可保护的内容）。
 * 返回备份文件绝对路径（无备份时为 null）。
 */
export async function backupAndWrite(
  agent: AgentId,
  targetPath: string,
  nextText: string,
  fs: FsPort = tauriFs,
  now: Date = new Date(),
): Promise<string | null> {
  const target = providerTarget(agent);
  let backup: string | null = null;
  if (await fs.exists(targetPath)) {
    const original = await fs.readText(targetPath);
    const dir = await absPath(PROVIDER_BACKUP_DIR);
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
    let seq = 0;
    let candidate = `${dir}/${providerBackupName(agent, now, target.ext, seq)}`;
    // 同一秒内多次写入时避免覆盖上一份备份
    while (await fs.exists(candidate)) {
      seq++;
      candidate = `${dir}/${providerBackupName(agent, now, target.ext, seq)}`;
    }
    await fs.writeText(candidate, original);
    backup = candidate;
  }
  const parent = parentOf(targetPath);
  if (parent && !(await fs.exists(parent))) await fs.mkdir(parent);
  await fs.writeText(targetPath, nextText);
  return backup;
}

/** 把 provider 写入对应 agent 的配置文件 */
export async function applyProvider(
  provider: Provider,
  fs: FsPort = tauriFs,
): Promise<ApplyResult> {
  const target: ProviderTarget = providerTarget(provider.agent);
  if (!target.writable) {
    return {
      ok: false,
      message: `${target.note ?? '暂不支持写入，仅支持查看'}（${provider.agent}）`,
    };
  }
  const file = await absPath(target.file);
  try {
    const original = (await fs.exists(file)) ? await fs.readText(file) : '';
    const next = applyProviderText(provider.agent, original, provider);
    const backup = await backupAndWrite(provider.agent, file, next, fs);
    // Codex 的 config.toml 只记录 env_key，密钥需用户自己放进环境变量
    const envHint =
      provider.agent === 'codex' && provider.apiKey
        ? `；请在环境变量 ${codexEnvKey(provider.id)} 中设置密钥后重启 Codex`
        : '';
    return {
      ok: true,
      message:
        (backup ? `已写入 ${target.file}，原文件已备份` : `已创建 ${target.file}`) +
        envHint,
      ...(backup ? { backup } : {}),
      file,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      file,
    };
  }
}

/** 读取 agent 配置文件里的当前 provider 信息；缺失 / 损坏都不抛错 */
export async function readCurrent(
  agent: AgentId,
  fs: FsPort = tauriFs,
  store?: ProviderStore,
): Promise<ReadResult> {
  const target = providerTarget(agent);
  if (!target.writable || target.file === '') {
    return { found: false, file: '', current: emptyCurrent() };
  }
  const file = await absPath(target.file);
  try {
    if (!(await fs.exists(file))) {
      return { found: false, file, current: emptyCurrent() };
    }
    const text = await fs.readText(file);
    // pi 需要知道当前生效的 provider id 才能定位条目
    const activeId =
      target.format === 'pi-models'
        ? store?.active[agent]
        : undefined;
    const current = readProviderConfig(target.format, text, activeId);
    return { found: current.found, file, current };
  } catch (e) {
    return {
      found: false,
      file,
      current: emptyCurrent(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 读取所有可写 agent 的现状（页面加载用） */
export async function readAllCurrent(
  agents: AgentId[],
  fs: FsPort = tauriFs,
  store?: ProviderStore,
): Promise<Partial<Record<AgentId, ReadResult>>> {
  const out: Partial<Record<AgentId, ReadResult>> = {};
  for (const agent of agents) {
    out[agent] = await readCurrent(agent, fs, store);
  }
  return out;
}

/** 某 agent 下按 store 中顺序排列的 provider */
export const providersForAgent = (
  store: ProviderStore,
  agent: AgentId,
): Provider[] => providersOf(store, agent);