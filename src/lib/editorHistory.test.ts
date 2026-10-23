import { beforeEach, describe, expect, it } from 'vitest';
import {
  addHistory,
  clearHistory,
  deleteHistoryEntry,
  formatEntrySize,
  historyPreview,
  listHistory,
  HISTORY_KEY,
  HISTORY_MAX_ENTRIES,
} from './editorHistory';

// node 环境下补一个内存版 localStorage
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  store.clear();
});

describe('editorHistory', () => {
  it('追加快照且新的在前', () => {
    expect(addHistory('{"a":1}')).toBe(true);
    expect(addHistory('{"b":2}')).toBe(true);
    const list = listHistory();
    expect(list).toHaveLength(2);
    expect(list[0].text).toBe('{"b":2}');
    expect(list[1].text).toBe('{"a":1}');
    expect(list[0].chars).toBe(7);
  });

  it('与最新一条相同则去重', () => {
    addHistory('{"a":1}');
    expect(addHistory('{"a":1}')).toBe(false);
    expect(listHistory()).toHaveLength(1);
  });

  it('空内容不记录', () => {
    expect(addHistory('')).toBe(false);
    expect(addHistory('   \n ')).toBe(false);
    expect(listHistory()).toHaveLength(0);
  });

  it('超过上限截断为最旧丢弃', () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 10; i++) {
      addHistory(`{"i":${i}}`);
    }
    const list = listHistory();
    expect(list).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(list[0].text).toBe(`{"i":${HISTORY_MAX_ENTRIES + 9}}`);
  });

  it('单条超过 512K 字符不记录', () => {
    expect(addHistory('x'.repeat(513 * 1024))).toBe(false);
    expect(listHistory()).toHaveLength(0);
  });

  it('删除指定条目', () => {
    addHistory('{"a":1}');
    addHistory('{"b":2}');
    const id = listHistory()[1].id;
    deleteHistoryEntry(id);
    const list = listHistory();
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('{"b":2}');
  });

  it('清空全部', () => {
    addHistory('{"a":1}');
    clearHistory();
    expect(listHistory()).toHaveLength(0);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('损坏的存档回退为空列表', () => {
    store.set(HISTORY_KEY, '{not json');
    expect(listHistory()).toEqual([]);
    store.set(HISTORY_KEY, '[{"bad":true}]');
    expect(listHistory()).toEqual([]);
  });

  it('格式化大小与预览', () => {
    expect(formatEntrySize(100)).toBe('100 字符');
    expect(formatEntrySize(2048)).toBe('2.0 KB');
    expect(historyPreview('{\n  "a":  1\n}')).toBe('{ "a": 1 }');
    expect(historyPreview('x'.repeat(100), 10)).toBe('xxxxxxxxxx…');
  });
});
