/**
 * 套餐/提示词服务的端到端冒烟测试（内存 FsPort + mock absPath）。
 * 覆盖审核修复点：#1 可见 agent 遍历、#2 默认只勾 MCP agent、
 * #5 备份归一化去重、#6 差量收回软链（真实目录不动）、#7 库单次读写。
 */
import { describe, expect, it, vi } from 'vitest';
import type { DirItem, FsPort } from '../lib/fsPort';

const HOME = '/h';

vi.mock('../lib/fsPort', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../lib/fsPort')>();
  return {
    ...orig,
    absPath: async (rel: string) => `${HOME}/${rel}`,
    home: async () => HOME,
  };
});

import { buildProfileManifest, applyProfile } from './profiles';
import type { Profile } from '../lib/profiles';

interface FakeFs extends FsPort {
  files: Map<string, string>;
  links: Map<string, string>;
  dirs: Set<string>;
}

function makeFs(): FakeFs {
  const files = new Map<string, string>();
  const links = new Map<string, string>();
  const dirs = new Set<string>();
  const children = (dir: string): DirItem[] => {
    const out: DirItem[] = [];
    const seen = new Set<string>();
    const add = (full: string, item: Omit<DirItem, 'name'>) => {
      if (!full.startsWith(dir + '/')) return;
      const rest = full.slice(dir.length + 1);
      if (!rest || rest.includes('/')) return;
      if (seen.has(rest)) return;
      seen.add(rest);
      out.push({ name: rest, ...item });
    };
    for (const k of files.keys()) add(k, { isDirectory: false, isSymlink: false });
    for (const k of links.keys()) add(k, { isDirectory: false, isSymlink: true });
    for (const k of dirs) add(k, { isDirectory: true, isSymlink: false });
    return out;
  };
  return {
    files,
    links,
    dirs,
    readText: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeText: async (p, t) => void files.set(p, t),
    exists: async (p) =>
      files.has(p) ||
      links.has(p) ||
      dirs.has(p) ||
      [...files.keys(), ...links.keys(), ...dirs].some((k) => k.startsWith(p + '/')),
    readDir: async (p) => children(p),
    mkdir: async (p) => void dirs.add(p),
    remove: async (p) => {
      files.delete(p);
      links.delete(p);
      dirs.delete(p);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    copyDir: async () => {},
    isSymlink: async (p) => links.has(p),
    readLink: async (p) => links.get(p) ?? '',
    symlink: async (target, link) => void links.set(link, target),
    gitClone: async () => {},
  };
}

const makeProfile = (over: Partial<Profile> = {}): Profile => ({
  id: 'prof1',
  name: 'P',
  skills: ['skill-1'],
  mcpServers: [],
  prompts: {},
  providers: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('buildProfileManifest', () => {
  it('新 server 默认只勾「可见且支持 MCP」的 agent（#2）', () => {
    const m = buildProfileManifest(
      { servers: [{ type: 'stdio', name: 's1', command: 'x', agents: {} }] },
      ['s1'],
    );
    const agents = m.servers[0].agents;
    const enabled = Object.entries(agents)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort();
    // node 环境回退到 5 个内置 agent，均有 mcpFile
    expect(enabled).toEqual(['claude', 'codex', 'cursor', 'gemini', 'pi']);
  });
});

describe('applyProfile', () => {
  it('skills 差量重算 + 提示词写入/备份/激活（#1 #5 #6 #7）', async () => {
    const fs = makeFs();
    // 中央库：skill-1 / skill-2 都存在
    fs.dirs.add(`${HOME}/ai-skills/skill-1`);
    fs.dirs.add(`${HOME}/ai-skills/skill-2`);
    // claude 已软链 skill-2（不在套餐内，应收回）；pi 有真实目录（绝不可删）
    fs.links.set(`${HOME}/.claude/skills/skill-2`, `${HOME}/ai-skills/skill-2`);
    fs.dirs.add(`${HOME}/.pi/agent/skills/local-skill`);
    fs.files.set(`${HOME}/.pi/agent/skills/local-skill/SKILL.md`, '# real');
    // 提示词库 + claude 现有提示词文件
    fs.files.set(
      `${HOME}/.ai-baogongtou/prompts.json`,
      JSON.stringify({
        prompts: [{ id: 'p1', name: 'P1', content: '新提示词', updatedAt: '2026-01-01T00:00:00Z' }],
        active: {},
      }),
    );
    fs.files.set(`${HOME}/.claude/CLAUDE.md`, '旧提示词内容');

    const report = await applyProfile(makeProfile({ prompts: { claude: 'p1' } }), fs);

    expect(report.errors).toEqual([]);
    // skills：skill-1 启用到 5 个可见 agent；skill-2 软链被收回
    expect(fs.links.get(`${HOME}/.claude/skills/skill-1`)).toBe(`${HOME}/ai-skills/skill-1`);
    expect(fs.links.get(`${HOME}/.pi/agent/skills/skill-1`)).toBe(`${HOME}/ai-skills/skill-1`);
    expect(fs.links.has(`${HOME}/.claude/skills/skill-2`)).toBe(false);
    // 真实目录不动（红线）
    expect(fs.files.get(`${HOME}/.pi/agent/skills/local-skill/SKILL.md`)).toBe('# real');
    expect(report.applied.some((a) => a.includes('收回 1 个'))).toBe(true);

    // 提示词：写入并补尾部换行，旧内容有备份，active 落库
    expect(fs.files.get(`${HOME}/.claude/CLAUDE.md`)).toBe('新提示词\n');
    const backups = [...fs.files.keys()].filter((k) => k.includes('prompt-backups/claude-'));
    expect(backups).toHaveLength(1);
    expect(fs.files.get(backups[0])).toBe('旧提示词内容');
    const lib = JSON.parse(fs.files.get(`${HOME}/.ai-baogongtou/prompts.json`) ?? '{}');
    expect(lib.active.claude).toBe('p1');

    // 再应用一次：内容一致（归一化比较）不应产生第二份备份（#5）
    const report2 = await applyProfile(makeProfile({ prompts: { claude: 'p1' } }), fs);
    expect(report2.errors).toEqual([]);
    const backups2 = [...fs.files.keys()].filter((k) => k.includes('prompt-backups/claude-'));
    expect(backups2).toHaveLength(1);
  });
});
