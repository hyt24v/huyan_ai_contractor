import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  isNavCustomized,
  moveWithinGroup,
  navHidden,
  navOrder,
  orderedTools,
  resetNavConfig,
  setNavOrder,
  setToolHidden,
  visibleTools,
} from '../navConfig';
import { TOOLS } from '../tools';

// vitest 环境是 node：打最小 window/localStorage 桩（navConfig 依赖浏览器存储）
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

beforeAll(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: fakeStorage,
    dispatchEvent: () => true,
  };
});

beforeEach(() => {
  window.localStorage.clear();
  resetNavConfig(); // 同时清缓存
});

describe('navConfig', () => {
  it('默认：注册表顺序、全部显示、未自定义', () => {
    expect(isNavCustomized()).toBe(false);
    expect(navOrder()).toEqual(TOOLS.map((t) => t.path));
    expect(navHidden()).toEqual([]);
    expect(visibleTools().map((t) => t.path)).toEqual(TOOLS.map((t) => t.path));
  });

  it('setToolHidden：隐藏后从生效列表消失，再次开启恢复', () => {
    setToolHidden('/json', true);
    expect(navHidden()).toEqual(['/json']);
    expect(visibleTools().map((t) => t.path)).not.toContain('/json');
    expect(isNavCustomized()).toBe(true);
    setToolHidden('/json', false);
    expect(visibleTools().map((t) => t.path)).toContain('/json');
  });

  it('setNavOrder：按自定义顺序排列，未列入的新工具排末尾', () => {
    const reversed = TOOLS.map((t) => t.path).reverse();
    setNavOrder(reversed);
    expect(orderedTools().map((t) => t.path)).toEqual(reversed);
  });

  it('moveWithinGroup：组内移动，其他组顺序不变', () => {
    // 「管理」组内把第一个移到最后
    const before = orderedTools();
    const manage = before.filter((t) => t.group === '管理');
    const next = moveWithinGroup('管理', 0, manage.length - 1);
    const after = next.map((p) => TOOLS.find((t) => t.path === p)!);
    expect(after.filter((t) => t.group === '编辑器').map((t) => t.path)).toEqual(
      before.filter((t) => t.group === '编辑器').map((t) => t.path),
    );
    const manageAfter = after.filter((t) => t.group === '管理').map((t) => t.path);
    expect(manageAfter).toEqual([...manage.slice(1).map((t) => t.path), manage[0].path]);
  });

  it('moveWithinGroup：非法索引返回原顺序', () => {
    const before = orderedTools().map((t) => t.path);
    expect(moveWithinGroup('管理', -1, 0)).toEqual(before);
    expect(moveWithinGroup('管理', 0, 99)).toEqual(before);
  });

  it('resetNavConfig：恢复默认', () => {
    setToolHidden('/json', true);
    setNavOrder(TOOLS.map((t) => t.path).reverse());
    resetNavConfig();
    expect(isNavCustomized()).toBe(false);
    expect(visibleTools().map((t) => t.path)).toEqual(TOOLS.map((t) => t.path));
  });

  it('visibleTools 返回缓存引用（useSyncExternalStore 不抖动）', () => {
    expect(visibleTools()).toBe(visibleTools());
    setToolHidden('/mcp', true);
    expect(visibleTools()).toBe(visibleTools());
  });
});
