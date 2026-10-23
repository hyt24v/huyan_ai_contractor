// Typora 式所见即所得 Markdown 编辑器（Milkdown Crepe 封装）
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
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
  /** 执行 Milkdown 命令（格式按钮用） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runCommand: (command: { key: CmdKey<any> }, payload?: unknown) => void;
  /** 滚动到大纲中第 index 个标题（按文档顺序） */
  scrollToHeading: (index: number) => void;
  focus: () => void;
}

interface MarkdownEditorProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ defaultValue, onChange }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const crepeRef = useRef<Crepe | null>(null);
    // onChange 存 ref，避免编辑器因回调身份变化重建
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

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
        })
        .catch((e) => console.error('Crepe 初始化失败', e));
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
        if (!crepe?.editor) return;
        crepe.editor.action(replaceAll(md));
      },
      runCommand: (command: { key: CmdKey<any> }, payload?: unknown) => {
        const crepe = crepeRef.current;
        if (!crepe?.editor) return;
        crepe.editor.action(
          payload === undefined
            ? callCommand(command.key)
            : callCommand(command.key, payload),
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

    return <div ref={hostRef} className="milkdown-wrapper" />;
  },
);

export default MarkdownEditor;
