import { describe, expect, it } from 'vitest';
import {
  applyJsonServers,
  backupPath,
  mergeIntoManifest,
  parseMcpServersJson,
  parseTomlHeader,
  planDistribution,
  replaceTomlServers,
  serverToToml,
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
  it('原文件非法时从空对象开始', () => {
    const out = applyJsonServers('{{bad', { x: { spec: { type: 'http', url: 'u' }, hasEnabledFlag: false } }, []);
    expect(JSON.parse(out).mcpServers.x).toEqual({ type: 'http', url: 'u' });
  });
});

describe('parseTomlHeader', () => {
  it('解析普通与引号段', () => {
    expect(parseTomlHeader('[mcp_servers.x]')).toEqual(['mcp_servers', 'x']);
    expect(parseTomlHeader('[mcp_servers."my.name".env]')).toEqual(['mcp_servers', 'my.name', 'env']);
    expect(parseTomlHeader('key = 1')).toBeNull();
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
});

describe('backupPath', () => {
  it('生成时间戳备份名', () => {
    const p = backupPath('/x/y.json', new Date(2026, 9, 21, 14, 5, 9));
    expect(p).toBe('/x/y.json.bak.20261021-140509');
  });
});
