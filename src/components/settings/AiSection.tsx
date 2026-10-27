/** 设置 → AI 助手：选择对话 dock 使用的服务商与模型，并管理该服务商的可选模型列表（AI-P1） */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Star, X } from 'lucide-react';
import { SettingGroup, SettingRow } from './ui';
import { loadStore, upsertProvider } from '../../services/providers';
import { fetchModels } from '../../lib/providerApi';
import { getAiSettings, setAiSettings, type AiSettings } from '../../lib/settings';
import type { ModelParams, Provider } from '../../lib/providers';
import ModelParamsEditor from '../ModelParamsEditor';

export default function AiSection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<AiSettings>(getAiSettings);
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState('');
  /** 正在编辑参数的模型名（点击模型芯片切换） */
  const [paramModel, setParamModel] = useState<string | null>(null);

  useEffect(() => {
    loadStore()
      .then((s) => setProviders(s.providers))
      .catch(() => setProviders([]));
  }, []);

  const provider = providers.find((p) => p.id === settings.providerId) ?? null;
  const models = provider
    ? (provider.models?.length
        ? provider.models
        : provider.model
          ? [provider.model]
          : [])
    : [];

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setAiSettings(next);
  };

  /** 模型列表改动持久化到 provider 本身（providers.json），AI 对话中的模型选择器随之更新 */
  const persistProvider = useCallback(
    async (next: Provider, msg: string) => {
      try {
        const store = await upsertProvider(next);
        setProviders(store.providers);
        setFetchMsg(msg);
      } catch (e) {
        setFetchMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [],
  );

  const addModel = useCallback(
    (name: string) => {
      if (!provider) return;
      const m = name.trim();
      if (!m || models.includes(m)) return;
      void persistProvider(
        {
          ...provider,
          models: [...models, m],
          model: provider.model ?? m,
        },
        `已添加模型 ${m}`,
      );
    },
    [provider, models, persistProvider],
  );

  const removeModel = useCallback(
    (name: string) => {
      if (!provider) return;
      const rest = models.filter((m) => m !== name);
      const modelParams = { ...(provider.modelParams ?? {}) };
      delete modelParams[name];
      if (paramModel === name) setParamModel(null);
      void persistProvider(
        {
          ...provider,
          models: rest,
          model: provider.model === name ? rest[0] : provider.model,
          modelParams:
            Object.keys(modelParams).length > 0 ? modelParams : undefined,
        },
        `已移除模型 ${name}`,
      );
    },
    [provider, models, persistProvider, paramModel],
  );

  /** 保存某模型的参数覆盖；next=undefined 表示恢复默认 */
  const saveParams = useCallback(
    (modelName: string, next: ModelParams | undefined) => {
      if (!provider) return;
      const modelParams = { ...(provider.modelParams ?? {}) };
      if (next) modelParams[modelName] = next;
      else delete modelParams[modelName];
      void persistProvider(
        {
          ...provider,
          modelParams:
            Object.keys(modelParams).length > 0 ? modelParams : undefined,
        },
        next ? `已更新 ${modelName} 的参数` : `已恢复 ${modelName} 的默认参数`,
      );
    },
    [provider, persistProvider],
  );

  const setDefaultModel = useCallback(
    (name: string) => {
      if (!provider || provider.model === name) return;
      void persistProvider({ ...provider, model: name }, `默认模型已切换为 ${name}`);
    },
    [provider, persistProvider],
  );

  const pullModels = useCallback(async () => {
    if (!provider) return;
    setFetching(true);
    setFetchMsg('');
    try {
      const r = await fetchModels(provider.baseUrl, provider.apiKey);
      if (r.ok) {
        setFetched(r.models);
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
          Key），这里选择引用并管理可选模型列表；改动即时生效。
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
          label="默认模型"
          description="留空则使用模型列表的第一个；对话中可临时切换"
        >
          <select
            value={settings.model ?? ''}
            onChange={(e) => update({ model: e.target.value || undefined })}
            disabled={!provider || models.length === 0}
            className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 dark:bg-input/30"
          >
            <option value="">
              {models.length > 0 ? `默认（${models[0]}）` : '请先在下方添加模型'}
            </option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="模型列表"
          description="点击模型名编辑参数；★ 为服务商默认模型；只能从拉取的列表中添加"
        >
          {provider ? (
            <div className="w-full max-w-md space-y-1.5">
              {models.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {models.map((m) => (
                    <span
                      key={m}
                      className="group inline-flex items-center gap-1 rounded-full border border-border/80 bg-background px-2.5 py-1 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setDefaultModel(m)}
                        title={provider.model === m ? '默认模型' : '设为默认模型'}
                        aria-label={`将 ${m} 设为默认模型`}
                        className="text-muted-foreground transition-colors hover:text-amber-500"
                      >
                        <Star
                          className={`h-3 w-3 ${
                            provider.model === m
                              ? 'fill-amber-500 text-amber-500'
                              : ''
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setParamModel(paramModel === m ? null : m)
                        }
                        title="编辑该模型的参数"
                        className={`max-w-52 truncate transition-colors hover:text-primary ${
                          paramModel === m ? 'text-primary' : ''
                        }`}
                      >
                        {m}
                      </button>
                      {provider.modelParams?.[m] && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          title="已自定义参数"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeModel(m)}
                        title="移除"
                        aria-label={`移除模型 ${m}`}
                        className="text-muted-foreground/60 transition-colors hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {paramModel && (
                <div className="rounded-md border border-border/60 bg-background/50 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-medium">
                      {paramModel} 参数
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        留空 = 不发送该参数（走服务商默认）
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setParamModel(null)}
                      title="收起"
                      aria-label="收起参数编辑"
                      className="text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <ModelParamsEditor
                    params={provider.modelParams?.[paramModel]}
                    onChange={(n) => saveParams(paramModel, n)}
                  />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addModel(e.target.value);
                  }}
                  disabled={fetched.length === 0}
                  className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 dark:bg-input/30"
                >
                  <option value="">
                    {fetched.length > 0
                      ? `从拉取结果中选择（${fetched.filter((m) => !models.includes(m)).length} 个可添加）…`
                      : '先点击右侧按钮拉取模型列表'}
                  </option>
                  {fetched
                    .filter((m) => !models.includes(m))
                    .map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => void pullModels()}
                  disabled={fetching}
                  title="从服务商拉取模型列表"
                  aria-label="从服务商拉取模型列表"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${fetching ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">先选择服务商</span>
          )}
        </SettingRow>
      </SettingGroup>

      {fetchMsg && (
        <p className="px-1 text-[11px] text-muted-foreground">{fetchMsg}</p>
      )}
    </div>
  );
}
