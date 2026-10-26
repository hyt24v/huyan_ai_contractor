import { useMemo } from 'react';
import { CircleAlert, Trash2 } from 'lucide-react';
import {
  cellPreview,
  collectFields,
  getByPath,
  type JsonlLineResult,
} from '../lib/jsonl';

const MAX_TABLE_ROWS = 5000;

export default function JsonlTableView({
  results,
  onDeleteLine,
  onJumpToLine,
}: {
  results: JsonlLineResult[];
  onDeleteLine: (line: number, endLine?: number) => void;
  onJumpToLine: (line: number) => void;
}) {
  const validRows = useMemo(
    () => results.filter((r) => !r.empty && r.ok),
    [results],
  );
  const invalidRows = useMemo(
    () => results.filter((r) => !r.empty && !r.ok),
    [results],
  );
  const fields = useMemo(
    () => collectFields(validRows.map((r) => r.value)),
    [validRows],
  );
  const truncated = validRows.length > MAX_TABLE_ROWS;
  const shownRows = truncated ? validRows.slice(0, MAX_TABLE_ROWS) : validRows;

  if (validRows.length === 0 && invalidRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        没有可展示的数据
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {truncated && (
        <div className="shrink-0 border-b bg-warning px-3 py-1.5 text-xs text-warning-foreground">
          数据共 {validRows.length} 行，表格仅渲染前 {MAX_TABLE_ROWS} 行
        </div>
      )}
      {invalidRows.length > 0 && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
            <CircleAlert className="h-3.5 w-3.5" />
            {invalidRows.length} 行解析失败（未纳入表格）：
          </div>
          <div className="max-h-24 overflow-auto">
            {invalidRows.map((r) => (
              <button
                key={r.line}
                onClick={() => onJumpToLine(r.line)}
                className="mb-1 mr-1.5 rounded-md bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] text-destructive hover:bg-destructive/20"
                title={r.error}
              >
                第 {r.endLine && r.endLine > r.line ? `${r.line}–${r.endLine}` : r.line} 行
              </button>
            ))}
          </div>
        </div>
      )}
      {/* shadcn / dbx 风格表格：sticky 表头 + 行分隔线 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b bg-muted/50">
              <th className="h-9 w-14 px-3 text-left align-middle text-xs font-medium text-muted-foreground">
                #
              </th>
              {fields.map((f) => (
                <th
                  key={f}
                  className="h-9 px-3 text-left align-middle font-mono text-xs font-medium text-muted-foreground"
                >
                  {f}
                </th>
              ))}
              <th className="h-9 w-10 bg-muted/50" />
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr
                key={r.line}
                className="border-b transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="px-3 py-1.5 align-middle">
                  <button
                    onClick={() => onJumpToLine(r.line)}
                    className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                    title="跳到代码行"
                  >
                    {r.line}
                  </button>
                </td>
                {fields.map((f) => {
                  const v = getByPath(r.value, f);
                  return (
                    <td
                      key={f}
                      className="max-w-64 truncate px-3 py-1.5 align-middle font-mono text-xs"
                      title={v === undefined ? undefined : JSON.stringify(v)}
                    >
                      {cellPreview(v)}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center align-middle">
                  <button
                    onClick={() => onDeleteLine(r.line, r.endLine)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="删除此行"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
