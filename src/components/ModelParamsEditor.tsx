/**
 * 模型参数编辑器：temperature / topP / maxTokens 三项可选覆盖。
 * 留空 = 不发送该参数（走服务商原始默认）；「恢复默认」清除该模型的全部覆盖。
 * AiSection（设置页）与 AiDock（对话内 popover）共用。
 */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ModelParams } from '../lib/providers';
import { normalizeModelParams } from '../lib/providers';

interface FieldSpec {
  key: keyof ModelParams;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

const FIELDS: FieldSpec[] = [
  { label: 'Temperature', hint: '0-2，越高越发散', key: 'temperature', min: 0, max: 2, step: 0.1 },
  { label: 'Top P', hint: '0-1，核采样', min: 0, max: 1, step: 0.05, key: 'topP' },
  { label: 'Max Tokens', hint: '最大输出长度', min: 1, max: 1000000, step: 1, integer: true, key: 'maxTokens' },
];

interface ModelParamsEditorProps {
  /** 当前覆盖；undefined = 全部默认 */
  params: ModelParams | undefined;
  /** 参数变化回调；normalize 后为空对象时回传 undefined（= 恢复默认） */
  onChange: (next: ModelParams | undefined) => void;
  /** 紧凑模式（AiDock popover 用） */
  compact?: boolean;
}

export default function ModelParamsEditor({
  params,
  onChange,
  compact = false,
}: ModelParamsEditorProps) {
  // 输入中的原始文本（允许「0.」这种中间态）
  const [drafts, setDrafts] = useState<Partial<Record<keyof ModelParams, string>>>({});

  const commit = (key: keyof ModelParams, raw: string, integer?: boolean) => {
    setDrafts((d) => ({ ...d, [key]: raw }));
    const trimmed = raw.trim();
    const next: ModelParams = { ...(params ?? {}) };
    if (trimmed === '') {
      delete next[key];
    } else {
      const n = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
      if (!Number.isFinite(n)) return;
      (next as Record<string, number>)[key] = n;
    }
    onChange(normalizeModelParams(next));
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      {FIELDS.map((f) => {
        const draft = drafts[f.key];
        const value = draft ?? (params?.[f.key] !== undefined ? String(params[f.key]) : '');
        return (
          <div key={f.key} className="flex items-center gap-2">
            <span
              className={`shrink-0 text-[11px] text-muted-foreground ${compact ? 'w-20' : 'w-24'}`}
              title={f.hint}
            >
              {f.label}
            </span>
            <input
              type="number"
              value={value}
              min={f.min}
              max={f.max}
              step={f.step}
              placeholder="默认"
              onChange={(e) => commit(f.key, e.target.value, f.integer)}
              className={`${compact ? 'h-6 w-20' : 'h-7 w-24'} rounded-md border border-input bg-transparent px-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30`}
            />
            <span className="text-[10px] text-muted-foreground/70">
              {value === '' ? '默认' : f.hint}
            </span>
          </div>
        );
      })}
      {params && (
        <button
          type="button"
          onClick={() => {
            setDrafts({});
            onChange(undefined);
          }}
          className="inline-flex items-center gap-1 rounded-sm px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          恢复默认（请求不携带参数）
        </button>
      )}
    </div>
  );
}
