/** agentVisibility 广播行为：refreshAgentVisibility 检测结果变化时发 SETTINGS_CHANGED_EVENT */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsPort } from './fsPort';

vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/home/test' }));

import { AGENTS } from './agents';
import {
  effectiveAgentIds,
  FALLBACK_AGENT_IDS,
  refreshAgentVisibility,
  resetAgentVisibility,
} from './agentVisibility';
import { SETTINGS_CHANGED_EVENT } from './settings';

// vitest 环境是 node：打最小 window/localStorage/事件桩
class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const fakeStorage = new FakeStorage();
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

beforeAll(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: fakeStorage,
    addEventListener: (type: string, l: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
    },
    removeEventListener: (type: string, l: Listener) => {
      listeners.get(type)?.delete(l);
    },
    dispatchEvent: (e: Event) => {
      listeners.get(e.type)?.forEach((l) => l());
      return true;
    },
  };
});

/** 只实现 exists 的内存 FsPort；dirs 为「存在」的绝对路径集合 */
function fakeFs(dirs: Set<string>): FsPort {
  return { exists: async (p: string) => dirs.has(p) } as unknown as FsPort;
}

function onChanged(): { count: () => number } {
  let n = 0;
  const l = () => {
    n += 1;
  };
  window.addEventListener(SETTINGS_CHANGED_EVENT, l);
  return { count: () => n };
}

const claude = AGENTS.find((a) => a.id === 'claude')!;
const codex = AGENTS.find((a) => a.id === 'codex')!;

beforeEach(() => {
  fakeStorage.clear();
  listeners.clear();
  resetAgentVisibility(); // 清自定义标记 + 模块缓存（会多发一次事件，先挂上再清零）
  listeners.clear();
});

describe('refreshAgentVisibility 广播', () => {
  it('什么都没检测到时回退内置 5 个，且不广播（生效列表未变）', async () => {
    const sub = onChanged();
    const result = await refreshAgentVisibility(fakeFs(new Set()));
    expect(result.map((a) => a.id)).toEqual(FALLBACK_AGENT_IDS);
    expect(sub.count()).toBe(0);
  });

  it('首次检测到 agent：广播一次，生效列表变为检测到的', async () => {
    const sub = onChanged();
    const result = await refreshAgentVisibility(
      fakeFs(new Set([`/home/test/${claude.skillsDir}`])),
    );
    expect(result.map((a) => a.id)).toEqual(['claude']);
    expect(sub.count()).toBe(1);
    expect(effectiveAgentIds()).toEqual(['claude']);
  });

  it('重复检测结果不变：不广播', async () => {
    const fs = fakeFs(new Set([`/home/test/${claude.skillsDir}`]));
    await refreshAgentVisibility(fs);
    const sub = onChanged();
    await refreshAgentVisibility(fs);
    expect(sub.count()).toBe(0);
  });

  it('检测结果变化（新增 agent）：再次广播', async () => {
    await refreshAgentVisibility(fakeFs(new Set([`/home/test/${claude.skillsDir}`])));
    const sub = onChanged();
    const result = await refreshAgentVisibility(
      fakeFs(new Set([`/home/test/${claude.skillsDir}`, `/home/test/${codex.skillsDir}`])),
    );
    expect(result.map((a) => a.id)).toEqual(['claude', 'codex']);
    expect(sub.count()).toBe(1);
  });
});
