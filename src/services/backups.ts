/** MCP 配置快照服务：fsPort 与 backups.ts 纯逻辑的粘合层 */
import { AGENTS } from '../lib/agents';
import {
  BACKUP_DIR,
  DEFAULT_KEEP,
  SNAPSHOT_FILES_DIR,
  SNAPSHOT_MANIFEST_FILE,
  compareSnapshotIds,
  isValidSnapshotId,
  parseSnapshot,
  prunePlan,
  serializeSnapshot,
  snapshotCopyName,
  snapshotId,
  uniqueSnapshotId,
  type SnapshotFileRecord,
  type SnapshotRecord,
} from '../lib/backups';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';

const CENTRAL_MANIFEST = '.ai-baogongtou/mcp-central.json';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function ensureDir(fs: FsPort, dir: string): Promise<void> {
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
}

async function backupRoot(): Promise<string> {
  return absPath(BACKUP_DIR);
}

/** 快照里要记录的文件：中央清单 + 每个 agent 的 MCP 配置 */
function snapshotTargets(): string[] {
  // 只快照支持 MCP 管理的 agent(未知配置路径的 agent 没有可快照的文件)
  return [
    CENTRAL_MANIFEST,
    ...AGENTS.filter((a) => a.mcpFile).map((a) => a.mcpFile!),
  ];
}

/**
 * 创建快照：读取中央清单与每个已存在的 agent MCP 配置，写入
 * ~/.ai-baogongtou/backups/<id>/files/，并生成 manifest.json。
 * 源文件缺失不会抛错，只在清单里记 exists=false。
 */
export async function createSnapshot(fs: FsPort = tauriFs, label = ''): Promise<string> {
  const root = await backupRoot();
  await ensureDir(fs, root);

  const taken = (await fs.readDir(root))
    .filter((e) => e.isDirectory && isValidSnapshotId(e.name))
    .map((e) => e.name);
  const id = uniqueSnapshotId(snapshotId(), taken);
  const dir = `${root}/${id}`;
  const filesDir = `${dir}/${SNAPSHOT_FILES_DIR}`;
  await fs.mkdir(dir);
  await fs.mkdir(filesDir);

  const files: SnapshotFileRecord[] = [];
  for (const rel of snapshotTargets()) {
    const copy = snapshotCopyName(rel);
    const record: SnapshotFileRecord = { file: rel, copy, exists: false, bytes: 0 };
    try {
      const src = await absPath(rel);
      if (await fs.exists(src)) {
        const text = await fs.readText(src);
        await fs.writeText(`${filesDir}/${copy}`, text);
        record.exists = true;
        record.bytes = text.length;
      }
    } catch (e) {
      record.error = errMsg(e);
    }
    files.push(record);
  }

  const snapshot: SnapshotRecord = {
    id,
    label: label.trim(),
    createdAt: new Date().toISOString(),
    files,
  };
  await fs.writeText(`${dir}/${SNAPSHOT_MANIFEST_FILE}`, serializeSnapshot(snapshot));
  return id;
}

/** 列出所有快照（新 → 旧）；清单损坏的快照也会列出但 files 为空 */
export async function listSnapshots(fs: FsPort = tauriFs): Promise<SnapshotRecord[]> {
  const root = await backupRoot();
  if (!(await fs.exists(root))) return [];
  const entries = await fs.readDir(root);
  const records: SnapshotRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory || !isValidSnapshotId(entry.name)) continue;
    const manifestPath = `${root}/${entry.name}/${SNAPSHOT_MANIFEST_FILE}`;
    let record: SnapshotRecord | null = null;
    try {
      if (await fs.exists(manifestPath)) record = parseSnapshot(await fs.readText(manifestPath));
    } catch {
      record = null;
    }
    records.push(
      record ?? { id: entry.name, label: '（清单缺失或损坏）', createdAt: '', files: [] },
    );
  }
  return records.sort((a, b) => compareSnapshotIds(b.id, a.id));
}

export interface RestoreResult {
  record: SnapshotRecord;
  /** 成功写回的文件（相对 $HOME） */
  restored: string[];
  /** 快照时不存在、本次回滚删除的文件 */
  removed: string[];
  /** 快照中缺失或写回失败的文件 */
  missing: string[];
}

/** 把快照里的文件写回原位置；单个文件失败记入 missing 而不是整体失败 */
export async function restoreSnapshot(
  fs: FsPort = tauriFs,
  id?: string,
): Promise<RestoreResult> {
  if (!id || !isValidSnapshotId(id)) throw new Error(`非法快照 ID：${id ?? ''}`);
  const root = await backupRoot();
  const dir = `${root}/${id}`;
  const manifestPath = `${dir}/${SNAPSHOT_MANIFEST_FILE}`;
  if (!(await fs.exists(manifestPath))) throw new Error(`快照不存在：${id}`);
  const record = parseSnapshot(await fs.readText(manifestPath));
  if (!record) throw new Error(`快照清单损坏：${id}`);

  const restored: string[] = [];
  const removed: string[] = [];
  const missing: string[] = [];
  for (const f of record.files) {
    if (!f.exists) {
      // 快照时不存在：真正的回滚需要删掉快照之后新增的文件
      try {
        const target = await absPath(f.file);
        if (await fs.exists(target)) {
          await fs.remove(target);
          removed.push(f.file);
        }
      } catch (e) {
        missing.push(`${f.file}（删除失败：${errMsg(e)}）`);
      }
      continue;
    }
    try {
      const copyPath = `${dir}/${SNAPSHOT_FILES_DIR}/${f.copy}`;
      if (!(await fs.exists(copyPath))) {
        missing.push(f.file);
        continue;
      }
      const text = await fs.readText(copyPath);
      const target = await absPath(f.file);
      const parent = target.slice(0, target.lastIndexOf('/'));
      if (parent && !(await fs.exists(parent))) await fs.mkdir(parent);
      await fs.writeText(target, text);
      restored.push(f.file);
    } catch (e) {
      missing.push(`${f.file}（${errMsg(e)}）`);
    }
  }
  return { record, restored, removed, missing };
}

/** 只保留最新 keep 个快照，返回被删除的 ID */
export async function pruneSnapshots(
  fs: FsPort = tauriFs,
  keep: number = DEFAULT_KEEP,
): Promise<string[]> {
  const records = await listSnapshots(fs);
  const drop = prunePlan(
    records.map((r) => r.id),
    keep,
  );
  if (drop.length === 0) return [];
  const root = await backupRoot();
  for (const id of drop) {
    try {
      await fs.remove(`${root}/${id}`, true);
    } catch {
      // 删除失败不影响其它快照
    }
  }
  return drop;
}