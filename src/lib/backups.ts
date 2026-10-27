/**
 * MCP 配置快照的命名 / 校验 / 裁剪 / 序列化纯逻辑（可单测）。
 *
 * 快照目录：~/.ai-baogongtou/backups/<snapshotId>/
 *   manifest.json        快照清单（SnapshotRecord）
 *   files/<copyName>     各 agent MCP 配置 + 中央清单的纯文本副本
 */

export const BACKUP_DIR = '.ai-baogongtou/backups';
export const SNAPSHOT_MANIFEST_FILE = 'manifest.json';
export const SNAPSHOT_FILES_DIR = 'files';
export const DEFAULT_KEEP = 20;

/** 快照里记录的一个文件 */
export interface SnapshotFileRecord {
  /** 相对 $HOME 的原始路径，如 .claude.json */
  file: string;
  /** 快照 files/ 下的副本文件名 */
  copy: string;
  /** 原始文件在创建快照时是否存在 */
  exists: boolean;
  /** 文本字节数（字符长度） */
  bytes: number;
  /** 读取失败时的错误信息 */
  error?: string;
}

export interface SnapshotRecord {
  id: string;
  label: string;
  /** ISO 时间戳 */
  createdAt: string;
  files: SnapshotFileRecord[];
}

/** ISO 安全的时间戳快照 ID：2026-10-22T10-47-05-123Z（可按字典序排序） */
export function snapshotId(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

const SNAPSHOT_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/;

export function isValidSnapshotId(id: string): boolean {
  return SNAPSHOT_ID_RE.test(id);
}

/** 同一毫秒重复创建时追加 -2、-3 … 后缀 */
export function uniqueSnapshotId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** 拆出基础时间部分与重复序号，用于正确排序 */
function splitSnapshotId(id: string): { base: string; seq: number } {
  const m = id.match(/^(.*Z)(?:-(\d+))?$/);
  return m ? { base: m[1], seq: Number(m[2] ?? 0) } : { base: id, seq: 0 };
}

/** 快照 ID 升序比较（旧 → 新） */
export function compareSnapshotIds(a: string, b: string): number {
  const sa = splitSnapshotId(a);
  const sb = splitSnapshotId(b);
  if (sa.base !== sb.base) return sa.base < sb.base ? -1 : 1;
  return sa.seq - sb.seq;
}

/**
 * 保留最新 keep 个快照，返回需要删除的 ID 列表（新 → 旧排序输入）。
 * 非法 ID 不参与裁剪，避免误删未知目录。
 */
export function prunePlan(ids: readonly string[], keep: number = DEFAULT_KEEP): string[] {
  const valid = ids.filter(isValidSnapshotId);
  const limit = Math.max(0, Math.floor(keep));
  const sorted = [...valid].sort((a, b) => compareSnapshotIds(b, a));
  return sorted.slice(limit);
}

/**
 * 原始相对路径 → 快照内唯一副本名。
 * 去掉前导点（避免 tauriFs.readDir 过滤隐藏项），用 ~ 作可逆转义符保证无碰撞：
 * 先转义已有的 ~ 为 ~~，再把路径分隔符换成 ~：
 *   .cursor/mcp.json        → cursor~mcp.json
 *   .pi/agent/mcp.json      → pi~agent~mcp.json
 *   claude__mcp.json（字面）→ claude__mcp.json（不与 .claude/mcp.json 碰撞）
 */
export function snapshotCopyName(relPath: string): string {
  const cleaned = relPath
    .replace(/^[./\\]+/, '')
    .replace(/~/g, '~~')
    .replace(/[/\\]+/g, '~')
    .replace(/[^A-Za-z0-9._@+~-]/g, '_');
  return cleaned || 'file';
}

/** 快照副本名必须是无分隔符的单层安全文件名（防篡改清单越界读写） */
export function isValidCopyName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('..') &&
    /^[A-Za-z0-9._@+~-]+$/.test(name)
  );
}

/** 相对 $HOME 的路径必须不含 .. 段、不是绝对路径（防篡改清单越界读写） */
export function isSafeRelPath(path: string): boolean {
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[/\\]+/).some((seg) => seg === '..');
}

export function serializeSnapshot(record: SnapshotRecord): string {
  return JSON.stringify(record, null, 2) + '\n';
}

/** 解析快照清单；结构不合法返回 null */
export function parseSnapshot(text: string): SnapshotRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.id !== 'string' || !isValidSnapshotId(r.id)) return null;
  const files: SnapshotFileRecord[] = [];
  if (Array.isArray(r.files)) {
    for (const raw of r.files) {
      if (typeof raw !== 'object' || raw === null) continue;
      const f = raw as Record<string, unknown>;
      if (typeof f.file !== 'string') continue;
      files.push({
        file: f.file,
        copy: typeof f.copy === 'string' ? f.copy : snapshotCopyName(f.file),
        exists: f.exists === true,
        bytes: typeof f.bytes === 'number' && Number.isFinite(f.bytes) ? f.bytes : 0,
        ...(typeof f.error === 'string' ? { error: f.error } : {}),
      });
    }
  }
  return {
    id: r.id,
    label: typeof r.label === 'string' ? r.label : '',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    files,
  };
}

/** 展示用时间：优先 createdAt，坏数据回退 ID 本身 */
export function snapshotDisplayTime(record: SnapshotRecord): string {
  if (!record.createdAt) return record.id;
  const d = new Date(record.createdAt);
  if (Number.isNaN(d.getTime())) return record.id;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}