import { useCallback, useEffect, useRef, useState } from 'react';
import CodeEditor, { type EditorInstance } from '../components/CodeEditor';
import ErrorPanel from '../components/ErrorPanel';
import JsonTreeView from '../components/JsonTreeView';
import { Toolbar, ToolbarButton, ToolbarDivider } from '../components/Toolbar';
import { monaco } from '../monacoSetup';
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
  type JsonTreeNode,
} from '../lib/json';

const STORAGE_KEY = 'huyan_tool:json';

const SAMPLE = `{
  "name": "AI包工头",
  "version": "0.1.0",
  "tags": ["json", "jsonl"],
  "author": { "name": "huyan", "local": true }
}`;

export default function JsonEditorPage() {
  const [text, setText] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? SAMPLE,
  );
  const [tree, setTree] = useState<JsonTreeNode | null>(null);
  const [treeStale, setTreeStale] = useState(false);
  const [error, setError] = useState<{
    message: string;
    line?: number;
    column?: number;
  } | null>(null);
  const [toast, setToast] = useState('');
  const [leftPct, setLeftPct] = useState(55);
  const editorRef = useRef<EditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1500);
  }, []);

  // 内容持久化
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text);
  }, [text]);

  // 校验 + 树刷新
  const validate = useCallback(
    (value: string, showOkToast = false) => {
      const r = parseJson(value);
      const model = editorRef.current?.getModel();
      if (r.ok) {
        setError(null);
        setTree(buildJsonTree(r.value));
        setTreeStale(false);
        if (model) monaco.editor.setModelMarkers(model, 'json-tool', []);
        if (showOkToast) showToast('✓ JSON 合法');
      } else {
        const { message, line, column } = r.error;
        setError({ message, line, column });
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
    },
    [showToast, tree],
  );

  // 输入防抖 300ms 自动校验
  useEffect(() => {
    const timer = setTimeout(() => validate(text), 300);
    return () => clearTimeout(timer);
    // validate 依赖 tree 会导致循环触发，这里只对 text 变化做防抖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const jumpTo = useCallback((line: number, column?: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: column ?? 1 });
    editor.focus();
  }, []);

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
        showToast(`失败：${r.error?.message ?? '未知错误'}`);
      }
    },
    [text, showToast],
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
        <ToolbarButton primary onClick={() => validate(text, true)} title="校验 JSON">
          校验
        </ToolbarButton>
        <ToolbarButton onClick={() => applyTransform((t) => formatJson(t), '已格式化')}>
          格式化
        </ToolbarButton>
        <ToolbarButton onClick={() => applyTransform((t) => minifyJson(t), '已压缩')}>
          压缩
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
        <ToolbarButton
          onClick={() =>
            copyToClipboard(text).then((ok) => showToast(ok ? '已复制' : '复制失败'))
          }
        >
          复制
        </ToolbarButton>
        <ToolbarButton onClick={() => downloadText('data.json', text)}>下载</ToolbarButton>
        <ToolbarButton onClick={() => fileInputRef.current?.click()}>打开文件</ToolbarButton>
        <ToolbarButton onClick={() => setText('')}>清空</ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,application/json"
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

      <div className="flex min-h-0 flex-1">
        {/* 左：编辑器 */}
        <div className="flex min-w-0 flex-col" style={{ width: `${leftPct}%` }}>
          <div className="min-h-0 flex-1">
            <CodeEditor
              value={text}
              onChange={setText}
              language="json"
              onMount={(editor) => {
                editorRef.current = editor;
                validate(editor.getValue());
              }}
            />
          </div>
          {error && (
            <ErrorPanel
              errors={[
                {
                  message: error.message,
                  line: error.line,
                  column: error.column,
                },
              ]}
              onJump={jumpTo}
            />
          )}
        </div>

        {/* 分隔条 */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
          onMouseDown={onDividerMouseDown}
        />

        {/* 右：树形视图 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
          {treeStale && tree && (
            <div className="shrink-0 border-b bg-warning px-3 py-1 text-xs text-warning-foreground">
              当前 JSON 有错误，显示的是上一次合法的树
            </div>
          )}
          <div className="min-h-0 flex-1">
            <JsonTreeView root={tree} />
          </div>
        </div>
      </div>
    </div>
  );
}
