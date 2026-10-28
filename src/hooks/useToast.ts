/** 带自动消隐的 toast hook：连续触发会重置定时器，不会被旧定时器提前清掉 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  msg: string;
  tone: 'ok' | 'err';
}

export function useToast(timeoutMs = 3000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const showToast = useCallback(
    (msg: string, tone: 'ok' | 'err' = 'ok') => {
      clear();
      setToast({ msg, tone });
      // 错误提示停留更久：2~3 秒根本读不完失败原因，至少 10 秒
      const ms = tone === 'err' ? Math.max(timeoutMs, 10_000) : timeoutMs;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setToast(null);
      }, ms);
    },
    [clear, timeoutMs],
  );

  // 卸载时清理，避免组件销毁后 setState
  useEffect(() => clear, [clear]);

  return { toast, showToast };
}
