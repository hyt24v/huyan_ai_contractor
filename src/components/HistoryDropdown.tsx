// 历史记录下拉面板（配合 useEditorHistory 使用）
import { History } from 'lucide-react';
import { ToolbarButton } from './Toolbar';
import {
  formatEntrySize,
  historyPreview,
  type EditorHistoryEntry,
} from '../lib/editorHistory';

interface HistoryDropdownProps {
  history: EditorHistoryEntry[];
  open: boolean;
  onToggle: () => void;
  onRestore: (entry: EditorHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
}

export default function HistoryDropdown({
  history,
  open,
  onToggle,
  onRestore,
  onRemove,
  onClear,
  containerRef,
}: HistoryDropdownProps) {
  return (
    <div ref={containerRef} className="relative">
      <ToolbarButton
        onClick={onToggle}
        title="编辑历史（停顿 2s 自动快照，最多 50 条）"
      >
        <span className="inline-flex items-center gap-1">
          <History className="h-3.5 w-3.5" />
          历史{history.length > 0 ? `(${history.length})` : ''}
        </span>
      </ToolbarButton>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 rounded-md border bg-card p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-foreground">
              历史记录（自动快照）
            </span>
            <button
              onClick={onClear}
              disabled={history.length === 0}
              className="text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
            >
              清空
            </button>
          </div>
          {history.length === 0 ? (
            <div className="px-1 py-6 text-center text-xs text-muted-foreground">
              暂无历史记录
            </div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="group rounded-sm border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground">
                      {new Date(entry.time).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatEntrySize(entry.chars)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {historyPreview(entry.text)}
                  </div>
                  <div className="mt-1 flex gap-3">
                    <button
                      onClick={() => onRestore(entry)}
                      className="text-xs text-primary hover:underline"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => onRemove(entry.id)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
