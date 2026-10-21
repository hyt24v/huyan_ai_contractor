import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor, { type EditorInstance } from '../components/CodeEditor';
import ErrorPanel from '../components/ErrorPanel';
import JsonlTableView from '../components/JsonlTableView';
import {
  SegmentedControl,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from '../components/Toolbar';
import { monaco } from '../monacoSetup';
import { copyToClipboard, downloadText } from '../lib/json';
import {
  deleteLine,
  duplicateLine,
  jsonlStats,
  normalizeJsonl,
  parseJsonl,
  type JsonlLineResult,
} from '../lib/jsonl';

const STORAGE_KEY = 'huyan_tool:jsonl';

const SAMPLE = `{"name": "Alice", "age": 30, "tags": ["a", "b"]}
{"name": "Bob", "age": 25, "address": {"city": "杭州"}}
{"name": "Carol", "active": true, "address": {"city": "上海", "zip": "200000"}}`;

export default function JsonlEditorPage() {
  const [text, setText] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? SAMPLE,
  );
  const [view, setView] = useState<'code' | 'table'>('code');
  const [keepEmptyLines, setKeepEmptyLines] = useState(false);
  const [results, setResults] = useState<JsonlLineResult[]>([]);
  const [toast, setToast] = useState('');
  const [jumpInput, setJumpInput] = useState('');
  const editorRef = useRef<EditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1500);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text);
  }, [text]);

  // 逐行校验 + Monaco 标记
  const validate = useCallback((value: string) => {
    const rs = parseJsonl(value);
    setResults(rs);
    const model = editorRef.current?.getModel();
    if (model) {
      monaco.editor.setModelMarkers(
        model,
        'jsonl-tool',
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
    return rs;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => validate(text), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const stats = useMemo(() => jsonlStats(results), [results]);

  const jumpTo = useCallback((line: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }, []);

  const jumpToNextError = useCallback(() => {
    const editor = editorRef.current;
    const errors = results.filter((r) => !r.empty && !r.ok);
    if (errors.length === 0) {
      showToast('没有错误行');
      return;
    }
    const curLine = editor?.getPosition()?.lineNumber ?? 0;
    const next = errors.find((r) => r.line > curLine) ?? errors[0];
    jumpTo(next.line);
  }, [results, jumpTo, showToast]);

  const currentLine = useCallback(
    () => editorRef.current?.getPosition()?.lineNumber ?? 1,
    [],
  );

  const doNormalize = useCallback(
    (okMsg: string) => {
      const r = normalizeJsonl(text, { keepEmptyLines });
      setText(r.text);
      if (r.errors.length > 0) {
        showToast(`已处理，${r.errors.length} 行仍有错误（已原样保留）`);
      } else {
        showToast(okMsg);
      }
    },
    [text, keepEmptyLines, showToast],
  );

  const openFile = useCallback(
    (file: File) => {
      file.text().then((content) => {
        setText(content);
        showToast(`已载入 ${file.name}`);
      });
    },
    [showToast],
  );

  const sizeWarning = text.length > 10 * 1024 * 1024;

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) openFile(file);
      }}
    >
      <Toolbar>
        <ToolbarButton
          primary
          onClick={() => {
            const rs = validate(text);
            const s = jsonlStats(rs);
            showToast(
              s.errors === 0
                ? `✓ ${s.valid} 行全部合法`
                : `${s.errors} 行有错误`,
            );
          }}
        >
          校验
        </ToolbarButton>
        <ToolbarButton onClick={() => doNormalize('已格式化')}>格式化</ToolbarButton>
        <ToolbarButton onClick={() => doNormalize('已压缩')}>压缩</ToolbarButton>
        <ToolbarDivider />
        <SegmentedControl
          options={[
            { value: 'code', label: '代码视图' },
            { value: 'table', label: '表格视图' },
          ]}
          value={view}
          onChange={setView}
        />
        <ToolbarDivider />
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
            setText(deleteLine(text, currentLine()));
            showToast('已删除当前行');
          }}
        >
          删除行
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            setText(duplicateLine(text, currentLine()));
            showToast('已复制当前行');
          }}
        >
          复制行
        </ToolbarButton>
        <ToolbarDivider />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={keepEmptyLines}
            onChange={(e) => setKeepEmptyLines(e.target.checked)}
            className="accent-foreground"
          />
          <input
            type="checkbox"
            checked={keepEmptyLines}
            onChange={(e) => setKeepEmptyLines(e.target.checked)}
          />
          保留空行
        </label>
        <ToolbarDivider />
        <ToolbarButton
          onClick={() =>
            copyToClipboard(text).then((ok) => showToast(ok ? '已复制' : '复制失败'))
          }
        >
          复制
        </ToolbarButton>
        <ToolbarButton onClick={() => downloadText('data.jsonl', text)}>
          下载
        </ToolbarButton>
        <ToolbarButton onClick={() => fileInputRef.current?.click()}>
          打开文件
        </ToolbarButton>
        <ToolbarButton onClick={() => setText('')}>清空</ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonl,.txt,.ndjson"
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

      <div className="min-h-0 flex-1">
        {view === 'code' ? (
          <CodeEditor
            value={text}
            onChange={setText}
            language="plaintext"
            onMount={(editor) => {
              editorRef.current = editor;
              validate(editor.getValue());
            }}
          />
        ) : (
          <JsonlTableView
            results={results}
            onDeleteLine={(line) => {
              setText(deleteLine(text, line));
              showToast(`已删除第 ${line} 行`);
            }}
            onJumpToLine={(line) => {
              setView('code');
              // 等编辑器重新挂载后再跳转
              setTimeout(() => jumpTo(line), 100);
            }}
          />
        )}
      </div>

      {view === 'code' && (
        <ErrorPanel
          errors={results
            .filter((r) => !r.empty && !r.ok)
            .slice(0, 20)
            .map((r) => ({ line: r.line, message: r.error ?? '解析失败' }))}
          onJump={(line) => jumpTo(line)}
        />
      )}

      {/* 状态栏 */}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
        <span>共 {stats.total} 行</span>
        <span className="text-success">{stats.valid} 行合法</span>
        {stats.errors > 0 && (
          <span className="text-destructive">{stats.errors} 行错误</span>
        )}
        {stats.empty > 0 && <span>{stats.empty} 行空行</span>}
      </div>
    </div>
  );
}
