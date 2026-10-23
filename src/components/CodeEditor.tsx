import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { monaco } from '../monacoSetup';

export type EditorInstance = Parameters<OnMount>[0];
// Monaco 主题（app-<themeId>）在 monacoSetup.ts 中随应用主题统一注册

/** 监听 <html> 上的 data-theme，跟随全局主题系统 */
function useAppThemeId(): string {
  const [id, setId] = useState(
    () => document.documentElement.dataset.theme ?? 'minimal-light',
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setId(document.documentElement.dataset.theme ?? 'minimal-light');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return id;
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
  language: 'json' | 'plaintext' | 'markdown';
  onMount?: OnMount;
  readOnly?: boolean;
}) {
  const themeId = useAppThemeId();
  const editorRef = useRef<EditorInstance | null>(null);

  return (
    <Editor
      value={value}
      onChange={(v) => onChange(v ?? '')}
      language={language}
      theme={`app-${themeId}`}
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
