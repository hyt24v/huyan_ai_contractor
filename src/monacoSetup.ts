// Monaco 本地打包配置：不走 CDN，按需注册 editor/json worker
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};

// 关闭 Monaco 自带的 JSON 诊断，校验由我们自己的逻辑负责（统一错误格式与标记）
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: false,
  allowComments: false,
  schemas: [],
});

loader.config({ monaco });

// 为每套应用主题注册对应 Monaco 主题（app-<themeId>），编辑器跟随主题系统切换
import { THEMES, type ThemeDefinition } from './lib/themes';

function registerMonacoTheme(theme: ThemeDefinition): void {
  const t = theme.tokens;
  monaco.editor.defineTheme(`app-${theme.id}`, {
    base: theme.appearance === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: t.foreground.slice(1) },
      { token: 'keyword', foreground: t.primary.slice(1) },
      { token: 'string', foreground: t.success.slice(1) },
      { token: 'string.key.json', foreground: t.primary.slice(1) },
      { token: 'number', foreground: t.warning.slice(1) },
      { token: 'keyword.json', foreground: t.destructive.slice(1) },
    ],
    colors: {
      'editor.background': t.card,
      'editor.foreground': t.foreground,
      'editorLineNumber.foreground': t.mutedForeground,
      'editorLineNumber.activeForeground': t.foreground,
      'editorCursor.foreground': t.primary,
      'editor.selectionBackground': `${t.primary}40`,
      'editor.lineHighlightBackground': `${t.muted}80`,
      'editorWidget.background': t.card,
      'editorWidget.border': t.border,
    },
  });
}

for (const theme of THEMES) registerMonacoTheme(theme);

export { monaco };
