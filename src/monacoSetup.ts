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

export { monaco };
