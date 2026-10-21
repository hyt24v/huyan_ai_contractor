import { CircleAlert } from 'lucide-react';

export interface ErrorItem {
  line?: number;
  column?: number;
  message: string;
}

export default function ErrorPanel({
  errors,
  onJump,
}: {
  errors: ErrorItem[];
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
              className="shrink-0 rounded bg-destructive/10 px-1 font-mono hover:bg-destructive/20"
              onClick={() => onJump(e.line!, e.column)}
            >
              第 {e.line} 行{e.column !== undefined ? `:${e.column}` : ''}
            </button>
          ) : null}
          <span className="break-all font-mono">{e.message}</span>
        </div>
      ))}
    </div>
  );
}
