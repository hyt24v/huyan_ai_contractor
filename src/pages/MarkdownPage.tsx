// Markdown 编辑器（Typora 式所见即所得 + 源码模式）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
} from 'lucide-react';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  wrapInHeadingCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  insertHrCommand,
  createCodeBlockCommand,
  insertImageCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  insertTableCommand,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import type { CmdKey } from '@milkdown/kit/core';
import CodeEditor, { type EditorInstance } from '../components/CodeEditor';
import MarkdownEditor, {
  type MarkdownEditorHandle,
} from '../components/markdown/MarkdownEditor';
import HistoryDropdown from '../components/HistoryDropdown';
import {
  SegmentedControl,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from '../components/Toolbar';
import { useEditorHistory } from '../hooks/useEditorHistory';
import {
  countWords,
  extractOutline,
  markdownToHtmlDoc,
} from '../lib/markdownUtils';
import { copyToClipboard, downloadText } from '../lib/json';
import { isTauri } from '@tauri-apps/api/core';
import { absPath, tauriFs } from '../lib/fsPort';

const STORAGE_KEY = 'huyan_tool:markdown';
const HISTORY_KEY_MD = 'huyan_tool:markdown-history';

const SAMPLE = `# Markdown 编辑器

所见即所得，输入 **Markdown** 语法即时渲染。

## 常用语法

- **粗体**、*斜体*、~~删除线~~、\`行内代码\`
- 选中文字可以弹出浮动工具栏
- 输入 \`/\` 唤起命令菜单

## 表格

| 功能 | 快捷键 |
| --- | --- |
| 加粗 | ⌘B |
| 斜体 | ⌘I |
| 源码模式 | ⌘/ |

## 代码块

\`\`\`js
const hello = 'world';
console.log(hello);
\`\`\`

> 提示：图片可以直接粘贴或拖拽进来。
`;

type ViewMode = 'wysiwyg' | 'source';

export default function MarkdownPage() {
  const [text, setText] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? SAMPLE,
  );
  const [viewMode, setViewMode] = useState<ViewMode>('wysiwyg');
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [toast, setToast] = useState('');

  const mdRef = useRef<MarkdownEditorHandle | null>(null);
  const monacoRef = useRef<EditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  // setText 包装：源码模式直接 set；所见即所得模式同步给 Crepe
  const applyText = useCallback(
    (next: string, syncEditor: 'both' | 'state-only' = 'both') => {
      setText(next);
      if (syncEditor === 'both' && viewMode === 'wysiwyg') {
        mdRef.current?.setMarkdown(next);
      }
    },
    [viewMode],
  );

  const {
    history,
    historyOpen,
    setHistoryOpen,
    historyRef,
    snapshotNow,
    refreshHistory,
    restoreEntry,
    removeEntry,
    clearAll,
  } = useEditorHistory({
    storageKey: HISTORY_KEY_MD,
    text,
    setText: (t) => applyText(t),
    showToast,
  });

  // 持久化
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text);
  }, [text]);

  // 大纲 / 字数
  const outline = useMemo(() => extractOutline(text), [text]);
  const wc = useMemo(() => countWords(text), [text]);

  // ⌘/ 切换源码模式
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setViewMode((m) => (m === 'wysiwyg' ? 'source' : 'wysiwyg'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = useCallback(
    (command: { key: CmdKey<any> }, payload?: unknown) => {
      mdRef.current?.runCommand(command, payload);
      mdRef.current?.focus();
    },
    [],
  );

  const insertLink = useCallback(() => {
    const href = window.prompt('链接地址：', 'https://');
    if (!href) return;
    run(toggleLinkCommand, { href });
  }, [run]);

  const insertImage = useCallback(() => {
    const src = window.prompt('图片地址（URL 或 data:）：', '');
    if (!src) return;
    run(insertImageCommand, { src, alt: '' });
  }, [run]);

  // 打开本地文件
  const openFile = useCallback(
    (file: File) => {
      file.text().then((content) => {
        snapshotNow();
        applyText(content);
        showToast(`已载入 ${file.name}`);
      });
    },
    [snapshotNow, applyText, showToast],
  );

  // 导出 HTML
  const exportHtml = useCallback(async () => {
    const title = outline[0]?.text ?? 'Document';
    const html = markdownToHtmlDoc(text, title);
    if (isTauri()) {
      try {
        const dir = await absPath('.ai-baogongtou/exports');
        if (!(await tauriFs.exists(dir))) await tauriFs.mkdir(dir);
        const path = `${dir}/${title.replace(/[\\/:*?"<>|]/g, '_')}.html`;
        await tauriFs.writeText(path, html);
        showToast(`已导出到 ${path}`);
      } catch (e) {
        showToast(`导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      downloadText(`${title}.html`, html);
      showToast('已开始下载');
    }
  }, [text, outline, showToast]);

  // 保存 .md
  const saveMd = useCallback(async () => {
    const title = outline[0]?.text ?? 'note';
    if (isTauri()) {
      try {
        const dir = await absPath('.ai-baogongtou/exports');
        if (!(await tauriFs.exists(dir))) await tauriFs.mkdir(dir);
        const path = `${dir}/${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
        await tauriFs.writeText(path, text);
        showToast(`已保存到 ${path}`);
      } catch (e) {
        showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      downloadText(`${title}.md`, text);
      showToast('已开始下载');
    }
  }, [text, outline, showToast]);

  const jumpToOutlineItem = useCallback(
    (index: number) => {
      if (viewMode === 'wysiwyg') {
        mdRef.current?.scrollToHeading(index);
      } else {
        const line = outline[index]?.line;
        if (line === undefined || !monacoRef.current) return;
        monacoRef.current.revealLineInCenter(line + 1);
        monacoRef.current.setPosition({ lineNumber: line + 1, column: 1 });
        monacoRef.current.focus();
      }
    },
    [viewMode, outline],
  );

  const fmt = (
    Icon: typeof Bold,
    label: string,
    onClick: () => void,
  ) => (
    <ToolbarButton key={label} onClick={onClick} title={label}>
      <Icon className="h-3.5 w-3.5" />
    </ToolbarButton>
  );

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <SegmentedControl<ViewMode>
          options={[
            { value: 'wysiwyg', label: '所见即所得' },
            { value: 'source', label: '源码' },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
        {viewMode === 'wysiwyg' && (
          <>
            <ToolbarDivider />
            {fmt(Bold, '加粗 ⌘B', () => run(toggleStrongCommand))}
            {fmt(Italic, '斜体 ⌘I', () => run(toggleEmphasisCommand))}
            {fmt(Strikethrough, '删除线', () => run(toggleStrikethroughCommand))}
            {fmt(Code, '行内代码', () => run(toggleInlineCodeCommand))}
            <ToolbarDivider />
            {fmt(Heading1, '标题 1', () => run(wrapInHeadingCommand, 1))}
            {fmt(Heading2, '标题 2', () => run(wrapInHeadingCommand, 2))}
            {fmt(Heading3, '标题 3', () => run(wrapInHeadingCommand, 3))}
            {fmt(Quote, '引用', () => run(wrapInBlockquoteCommand))}
            {fmt(List, '无序列表', () => run(wrapInBulletListCommand))}
            {fmt(ListOrdered, '有序列表', () => run(wrapInOrderedListCommand))}
            <ToolbarDivider />
            {fmt(Link, '插入链接', insertLink)}
            {fmt(Image, '插入图片', insertImage)}
            {fmt(Table, '插入表格', () => run(insertTableCommand))}
            {fmt(SquareCode, '代码块', () => run(createCodeBlockCommand))}
            {fmt(Minus, '分割线', () => run(insertHrCommand))}
          </>
        )}
        <ToolbarDivider />
        <ToolbarButton
          onClick={() => setOutlineOpen((o) => !o)}
          title="大纲"
        >
          <span className="inline-flex items-center gap-1">
            <ListTree className="h-3.5 w-3.5" />
            大纲
          </span>
        </ToolbarButton>
        <ToolbarButton onClick={() => fileInputRef.current?.click()}>
          打开
        </ToolbarButton>
        <ToolbarButton onClick={saveMd}>保存</ToolbarButton>
        <ToolbarButton onClick={exportHtml}>导出 HTML</ToolbarButton>
        <HistoryDropdown
          history={history}
          open={historyOpen}
          onToggle={() => {
            refreshHistory();
            setHistoryOpen((o) => !o);
          }}
          onRestore={restoreEntry}
          onRemove={removeEntry}
          onClear={clearAll}
          containerRef={historyRef}
        />
        <ToolbarButton
          onClick={() =>
            copyToClipboard(text).then((ok) =>
              showToast(ok ? '已复制全文' : '复制失败'),
            )
          }
        >
          复制
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            snapshotNow();
            applyText('');
          }}
        >
          清空
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
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
        {/* 大纲侧栏 */}
        {outlineOpen && (
          <div className="w-52 shrink-0 overflow-y-auto border-r bg-muted/20">
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
              大纲
            </div>
            {outline.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                暂无标题
              </div>
            ) : (
              outline.map((item, i) => (
                <button
                  key={i}
                  onClick={() => jumpToOutlineItem(i)}
                  className="block w-full truncate px-3 py-1 text-left text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                  style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))
            )}
          </div>
        )}

        {/* 编辑区 */}
        <div className="min-w-0 flex-1">
          {viewMode === 'wysiwyg' ? (
            <MarkdownEditor
              key="wysiwyg"
              ref={mdRef}
              defaultValue={text}
              onChange={setText}
            />
          ) : (
            <CodeEditor
              value={text}
              onChange={setText}
              language="markdown"
              onMount={(editor) => {
                monacoRef.current = editor;
              }}
            />
          )}
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-[11px] text-muted-foreground">
        <span>{viewMode === 'wysiwyg' ? '所见即所得' : '源码模式'}</span>
        <span>{wc.words} 词</span>
        <span>{wc.chars} 字符</span>
        <span>约 {wc.minutes} 分钟</span>
        <span className="ml-auto">⌘/ 切换源码</span>
      </div>
    </div>
  );
}
