import { Pencil, Trash2 } from 'lucide-react';
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

/** 「生效」列单选圈：点击 = 应用该 provider 到其 agent（外层走 ConfirmApplyDialog） */
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

/**
 * 模型服务单屏清单：一行 = 一个 provider（借鉴 magpie 的单屏清单密度）。
 * 排序与筛选由调用方完成，这里只负责渲染。
 */
export default function ProviderTable({
  store,
  providers,
  busy,
  onApply,
  onEdit,
  onDelete,
}: {
  store: ProviderStore;
  providers: Provider[];
  busy: boolean;
  onApply: (p: Provider) => void;
  onEdit: (p: Provider) => void;
  onDelete: (p: Provider) => void;
}) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 bg-card">
        <tr className="border-b text-left text-[11px] text-muted-foreground">
          <th className="px-3 py-2 font-medium">名称</th>
          <th className="px-2 py-2 font-medium">目标 Agent</th>
          <th className="px-2 py-2 font-medium">Base URL</th>
          <th className="px-2 py-2 font-medium">模型</th>
          <th className="px-2 py-2 font-medium">API 协议</th>
          <th className="px-2 py-2 font-medium">API Key</th>
          <th className="px-2 py-2 text-center font-medium">生效</th>
          <th className="px-3 py-2 text-right font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        {providers.map((p) => {
          const active = isActive(store, p);
          // 导入的 JSON 可能带注册表外的 agent id，按不可写兜底
          const writable = PROVIDER_TARGETS[p.agent]?.writable ?? false;
          return (
            <tr
              key={p.id}
              className={`group border-b transition-colors last:border-0 hover:bg-accent/40 ${
                active ? 'bg-primary/5' : ''
              }`}
            >
              <td className="max-w-[12rem] px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{p.name}</span>
                  {active && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      当前
                    </span>
                  )}
                </div>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {agentName(p.agent)}
              </td>
              <td
                className="max-w-[16rem] truncate px-2 py-2 font-mono text-[11px] text-muted-foreground"
                title={p.baseUrl}
              >
                {p.baseUrl}
              </td>
              <td
                className="max-w-[10rem] truncate px-2 py-2 font-mono text-[11px]"
                title={p.model ?? ''}
              >
                {p.model || '—'}
              </td>
              <td className="whitespace-nowrap px-2 py-2">
                <ApiBadge api={p.api} />
              </td>
              <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-muted-foreground">
                {maskKey(p.apiKey)}
              </td>
              <td className="px-2 py-2 text-center">
                <ActiveRadio
                  active={active}
                  writable={writable}
                  busy={busy}
                  onApply={() => onApply(p)}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => onEdit(p)}
                    title="编辑"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    title="从清单删除（可重新导入，不会改动 Agent 配置文件）"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
