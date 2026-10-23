// JSON 编辑器历史记录（自动快照）
// 存 localStorage，重启应用不丢；最多 50 条，单条超过 512KB 不存。

export interface EditorHistoryEntry {
  id: string;
  time: number; // epoch ms
  text: string;
  chars: number;
}

export const HISTORY_KEY = 'huyan_tool:editor-history';
export const HISTORY_MAX_ENTRIES = 50;
export const HISTORY_MAX_ENTRY_BYTES = 512 * 1024;

function readAll(): EditorHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e: unknown): e is EditorHistoryEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as EditorHistoryEntry).text === 'string' &&
        typeof (e as EditorHistoryEntry).time === 'number',
    );
  } catch {
    return [];
  }
}

function writeAll(entries: EditorHistoryEntry[]): boolean {
  // localStorage 配额有限：写不下就逐步丢弃最旧的记录再试
  let list = entries;
  for (let i = 0; i < 8; i++) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return true;
    } catch {
      if (list.length <= 1) return false;
      list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
    }
  }
  return false;
}

/** 读全部历史（新的在前） */
export function listHistory(): EditorHistoryEntry[] {
  return readAll();
}

/** 追加一条快照；与最新一条内容相同时忽略。返回是否实际新增。 */
export function addHistory(text: string): boolean {
  if (!text.trim()) return false;
  // 单条上限：按 UTF-16 码元数近似（512K 字符 ≈ ≤1MB UTF-8）
  if (text.length > HISTORY_MAX_ENTRY_BYTES) return false;
  const entries = readAll();
  if (entries[0] && entries[0].text === text) return false;
  const entry: EditorHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now(),
    text,
    chars: text.length,
  };
  const next = [entry, ...entries].slice(0, HISTORY_MAX_ENTRIES);
  return writeAll(next);
}

/** 删除指定条目 */
export function deleteHistoryEntry(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

/** 清空全部历史 */
export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

/** 人类可读的条目大小 */
export function formatEntrySize(chars: number): string {
  if (chars < 1024) return `${chars} 字符`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}

/** 条目内容预览（压缩为单行、截断） */
export function historyPreview(text: string, max = 64): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}
