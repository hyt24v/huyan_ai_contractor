/** 健康检查问题数的全局发布/订阅（activitybar 聚合计数徽标用，借鉴 fanbox「谁在等我」计数） */

const KEY = 'huyan_tool:health-issues';
const EVT = 'health-issues-changed';

export function setHealthIssueCount(n: number): void {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    // 隐私模式写入失败可忽略
  }
  window.dispatchEvent(new CustomEvent(EVT));
}

export function getHealthIssueCount(): number {
  const n = Number(localStorage.getItem(KEY) ?? '0');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function onHealthIssueCount(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}
