import { describe, expect, it } from 'vitest';
import {
  auditSkills,
  auditScore,
  metaKey,
  MIN_DESCRIPTION_LENGTH,
  type AuditSnapshot,
  type SkillMeta,
  type SymlinkTargetMap,
} from './skillAudit';

const LONG_DESC = '这是一段足够长的 skill 描述文本';
const GOOD_CONTENT = `---\nname: alpha\ndescription: ${LONG_DESC}\n---\n# alpha\n`;

const snapshot = (over: Partial<AuditSnapshot> = {}): AuditSnapshot => ({
  libraryAbs: '/home/u/ai-skills',
  librarySkills: [],
  scans: [],
  ...over,
});

const meta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
  dirExists: true,
  skillMdExists: true,
  readable: true,
  fileCount: 2,
  content: GOOD_CONTENT,
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('auditSkills', () => {
  it('干净库零问题、满分', () => {
    const report = auditSkills(
      snapshot({ librarySkills: ['alpha'] }),
      { [metaKey('library', 'alpha')]: meta() },
      {},
    );
    expect(report.issues).toEqual([]);
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(report.score).toBe(100);
  });

  it('库内 skill 目录缺失报 error', () => {
    const report = auditSkills(
      snapshot({ librarySkills: ['ghost'] }),
      { [metaKey('library', 'ghost')]: meta({ dirExists: false, fileCount: 0 }) },
      {},
    );
    expect(codes(report.issues)).toContain('library-missing-on-disk');
    expect(report.counts.error).toBe(1);
    expect(report.score).toBe(88);
  });

  it('缺 SKILL.md + 空目录', () => {
    const report = auditSkills(
      snapshot({ librarySkills: ['alpha'] }),
      {
        [metaKey('library', 'alpha')]: meta({
          skillMdExists: false,
          readable: false,
          fileCount: 0,
          content: undefined,
        }),
      },
      {},
    );
    expect(codes(report.issues)).toEqual(
      expect.arrayContaining(['empty-skill-dir', 'missing-skill-md']),
    );
    // 没有 SKILL.md 时不再重复报 description 问题
    expect(codes(report.issues)).not.toContain('missing-description');
  });

  it('不可读的 SKILL.md 报 unreadable', () => {
    const report = auditSkills(
      snapshot({ librarySkills: ['alpha'] }),
      { [metaKey('library', 'alpha')]: meta({ readable: false, content: undefined }) },
      {},
    );
    expect(codes(report.issues)).toContain('unreadable-skill-md');
  });

  it('frontmatter 未闭合与缺失分别判定', () => {
    const invalid = auditSkills(
      snapshot({ librarySkills: ['alpha'] }),
      {
        [metaKey('library', 'alpha')]: meta({
          content: '---\nname: alpha\ndescription: 描述描述描述描述描述\n# 没有结束',
        }),
      },
      {},
    );
    expect(codes(invalid.issues)).toContain('invalid-frontmatter');
    expect(invalid.issues[0].severity).toBe('error');

    const missing = auditSkills(
      snapshot({ librarySkills: ['beta'] }),
      { [metaKey('library', 'beta')]: meta({ content: '# 只有正文' }) },
      {},
    );
    expect(codes(missing.issues)).toContain('missing-frontmatter');
    expect(codes(missing.issues)).not.toContain('missing-description');
  });

  it('description 缺失或过短报 warning', () => {
    const missing = auditSkills(
      snapshot({ librarySkills: ['alpha'] }),
      {
        [metaKey('library', 'alpha')]: meta({
          content: '---\nname: alpha\n---\n# alpha\n',
        }),
      },
      {},
    );
    expect(codes(missing.issues)).toContain('missing-description');

    const short = auditSkills(
      snapshot({ librarySkills: ['beta'] }),
      {
        [metaKey('library', 'beta')]: meta({
          content: '---\nname: beta\ndescription: 太短\n---\n# beta\n',
        }),
      },
      {},
    );
    const issue = short.issues.find((i) => i.code === 'short-description');
    expect(issue).toBeDefined();
    expect(issue?.detail).toContain(String(MIN_DESCRIPTION_LENGTH));
  });

  it('同名本地 skill 出现在多个 agent', () => {
    const report = auditSkills(
      snapshot({
        scans: [
          { agent: 'claude', dirExists: true, skills: [{ name: 'dup', kind: 'local' }] },
          { agent: 'pi', dirExists: true, skills: [{ name: 'dup', kind: 'local' }] },
        ],
      }),
      {
        [metaKey('claude', 'dup')]: meta(),
        [metaKey('pi', 'dup')]: meta(),
      },
      {},
    );
    const issue = report.issues.find((i) => i.code === 'duplicate-name-across-agents');
    expect(issue?.severity).toBe('warning');
    expect(issue?.detail).toContain('claude');
    expect(issue?.detail).toContain('pi');
    expect(
      report.issues.filter((i) => i.code === 'duplicate-name-across-agents'),
    ).toHaveLength(1);
  });

  it('库与本地同名提示重复', () => {
    const report = auditSkills(
      snapshot({
        librarySkills: ['alpha'],
        scans: [{ agent: 'claude', dirExists: true, skills: [{ name: 'alpha', kind: 'local' }] }],
      }),
      {
        [metaKey('library', 'alpha')]: meta(),
        [metaKey('claude', 'alpha')]: meta(),
      },
      {},
    );
    const issue = report.issues.find((i) => i.code === 'duplicate-library-local');
    expect(issue?.agent).toBe('claude');
  });

  it('软链目标正常 / 出库 / 不可读 / 库内目标丢失', () => {
    const base = snapshot({
      librarySkills: ['alpha'],
      scans: [{ agent: 'claude', dirExists: true, skills: [{ name: 'alpha', kind: 'linked' }] }],
    });
    const good: SymlinkTargetMap = {
      [metaKey('claude', 'alpha')]: { target: '/home/u/ai-skills/alpha' },
    };
    const goodLibraryMeta = { [metaKey('library', 'alpha')]: meta() };
    expect(auditSkills(base, goodLibraryMeta, good).issues).toEqual([]);

    const missingTarget: SymlinkTargetMap = {
      [metaKey('claude', 'alpha')]: { target: '/home/u/ai-skills/gone' },
    };
    const missingReport = auditSkills(base, goodLibraryMeta, missingTarget);
    expect(codes(missingReport.issues)).toContain('broken-symlink');
    expect(missingReport.counts.error).toBe(1);

    const outside: SymlinkTargetMap = {
      [metaKey('claude', 'alpha')]: { target: '/tmp/alpha' },
    };
    const outsideReport = auditSkills(base, goodLibraryMeta, outside);
    expect(codes(outsideReport.issues)).toContain('symlink-outside-library');
    expect(outsideReport.issues[0].severity).toBe('warning');

    const broken: SymlinkTargetMap = {
      [metaKey('claude', 'alpha')]: { error: 'No such file or directory' },
    };
    const brokenReport = auditSkills(base, goodLibraryMeta, broken);
    expect(codes(brokenReport.issues)).toContain('broken-symlink');
    expect(brokenReport.counts.error).toBe(1);
  });

  it('可疑内容聚合为一条并取最高严重级别', () => {
    const content = `---\nname: danger\ndescription: ${LONG_DESC}\n---\nrm -rf /tmp/x\neval("bad")\n`;
    const report = auditSkills(
      snapshot({ librarySkills: ['danger'] }),
      { [metaKey('library', 'danger')]: meta({ content }) },
      {},
    );
    const issues = report.issues.filter((i) => i.code === 'suspicious-content');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].detail).toContain('rm -rf');
    expect(issues[0].detail).toContain('eval');
  });

  it('score 按严重级别扣分并夹在 0-100', () => {
    expect(auditScore({ error: 0, warning: 0, info: 0 })).toBe(100);
    expect(auditScore({ error: 1, warning: 0, info: 0 })).toBe(88);
    expect(auditScore({ error: 0, warning: 1, info: 0 })).toBe(96);
    expect(auditScore({ error: 0, warning: 0, info: 1 })).toBe(99);
    expect(auditScore({ error: 50, warning: 50, info: 50 })).toBe(0);
  });

  it('问题按严重级别、skill 名稳定排序', () => {
    const report = auditSkills(
      snapshot({ librarySkills: ['b-missing', 'a-empty'] }),
      {
        [metaKey('library', 'b-missing')]: meta({ dirExists: false, fileCount: 0 }),
        [metaKey('library', 'a-empty')]: meta({ content: '# no frontmatter' }),
      },
      {},
    );
    expect(report.issues[0].severity).toBe('error');
    expect(report.issues[0].skill).toBe('b-missing');
    expect(report.issues[report.issues.length - 1].severity).toBe('warning');
  });
});