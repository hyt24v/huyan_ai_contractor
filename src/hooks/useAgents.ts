/** 订阅「当前生效的 agent 列表」:设置里切换显示后组件自动重渲染 */
import { useSyncExternalStore } from 'react';
import { effectiveAgents } from '../lib/agentVisibility';
import { SETTINGS_CHANGED_EVENT } from '../lib/settings';
import type { AgentDef } from '../lib/agents';

export function useAgents(): AgentDef[] {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(SETTINGS_CHANGED_EVENT, cb);
      return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, cb);
    },
    // effectiveAgents 内部有缓存,未变更时返回同一数组引用,不会死循环
    () => effectiveAgents(),
  );
}
