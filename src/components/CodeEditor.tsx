import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { monaco } from '../monacoSetup';

export type EditorInstance = Parameters<OnMount>[0];

/** 监听 <html> 上的 dark class，跟随全局主题 */
function useDarkClass(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export default function CodeEditor({
  value,
  onChange,
  language,
  onMount,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  language: 'json' | 'plaintext';
  onMount?: OnMount;
  readOnly?: boolean;
}) {
  const dark = useDarkClass();
  const editorRef = useRef<EditorInstance | null>(null);

  return (
    <Editor
      value={value}
      onChange={(v) => onChange(v ?? '')}
      language={language}
      theme={dark ? 'vs-dark' : 'vs'}
      onMount={(editor, m) => {
        editorRef.current = editor;
        onMount?.(editor, m);
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 2,
        automaticLayout: true,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        readOnly: readOnly ?? false,
        folding: true,
        largeFileOptimizations: true,
      }}
      loading={
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          编辑器加载中…
        </div>
      }
    />
  );
}

export { monaco };
