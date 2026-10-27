import { describe, expect, it, vi } from 'vitest';
import {
  applyJsonServers,
  parseMcpServersJson,
  planDistribution,
  specToJsonEntry,
} from '../mcp';
import type { McpServerSpec } from '../mcp';
import { AGENTS } from '../agents';
import { distribute } from '../../services/agentMcp';
import type { FsPort } from '../fsPort';

const HOME = '/h';

vi.mock('../fsPort', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../fsPort')>();
  return {
    ...orig,
    absPath: async (rel: string) => `${HOME}/${rel}`,
    home: async () => HOME,
  };
});

// 测试环境无本机检测结果，让全部注册 agent 参与（distribute 内部再按 fs 判定已安装）
vi.mock('../agentVisibility', () => ({
  effectiveAgents: () => AGENTS,
}));

/** 最小内存 FsPort：只实现 distribute 触及的方法 */
function makeFs(existingDirs: string[] = []) {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/', HOME, ...existingDirs]);
  const fs: FsPort = {
    exists: async (p: string) => files.has(p) || dirs.has(p),
    readText: async (p: string) => {
      const t = files.get(p);
      if (t === undefined) throw new Error(`ENOENT ${p}`);
      return t;
    },
    writeText: async (p: string, text: string) => {
      files.set(p, text);
    },
    mkdir: async (p: string) => {
      // 模拟 recursive mkdir：把每层父目录都登记
      const parts = p.split('/');
      for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/') || '/');
    },
    readDir: async () => [],
    remove: async (p: string) => {
      files.delete(p);
    },
  } as unknown as FsPort;
  return { fs, files, dirs };
}

// 12 个扩展 agent 的配置读写 round-trip（覆盖 beta.4 新增的 rootKey/specStyle 行为）
describe('扩展 agent MCP 读写 round-trip', () => {
  const cases: Array<{ id: string; rootKey?: string; specStyle?: 'standard' | 'opencode' }> = [
    { id: 'windsurf' },
    { id: 'qwen_code' },
    { id: 'kiro' },
    { id: 'cline' },
    { id: 'roo_code' },
    { id: 'kilo_code' },
    { id: 'droid' },
    { id: 'kimi' },
    { id: 'warp' },
    { id: 'opencode', rootKey: 'mcp', specStyle: 'opencode' },
    { id: 'crush', rootKey: 'mcp' },
    { id: 'amp', rootKey: 'amp.mcpServers' },
  ];
  const spec: McpServerSpec = { type: 'stdio', command: 'npx', args: ['-y', 'srv'] };

  for (const c of cases) {
    it(`${c.id}：写入 → 解析字段不丢失`, () => {
      const opts = { rootKey: c.rootKey, specStyle: c.specStyle };
      const out = applyJsonServers('{}', { s: { spec, hasEnabledFlag: false } }, [], opts);
      const back = parseMcpServersJson(out, opts);
      expect(back.servers.s).toEqual(spec);
      expect(back.enabled.s).toBe(true);
    });
  }

  it('扩展 agent 均带 mcpFile 且 hasEnabledFlag 为空', () => {
    const ids = new Set(cases.map((c) => c.id));
    for (const a of AGENTS) {
      if (!ids.has(a.id)) continue;
      expect(a.mcpFile, a.id).toBeTruthy();
      expect(a.mcpFormat).toBe('json');
      expect(a.hasEnabledFlag).toBeUndefined();
    }
  });
});

describe('distribute：配置父目录缺失时自动补建（globalStorage 场景）', () => {
  it('cline 已检测（~/.claude 存在）但 globalStorage 目录不存在 → mkdir 后写入', async () => {
    const { fs, files } = makeFs([`${HOME}/.claude`, `${HOME}/.agents`]);
    const r = await distribute(
      { servers: [{ name: 's', type: 'stdio', command: 'x', agents: { cline: true } }] },
      fs,
    );
    expect(r.errors.cline).toBeUndefined();
    expect(r.written).toContain('cline');
    const cline = AGENTS.find((a) => a.id === 'cline');
    const text = files.get(`${HOME}/${cline!.mcpFile}`);
    expect(text).toBeTruthy();
    expect(parseMcpServersJson(text!).servers.s?.command).toBe('x');
  });
});

describe('planDistribution 与新 schema 判等', () => {
  it('opencode 清单与本地 spec 一致时跳过更新', () => {
    const spec: McpServerSpec = { type: 'stdio', command: 'npx', args: ['-y', 'srv'] };
    const opts = { rootKey: 'mcp', specStyle: 'opencode' as const };
    const localText = applyJsonServers('{}', { s: { spec, hasEnabledFlag: false } }, [], opts);
    const local = parseMcpServersJson(localText, opts);
    const plan = planDistribution(
      { servers: [{ name: 's', type: 'stdio', command: 'npx', args: ['-y', 'srv'], agents: { opencode: true } }] },
      { opencode: { servers: local.servers } },
      ['opencode'],
    );
    expect(plan.opencode.updates).toEqual({});
    expect(plan.opencode.removals).toEqual([]);
  });
});

describe('specToJsonEntry 双 schema', () => {
  it('standard 与 opencode 输出差异', () => {
    const spec: McpServerSpec = { type: 'http', url: 'https://x/mcp', headers: { A: 'b' } };
    expect(specToJsonEntry(spec, false)).toMatchObject({ type: 'http', url: 'https://x/mcp' });
    expect(specToJsonEntry(spec, false, 'opencode')).toMatchObject({
      type: 'remote',
      url: 'https://x/mcp',
      enabled: true,
    });
  });
});
