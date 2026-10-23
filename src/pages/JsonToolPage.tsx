import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import CodeEditor, { type EditorInstance } from '../components/CodeEditor';
import ErrorPanel from '../components/ErrorPanel';
import JsonTreeView from '../components/JsonTreeView';
import JsonlTableView from '../components/JsonlTableView';
import {
  SegmentedControl,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from '../components/Toolbar';
import { monaco } from '../monacoSetup';
import { isTauri } from '@tauri-apps/api/core';
import { absPath, tauriFs } from '../lib/fsPort';
import {
  buildJsonTree,
  copyToClipboard,
  downloadText,
  escapeJson,
  formatJson,
  minifyJson,
  parseJson,
  unicodeToChinese,
  unescapeJson,
  valueType,
  type JsonTreeNode,
} from '../lib/json';
import {
  deleteLine,
  duplicateLine,
  jsonlStats,
  normalizeJsonl,
  parseJsonl,
  type JsonlLineResult,
  type JsonValue,
} from '../lib/jsonl';
import {
  detectMode,
  queryJsonPath,
  repairText,
  sortJsonKeys,
  type EditorMode,
  type QueryResult,
} from '../lib/toolkit';
import {
  addHistory,
  clearHistory,
  deleteHistoryEntry,
  formatEntrySize,
  historyPreview,
  listHistory,
  type EditorHistoryEntry,
} from '../lib/editorHistory';

const STORAGE_KEY = 'huyan_tool:editor';
const MODE_KEY = 'huyan_tool:editor-mode';
const KEEP_ESCAPE_KEY = 'huyan_tool:editor-keep-escape';
const HISTORY_DEBOUNCE_MS = 2000;

const SAMPLE = `{
  "name": "AI包工头",
  "version": "0.5.1",
  "site": "https://github.com/hyt24v/huyan_ai_contractor",
  "created": "2026-10-21",
  "tags": ["json", "jsonl"],
  "author": { "name": "huyan", "local": true }
}`;

type ModeSetting = 'auto' | EditorMode;
type Panel = 'tree' | 'table' | 'query';

function initialText(): string {
  return (
    localStorage.getItem(STORAGE_KEY) ??
    // 兼容旧版两个工具的存档
    localStorage.getItem('huyan_tool:json') ??
    localStorage.getItem('huyan_tool:jsonl') ??
    SAMPLE
  );
}

export default function JsonToolPage() {
  const [text, setText] = useState(initialText);
  const [modeSetting, setModeSetting] = useState<ModeSetting>(
    () => (localStorage.getItem(MODE_KEY) as ModeSetting | null) ?? 'auto',
  );
  const [panel, setPanel] = useState<Panel>('tree');
  const [keepEmptyLines, setKeepEmptyLines] = useState(false);
  const [keepEscape, setKeepEscape] = useState(
    () => localStorage.getItem(KEEP_ESCAPE_KEY) === '1',
  );

  useEffect(() => {
    localStorage.setItem(KEEP_ESCAPE_KEY, keepEscape ? '1' : '0');
  }, [keepEscape]);
  const [toast, setToast] = useState('');
  const [jumpInput, setJumpInput] = useState('');

  // JSON 模式状态
  const [tree, setTree] = useState<JsonTreeNode | null>(null);
  const [treeStale, setTreeStale] = useState(false);
  const [jsonError, setJsonError] = useState<{
    message: string;
    line?: number;
    column?: number;
  } | null>(null);
  const [jsonValue, setJsonValue] = useState<JsonValue | null>(null);

  // JSONL 模式状态
  const [jsonlResults, setJsonlResults] = useState<JsonlLineResult[]>([]);

  // 查询面板状态
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);

  const editorRef = useRef<EditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPct, setLeftPct] = useState(55);

  // ---------- 历史记录（自动快照） ----------
  const [history, setHistory] = useState<EditorHistoryEntry[]>(() =>
    listHistory(),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>(text);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  // 模式：手动优先，否则自动识别
  const mode: EditorMode =
    modeSetting === 'auto' ? detectMode(text) : modeSetting;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text);
  }, [text]);
  useEffect(() => {
    localStorage.setItem(MODE_KEY, modeSetting);
  }, [modeSetting]);

  // 编辑停顿 2s 自动快照（与最新一条相同则由 addHistory 去重）
  useEffect(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
    }
    historyTimerRef.current = window.setTimeout(() => {
      if (text !== lastSavedRef.current && addHistory(text)) {
        lastSavedRef.current = text;
        setHistory(listHistory());
      }
    }, HISTORY_DEBOUNCE_MS);
    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
      }
    };
  }, [text]);

  // 点击历史面板外部关闭
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        historyRef.current &&
        !historyRef.current.contains(e.target as Node)
      ) {
        setHistoryOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [historyOpen]);

  // 立即快照当前内容（破坏性操作前调用，防误操作丢失）
  const snapshotNow = useCallback(() => {
    setText((current) => {
      if (addHistory(current)) {
        lastSavedRef.current = current;
        setHistory(listHistory());
      }
      return current;
    });
  }, []);

  const restoreHistoryEntry = useCallback(
    (entry: EditorHistoryEntry) => {
      snapshotNow(); // 恢复前先保住当前内容
      setText(entry.text);
      setHistoryOpen(false);
      showToast('已恢复历史版本');
    },
    [snapshotNow, showToast],
  );

  const removeHistoryEntry = useCallback((id: string) => {
    deleteHistoryEntry(id);
    setHistory(listHistory());
  }, []);

  const clearAllHistory = useCallback(() => {
    clearHistory();
    setHistory([]);
    showToast('历史已清空');
  }, [showToast]);

  // ---------- 校验（随模式分派，防抖 300ms） ----------
  const validate = useCallback(
    (value: string, m: EditorMode) => {
      const model = editorRef.current?.getModel();
      if (m === 'json') {
        const r = parseJson(value);
        if (r.ok) {
          setJsonError(null);
          const v = r.value as JsonValue;
          setJsonValue(v);
          setTree(buildJsonTree(v));
          setTreeStale(false);
          if (model) monaco.editor.setModelMarkers(model, 'json-tool', []);
        } else {
          const { message, line, column } = r.error;
          setJsonError({ message, line, column });
          setJsonValue(null);
          setTreeStale((prev) => prev || tree !== null);
          if (model && line !== undefined) {
            monaco.editor.setModelMarkers(model, 'json-tool', [
              {
                severity: monaco.MarkerSeverity.Error,
                message,
                startLineNumber: line,
                startColumn: column ?? 1,
                endLineNumber: line,
                endColumn: model.getLineMaxColumn(
                  Math.min(line, model.getLineCount()),
                ),
              },
            ]);
          }
        }
      } else {
        const rs = parseJsonl(value);
        setJsonlResults(rs);
        setJsonError(null);
        if (model) {
          monaco.editor.setModelMarkers(
            model,
            'json-tool',
            rs
              .filter((r) => !r.empty && !r.ok)
              .map((r) => ({
                severity: monaco.MarkerSeverity.Error,
                message: r.error ?? '解析失败',
                startLineNumber: r.line,
                startColumn: 1,
                endLineNumber: r.line,
                endColumn: model.getLineMaxColumn(
                  Math.min(r.line, model.getLineCount()),
                ),
              })),
          );
        }
      }
    },
    [tree],
  );

  useEffect(() => {
    const timer = setTimeout(() => validate(text, mode), 300);
    return () => clearTimeout(timer);
    // validate 依赖 tree 会循环触发，这里只对 text/mode 变化防抖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode]);

  const jsonlStatsMemo = useMemo(
    () => jsonlStats(jsonlResults),
    [jsonlResults],
  );

  // ---------- 编辑器辅助 ----------
  const jumpTo = useCallback((line: number, column?: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: column ?? 1 });
    editor.focus();
  }, []);

  const jumpToNextError = useCallback(() => {
    const errors = jsonlResults.filter((r) => !r.empty && !r.ok);
    if (errors.length === 0) {
      showToast('没有错误行');
      return;
    }
    const curLine = editorRef.current?.getPosition()?.lineNumber ?? 0;
    const next = errors.find((r) => r.line > curLine) ?? errors[0];
    jumpTo(next.line);
  }, [jsonlResults, jumpTo, showToast]);

  const currentLine = useCallback(
    () => editorRef.current?.getPosition()?.lineNumber ?? 1,
    [],
  );

  // ---------- 操作 ----------
  const applyTransform = useCallback(
    (
      fn: (t: string) => {
        ok: boolean;
        text?: string;
        error?: { message: string };
      },
      okMsg: string,
    ) => {
      snapshotNow();
      const r = fn(text);
      if (r.ok && r.text !== undefined) {
        setText(r.text);
        showToast(okMsg);
      } else if (!r.ok) {
        showToast(`失败：${r.error?.message ?? '未知错误'}`);
      }
    },
    [text, showToast, snapshotNow],
  );

  const doNormalize = useCallback(
    (okMsg: string) => {
      snapshotNow();
      const r = normalizeJsonl(text, { keepEmptyLines });
      setText(r.text);
      showToast(
        r.errors.length > 0
          ? `已处理，${r.errors.length} 行仍有错误（已原样保留）`
          : okMsg,
      );
    },
    [text, keepEmptyLines, showToast, snapshotNow],
  );

  const doRepair = useCallback(() => {
    snapshotNow();
    const r = repairText(text, mode);
    setText(r.text);
    showToast(r.ok ? '已修复' : `部分修复：${r.error ?? '仍有无法修复的内容'}`);
  }, [text, mode, showToast, snapshotNow]);

  const doSort = useCallback(() => {
    snapshotNow();
    const r = sortJsonKeys(text, mode);
    if (r.ok) {
      setText(r.text);
      showToast('已按键排序');
    } else {
      showToast(`排序失败：${r.error ?? '未知错误'}`);
    }
  }, [text, mode, showToast, snapshotNow]);

  const runQuery = useCallback(() => {
    const r = queryJsonPath(text, mode, query);
    setQueryResult(r);
  }, [text, mode, query]);

  // 下载：Tauri webview 里 a[download] 静默失败，改写文件到 exports 目录
  const doDownload = useCallback(async () => {
    const filename = mode === 'json' ? 'data.json' : 'data.jsonl';
    if (isTauri()) {
      try {
        const dir = await absPath('.ai-baogongtou/exports');
        if (!(await tauriFs.exists(dir))) await tauriFs.mkdir(dir);
        const path = `${dir}/${filename}`;
        await tauriFs.writeText(path, text);
        showToast(`已保存到 ${path}`);
      } catch (e) {
        showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      downloadText(filename, text);
      showToast('已开始下载');
    }
  }, [mode, text, showToast]);

  const openFile = useCallback(
    (file: File) => {
      file.text().then((content) => {
        snapshotNow();
        setText(content);
        showToast(`已载入 ${file.name}`);
      });
    },
    [showToast, snapshotNow],
  );

  // 分隔条拖拽
  const onDividerMouseDown = useCallback(() => {
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ---------- 表格数据 ----------
  // jsonl：直接用行结果；json 数组：元素成行；json 对象：键值成行
  const tableRows = useMemo((): JsonlLineResult[] | null => {
    if (mode === 'jsonl') return jsonlResults;
    if (jsonValue === null) return null;
    const t = valueType(jsonValue);
    if (t === 'array') {
      return (jsonValue as JsonValue[]).map((v, i) => ({
        line: i + 1,
        raw: '',
        empty: false,
        ok: true,
        value: v,
      }));
    }
    if (t === 'object') {
      return Object.entries(jsonValue as Record<string, JsonValue>).map(
        ([k, v], i) => ({
          line: i + 1,
          raw: '',
          empty: false,
          ok: true,
          value: { key: k, value: v, type: valueType(v) },
        }),
      );
    }
    return null;
  }, [mode, jsonlResults, jsonValue]);

  const handleTableDelete = useCallback(
    (line: number) => {
      snapshotNow();
      if (mode === 'jsonl') {
        setText(deleteLine(text, line));
        showToast(`已删除第 ${line} 行`);
      } else if (Array.isArray(jsonValue)) {
        const next = (jsonValue as JsonValue[]).filter(
          (_, i) => i !== line - 1,
        );
        setText(JSON.stringify(next, null, 2));
        showToast(`已删除第 ${line} 项`);
      }
    },
    [mode, text, jsonValue, showToast, snapshotNow],
  );

  const sizeWarning = text.length > 10 * 1024 * 1024;
  const modeLabel = mode === 'json' ? 'JSON' : 'JSONL';

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) openFile(file);
      }}
    >
      <Toolbar>
        {/* 模式切换 */}
        <SegmentedControl<ModeSetting>
          options={[
            { value: 'auto', label: `自动(${detectMode(text) === 'json' ? 'JSON' : 'JSONL'})` },
            { value: 'json', label: 'JSON' },
            { value: 'jsonl', label: 'JSONL' },
          ]}
          value={modeSetting}
          onChange={setModeSetting}
        />
        <ToolbarDivider />
        <ToolbarButton
          primary
          onClick={() => {
            validate(text, mode);
            // 重新解析一次取结果，避免读到 setState 前的旧状态
            if (mode === 'json') {
              showToast(parseJson(text).ok ? '✓ JSON 合法' : 'JSON 有错误');
            } else {
              const s = jsonlStats(parseJsonl(text));
              showToast(
                s.errors === 0
                  ? `✓ ${s.valid} 行全部合法`
                  : `${s.errors} 行有错误`,
              );
            }
          }}
        >
          校验
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            mode === 'json'
              ? applyTransform((t) => formatJson(t, 2, keepEscape), '已格式化')
              : doNormalize('已格式化')
          }
        >
          格式化
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            mode === 'json'
              ? applyTransform((t) => minifyJson(t, keepEscape), '已压缩')
              : doNormalize('已压缩')
          }
        >
          压缩
        </ToolbarButton>
        <label
          className="inline-flex cursor-pointer select-none items-center gap-1 text-xs text-muted-foreground"
          title="勾选：中文等非 ASCII 输出为 \\uXXXX 转义；不勾选：\\n、\\t、\\uXXXX 解码为真实字符（参考 json.cn）"
        >
          <input
            type="checkbox"
            checked={keepEscape}
            onChange={(e) => setKeepEscape(e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          保留转义
        </label>
        <ToolbarButton onClick={doRepair} title="修复单引号/尾逗号/缺引号等">
          智能修复
        </ToolbarButton>
        <ToolbarButton onClick={doSort} title="对象 key 递归排序">
          键排序
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => applyTransform((t) => escapeJson(t), '已转义')}>
          转义
        </ToolbarButton>
        <ToolbarButton onClick={() => applyTransform((t) => unescapeJson(t), '已去除转义')}>
          去转义
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            snapshotNow();
            setText(unicodeToChinese(text));
            showToast('已转换 Unicode');
          }}
        >
          Unicode转中文
        </ToolbarButton>
        <ToolbarDivider />
        {mode === 'jsonl' && (
          <>
            <input
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = Number(jumpInput);
                  if (Number.isInteger(n) && n >= 1) jumpTo(n);
                }
              }}
              placeholder="行号"
              className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <ToolbarButton onClick={jumpToNextError} title="跳到下一个错误行">
              下个错误
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                snapshotNow();
                setText(deleteLine(text, currentLine()));
                showToast('已删除当前行');
              }}
            >
              删除行
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                snapshotNow();
                setText(duplicateLine(text, currentLine()));
                showToast('已复制当前行');
              }}
            >
              复制行
            </ToolbarButton>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={keepEmptyLines}
                onChange={(e) => setKeepEmptyLines(e.target.checked)}
              />
              保留空行
            </label>
            <ToolbarDivider />
          </>
        )}
        <ToolbarButton
          onClick={() =>
            copyToClipboard(text).then((ok) =>
              showToast(ok ? '已复制' : '复制失败'),
            )
          }
        >
          复制
        </ToolbarButton>
        <ToolbarButton onClick={doDownload}>
          下载
        </ToolbarButton>
        <ToolbarButton onClick={() => fileInputRef.current?.click()}>
          打开文件
        </ToolbarButton>
        <div ref={historyRef} className="relative">
          <ToolbarButton
            onClick={() => {
              setHistory(listHistory());
              setHistoryOpen((o) => !o);
            }}
            title="编辑历史（停顿 2s 自动快照，最多 50 条）"
          >
            <span className="inline-flex items-center gap-1">
              <History className="h-3.5 w-3.5" />
              历史{history.length > 0 ? `(${history.length})` : ''}
            </span>
          </ToolbarButton>
          {historyOpen && (
            <div className="absolute right-0 top-9 z-50 w-80 rounded-md border bg-card p-2 shadow-lg">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-medium text-foreground">
                  历史记录（自动快照）
                </span>
                <button
                  onClick={clearAllHistory}
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
                          onClick={() => restoreHistoryEntry(entry)}
                          className="text-xs text-primary hover:underline"
                        >
                          恢复
                        </button>
                        <button
                          onClick={() => removeHistoryEntry(entry.id)}
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
        <ToolbarButton
          onClick={() => {
            snapshotNow();
            setText('');
          }}
        >
          清空
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.jsonl,.txt,.ndjson"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openFile(file);
            e.target.value = '';
          }}
        />
        {toast && (
          <span className="ml-auto text-xs font-medium text-success">
            {toast}
          </span>
        )}
      </Toolbar>

      {sizeWarning && (
        <div className="shrink-0 border-b bg-warning px-3 py-1 text-xs text-warning-foreground">
          文件超过 10MB，编辑可能卡顿
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左：编辑器 */}
        <div className="flex min-w-0 flex-col" style={{ width: `${leftPct}%` }}>
          <div className="min-h-0 flex-1">
            <CodeEditor
              value={text}
              onChange={setText}
              language={mode === 'json' ? 'json' : 'plaintext'}
              onMount={(editor) => {
                editorRef.current = editor;
                validate(editor.getValue(), mode);
              }}
            />
          </div>
          {mode === 'json' && jsonError && (
            <ErrorPanel
              errors={[
                {
                  message: jsonError.message,
                  line: jsonError.line,
                  column: jsonError.column,
                },
              ]}
              onJump={jumpTo}
            />
          )}
          {mode === 'jsonl' && (
            <ErrorPanel
              errors={jsonlResults
                .filter((r) => !r.empty && !r.ok)
                .slice(0, 20)
                .map((r) => ({ line: r.line, message: r.error ?? '解析失败' }))}
              onJump={(line) => jumpTo(line)}
            />
          )}
        </div>

        {/* 分隔条 */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
          onMouseDown={onDividerMouseDown}
        />

        {/* 右：面板（树 / 表格 / 查询） */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
          <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
            <SegmentedControl<Panel>
              options={[
                { value: 'tree', label: '树' },
                { value: 'table', label: '表格' },
                { value: 'query', label: '查询' },
              ]}
              value={panel}
              onChange={setPanel}
            />
            {panel === 'query' && (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runQuery();
                  }}
                  placeholder={
                    mode === 'json'
                      ? '$.author.name'
                      : 'JSONL 按行组成数组查询，如 $[*].name'
                  }
                  className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <ToolbarButton primary onClick={runQuery}>
                  运行
                </ToolbarButton>
              </>
            )}
          </div>

          {treeStale && tree && panel === 'tree' && (
            <div className="shrink-0 border-b bg-warning px-3 py-1 text-xs text-warning-foreground">
              当前 JSON 有错误，显示的是上一次合法的树
            </div>
          )}

          <div className="min-h-0 flex-1">
            {panel === 'tree' &&
              (mode === 'json' ? (
                <JsonTreeView root={tree} />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  树视图仅支持 JSON 模式，JSONL 请用表格视图
                </div>
              ))}
            {panel === 'table' &&
              (tableRows ? (
                <JsonlTableView
                  results={tableRows}
                  onDeleteLine={handleTableDelete}
                  onJumpToLine={(line) => {
                    if (mode === 'jsonl') jumpTo(line);
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  表格视图需要 JSONL 或 JSON 数组/对象
                </div>
              ))}
            {panel === 'query' && (
              <div className="flex h-full flex-col">
                {queryResult === null ? (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                    输入 JSONPath 表达式后回车或点「运行」
                    <br />
                    例：$.tags[0] / $..name / $.items[?(@.age &gt; 18)]
                  </div>
                ) : queryResult.ok ? (
                  <>
                    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                      <span>{queryResult.count} 条结果</span>
                      <button
                        className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                        onClick={() =>
                          copyToClipboard(queryResult.text).then((ok) =>
                            showToast(ok ? '结果已复制' : '复制失败'),
                          )
                        }
                      >
                        复制结果
                      </button>
                      <button
                        className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                        onClick={() => {
                          setText(queryResult.text);
                          showToast('已应用到编辑器');
                        }}
                      >
                        应用到编辑器
                      </button>
                    </div>
                    <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
                      {queryResult.text}
                    </pre>
                  </>
                ) : (
                  <div className="p-3 text-xs text-destructive">
                    {queryResult.error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{modeLabel}</span>
        {mode === 'json' ? (
          <span>
            {text.length.toLocaleString()} 字符 ·{' '}
            {new Blob([text]).size > 1024
              ? `${(new Blob([text]).size / 1024).toFixed(1)} KB`
              : `${new Blob([text]).size} B`}
          </span>
        ) : (
          <>
            <span>共 {jsonlStatsMemo.total} 行</span>
            <span className="text-success">{jsonlStatsMemo.valid} 行合法</span>
            {jsonlStatsMemo.errors > 0 && (
              <span className="text-destructive">
                {jsonlStatsMemo.errors} 行错误
              </span>
            )}
            {jsonlStatsMemo.empty > 0 && (
              <span>{jsonlStatsMemo.empty} 行空行</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
