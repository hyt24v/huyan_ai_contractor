import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor, { type EditorInstance } from '../components/CodeEditor';
import ErrorPanel from '../components/ErrorPanel';
import JsonTreeView from '../components/JsonTreeView';
import JsonGraphView from '../components/JsonGraphView';
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
  parseJsonTolerant,
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
  parseJsonlSmart,
  prettifyJsonl,
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
import { addHistory, HISTORY_KEY } from '../lib/editorHistory';
import { useEditorHistory } from '../hooks/useEditorHistory';
import { useToast } from '../hooks/useToast';
import HistoryDropdown from '../components/HistoryDropdown';

const STORAGE_KEY = 'huyan_tool:editor';
const MODE_KEY = 'huyan_tool:editor-mode';
const KEEP_ESCAPE_KEY = 'huyan_tool:editor-keep-escape';

const SAMPLE = `{
  "name": "AI包工头",
  "version": "0.5.1",
  "site": "https://github.com/hyt24v/huyan_ai_contractor",
  "created": "2026-10-21",
  "tags": ["json", "jsonl"],
  "author": { "name": "huyan", "local": true }
}`;

type ModeSetting = 'auto' | EditorMode;
type Panel = 'tree' | 'table' | 'query' | 'graph';

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

  const { toast, showToast } = useToast(1800);

  // ---------- 历史记录（手动保存） ----------
  const {
    history,
    historyOpen,
    setHistoryOpen,
    historyRef,
    saveCurrent,
    refreshHistory,
    restoreEntry,
    removeEntry,
    clearAll,
  } = useEditorHistory({ storageKey: HISTORY_KEY, text, setText, showToast });

  /** 破坏性操作（清空/载入/恢复/覆盖）前自动快照当前内容到历史（AGENTS.md 约定，审核 #12） */
  const snapshotNow = useCallback(() => {
    if (addHistory(text, HISTORY_KEY)) refreshHistory();
  }, [text, refreshHistory]);

  // 模式：手动优先，否则自动识别（useMemo 缓存，避免每次渲染重复全量解析，审核 #14）
  const autoMode = useMemo(() => detectMode(text), [text]);
  const mode: EditorMode = modeSetting === 'auto' ? autoMode : modeSetting;

  // 防抖 + try/catch：避免每次击键同步写大文本卡顿；配额满时静默跳过而不是白屏（审核 #13）
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, text);
      } catch {
        // 配额超限：本次不持久化
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    localStorage.setItem(MODE_KEY, modeSetting);
  }, [modeSetting]);

  // ---------- 校验（随模式分派，防抖 300ms） ----------
  const validate = useCallback(
    (value: string, m: EditorMode) => {
      // 极端输入（超深嵌套等）可能触发引擎限制，降级为错误提示而不是让 effect 异常白屏（审核 #5）
      try {
        const model = editorRef.current?.getModel();
      if (m === 'json') {
        // 宽容解析：「不保留转义」显示态（字符串含真实换行）不算错误
        const r = parseJsonTolerant(value);
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
        const rs = parseJsonlSmart(value);
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
                endLineNumber: Math.min(
                  r.endLine ?? r.line,
                  model.getLineCount(),
                ),
                endColumn: model.getLineMaxColumn(
                  Math.min(r.endLine ?? r.line, model.getLineCount()),
                ),
              })),
          );
        }
      }
      } catch (e) {
        setJsonError({
          message: `解析失败：${e instanceof Error ? e.message : String(e)}`,
        });
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
      const r = fn(text);
      if (r.ok && r.text !== undefined) {
        setText(r.text);
        showToast(okMsg);
      } else if (!r.ok) {
        showToast(`失败：${r.error?.message ?? '未知错误'}`, 'err');
      }
    },
    [text, showToast],
  );

  const doNormalize = useCallback(
    (okMsg: string) => {
      const r = normalizeJsonl(text, { keepEmptyLines });
      setText(r.text);
      showToast(
        r.errors.length > 0
          ? `已处理，${r.errors.length} 行仍有错误（已原样保留）`
          : okMsg,
        r.errors.length > 0 ? 'err' : 'ok',
      );
    },
    [text, keepEmptyLines, showToast],
  );

  const doPrettify = useCallback(
    (okMsg: string) => {
      const r = prettifyJsonl(text, { keepEmptyLines });
      setText(r.text);
      showToast(
        r.errors.length > 0
          ? `已处理，${r.errors.length} 行仍有错误（已原样保留）`
          : okMsg,
        r.errors.length > 0 ? 'err' : 'ok',
      );
    },
    [text, keepEmptyLines, showToast],
  );

  const doRepair = useCallback(() => {
    const r = repairText(text, mode);
    setText(r.text);
    showToast(
      r.ok ? '已修复' : `部分修复：${r.error ?? '仍有无法修复的内容'}`,
      r.ok ? 'ok' : 'err',
    );
  }, [text, mode, showToast]);

  const doSort = useCallback(() => {
    const r = sortJsonKeys(text, mode);
    if (r.ok) {
      setText(r.text);
      showToast('已按键排序');
    } else {
      showToast(`排序失败：${r.error ?? '未知错误'}`, 'err');
    }
  }, [text, mode, showToast]);

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
        showToast(
          `保存失败：${e instanceof Error ? e.message : String(e)}`,
          'err',
        );
      }
    } else {
      downloadText(filename, text);
      showToast('已开始下载');
    }
  }, [mode, text, showToast]);

  const openFile = useCallback(
    (file: File) => {
      snapshotNow();
      file
        .text()
        .then((content) => {
          setText(content);
          showToast(`已载入 ${file.name}`);
        })
        .catch((e) => {
          // 读取失败要有反馈，不能静默无反应（审核 #19）
          showToast(
            `读取失败：${e instanceof Error ? e.message : String(e)}`,
            'err',
          );
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
  // JSONL 树视图：把合法行组成数组建树（与查询面板语义一致）
  const jsonlTree = useMemo((): JsonTreeNode | null => {
    const values = jsonlResults
      .filter((r) => !r.empty && r.ok)
      .map((r) => r.value as JsonValue);
    if (values.length === 0) return null;
    return buildJsonTree(values);
  }, [jsonlResults]);

  const jsonlErrors = useMemo(
    () => jsonlResults.filter((r) => !r.empty && !r.ok),
    [jsonlResults],
  );

  const jsonlInvalidCount = jsonlErrors.length;

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
    (line: number, endLine?: number) => {
      if (mode === 'jsonl') {
        // 防抖窗口内表格数据可能滞后于文本：用当前 text 重新解析定位，避免按旧行号删错行（审核 #8）
        const stale = jsonlResults.find(
          (r) => r.line === line && (r.endLine ?? r.line) === (endLine ?? line),
        );
        const fresh = parseJsonlSmart(text);
        const target =
          (stale && !stale.empty
            ? fresh.find((r) => !r.empty && r.raw === stale.raw)
            : undefined) ??
          fresh.find(
            (r) => !r.empty && line >= r.line && line <= (r.endLine ?? r.line),
          );
        if (!target) {
          showToast('定位失败：内容已变化，请重试', 'err');
          return;
        }
        const tEnd = target.endLine ?? target.line;
        setText(deleteLine(text, target.line, target.endLine));
        showToast(
          tEnd > target.line
            ? `已删除第 ${target.line}–${tEnd} 行`
            : `已删除第 ${target.line} 行`,
        );
      } else if (Array.isArray(jsonValue)) {
        const next = (jsonValue as JsonValue[]).filter(
          (_, i) => i !== line - 1,
        );
        setText(JSON.stringify(next, null, 2));
        showToast(`已删除第 ${line} 项`);
      } else if (jsonValue !== null && typeof jsonValue === 'object') {
        const entries = Object.entries(jsonValue as Record<string, JsonValue>);
        const key = entries[line - 1]?.[0];
        if (key === undefined) return;
        setText(
          JSON.stringify(
            Object.fromEntries(entries.filter((_, i) => i !== line - 1)),
            null,
            2,
          ),
        );
        showToast(`已删除字段 ${key}`);
      }
    },
    [mode, text, jsonValue, jsonlResults, showToast],
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
            { value: 'auto', label: `自动(${autoMode === 'json' ? 'JSON' : 'JSONL'})` },
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
              const ok = parseJsonTolerant(text).ok;
              showToast(ok ? '✓ JSON 合法' : 'JSON 有错误', ok ? 'ok' : 'err');
            } else {
              const s = jsonlStats(parseJsonlSmart(text));
              showToast(
                s.errors === 0
                  ? `✓ ${s.valid} 条记录全部合法`
                  : `${s.errors} 条记录有错误`,
                s.errors === 0 ? 'ok' : 'err',
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
              : doPrettify('已格式化')
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
          className={`inline-flex select-none items-center gap-1 text-xs text-muted-foreground ${
            mode === 'jsonl' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
          title={
            mode === 'jsonl'
              ? '保留转义仅 JSON 模式有效（JSONL 逐条处理，不参与转义显示切换）'
              : '切换转义显示（对齐 json.cn）：勾选=字符串中的转义序列 \\n、\\uXXXX 等原样保留，中文不转义；不勾选=\\n、\\t、\\uXXXX 解码为真实字符，可自由来回切换'
          }
        >
          <input
            type="checkbox"
            disabled={mode === 'jsonl'}
            checked={keepEscape}
            onChange={(e) => {
              const next = e.target.checked;
              setKeepEscape(next);
              // 立即按新显示模式重新渲染当前内容（formatJson 宽容解析，两种显示态可自由互切）
              if (mode === 'json') {
                applyTransform(
                  (t) => formatJson(t, 2, next),
                  next ? '已切换为转义显示' : '已切换为原文显示',
                );
              }
            }}
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
                // 光标落在多行记录中间时删除整条记录
                const cur = currentLine();
                const rec = parseJsonlSmart(text).find(
                  (r) =>
                    !r.empty && cur >= r.line && cur <= (r.endLine ?? r.line),
                );
                const start = rec ? rec.line : cur;
                const end =
                  rec && rec.endLine && rec.endLine > rec.line
                    ? rec.endLine
                    : undefined;
                setText(deleteLine(text, start, end));
                showToast(
                  end ? `已删除第 ${start}–${end} 行` : '已删除当前行',
                );
              }}
            >
              删除行
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                const cur = currentLine();
                const rec = parseJsonlSmart(text).find(
                  (r) =>
                    !r.empty && cur >= r.line && cur <= (r.endLine ?? r.line),
                );
                const start = rec ? rec.line : cur;
                const end =
                  rec && rec.endLine && rec.endLine > rec.line
                    ? rec.endLine
                    : undefined;
                setText(duplicateLine(text, start, end));
                showToast(
                  end ? `已复制第 ${start}–${end} 行` : '已复制当前行',
                );
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
              showToast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'err'),
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
        <HistoryDropdown
          history={history}
          open={historyOpen}
          onToggle={() => {
            refreshHistory();
            setHistoryOpen((o) => !o);
          }}
          onSave={saveCurrent}
          onRestore={(entry) => {
            snapshotNow();
            restoreEntry(entry);
          }}
          onRemove={removeEntry}
          onClear={clearAll}
          containerRef={historyRef}
        />
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
          <span
            className={`ml-auto text-xs font-medium ${
              toast.tone === 'err' ? 'text-destructive' : 'text-success'
            }`}
          >
            {toast.msg}
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
              errors={jsonlErrors
                .slice(0, 20)
                .map((r) => ({ line: r.line, message: r.error ?? '解析失败' }))}
              total={jsonlErrors.length}
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
                { value: 'graph', label: '图形' },
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

          {treeStale && tree && (panel === 'tree' || panel === 'graph') && (
            <div className="shrink-0 border-b bg-warning px-3 py-1 text-xs text-warning-foreground">
              当前 JSON 有错误，显示的是上一次合法的视图
            </div>
          )}

          <div className="min-h-0 flex-1">
            {panel === 'tree' &&
              (mode === 'json' ? (
                <JsonTreeView root={tree} />
              ) : jsonlTree ? (
                <div className="flex h-full flex-col">
                  {jsonlInvalidCount > 0 && (
                    <div className="shrink-0 border-b bg-warning px-3 py-1 text-xs text-warning-foreground">
                      {jsonlInvalidCount} 行有错误，已从树中排除
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <JsonTreeView root={jsonlTree} />
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  没有可显示的合法行
                </div>
              ))}
            {panel === 'graph' &&
              (mode === 'json' ? (
                <JsonGraphView root={tree} />
              ) : jsonlTree ? (
                <div className="flex h-full flex-col">
                  {jsonlInvalidCount > 0 && (
                    <div className="shrink-0 border-b bg-warning px-3 py-1 text-xs text-warning-foreground">
                      {jsonlInvalidCount} 行有错误，已从图中排除
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <JsonGraphView root={jsonlTree} />
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  没有可显示的合法行
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
                  disableJump={mode !== 'jsonl'}
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
                            showToast(
                              ok ? '结果已复制' : '复制失败',
                              ok ? 'ok' : 'err',
                            ),
                          )
                        }
                      >
                        复制结果
                      </button>
                      <button
                        className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                        onClick={() => {
                          snapshotNow();
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
            <span>
              共 {jsonlStatsMemo.total} 条记录
              {jsonlStatsMemo.lines !== jsonlStatsMemo.total &&
                `（${jsonlStatsMemo.lines} 行）`}
            </span>
            <span className="text-success">{jsonlStatsMemo.valid} 条合法</span>
            {jsonlStatsMemo.errors > 0 && (
              <span className="text-destructive">
                {jsonlStatsMemo.errors} 条错误
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
