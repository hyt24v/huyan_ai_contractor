import { Gauge, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/controls';
import { AGENTS } from '../../lib/agents';
import { PROVIDER_TARGETS, UNSUPPORTED_NOTE } from '../../lib/providerTargets';
import {
  API_LABEL,
  isActive,
  maskKey,
  type Provider,
  type ProviderApi,
  type ProviderStore,
} from '../../lib/providers';

/** provider.agent 一定是注册表里的 agent，但导入的 JSON 可能带未知 id，需兜底 */
const agentName = (id: string): string =>
  AGENTS.find((a) => a.id === id)?.name ?? id;

function ApiBadge({ api }: { api?: ProviderApi }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
      {api ? API_LABEL[api] : '默认 API'}
    </span>
  );
}

/** 生效单选圈：点击 = 应用该 provider 到其 agent（外层走 ConfirmApplyDialog） */
function ActiveRadio({
  active,
  writable,
  busy,
  onApply,
}: {
  active: boolean;
  writable: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onApply}
      disabled={busy || !writable || active}
      title={
        active
          ? '当前生效'
          : writable
            ? '写入该 Agent 的配置文件并设为当前'
            : UNSUPPORTED_NOTE
      }
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed ${
        active
          ? 'border-primary'
          : writable
            ? 'border-input hover:border-primary/60'
            : 'border-input opacity-40'
      }`}
    >
      {active && <span className="h-2 w-2 rounded-full bg-primary" />}
    </button>
  );
}

export interface RowTestResult {
  text: string;
  ok: boolean;
}

/** 名称首字符头像（Magpie 式 vendor 图标占位） */
function ProviderAvatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * 模型服务卡片列表（Magpie 式：一行一张白色圆角卡片，浮在页面底色上）。
 * 排序与筛选由调用方完成，这里只负责渲染。
 */
export default function ProviderTable({
  store,
  providers,
  busy,
  onApply,
  onEdit,
  onDelete,
  onTest,
  testingId,
  testResults,
}: {
  store: ProviderStore;
  providers: Provider[];
  busy: boolean;
  onApply: (p: Provider) => void;
  onEdit: (p: Provider) => void;
  onDelete: (p: Provider) => void;
  /** 行内测速（借鉴 cc-switch 端点测速） */
  onTest?: (p: Provider) => void;
  testingId?: string | null;
  testResults?: Record<string, RowTestResult>;
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {providers.map((p) => {
        const active = isActive(store, p);
        // 导入的 JSON 可能带注册表外的 agent id，按不可写兜底
        const writable = PROVIDER_TARGETS[p.agent]?.writable ?? false;
        const extraModels =
          (p.models?.length ?? 0) - (p.model && p.models?.includes(p.model) ? 1 : 0);
        const result = testResults?.[p.id];
        return (
          <div
            key={p.id}
            className={`group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${
              active ? 'border-primary/40' : ''
            }`}
          >
            <ProviderAvatar name={p.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium">{p.name}</span>
                {active && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    当前
                  </span>
                )}
                <ApiBadge api={p.api} />
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                <span className="shrink-0">{agentName(p.agent)}</span>
                <span className="shrink-0 opacity-50">·</span>
                <span className="truncate font-mono" title={p.baseUrl}>
                  {hostOf(p.baseUrl)}
                </span>
                <span className="shrink-0 opacity-50">·</span>
                <span
                  className="truncate font-mono"
                  title={
                    p.models && p.models.length > 0
                      ? `默认：${p.model || '—'}\n全部：${p.models.join(', ')}`
                      : (p.model ?? '')
                  }
                >
                  {p.model || '—'}
                  {extraModels > 0 ? ` +${extraModels}` : ''}
                </span>
                <span className="shrink-0 opacity-50">·</span>
                <span className="shrink-0 font-mono">{maskKey(p.apiKey)}</span>
              </div>
              {result && (
                <div
                  className={`mt-0.5 truncate text-[10px] ${result.ok ? 'text-success' : 'text-warning'}`}
                >
                  {result.text}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {onTest && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onTest(p)}
                  disabled={testingId === p.id}
                  title="测试端点连通性与延迟"
                >
                  {testingId === p.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Gauge className="h-3 w-3" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onEdit(p)}
                title="编辑"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDelete(p)}
                title="从清单删除（可重新导入，不会改动 Agent 配置文件）"
                className="text-muted-foreground hover:!bg-destructive/10 hover:!text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <ActiveRadio
              active={active}
              writable={writable}
              busy={busy}
              onApply={() => onApply(p)}
            />
          </div>
        );
      })}
    </div>
  );
}
