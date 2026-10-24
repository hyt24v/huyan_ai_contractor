import { describe, expect, it } from 'vitest';
import type { FsPort, DirItem } from '../lib/fsPort';
import type { CatalogSkill } from '../lib/skillCatalog';
import {
  isTextFileName,
  listSkillFiles,
  readSkillFileText,
  skillDirOf,
} from './skillCatalog';

/** 内存 FsPort mock:只实现本测试用到的字段 */
function mockFs(tree: Record<string, DirItem[]>, texts: Record<string, string>): FsPort {
  return {
    readText: async (p: string) => {
      if (!(p in texts)) throw new Error(`ENOENT: ${p}`);
      return texts[p];
    },
    readDir: async (p: string) => tree[p] ?? [],
    exists: async (p: string) => p in tree || p in texts,
  } as unknown as FsPort;
}

function skillWithLibrary(path?: string): CatalogSkill {
  return {
    name: 'demo',
    tags: [],
    source: 'local',
    inLibrary: !!path,
    agents: { claude: 'none', codex: 'none', pi: 'none', cursor: 'none', gemini: 'none' },
    agentPaths: {},
    ...(path ? { libraryPath: path } : {}),
  };
}

describe('skillDirOf', () => {
  it('优先中央库路径', () => {
    const s = skillWithLibrary('/lib/demo');
    s.agentPaths = { claude: '/agent/demo' };
    expect(skillDirOf(s)).toBe('/lib/demo');
  });
  it('无中央库时用任一 agent 本地副本', () => {
    const s = skillWithLibrary(undefined);
    s.agentPaths = { claude: '/agent/demo' };
    expect(skillDirOf(s)).toBe('/agent/demo');
  });
  it('都不在返回 null', () => {
    expect(skillDirOf(skillWithLibrary(undefined))).toBeNull();
  });
});

describe('listSkillFiles', () => {
  it('递归列出文件,目录在前并跳过 .git', async () => {
    const fs = mockFs({
      '/lib/demo': [
        { name: '.git', isDirectory: true, isSymlink: false },
        { name: 'scripts', isDirectory: true, isSymlink: false },
        { name: 'SKILL.md', isDirectory: false, isSymlink: false },
      ],
      '/lib/demo/scripts': [{ name: 'run.sh', isDirectory: false, isSymlink: false }],
    }, {});
    const list = await listSkillFiles(skillWithLibrary('/lib/demo'), fs);
    expect(list.map((f) => f.path)).toEqual(['scripts/', 'scripts/run.sh', 'SKILL.md']);
    expect(list.find((f) => f.path === 'scripts/')?.isDirectory).toBe(true);
  });

  it('目录读取失败降级为空,不抛错', async () => {
    const fs = mockFs({}, {});
    const list = await listSkillFiles(skillWithLibrary('/missing'), fs);
    expect(list).toEqual([]);
  });
});

describe('isTextFileName', () => {
  it('常见文本扩展名', () => {
    expect(isTextFileName('SKILL.md')).toBe(true);
    expect(isTextFileName('a/b/config.yaml')).toBe(true);
    expect(isTextFileName('run.sh')).toBe(true);
  });
  it('无扩展名视为文本(LICENSE 等)', () => {
    expect(isTextFileName('LICENSE')).toBe(true);
  });
  it('二进制扩展名不是文本', () => {
    expect(isTextFileName('logo.png')).toBe(false);
    expect(isTextFileName('bin.zip')).toBe(false);
  });
});

describe('readSkillFileText', () => {
  it('读取文本文件', async () => {
    const fs = mockFs({}, { '/lib/demo/SKILL.md': '# Demo' });
    await expect(
      readSkillFileText(skillWithLibrary('/lib/demo'), 'SKILL.md', fs),
    ).resolves.toBe('# Demo');
  });
  it('非文本文件拒绝', async () => {
    const fs = mockFs({}, {});
    await expect(
      readSkillFileText(skillWithLibrary('/lib/demo'), 'logo.png', fs),
    ).rejects.toThrow('不支持预览');
  });
});
