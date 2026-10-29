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
import { EmptyState } from '../components/ui/states';
import {
  SegmentedControl,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from '../components/Toolbar';
import { useEditorHistory } from '../hooks/useEditorHistory';
import { useToast } from '../hooks/useToast';
import { addHistory } from '../lib/editorHistory';
import {
  countWords,
  extractOutline,
  markdownToHtmlDoc,
} from '../lib/markdownUtils';
import { copyToClipboard, downloadText } from '../lib/json';
import { isTauri } from '@tauri-apps/api/core';
import { absPath, tauriFs } from '../lib/fsPort';
import { FloatingToast } from '../components/Toast';

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
  const { toast, showToast } = useToast(1800);

  const mdRef = useRef<MarkdownEditorHandle | null>(null);
  const monacoRef = useRef<EditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 持久化失败只提示一次（恢复成功后重置），避免每次击键都弹错
  const persistFailedRef = useRef(false);

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
    saveCurrent,
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

  // 破坏性操作（清空/载入/恢复历史）前自动快照当前内容到历史，防误丢
  const snapshotNow = useCallback(() => {
    if (addHistory(text, HISTORY_KEY_MD)) refreshHistory();
  }, [text, refreshHistory]);

  // 持久化 / 大纲 / 字数走 400ms 防抖后的文本，避免每次击键三重全量计算
  const [settledText, setSettledText] = useState(text);
  useEffect(() => {
    const t = window.setTimeout(() => setSettledText(text), 400);
    return () => window.clearTimeout(t);
  }, [text]);

  // 持久化（嵌图后可能超 localStorage 配额，失败要提示而不是静默丢内容）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, settledText);
      persistFailedRef.current = false;
    } catch {
      if (!persistFailedRef.current) {
        persistFailedRef.current = true;
        showToast('内容过大，本地暂存失败：刷新后可能丢失，请先「保存」为文件', 'err');
      }
    }
  }, [settledText, showToast]);

  // 大纲 / 字数
  const outline = useMemo(() => extractOutline(settledText), [settledText]);
  const wc = useMemo(() => countWords(settledText), [settledText]);

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
      const ok = mdRef.current?.runCommand(command, payload);
      if (ok === false) {
        // 编辑器未就绪 / 无选区等导致命令静默无效时给用户反馈
        showToast('命令未生效：请先点击编辑器或选中文字', 'err');
        return;
      }
      mdRef.current?.focus();
    },
    [showToast],
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
      // 大文件直接喂给 Crepe 会卡死，先确认
      if (
        file.size > 5 * 1024 * 1024 &&
        !window.confirm(
          `文件 ${file.name} 有 ${(file.size / 1024 / 1024).toFixed(1)} MB，打开可能卡顿，继续？`,
        )
      ) {
        return;
      }
      file
        .text()
        .then((content) => {
          snapshotNow(); // 覆盖当前内容前留底
          applyText(content);
          showToast(`已载入 ${file.name}`);
        })
        .catch((e) =>
          showToast(
            `读取失败：${e instanceof Error ? e.message : String(e)}`,
            'err',
          ),
        );
    },
    [applyText, showToast, snapshotNow],
  );

  // 导出目录下生成不重名的文件路径（重名追加 -2/-3…）
  const uniqueExportPath = useCallback(
    async (title: string, ext: string) => {
      const dir = await absPath('.ai-baogongtou/exports');
      if (!(await tauriFs.exists(dir))) await tauriFs.mkdir(dir);
      const safe = title.replace(/[\\/:*?"<>|]/g, '_');
      let path = `${dir}/${safe}.${ext}`;
      for (let i = 2; await tauriFs.exists(path); i++) {
        path = `${dir}/${safe}-${i}.${ext}`;
      }
      return path;
    },
    [],
  );

  // 导出 HTML
  const exportHtml = useCallback(async () => {
    const title = outline[0]?.text ?? 'Document';
    const html = markdownToHtmlDoc(text, title);
    if (isTauri()) {
      try {
        const path = await uniqueExportPath(title, 'html');
        await tauriFs.writeText(path, html);
        showToast(`已导出到 ${path}`);
      } catch (e) {
        showToast(
          `导出失败：${e instanceof Error ? e.message : String(e)}`,
          'err',
        );
      }
    } else {
      downloadText(`${title}.html`, html);
      showToast('已开始下载');
    }
  }, [text, outline, showToast, uniqueExportPath]);

  // 保存 .md
  const saveMd = useCallback(async () => {
    const title = outline[0]?.text ?? 'Document';
    if (isTauri()) {
      try {
        const path = await uniqueExportPath(title, 'md');
        await tauriFs.writeText(path, text);
        showToast(`已保存到 ${path}`);
      } catch (e) {
        showToast(
          `保存失败：${e instanceof Error ? e.message : String(e)}`,
          'err',
        );
      }
    } else {
      downloadText(`${title}.md`, text);
      showToast('已开始下载');
    }
  }, [text, outline, showToast, uniqueExportPath]);

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
          onSave={saveCurrent}
          onRestore={(entry) => {
            snapshotNow(); // 恢复覆盖当前内容前留底
            restoreEntry(entry);
          }}
          onRemove={removeEntry}
          onClear={clearAll}
          containerRef={historyRef}
        />
        <ToolbarButton
          onClick={() =>
            copyToClipboard(text).then((ok) =>
              showToast(ok ? '已复制全文' : '复制失败', ok ? 'ok' : 'err'),
            )
          }
        >
          复制
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            if (!text) return;
            if (!window.confirm('确定清空全部内容？（已自动快照到历史，可恢复）'))
              return;
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
        {toast && <FloatingToast toast={toast} />}
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        {/* 大纲侧栏 */}
        {outlineOpen && (
          <div className="w-52 shrink-0 overflow-y-auto border-r bg-muted/20">
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
              大纲
            </div>
            {outline.length === 0 ? (
              <EmptyState className="px-3 py-6" title="暂无标题" />
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
              onInitError={() => {
                // 编辑器加载失败自动降级源码模式，内容不丢
                setViewMode('source');
                showToast('所见即所得加载失败，已切换源码模式', 'err');
              }}
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
