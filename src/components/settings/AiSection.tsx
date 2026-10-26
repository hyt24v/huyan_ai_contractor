/** 设置 → AI 助手：选择对话 dock 使用的服务商与模型（AI-P0） */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SettingGroup, SettingRow } from './ui';
import { Input } from '../ui/controls';
import { loadStore } from '../../services/providers';
import { fetchModels } from '../../lib/providerApi';
import { getAiSettings, setAiSettings, type AiSettings } from '../../lib/settings';
import type { Provider } from '../../lib/providers';

export default function AiSection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<AiSettings>(getAiSettings);
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState('');

  useEffect(() => {
    loadStore()
      .then((s) => setProviders(s.providers))
      .catch(() => setProviders([]));
  }, []);

  const provider = providers.find((p) => p.id === settings.providerId) ?? null;

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setAiSettings(next);
  };

  const pullModels = useCallback(async () => {
    if (!provider) return;
    setFetching(true);
    setFetchMsg('');
    try {
      const r = await fetchModels(provider.baseUrl, provider.apiKey);
      if (r.ok) {
        setModels(r.models);
        setFetchMsg(r.message);
      } else {
        setFetchMsg(`获取失败：${r.message}`);
      }
    } finally {
      setFetching(false);
    }
  }, [provider]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">AI 助手</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          右侧 AI 助手面板使用的服务商与模型。服务商在「模型服务」页维护（含 API
          Key），这里只选择引用；改动即时生效。
        </p>
      </div>

      <SettingGroup>
        <SettingRow
          label="服务商"
          description={
            providers.length === 0
              ? '还没有服务商——先到「模型服务」页添加'
              : 'AI 对话请求经 Rust 侧转发，Key 不出本机'
          }
        >
          <select
            value={settings.providerId ?? ''}
            onChange={(e) =>
              update({ providerId: e.target.value || undefined })
            }
            className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
          >
            <option value="">未选择</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="模型"
          description="留空则使用服务商自身配置的默认模型"
        >
          <div className="flex items-center gap-1.5">
            <Input
              value={settings.model ?? ''}
              onChange={(e) => update({ model: e.target.value || undefined })}
              placeholder={provider?.model || '模型名，如 gpt-4o-mini'}
              list="ai-model-suggestions"
              className="w-56"
            />
            <button
              type="button"
              onClick={() => void pullModels()}
              disabled={!provider || fetching}
              title="从服务商拉取模型列表"
              aria-label="从服务商拉取模型列表"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetching ? 'animate-spin' : ''}`} />
            </button>
            <datalist id="ai-model-suggestions">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </SettingRow>
      </SettingGroup>

      {fetchMsg && (
        <p className="px-1 text-[11px] text-muted-foreground">{fetchMsg}</p>
      )}
    </div>
  );
}
