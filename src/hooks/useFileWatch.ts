/**
 * 组件级文件监听 hook：挂载时监听一组路径，卸载时取消。
 * 注意：unwatch 按路径整体移除，同一路径多实例共用会互相取消（当前页面级使用无此场景）。
 */
import { useEffect, useRef } from 'react';
import { onFsChange, unwatchPath, watchPath } from '../lib/fileWatch';

export function useFileWatch(
  paths: (string | null | undefined)[],
  onChange: (path: string, kind: 'modified' | 'removed') => void,
): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const key = paths
    .filter((p): p is string => Boolean(p))
    .sort()
    .join('\n');

  useEffect(() => {
    if (!key) return;
    const list = key.split('\n');
    for (const p of list) void watchPath(p);
    const off = onFsChange((e) => {
      if (list.includes(e.path)) cbRef.current(e.path, e.kind);
    });
    return () => {
      off();
      for (const p of list) void unwatchPath(p);
    };
  }, [key]);
}
