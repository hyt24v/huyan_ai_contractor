// 编辑器历史记录（自动快照）通用 Hook —— JSON / Markdown 编辑器共用
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addHistory,
  clearHistory,
  deleteHistoryEntry,
  listHistory,
  type EditorHistoryEntry,
} from '../lib/editorHistory';

export const EDITOR_HISTORY_DEBOUNCE_MS = 2000;

interface UseEditorHistoryOptions {
  /** localStorage 存储 key（不同编辑器用不同 key） */
  storageKey: string;
  /** 当前文本（受控） */
  text: string;
  setText: (text: string) => void;
  showToast: (msg: string) => void;
}

export function useEditorHistory({
  storageKey,
  text,
  setText,
  showToast,
}: UseEditorHistoryOptions) {
  const [history, setHistory] = useState<EditorHistoryEntry[]>(() =>
    listHistory(storageKey),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>(text);

  // 编辑停顿后自动快照（与最新一条相同则由 addHistory 去重）
  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (text !== lastSavedRef.current && addHistory(text, storageKey)) {
        lastSavedRef.current = text;
        setHistory(listHistory(storageKey));
      }
    }, EDITOR_HISTORY_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [text, storageKey]);

  // 点击历史面板外部关闭
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [historyOpen]);

  /** 立即快照当前内容（破坏性操作前调用） */
  const snapshotNow = useCallback(() => {
    if (addHistory(text, storageKey)) {
      lastSavedRef.current = text;
      setHistory(listHistory(storageKey));
    }
  }, [text, storageKey]);

  const refreshHistory = useCallback(() => {
    setHistory(listHistory(storageKey));
  }, [storageKey]);

  const restoreEntry = useCallback(
    (entry: EditorHistoryEntry) => {
      snapshotNow(); // 恢复前先保住当前内容
      setText(entry.text);
      setHistoryOpen(false);
      showToast('已恢复历史版本');
    },
    [snapshotNow, setText, showToast],
  );

  const removeEntry = useCallback(
    (id: string) => {
      deleteHistoryEntry(id, storageKey);
      setHistory(listHistory(storageKey));
    },
    [storageKey],
  );

  const clearAll = useCallback(() => {
    clearHistory(storageKey);
    setHistory([]);
    showToast('历史已清空');
  }, [storageKey, showToast]);

  return {
    history,
    historyOpen,
    setHistoryOpen,
    historyRef,
    snapshotNow,
    refreshHistory,
    restoreEntry,
    removeEntry,
    clearAll,
  };
}
