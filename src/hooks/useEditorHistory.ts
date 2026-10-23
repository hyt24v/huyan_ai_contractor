// 编辑器历史记录（手动保存）通用 Hook —— JSON / Markdown 编辑器共用
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addHistory,
  clearHistory,
  deleteHistoryEntry,
  listHistory,
  type EditorHistoryEntry,
} from '../lib/editorHistory';

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

  /** 手动保存当前内容到历史（仅用户点击时调用） */
  const saveCurrent = useCallback(() => {
    if (!text.trim()) {
      showToast('当前内容为空，未保存');
      return;
    }
    if (addHistory(text, storageKey)) {
      setHistory(listHistory(storageKey));
      showToast('已存到历史');
    } else {
      showToast('内容与最近一条相同，未重复保存');
    }
  }, [text, storageKey, showToast]);

  const refreshHistory = useCallback(() => {
    setHistory(listHistory(storageKey));
  }, [storageKey]);

  const restoreEntry = useCallback(
    (entry: EditorHistoryEntry) => {
      setText(entry.text);
      setHistoryOpen(false);
      showToast('已恢复历史版本');
    },
    [setText, showToast],
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
    saveCurrent,
    refreshHistory,
    restoreEntry,
    removeEntry,
    clearAll,
  };
}
