import { describe, expect, it } from 'vitest';
import type { CentralManifest, McpServerSpec } from './mcp';
import {
  canonicalSpec,
  computeMcpDiff,
  diffServerLines,
  fieldEntries,
  formatDiff,
  specOf,
  type PerAgentServers,
} from './mcpDiff';

const stdio = (command: string, args: string[] = []): McpServerSpec => ({
  type: 'stdio',
  command,
  ...(args.length > 0 ? { args } : {}),
});

describe('specOf', () => {
  it('剥离 name / agents，仅保留下发字段', () => {
    expect(
      specOf({ name: 'x', type: 'stdio', command: 'npx', args: ['-y'], agents: { claude: true } }),
    ).toEqual({ type: 'stdio', command: 'npx', args: ['-y'] });
    expect(specOf({ name: 'h', type: 'http', url: 'https://x', agents: {} })).toEqual({
      type: 'http',
      url: 'https://x',
    });
  });
});

describe('canonicalSpec', () => {
  it('忽略 env / headers 键顺序', () => {
    const a: McpServerSpec = { type: 'stdio', command: 'x', env: { A: '1', B: '2' } };
    const b: McpServerSpec = { type: 'stdio', command: 'x', env: { B: '2', A: '1' } };
    expect(canonicalSpec(a)).toBe(canonicalSpec(b));
  });

  it('字段不同则不等价', () => {
    expect(canonicalSpec(stdio('a'))).not.toBe(canonicalSpec(stdio('b')));
  });
});

describe('fieldEntries', () => {
  it('stdout 展开 env，http 展开 headers', () => {
    expect(fieldEntries({ type: 'stdio', command: 'x', args: ['a', 'b'] })).toEqual([
      ['type', 'stdio'],
      ['command', 'x'],
      ['args', 'a b'],
    ]);
    expect(fieldEntries({ type: 'http', url: 'https://x', headers: { B: '2', A: '1' } })).toEqual([
      ['type', 'http'],
      ['url', 'https://x'],
      ['headers.A', '1'],
      ['headers.B', '2'],
    ]);
  });
});

describe('diffServerLines', () => {
  it('新增全部为 added 行', () => {
    const lines = diffServerLines(undefined, stdio('npx', ['-y']));
    expect(lines.every((l) => l.kind === 'added')).toBe(true);
    expect(lines.map((l) => l.text)).toContain('command: npx');
  });

  it('移除全部为 removed 行', () => {
    const lines = diffServerLines(stdio('npx'), undefined);
    expect(lines.every((l) => l.kind === 'removed')).toBe(true);
  });

  it('字段变化用 changed 行，未变用 context 行', () => {
    const lines = diffServerLines(stdio('old'), stdio('new'));
    expect(lines).toContainEqual({ kind: 'changed', text: 'command: old → new' });
    expect(lines).toContainEqual({ kind: 'context', text: 'type: stdio' });
  });

  it('仅一侧存在的字段分别标 added / removed', () => {
    const lines = diffServerLines(stdio('x'), stdio('x', ['-y']));
    expect(lines).toContainEqual({ kind: 'added', text: 'args: -y' });
    const back = diffServerLines(stdio('x', ['-y']), stdio('x'));
    expect(back).toContainEqual({ kind: 'removed', text: 'args: -y' });
  });
});

describe('computeMcpDiff', () => {
  const manifest: CentralManifest = {
    servers: [
      {
        name: 'same',
        type: 'stdio',
        command: 's',
        agents: { claude: true, codex: true },
      },
      {
        name: 'fresh',
        type: 'http',
        url: 'https://fresh',
        agents: { claude: true },
      },
      {
        name: 'tweaked',
        type: 'stdio',
        command: 'new-cmd',
        agents: { codex: true },
      },
      {
        name: 'drop-me',
        type: 'stdio',
        command: 'gone',
        agents: { claude: false },
      },
    ],
  };

  const current: PerAgentServers = {
    claude: {
      same: stdio('s'),
      tweaked: stdio('old-cmd'), // 清单中未启用 claude → 移除
      'drop-me': stdio('gone'), // 清单中明确未启用 → 移除
      legacy: stdio('legacy'), // 不在清单 → untracked，不动
    },
    codex: {
      same: stdio('s'),
      tweaked: stdio('old-cmd'), // 与清单 command 不同 → 修改
    },
  };

  it('按 agent 分类 added / removed / changed / unchanged / untracked', () => {
    const diff = computeMcpDiff(manifest, current);
    const claude = diff.perAgent.find((a) => a.agent === 'claude');
    const codex = diff.perAgent.find((a) => a.agent === 'codex');
    expect(claude).toBeDefined();
    expect(codex).toBeDefined();
    expect(claude!.added).toEqual(['fresh']);
    expect(claude!.changed).toEqual([]);
    expect(claude!.removed).toEqual(['drop-me', 'tweaked']);
    expect(claude!.unchanged).toEqual(['same']);
    expect(claude!.untracked).toEqual(['legacy']);
    expect(codex!.changed).toEqual(['tweaked']);
    expect(codex!.unchanged).toEqual(['same']);
    expect(codex!.added).toEqual([]);
    expect(codex!.removed).toEqual([]);
    expect(claude!.file).toBe('.claude.json');
    expect(claude!.name).toBe('Claude Code');
  });

  it('包含 agent 各 tab 的数据与 server 行', () => {
    const diff = computeMcpDiff(manifest, current);
    expect(diff.perAgent).toHaveLength(5);
    const codex = diff.perAgent.find((a) => a.agent === 'codex')!;
    const tweaked = codex.servers.find((s) => s.name === 'tweaked')!;
    expect(tweaked.status).toBe('changed');
    expect(tweaked.lines).toContainEqual({
      kind: 'changed',
      text: 'command: old-cmd → new-cmd',
    });
    const fresh = diff.perAgent
      .find((a) => a.agent === 'claude')!
      .servers.find((s) => s.name === 'fresh')!;
    expect(fresh.status).toBe('added');
    expect(fresh.lines.every((l) => l.kind === 'added')).toBe(true);
  });

  it('汇总计数与 hasChanges / changedAgents', () => {
    const diff = computeMcpDiff(manifest, current);
    expect(diff.summary).toMatchObject({
      added: 1,
      removed: 2,
      changed: 1,
      unchanged: 2,
      changedAgents: 2,
      hasChanges: true,
    });
  });

  it('现状与清单一致时无变更', () => {
    const clean: PerAgentServers = {
      claude: { same: stdio('s'), fresh: { type: 'http', url: 'https://fresh' } },
      codex: { same: stdio('s'), tweaked: stdio('new-cmd') },
    };
    const diff = computeMcpDiff(manifest, clean);
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.changed).toBe(0);
    expect(diff.summary.hasChanges).toBe(false);
    expect(diff.summary.changedAgents).toBe(0);
  });
});

describe('formatDiff', () => {
  it('包含总数与按 agent 明细', () => {
    const diff = computeMcpDiff(
      { servers: [{ name: 'a', type: 'stdio', command: 'a', agents: { claude: true } }] },
      {},
    );
    const text = formatDiff(diff);
    expect(text).toContain('共 1 项变更');
    expect(text).toContain('新增 1');
    expect(text).toContain('Claude Code（.claude.json）：新增 a');
  });

  it('无变更时只有汇总行', () => {
    const diff = computeMcpDiff({ servers: [] }, {});
    expect(formatDiff(diff)).toBe(
      '共 0 项变更：新增 0，移除 0，修改 0，未变化 0',
    );
  });
});