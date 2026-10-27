// Typora 式所见即所得 Markdown 编辑器（Milkdown Crepe 封装）
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Crepe } from '@milkdown/crepe';
import { replaceAll, callCommand } from '@milkdown/kit/utils';
import type { CmdKey } from '@milkdown/kit/core';
import '@milkdown/crepe/theme/common/style.css';
import { fileToDataUrl } from '../../lib/markdownUtils';
import './markdown-editor.css';

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  /** 全量替换内容（保留撤销栈之外的历史插件状态会重置） */
  setMarkdown: (md: string) => void;
  /** 执行 Milkdown 命令（格式按钮用）；返回命令是否实际生效 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runCommand: (command: { key: CmdKey<any> }, payload?: unknown) => boolean;
  /** 滚动到大纲中第 index 个标题（按文档顺序） */
  scrollToHeading: (index: number) => void;
  focus: () => void;
}

interface MarkdownEditorProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
  /** Crepe 初始化失败时回调（页面可降级到源码模式） */
  onInitError?: (message: string) => void;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ defaultValue, onChange, onInitError }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const crepeRef = useRef<Crepe | null>(null);
    // onChange 存 ref，避免编辑器因回调身份变化重建
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onInitErrorRef = useRef(onInitError);
    onInitErrorRef.current = onInitError;
    const [initError, setInitError] = useState<string | null>(null);
    // create() 是异步的：就绪前 setMarkdown 先挂起，resolve 后补齐，避免状态与视图脱钩
    const readyRef = useRef(false);
    const pendingMarkdownRef = useRef<string | null>(null);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const crepe = new Crepe({
        root: host,
        defaultValue,
        features: {
          // LaTeX/AI 暂不需要，减少体积
          [Crepe.Feature.Latex]: false,
          [Crepe.Feature.AI]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: {
            text: '输入 Markdown，或按 / 唤起命令…',
            mode: 'block',
          },
          [Crepe.Feature.ImageBlock]: {
            // 粘贴/拖拽/选择的图片内嵌为 data URL（纯本地，可移植）
            onUpload: (file: File) => fileToDataUrl(file),
          },
        },
      });

      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          onChangeRef.current?.(markdown);
        });
      });

      let disposed = false;
      crepe
        .create()
        .then(() => {
          if (disposed) return crepe.destroy();
          readyRef.current = true;
          // 补齐就绪前被挂起的内容替换
          if (pendingMarkdownRef.current !== null && crepe.editor) {
            const md = pendingMarkdownRef.current;
            pendingMarkdownRef.current = null;
            crepe.editor.action(replaceAll(md));
          }
        })
        .catch((e) => {
          console.error('Crepe 初始化失败', e);
          if (!disposed) {
            const msg = e instanceof Error ? e.message : String(e);
            setInitError(msg);
            onInitErrorRef.current?.(msg);
          }
        });
      crepeRef.current = crepe;

      return () => {
        disposed = true;
        crepeRef.current = null;
        crepe.destroy().catch(() => {});
      };
      // defaultValue 只在首次挂载生效；后续内容变更走 setMarkdown
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => crepeRef.current?.getMarkdown() ?? '',
      setMarkdown: (md: string) => {
        const crepe = crepeRef.current;
        if (!crepe?.editor || !readyRef.current) {
          // 编辑器未就绪：挂起，create() resolve 后补齐
          pendingMarkdownRef.current = md;
          return;
        }
        crepe.editor.action(replaceAll(md));
      },
      runCommand: (command: { key: CmdKey<any> }, payload?: unknown) => {
        const crepe = crepeRef.current;
        if (!crepe?.editor || !readyRef.current) return false;
        return Boolean(
          crepe.editor.action(
            payload === undefined
              ? callCommand(command.key)
              : callCommand(command.key, payload),
          ),
        );
      },
      scrollToHeading: (index: number) => {
        const host = hostRef.current;
        if (!host) return;
        const headings = host.querySelectorAll(
          '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6',
        );
        const el = headings[index] as HTMLElement | undefined;
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.remove('md-heading-flash');
        // 触发重绘以便重复点击同一标题也能看到闪烁
        void el.offsetWidth;
        el.classList.add('md-heading-flash');
      },
      focus: () => {
        hostRef.current
          ?.querySelector<HTMLElement>('.ProseMirror')
          ?.focus();
      },
    }));

    if (initError) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          所见即所得编辑器加载失败：{initError}
          <br />
          已切换为源码模式，内容不会丢失。
        </div>
      );
    }
    return <div ref={hostRef} className="milkdown-wrapper" />;
  },
);

export default MarkdownEditor;
