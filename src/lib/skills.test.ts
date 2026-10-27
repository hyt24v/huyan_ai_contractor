import { describe, expect, it } from 'vitest';
import {
  computeSkillMatrix,
  isValidSkillName,
  linkPointsToLibrary,
  parseGitTreeUrl,
  parseSkillMdMeta,
  projectSkillStatus,
  skillNameFromGitUrl,
} from './skills';

describe('computeSkillMatrix', () => {
  it('汇总库与各 agent 扫描，生成排序矩阵', () => {
    const rows = computeSkillMatrix(
      ['shared', 'lib-only'],
      [
        {
          agent: 'claude',
          dirExists: true,
          skills: [
            { name: 'shared', kind: 'linked' },
            { name: 'local-only', kind: 'local' },
          ],
        },
        { agent: 'pi', dirExists: true, skills: [{ name: 'shared', kind: 'local' }] },
      ],
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(rows.map((r) => r.name)).toEqual(['lib-only', 'local-only', 'shared']);
    expect(byName.get('shared')).toMatchObject({
      inLibrary: true,
      agents: { claude: 'linked', pi: 'local' },
    });
    expect(byName.get('local-only')).toMatchObject({
      inLibrary: false,
      agents: { claude: 'local', pi: 'none' },
    });
    expect(byName.get('lib-only')).toMatchObject({
      inLibrary: true,
      agents: { claude: 'none', pi: 'none' },
    });
  });
});

describe('projectSkillStatus', () => {
  it('软链指向中央库 = 与中心一致', () => {
    expect(projectSkillStatus(true, 'linked')).toBe('synced');
    // 中央库里没有但软链存在(异常情况)也算 synced,以软链为准
    expect(projectSkillStatus(false, 'linked')).toBe('synced');
  });
  it('真实目录且中央库无同名 = 仅项目', () => {
    expect(projectSkillStatus(false, 'local')).toBe('project-only');
  });
  it('真实目录且中央库有同名 = 分叉', () => {
    expect(projectSkillStatus(true, 'local')).toBe('diverged');
  });
  it('项目里不存在 = none', () => {
    expect(projectSkillStatus(true, 'none')).toBe('none');
    expect(projectSkillStatus(false, 'none')).toBe('none');
  });
});

describe('linkPointsToLibrary', () => {
  it('匹配库内路径', () => {
    expect(linkPointsToLibrary('/home/u/ai-skills/foo', '/home/u/ai-skills')).toBe(true);
    expect(linkPointsToLibrary('/home/u/ai-skills', '/home/u/ai-skills')).toBe(true);
    expect(linkPointsToLibrary('/home/u/ai-skillsx/foo', '/home/u/ai-skills')).toBe(false);
    expect(linkPointsToLibrary('/other/foo', '/home/u/ai-skills')).toBe(false);
  });
});

describe('parseSkillMdMeta', () => {
  it('解析 frontmatter', () => {
    const md = '---\nname: my-skill\ndescription: 干一件很酷的事\n---\n# body';
    expect(parseSkillMdMeta(md)).toEqual({
      name: 'my-skill',
      description: '干一件很酷的事',
    });
  });
  it('无 frontmatter 返回空', () => {
    expect(parseSkillMdMeta('# 只有正文')).toEqual({});
  });
});

describe('skillNameFromGitUrl', () => {
  it('从各种 URL 形式提取名字', () => {
    expect(skillNameFromGitUrl('https://github.com/a/b.git')).toBe('b');
    expect(skillNameFromGitUrl('https://github.com/a/b')).toBe('b');
    expect(skillNameFromGitUrl('https://github.com/a/b/tree/main/skills/my-skill')).toBe('my-skill');
    expect(skillNameFromGitUrl('')).toBeNull();
  });
});

describe('parseGitTreeUrl', () => {
  it('解析 /tree/<branch>/<subdir> 链接', () => {
    expect(parseGitTreeUrl('https://github.com/a/b/tree/main/skills/my-skill')).toEqual({
      repoUrl: 'https://github.com/a/b',
      subdir: 'skills/my-skill',
    });
    expect(parseGitTreeUrl('https://github.com/a/b')).toBeNull();
  });

  it('拒绝含 . / .. 路径段的子目录（防路径穿越）', () => {
    expect(parseGitTreeUrl('https://github.com/a/b/tree/main/../../.claude/skills/x')).toBeNull();
    expect(parseGitTreeUrl('https://github.com/a/b/tree/main/./skills/x')).toBeNull();
    expect(parseGitTreeUrl('https://github.com/a/b/tree/main/skills/../x')).toBeNull();
  });
});

describe('isValidSkillName', () => {
  it('接受常规名字', () => {
    expect(isValidSkillName('my-skill')).toBe(true);
    expect(isValidSkillName('skill_1.2')).toBe(true);
    expect(isValidSkillName('Skill')).toBe(true);
  });

  it('拒绝非法名字与路径段', () => {
    expect(isValidSkillName('')).toBe(false);
    expect(isValidSkillName('.')).toBe(false);
    expect(isValidSkillName('..')).toBe(false);
    expect(isValidSkillName('.hidden')).toBe(false);
    expect(isValidSkillName('-lead')).toBe(false);
    expect(isValidSkillName('a/b')).toBe(false);
    expect(isValidSkillName('a b')).toBe(false);
    expect(isValidSkillName('中文')).toBe(false);
  });
});
