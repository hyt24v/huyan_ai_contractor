import { describe, expect, it } from 'vitest';
import {
  applyJsonServers,
  backupPath,
  joinArgs,
  mergeIntoManifest,
  parseMcpServersJson,
  parseTomlHeader,
  parseTomlMcpServers,
  parseTomlStringArray,
  parseTomlValue,
  planDistribution,
  replaceTomlServers,
  sanitizeManifest,
  serverToToml,
  splitArgs,
} from './mcp';

describe('parseMcpServersJson', () => {
  it('解析 stdio 与 http，剥离 enabled', () => {
    const text = JSON.stringify({
      other: true,
      mcpServers: {
        a: { type: 'stdio', command: 'x', args: ['1'], env: { K: 'V' }, enabled: false },
        b: { type: 'http', url: 'https://x/mcp' },
      },
    });
    const { servers, enabled } = parseMcpServersJson(text);
    expect(servers.a).toEqual({ type: 'stdio', command: 'x', args: ['1'], env: { K: 'V' } });
    expect(servers.b).toEqual({ type: 'http', url: 'https://x/mcp' });
    expect(enabled.a).toBe(false);
    expect(enabled.b).toBe(true);
  });
  it('非法 JSON 返回空', () => {
    expect(parseMcpServersJson('not json')).toEqual({ servers: {}, enabled: {} });
  });

  it('识别 serverUrl/httpUrl 别名与 disabled 约定', () => {
    const r = parseMcpServersJson(
      '{ "mcpServers": { "a": { "serverUrl": "https://x" }, "b": { "httpUrl": "https://y", "disabled": true } } }',
    );
    expect(r.servers.a?.url).toBe('https://x');
    expect(r.servers.b?.url).toBe('https://y');
    expect(r.enabled.a).toBe(true);
    expect(r.enabled.b).toBe(false);
  });
});

describe('mergeIntoManifest', () => {
  it('多 agent 合并同名 server，记录启用矩阵', () => {
    const m = mergeIntoManifest(
      {
        claude: {
          servers: { cg: { type: 'stdio', command: 'cg' } },
          enabled: { cg: true },
        },
        pi: {
          servers: { cg: { type: 'stdio', command: 'cg' }, mem: { type: 'http', url: 'u' } },
          enabled: { cg: false, mem: true },
        },
      },
      ['claude', 'pi'],
    );
    const cg = m.servers.find((s) => s.name === 'cg');
    expect(cg?.agents).toEqual({ claude: true, pi: false });
    expect(m.servers.find((s) => s.name === 'mem')?.agents).toEqual({ pi: true });
  });
});

describe('applyJsonServers', () => {
  it('保留其他键，更新/删除 mcpServers', () => {
    const out = applyJsonServers(
      JSON.stringify({ theme: 'dark', mcpServers: { old: { command: 'o' }, keep: { command: 'k' } } }),
      { new1: { spec: { type: 'stdio', command: 'n', args: ['a'] }, hasEnabledFlag: true } },
      ['old'],
    );
    const j = JSON.parse(out);
    expect(j.theme).toBe('dark');
    expect(j.mcpServers.keep).toEqual({ command: 'k' });
    expect(j.mcpServers.old).toBeUndefined();
    expect(j.mcpServers.new1).toMatchObject({ command: 'n', args: ['a'], enabled: true });
  });
  it('非空非法 JSON 直接抛错，绝不从空对象重写（数据安全）', () => {
    expect(() =>
      applyJsonServers('{{bad', { x: { spec: { type: 'http', url: 'u' }, hasEnabledFlag: false } }, []),
    ).toThrow();
    // 顶层非对象同样抛错
    expect(() => applyJsonServers('[]', {}, [])).toThrow();
    expect(() => applyJsonServers('"str"', {}, [])).toThrow();
  });

  it('rootKey 点路径：嵌套键读写（amp amp.mcpServers）', () => {
    const out = applyJsonServers(
      JSON.stringify({ amp: { mcpServers: { old: { command: 'x' } }, other: 1 } }),
      { s: { spec: { type: 'stdio', command: 'npx' }, hasEnabledFlag: false } },
      ['old'],
      { rootKey: 'amp.mcpServers' },
    );
    const root = JSON.parse(out) as { amp: { mcpServers: Record<string, unknown>; other: number } };
    expect(root.amp.other).toBe(1);
    expect(root.amp.mcpServers.old).toBeUndefined();
    expect(root.amp.mcpServers.s).toMatchObject({ command: 'npx' });
    expect(parseMcpServersJson(out, { rootKey: 'amp.mcpServers' }).servers.s?.command).toBe('npx');
  });

  it('specStyle opencode：command 数组双向转换', () => {
    const out = applyJsonServers(
      '{}',
      { s: { spec: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'] }, hasEnabledFlag: false } },
      [],
      { specStyle: 'opencode', rootKey: 'mcp' },
    );
    const root = JSON.parse(out) as { mcp: Record<string, Record<string, unknown>> };
    expect(root.mcp.s).toMatchObject({ type: 'local', command: ['npx', '-y', 'pkg'], enabled: true });
    const back = parseMcpServersJson(out, { specStyle: 'opencode', rootKey: 'mcp' });
    expect(back.servers.s).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'pkg'] });
  });
});

describe('parseTomlHeader', () => {
  it('解析普通与引号段', () => {
    expect(parseTomlHeader('[mcp_servers.x]')).toEqual(['mcp_servers', 'x']);
    expect(parseTomlHeader('[mcp_servers."my.name".env]')).toEqual(['mcp_servers', 'my.name', 'env']);
    expect(parseTomlHeader('key = 1')).toBeNull();
  });

  it('放行节头行尾注释与多余空白', () => {
    expect(parseTomlHeader('[mcp_servers.x] # 注释')).toEqual(['mcp_servers', 'x']);
    expect(parseTomlHeader('  [mcp_servers.x]  ')).toEqual(['mcp_servers', 'x']);
  });

  it('支持引号内的 ] 与单引号段', () => {
    expect(parseTomlHeader('[mcp_servers."a]b"]')).toEqual(['mcp_servers', 'a]b']);
    expect(parseTomlHeader("[mcp_servers.'lit.name']")).toEqual(['mcp_servers', 'lit.name']);
  });
});

describe('parseTomlValue / parseTomlStringArray', () => {
  it('basic 字符串反转义，literal 字符串原样', () => {
    expect(parseTomlValue('"a\\nb"')).toBe('a\nb');
    expect(parseTomlValue('"a\\\"b"')).toBe('a"b');
    expect(parseTomlValue('"\\\\"')).toBe('\\');
    expect(parseTomlValue('"a\\u0041"')).toBe('aA');
    expect(parseTomlValue("'a\\nb'")).toBe('a\\nb');
    // 未知转义保守保留两字符
    expect(parseTomlValue('"a\\qb"')).toBe('a\\qb');
    expect(parseTomlValue('plain')).toBe('plain');
  });

  it('引号感知切分数组', () => {
    expect(parseTomlStringArray('["a, b", "c"]')).toEqual(['a, b', 'c']);
    expect(parseTomlStringArray("['x', \"y\"]")).toEqual(['x', 'y']);
    expect(parseTomlStringArray('[]')).toEqual([]);
  });
});

describe('parseTomlMcpServers', () => {
  it('round-trip：写出的 TOML 读回后 args/env 不劣化', () => {
    const spec = {
      type: 'stdio' as const,
      command: 'cg',
      args: ['a, b', 'x"y', 'line\nbreak'],
      env: { 'K,1': 'v "q" \\ end' },
    };
    const toml = serverToToml('weird.name', spec);
    const { servers, enabled } = parseTomlMcpServers(toml);
    expect(servers['weird.name']).toEqual(spec);
    // enabled 稀疏：未写 enabled = 行时不出现该键（默认启用）
    expect(enabled['weird.name']).toBeUndefined();
  });

  it('http server 与 enabled 读回', () => {
    const toml = [
      '[mcp_servers.web]',
      'url = "https://x/mcp"',
      'enabled = false',
      '',
    ].join('\n');
    const { servers, enabled } = parseTomlMcpServers(toml);
    expect(servers.web).toEqual({ type: 'http', url: 'https://x/mcp' });
    expect(enabled.web).toBe(false);
  });

  it('缺 command/url 的段被忽略', () => {
    const toml = '[mcp_servers.broken]\nfoo = 1\n';
    expect(parseTomlMcpServers(toml).servers).toEqual({});
  });
});

describe('splitArgs / joinArgs', () => {
  it('空格切分，引号保留空格', () => {
    expect(splitArgs('-y @scope/pkg "a b"')).toEqual(['-y', '@scope/pkg', 'a b']);
    expect(splitArgs("'x y' z")).toEqual(['x y', 'z']);
    expect(splitArgs('')).toEqual([]);
  });

  it('joinArgs 与 splitArgs 互逆', () => {
    const args = ['-y', 'a b', 'x"y'];
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});

describe('sanitizeManifest', () => {
  it('丢弃畸形条目并去重同名', () => {
    const m = sanitizeManifest({
      servers: [
        { name: 'ok', type: 'stdio', command: 'x', agents: { pi: true } },
        { name: '', type: 'stdio', command: 'x' },
        null,
        { name: 'ok', type: 'http', url: 'u' }, // 重名，后者丢弃
        { name: 'bad', type: 'weird' },
      ],
    });
    expect(m.servers).toHaveLength(1);
    expect(m.servers[0].name).toBe('ok');
  });

  it('servers 非数组时给空清单', () => {
    expect(sanitizeManifest({ servers: 'nope' } as unknown as Record<string, unknown>).servers).toEqual([]);
  });
});

describe('serverToToml / replaceTomlServers', () => {
  it('生成 stdio server 段含 env 子表', () => {
    const t = serverToToml('cg', { type: 'stdio', command: 'cg', args: ['serve'], env: { A: '1' } });
    expect(t).toContain('[mcp_servers."cg"]');
    expect(t).toContain('command = "cg"');
    expect(t).toContain('args = ["serve"]');
    expect(t).toContain('[mcp_servers."cg".env]');
    expect(t).toContain('"A" = "1"');
  });

  it('外科手术：只动目标 server，保留注释与其他段', () => {
    const original = [
      '# 全局配置别动我',
      'model = "gpt-5"',
      '',
      '[mcp_servers.old]',
      'command = "old"',
      '',
      '[mcp_servers.keep]',
      'command = "keep"',
      '',
      '[mcp_servers."weird.name"]',
      'url = "https://x"',
      '',
    ].join('\n');
    const out = replaceTomlServers(
      original,
      { cg: { type: 'stdio', command: 'cg' } },
      ['old'],
    );
    expect(out).toContain('# 全局配置别动我');
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[mcp_servers.keep]');
    expect(out).toContain('[mcp_servers."weird.name"]');
    expect(out).not.toContain('mcp_servers.old');
    expect(out).toContain('[mcp_servers."cg"]');
    // 验证可被解析：新旧段名都在
    expect(parseTomlHeader('[mcp_servers."cg"]')).toEqual(['mcp_servers', 'cg']);
  });

  it('删除带 env 子表的 server 连同子表一起删', () => {
    const original = [
      '[mcp_servers.a]',
      'command = "a"',
      '[mcp_servers.a.env]',
      'K = "V"',
      '[other]',
      'x = 1',
    ].join('\n');
    const out = replaceTomlServers(original, {}, ['a']);
    expect(out).not.toContain('mcp_servers.a');
    expect(out).toContain('[other]');
  });
});

describe('planDistribution', () => {
  it('勾选的写 updates，内容相同则跳过', () => {
    const manifest = {
      servers: [
        { name: 'cg', type: 'stdio' as const, command: 'cg', agents: { claude: true, pi: true } },
        { name: 'mem', type: 'http' as const, url: 'u', agents: { claude: true } },
      ],
    };
    const plan = planDistribution(
      manifest,
      { claude: { servers: { cg: { type: 'stdio', command: 'cg' } } }, pi: { servers: {} } },
      ['claude', 'pi'],
    );
    // claude: cg 内容一致跳过，mem 需要新增
    expect(Object.keys(plan.claude.updates)).toEqual(['mem']);
    // pi: cg 需要新增
    expect(Object.keys(plan.pi.updates)).toEqual(['cg']);
  });

  it('取消勾选的 server 进 removals', () => {
    const manifest = {
      servers: [
        { name: 'cg', type: 'stdio' as const, command: 'cg', agents: { pi: true } },
      ],
    };
    const plan = planDistribution(
      manifest,
      { claude: { servers: { cg: { type: 'stdio', command: 'cg' }, old: { type: 'http', url: 'u' } } } },
      ['claude'],
    );
    // cg 在清单里但未勾选 claude → 移除；old 不在清单里 → 不纳入管理，不动
    expect(plan.claude.removals).toEqual(['cg']);
    expect(plan.claude.updates).toEqual({});
  });

  it('键序不同但内容相同的 spec 判等跳过（canonicalSpec）', () => {
    const manifest = {
      servers: [
        { name: 's', type: 'stdio' as const, command: 'c', args: ['a'], env: { B: '2', A: '1' }, agents: { pi: true } },
      ],
    };
    // 现有配置字段顺序、env 键序不同
    const plan = planDistribution(
      manifest,
      { pi: { servers: { s: { env: { A: '1', B: '2' }, args: ['a'], command: 'c', type: 'stdio' } } } },
      ['pi'],
    );
    expect(plan.pi.updates).toEqual({});
  });
});

describe('backupPath', () => {
  it('生成时间戳备份名', () => {
    const p = backupPath('/x/y.json', new Date(2026, 9, 21, 14, 5, 9));
    expect(p).toBe('/x/y.json.bak.20261021-140509');
  });
});
