import { CircleAlert } from 'lucide-react';

export interface ErrorItem {
  line?: number;
  column?: number;
  message: string;
}

export default function ErrorPanel({
  errors,
  total,
  onJump,
}: {
  errors: ErrorItem[];
  /** 错误总数；大于 errors.length 时说明被截断，显示提示（审核 #17） */
  total?: number;
  onJump?: (line: number, column?: number) => void;
}) {
  if (errors.length === 0) return null;
  return (
    <div className="max-h-28 shrink-0 overflow-auto border-t border-destructive/30 bg-destructive/5 px-3 py-1.5">
      {errors.map((e, i) => (
        <div
          key={i}
          className="flex items-start gap-1.5 py-0.5 text-xs text-destructive"
        >
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {e.line !== undefined && onJump ? (
            <button
              className="shrink-0 rounded-sm bg-destructive/10 px-1 font-mono hover:bg-destructive/20"
              onClick={() => onJump(e.line!, e.column)}
            >
              第 {e.line} 行{e.column !== undefined ? `:${e.column}` : ''}
            </button>
          ) : null}
          <span className="break-all font-mono">{e.message}</span>
        </div>
      ))}
      {total !== undefined && total > errors.length && (
        <div className="py-0.5 text-xs text-muted-foreground">
          仅显示前 {errors.length} 条，共 {total} 条错误
        </div>
      )}
    </div>
  );
}
