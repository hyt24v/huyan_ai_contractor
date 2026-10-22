import { describe, expect, it } from 'vitest';
import {
  activeProvider,
  applyClaudeSettings,
  applyCodexToml,
  applyPiModels,
  applyProviderText,
  createProvider,
  emptyCurrent,
  emptyStore,
  exportStoreJson,
  importStoreJson,
  isActive,
  maskKey,
  normalizeStore,
  PROVIDER_APIS,
  providersOf,
  readClaudeSettings,
  readCodexToml,
  readPiModels,
  readProviderConfig,
  removeProvider,
  setActive,
  uniqueProviderId,
  updateProvider,
  upsertProvider,
  validateProvider,
  type Provider,
  type ProviderInput,
} from './providers';
import {
  isProviderWritable,
  PROVIDER_TARGETS,
  providerBackupName,
  providerTarget,
} from './providerTargets';

const NOW = new Date('2026-10-22T08:00:00.000Z');

const input = (patch: Partial<ProviderInput> = {}): ProviderInput => ({
  name: '公司中转',
  agent: 'claude',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
  model: 'claude-sonnet-4-5',
  ...patch,
});

const make = (patch: Partial<ProviderInput> = {}, now = NOW): Provider =>
  createProvider(input(patch), now);

describe('validateProvider', () => {
  it('合法输入无错误', () => {
    expect(validateProvider(input())).toEqual([]);
  });

  it('缺名称 / 缺 agent / 非法 URL', () => {
    expect(validateProvider(input({ name: '  ' }))).toContain('名称不能为空');
    expect(validateProvider(input({ agent: 'vscode' as never }))).toContain(
      '请选择目标 Agent',
    );
    expect(validateProvider(input({ baseUrl: '' }))).toContain('Base URL 不能为空');
    expect(validateProvider(input({ baseUrl: 'ftp://x' }))).toContain(
      'Base URL 必须以 http:// 或 https:// 开头',
    );
    expect(validateProvider(input({ baseUrl: 'https://a b' }))).toContain(
      'Base URL 不能包含空白字符',
    );
  });

  it('拒绝换行注入与非法 id / api', () => {
    expect(validateProvider(input({ apiKey: 'a\nb' }))).toContain(
      'API Key 不能包含换行',
    );
    expect(validateProvider(input({ model: 'a\nb' }))).toContain(
      '模型名不能包含换行',
    );
    expect(validateProvider(input({ id: '../evil' }))).toContain(
      'ID 只能包含字母、数字、下划线和连字符',
    );
    expect(validateProvider(input({ api: 'grpc' as never }))).toContain(
      '未知的 API 协议',
    );
  });

  it('长名称超限', () => {
    expect(validateProvider(input({ name: 'x'.repeat(61) }))).toContain(
      '名称不能超过 60 个字符',
    );
  });
});

describe('maskKey', () => {
  it('空值显示未设置', () => {
    expect(maskKey(undefined)).toBe('未设置');
    expect(maskKey('')).toBe('未设置');
  });

  it('短 key 完全隐藏', () => {
    expect(maskKey('sk-1234')).not.toContain('1234');
    expect(maskKey('12345678')).toBe('••••••••');
  });

  it('中等长度只露末 4 位', () => {
    const masked = maskKey('abcdefghijkl');
    expect(masked.endsWith('ijkl')).toBe(true);
    expect(masked).not.toContain('abcdefgh');
  });

  it('长 key 首 4 + 末 4，永不等于原文', () => {
    const key = 'sk-abcdefghijklmnopqrstuvwxyz';
    const masked = maskKey(key);
    expect(masked).toBe('sk-a••••wxyz');
    expect(masked).not.toBe(key);
  });
});

describe('id / create / update', () => {
  it('中文名回退 provider，重名递增', () => {
    expect(uniqueProviderId('公司中转', [])).toBe('provider');
    expect(uniqueProviderId('公司中转', ['provider'])).toBe('provider-2');
    expect(uniqueProviderId('My Proxy', [])).toBe('my-proxy');
  });

  it('createProvider 生成时间戳与可选字段', () => {
    const p = make();
    expect(p.id).toBe('provider');
    expect(p.createdAt).toBe(NOW.toISOString());
    expect(p.updatedAt).toBe(NOW.toISOString());
    expect(p.apiKey).toBe('sk-abcdefghijklmnopqrstuvwxyz');
    expect(p.model).toBe('claude-sonnet-4-5');
  });

  it('createProvider 去空白并省略空可选字段', () => {
    const p = make({ name: ' A ', apiKey: '  ', model: ' ' });
    expect(p.name).toBe('A');
    expect('apiKey' in p).toBe(false);
    expect('model' in p).toBe(false);
  });

  it('updateProvider 保留 id/createdAt，可清除可选字段', () => {
    const p = make();
    const next = updateProvider(
      p,
      { ...input({ apiKey: '', model: '' }) },
      new Date('2026-10-23T00:00:00.000Z'),
    );
    expect(next.id).toBe(p.id);
    expect(next.createdAt).toBe(p.createdAt);
    expect(next.updatedAt).toBe('2026-10-23T00:00:00.000Z');
    expect('apiKey' in next).toBe(false);
    expect('model' in next).toBe(false);
  });
});

describe('store helpers', () => {
  it('upsert 新增与替换', () => {
    const a = make({ id: 'a', name: 'A' });
    const b = make({ id: 'b', name: 'B' });
    let store = upsertProvider(emptyStore(), a);
    store = upsertProvider(store, upsertProvider(store, b).providers[1]);
    expect(store.providers.map((p) => p.id)).toEqual(['a', 'b']);
    const updated = { ...a, name: 'A2' };
    store = upsertProvider(store, updated);
    expect(store.providers).toHaveLength(2);
    expect(store.providers[0].name).toBe('A2');
  });

  it('改 agent 时清理旧 agent 的 active', () => {
    const a = make({ id: 'a' });
    let store = upsertProvider(emptyStore(), a);
    store = setActive(store, 'claude', 'a');
    const moved = { ...a, agent: 'codex' as const };
    store = upsertProvider(store, moved);
    expect(store.active.claude).toBeUndefined();
  });

  it('remove 时清理 active', () => {
    const a = make({ id: 'a' });
    let store = setActive(upsertProvider(emptyStore(), a), 'claude', 'a');
    expect(activeProvider(store, 'claude')?.id).toBe('a');
    store = removeProvider(store, 'a');
    expect(store.providers).toEqual([]);
    expect(store.active).toEqual({});
    expect(removeProvider(store, 'nope')).toEqual(store);
  });

  it('setActive 校验 provider 存在且属于该 agent', () => {
    const a = make({ id: 'a' });
    const store = upsertProvider(emptyStore(), a);
    expect(() => setActive(store, 'claude', 'missing')).toThrow('provider 不存在');
    expect(() => setActive(store, 'codex', 'a')).toThrow('不属于该 Agent');
    expect(setActive(store, 'claude', null).active).toEqual({});
  });

  it('isActive / providersOf', () => {
    const a = make({ id: 'a' });
    const b = make({ id: 'b', agent: 'codex' });
    let store = upsertProvider(upsertProvider(emptyStore(), a), b);
    store = setActive(store, 'claude', 'a');
    expect(isActive(store, store.providers[0])).toBe(true);
    expect(providersOf(store, 'codex').map((p) => p.id)).toEqual(['b']);
  });
});

describe('export / import', () => {
  it('导出后可原样导入', () => {
    const a = make({ id: 'a' });
    const store = setActive(upsertProvider(emptyStore(), a), 'claude', 'a');
    const json = exportStoreJson(store);
    const result = importStoreJson(json, emptyStore(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.store.providers).toEqual(store.providers);
    expect(result.store.active.claude).toBe('a');
  });

  it('支持纯数组格式，同 id 覆盖', () => {
    const a = make({ id: 'a', name: '旧' });
    const current = upsertProvider(emptyStore(), a);
    const raw = JSON.stringify([
      { ...make({ id: 'a', name: '新' }), name: '新' },
      { ...make({ id: 'b' }), name: 'B' },
    ]);
    const result = importStoreJson(raw, current, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.store.providers.map((p) => p.name)).toEqual(['新', 'B']);
  });

  it('非法 JSON / 缺数组 / 坏条目都返回错误', () => {
    expect(importStoreJson('{', emptyStore(), NOW).ok).toBe(false);
    expect(importStoreJson('{}', emptyStore(), NOW).ok).toBe(false);
    const bad = importStoreJson(
      JSON.stringify([{ id: 'x', name: '', agent: 'claude', baseUrl: 'https://a' }]),
      emptyStore(),
      NOW,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('第 1 条无效');
  });

  it('active 只保留有效指向', () => {
    const store = {
      providers: [make({ id: 'a' })],
      active: { claude: 'a', codex: 'ghost' } as Record<string, string>,
    };
    const result = importStoreJson(
      JSON.stringify({
        providers: [make({ id: 'a' })],
        active: { claude: 'a', codex: 'ghost', pi: 'a' },
      }),
      emptyStore(),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.store.active).toEqual({ claude: 'a' });
    expect(store.active.codex).toBe('ghost');
  });
});

describe('normalizeStore', () => {
  it('丢弃坏条目与非法 active', () => {
    const store = normalizeStore(
      {
        providers: [
          make({ id: 'a' }),
          { id: 'bad id', name: 'x', agent: 'claude', baseUrl: 'https://a' },
          { id: 'b', name: '', agent: 'claude', baseUrl: 'https://a' },
          { id: 'c', name: 'C', agent: 'nope', baseUrl: 'https://a' },
          make({ id: 'd', agent: 'codex' }),
        ],
        active: { claude: 'a', codex: 'a', pi: 'd' },
      },
      NOW,
    );
    expect(store.providers.map((p) => p.id)).toEqual(['a', 'd']);
    expect(store.active).toEqual({ claude: 'a' });
  });

  it('非对象 / 空输入回退空 store', () => {
    expect(normalizeStore(null, NOW)).toEqual(emptyStore());
    expect(normalizeStore([], NOW)).toEqual(emptyStore());
    expect(normalizeStore('x', NOW)).toEqual(emptyStore());
  });
});

describe('applyClaudeSettings', () => {
  it('空文件生成 env', () => {
    const out = JSON.parse(applyClaudeSettings('', make())) as Record<string, any>;
    expect(out.env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_AUTH_TOKEN: 'sk-abcdefghijklmnopqrstuvwxyz',
      ANTHROPIC_MODEL: 'claude-sonnet-4-5',
    });
    expect(applyClaudeSettings('', make()).endsWith('\n')).toBe(true);
  });

  it('保留其它 settings / hooks / env 键', () => {
    const original = JSON.stringify({
      permissions: { allow: ['Bash'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
      env: { FOO: 'bar', ANTHROPIC_AUTH_TOKEN: 'old' },
      model: 'legacy',
    });
    const out = JSON.parse(
      applyClaudeSettings(original, make({ apiKey: 'new-key', model: 'm2' })),
    ) as Record<string, any>;
    expect(out.permissions).toEqual({ allow: ['Bash'] });
    expect(out.hooks.Stop).toHaveLength(1);
    expect(out.model).toBe('legacy');
    expect(out.env).toEqual({
      FOO: 'bar',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_AUTH_TOKEN: 'new-key',
      ANTHROPIC_MODEL: 'm2',
    });
  });

  it('未提供 key/model 时移除对应 env 项', () => {
    const original = JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'old', ANTHROPIC_MODEL: 'old-model', A: '1' },
    });
    const out = JSON.parse(
      applyClaudeSettings(original, make({ apiKey: undefined, model: undefined })),
    ) as Record<string, any>;
    expect(out.env).toEqual({
      A: '1',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
    });
  });

  it('损坏 JSON 抛出可读错误且不改内容', () => {
    expect(() => applyClaudeSettings('{oops', make())).toThrow('不是合法 JSON');
    expect(() => applyClaudeSettings('[]', make())).toThrow('根节点不是对象');
  });
});

describe('applyCodexToml', () => {
  it('空文件生成顶层键与 provider 段', () => {
    const out = applyCodexToml('', make({ id: 'corp', model: 'gpt-5' }));
    expect(out).toContain('model_provider = "corp"');
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[model_providers.corp]');
    expect(out).toContain('name = "公司中转"');
    expect(out).toContain('base_url = "https://api.example.com"');
    expect(out).toContain('wire_api = "responses"');
    expect(out).toContain('requires_openai_auth = true');
  });

  it('替换已有顶层键并保留注释与其它配置', () => {
    const original = [
      '# 我的 codex 配置',
      'model = "old"',
      'approval_policy = "never" # 注释',
      '',
      '[mcp_servers.x]',
      'command = "npx"',
    ].join('\n');
    const out = applyCodexToml(
      original,
      make({ id: 'p1', model: 'gpt-5', api: 'openai-completions' }),
    );
    expect(out).toContain('# 我的 codex 配置');
    expect(out).toContain('approval_policy = "never" # 注释');
    expect(out).toContain('model = "gpt-5"');
    expect(out).not.toContain('model = "old"');
    expect(out).toContain('model_provider = "p1"');
    expect(out).toContain('wire_api = "completions"');
    expect(out).toContain('[mcp_servers.x]');
    expect(out.indexOf('model_provider')).toBeLessThan(out.indexOf('[mcp_servers.x]'));
  });

  it('整段替换旧的 [model_providers.<id>] 与子表', () => {
    const original = [
      'model_provider = "p1"',
      'model = "old"',
      '',
      '[model_providers.p1]',
      'name = "旧名"',
      'base_url = "https://old"',
      'wire_api = "chat"',
      '',
      '[model_providers.p1.http_headers]',
      'x = "y"',
      '',
      '[model_providers.other]',
      'name = "保留"',
    ].join('\n');
    const out = applyCodexToml(original, make({ id: 'p1', model: 'new-model' }));
    expect(out).toContain('name = "公司中转"');
    expect(out).toContain('base_url = "https://api.example.com"');
    expect(out).not.toContain('旧名');
    expect(out).not.toContain('https://old');
    expect(out).not.toContain('http_headers');
    expect(out).toContain('[model_providers.other]');
    expect(out).toContain('name = "保留"');
    expect(out.match(/\[model_providers\.p1\]/g)).toHaveLength(1);
  });

  it('未提供 model 时不动顶层 model', () => {
    const out = applyCodexToml('model = "keep"\n', make({ model: undefined }));
    expect(out).toContain('model = "keep"');
    expect(out).toContain('model_provider = "provider"');
  });

  it('无 key 时不写 requires_openai_auth', () => {
    const out = applyCodexToml('', make({ apiKey: undefined }));
    expect(out).not.toContain('requires_openai_auth');
  });

  it('无注释空行时也能正确插入', () => {
    const out = applyCodexToml('', make({ id: 'a', name: 'A' }));
    const first = out.split('\n')[0];
    expect(first).toMatch(/^model_provider = "a"$/);
  });

  it('文件以节头开头时顶层键插在最前并留空行', () => {
    const out = applyCodexToml('[mcp_servers.a]\ncommand = "x"\n', make({ id: 'p', model: 'm' }));
    expect(out.split('\n').slice(0, 4)).toEqual([
      'model_provider = "p"',
      'model = "m"',
      '',
      '[mcp_servers.a]',
    ]);
  });
});

describe('applyPiModels', () => {
  it('空文件生成 providers 条目', () => {
    const out = JSON.parse(applyPiModels('', make({ id: 'corp' }))) as Record<string, any>;
    expect(out.providers.corp).toEqual({
      name: '公司中转',
      baseUrl: 'https://api.example.com',
      api: 'openai-responses',
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
      models: [{ id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' }],
    });
  });

  it('保留其它 provider 与顶层键，自定义 api 生效', () => {
    const original = JSON.stringify({
      defaultProvider: 'x',
      providers: { x: { name: 'X', baseUrl: 'https://x', models: [{ id: 'm' }] } },
    });
    const out = JSON.parse(
      applyPiModels(original, make({ id: 'corp', api: 'anthropic-messages' })),
    ) as Record<string, any>;
    expect(out.defaultProvider).toBe('x');
    expect(out.providers.x.name).toBe('X');
    expect(out.providers.corp.api).toBe('anthropic-messages');
  });

  it('无 model / key 时省略对应字段', () => {
    const out = JSON.parse(
      applyPiModels('', make({ model: undefined, apiKey: undefined })),
    ) as Record<string, any>;
    expect(out.providers.provider).not.toHaveProperty('models');
    expect(out.providers.provider).not.toHaveProperty('apiKey');
  });

  it('损坏 JSON 抛出错误', () => {
    expect(() => applyPiModels('nope', make())).toThrow('不是合法 JSON');
  });
});

describe('readProviderConfig', () => {
  it('claude 读 env，key 只报存在性', () => {
    const text = applyClaudeSettings('', make());
    const c = readClaudeSettings(text);
    expect(c.found).toBe(true);
    expect(c.baseUrl).toBe('https://api.example.com');
    expect(c.model).toBe('claude-sonnet-4-5');
    expect(c.hasKey).toBe(true);
    expect(JSON.stringify(c)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('codex 读顶层键与指定 provider 段', () => {
    const text = [
      'model_provider = "corp"',
      'model = "gpt-5"',
      '',
      '[model_providers.corp]',
      'name = "公司"',
      'base_url = "https://api.example.com"',
      'requires_openai_auth = true',
    ].join('\n');
    const c = readCodexToml(text);
    expect(c).toMatchObject({
      found: true,
      providerId: 'corp',
      providerName: '公司',
      baseUrl: 'https://api.example.com',
      model: 'gpt-5',
      hasKey: true,
    });
  });

  it('codex 空 / 无关内容返回 found=false', () => {
    expect(readCodexToml('').found).toBe(false);
    expect(readCodexToml('approval_policy = "never"').found).toBe(false);
  });

  it('pi 读指定 provider，缺省取第一个', () => {
    const text = JSON.stringify({
      providers: {
        a: { name: 'A', baseUrl: 'https://a', api: 'openai-completions' },
        b: { name: 'B', baseUrl: 'https://b', models: [{ id: 'm2' }] },
      },
    });
    expect(readPiModels(text, 'b')).toMatchObject({
      baseUrl: 'https://b',
      providerId: 'b',
      model: 'm2',
      hasKey: false,
    });
    expect(readPiModels(text).providerId).toBe('a');
    expect(readPiModels('', 'a')).toEqual(emptyCurrent());
  });

  it('分发器按格式读取，unsupported 为空', () => {
    const text = applyClaudeSettings('', make());
    expect(readProviderConfig('claude-settings', text).found).toBe(true);
    expect(readProviderConfig('unsupported', text).found).toBe(false);
  });
});

describe('applyProviderText', () => {
  it('按 agent 选择正确格式', () => {
    expect(applyProviderText('claude', '', make())).toContain('ANTHROPIC_BASE_URL');
    expect(applyProviderText('codex', '', make())).toContain('model_provider');
    expect(applyProviderText('pi', '', make())).toContain('"providers"');
  });

  it('cursor / gemini 拒绝写入并给出提示', () => {
    expect(() => applyProviderText('cursor', '', make({ agent: 'cursor' }))).toThrow(
      '暂不支持写入，仅支持查看',
    );
    expect(() => applyProviderText('gemini', '', make({ agent: 'gemini' }))).toThrow(
      '暂不支持写入，仅支持查看',
    );
  });
});

describe('providerTargets', () => {
  it('三个可写、两个仅查看', () => {
    expect(isProviderWritable('claude')).toBe(true);
    expect(isProviderWritable('codex')).toBe(true);
    expect(isProviderWritable('pi')).toBe(true);
    expect(isProviderWritable('cursor')).toBe(false);
    expect(isProviderWritable('gemini')).toBe(false);
    expect(PROVIDER_TARGETS.cursor.note).toBe('暂不支持写入，仅支持查看');
    expect(providerTarget('pi').file).toBe('.pi/agent/models.json');
  });

  it('备份文件名带 agent 与时间戳', () => {
    expect(providerBackupName('claude', NOW, 'json')).toBe(
      'claude-20261022-160000.json',
    );
    expect(providerBackupName('codex', NOW, 'toml', 2)).toBe(
      'codex-20261022-160000-2.toml',
    );
  });

  it('API 协议枚举与标签完整', () => {
    expect(PROVIDER_APIS).toEqual([
      'openai-responses',
      'openai-completions',
      'anthropic-messages',
    ]);
  });
});
// ---------- 服务层（内存 FsPort，验证备份 / 写入 / 持久化） ----------
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/home/test/' }));

import type { FsPort } from './fsPort';
import {
  applyProvider,
  backupAndWrite,
  loadStore,
  removeProvider as removeProviderFromDisk,
  saveStore,
  setActive as setActiveOnDisk,
} from '../services/providers';

const HOME = '/home/test';

function memFs(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const fs: FsPort = {
    readText: async (p) => {
      const v = map.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeText: async (p, t) => {
      map.set(p, t);
    },
    exists: async (p) => map.has(p),
    readDir: async () => [],
    mkdir: async () => {},
    remove: async (p) => {
      map.delete(p);
    },
    rename: async (a, b) => {
      const v = map.get(a);
      map.delete(a);
      if (v !== undefined) map.set(b, v);
    },
    copyDir: async () => {},
    readLink: async () => '',
    symlink: async () => {},
    gitClone: async () => {},
  };
  return { fs, map };
}

const STORE_PATH = `${HOME}/.ai-baogongtou/providers.json`;
const CLAUDE_PATH = `${HOME}/.claude/settings.json`;

describe('services/providers: store', () => {
  it('缺失文件返回空清单', async () => {
    const { fs } = memFs();
    expect(await loadStore(fs)).toEqual(emptyStore());
  });

  it('损坏 JSON 回退空清单且不覆盖原文件', async () => {
    const { fs, map } = memFs({ [STORE_PATH]: '{broken' });
    expect(await loadStore(fs)).toEqual(emptyStore());
    expect(map.get(STORE_PATH)).toBe('{broken');
  });

  it('save + load 往返，自动建目录', async () => {
    const { fs, map } = memFs();
    const a = make({ id: 'a' });
    const store = setActive(upsertProvider(emptyStore(), a), 'claude', 'a');
    await saveStore(store, fs);
    expect(map.has(STORE_PATH)).toBe(true);
    const loaded = await loadStore(fs);
    expect(loaded.providers).toEqual(store.providers);
    expect(loaded.active.claude).toBe('a');
  });

  it('setActive / removeProvider 落盘', async () => {
    const { fs } = memFs();
    const a = make({ id: 'a' });
    await saveStore(upsertProvider(emptyStore(), a), fs);
    expect((await setActiveOnDisk('claude', 'a', fs)).active.claude).toBe('a');
    const after = await removeProviderFromDisk('a', fs);
    expect(after.providers).toEqual([]);
    expect(after.active).toEqual({});
  });
});

describe('services/providers: applyProvider', () => {
  it('写入 Claude 配置并备份原文件', async () => {
    const original = JSON.stringify({ env: { FOO: '1' }, permissions: {} });
    const { fs, map } = memFs({ [CLAUDE_PATH]: original });
    const result = await applyProvider(make({ id: 'p1' }), fs);
    expect(result.ok).toBe(true);
    expect(result.file).toBe(CLAUDE_PATH);
    expect(result.backup).toBeTruthy();
    expect(map.get(result.backup!)).toBe(original);
    expect(result.backup!).toContain('.ai-baogongtou/provider-backups/claude-');
    const written = JSON.parse(map.get(CLAUDE_PATH)!) as Record<string, any>;
    expect(written.env.FOO).toBe('1');
    expect(written.env.ANTHROPIC_BASE_URL).toBe('https://api.example.com');
    expect(written.permissions).toEqual({});
  });

  it('目标文件不存在时直接创建，无备份', async () => {
    const { fs, map } = memFs();
    const result = await applyProvider(make({ id: 'p1', agent: 'codex' }), fs);
    expect(result.ok).toBe(true);
    expect(result.backup).toBeUndefined();
    expect(map.get(`${HOME}/.codex/config.toml`)).toContain('model_provider = "p1"');
  });

  it('配置损坏时中止写入且不改原文件', async () => {
    const broken = '{not json';
    const { fs, map } = memFs({ [CLAUDE_PATH]: broken });
    const result = await applyProvider(make(), fs);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('不是合法 JSON');
    expect(map.get(CLAUDE_PATH)).toBe(broken);
  });

  it('cursor / gemini 不写文件', async () => {
    const { fs, map } = memFs();
    const result = await applyProvider(make({ agent: 'gemini' }), fs);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('暂不支持写入，仅支持查看');
    expect([...map.keys()]).toEqual([]);
  });

  it('同一秒内多次写入不覆盖上一份备份', async () => {
    const p = `${HOME}/.claude/settings.json`;
    const { fs, map } = memFs({ [p]: 'v0' });
    const fixed = new Date('2026-10-22T08:00:00.000Z');
    const b1 = await backupAndWrite('claude', p, 'v1', fs, fixed);
    const b2 = await backupAndWrite('claude', p, 'v2', fs, fixed);
    expect(b1).toBeTruthy();
    expect(b2).toBeTruthy();
    expect(b1).not.toBe(b2);
    expect(map.get(b1!)).toBe('v0');
    expect(map.get(b2!)).toBe('v1');
    expect(map.get(p)).toBe('v2');
  });
});
