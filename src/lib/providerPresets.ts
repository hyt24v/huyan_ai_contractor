/**
 * 供应商预设模板库（借鉴 cc-switch：选预设自动填端点，只填 API Key）。
 * baseUrl 约定：不含版本段的由调用方补 /v1（见 providerApi.ts 的 modelsUrl）。
 */

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** 常用模型建议（展示用，可选） */
  models: string[];
  /** 控制台/文档地址（获取 API Key） */
  site?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
    site: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    site: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    name: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k'],
    site: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    site: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M2'],
    site: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen-plus', 'qwen-flash'],
    site: 'https://bailian.console.aliyun.com/#/api-key',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter（聚合）',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    site: 'https://openrouter.ai/keys',
  },
];

/** id → 预设（custom 表示手动填写） */
export function presetById(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? null;
}
