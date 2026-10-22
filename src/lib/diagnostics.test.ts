import { describe, expect, it } from 'vitest';
import { AGENTS } from './agents';
import {
  analyzeHealth,
  commandIsPathLike,
  gradeForScore,
  type AgentHealthInput,
  type DiagnosticsInput,
  type SkillHealthEntry,
} from './diagnostics';

function baseInput(over: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    skills: {
      librarySkills: [],
      scans: AGENTS.map((a) => ({ agent: a.id, dirExists: true, skills: [] })),
    },
    mcp: { manifest: { servers: [] }, perAgent: {} },
    agentHealth: AGENTS.map(
      (a): AgentHealthInput => ({ agent: a.id, configExists: true, configParsable: true }),
    ),
    skillEntries: [],
    missingCommands: [],
    backups: { enabled: true, count: 0 },
    ...over,
  };
}

const skillEntry = (over: Partial<SkillHealthEntry> = {}): SkillHealthEntry => ({
  name: 'demo',
  scope: 'agent',
  agent: 'claude',
  kind: 'local',
  hasSkillMd: true,
  description: '演示用',
  ...over,
});

const ids = (input: DiagnosticsInput): string[] =>
  analyzeHealth(input).issues.map((i) => i.id);

describe('analyzeHealth 基础', () => {
  it('全部健康时 100 分、A 级、无问题', () => {
    const report = analyzeHealth(baseInput());
    expect(report.issues).toEqual([]);
    expect(report.score).toBe(100);
    expect(report.grade).toBe('A');
    expect(report.agents).toHaveLength(AGENTS.length);
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 });
  });

  it('按 error/warning/info 的权重扣分并给出等级', () => {
    const report = analyzeHealth(
      baseInput({
        skillsError: '读盘失败',
        skillEntries: [
          skillEntry({ scope: 'library', agent: undefined, kind: 'local', hasSkillMd: false }),
        ],
      }),
    );
    // 1 error(扫描失败) + 1 error(库缺 SKILL.md)
    expect(report.counts.error).toBe(2);
    expect(report.score).toBe(70);
    expect(report.grade).toBe('C');
  });

  it('分数下限为 0', () => {
    const entries: SkillHealthEntry[] = Array.from({ length: 12 }, (_, i) =>
      skillEntry({ name: `s${i}`, scope: 'library', agent: undefined, kind: 'local', hasSkillMd: false }),
    );
    const report = analyzeHealth(baseInput({ skillEntries: entries }));
    expect(report.score).toBe(0);
    expect(report.grade).toBe('F');
  });

  it('问题按严重程度排序', () => {
    const report = analyzeHealth(
      baseInput({
        skillsError: 'boom',
        skillEntries: [
          skillEntry({ name: 'a', hasSkillMd: true, description: '' }),
        ],
      }),
    );
    expect(report.issues[0].severity).toBe('error');
    expect(report.issues[report.issues.length - 1]?.severity).toBe('info');
  });
});

describe('skill 问题', () => {
  it('识别失效软链并跳过其 SKILL.md 检查', () => {
    const result = ids(
      baseInput({
        skillEntries: [
          skillEntry({ name: 'broken', kind: 'linked', broken: true, hasSkillMd: false }),
        ],
      }),
    );
    expect(result).toEqual(['skill-broken-link:skill:agent:claude:broken']);
  });

  it('识别指向中央库之外的软链', () => {
    const input = baseInput({
      skillEntries: [
        skillEntry({ name: 'out', kind: 'linked', outsideLibrary: true, hasSkillMd: true }),
      ],
    });
    expect(ids(input)).toEqual(['skill-outside-library:skill:agent:claude:out']);
  });

  it('库内 skill 缺 SKILL.md 是 error，本地缺是 warning', () => {
    const report = analyzeHealth(
      baseInput({
        skillEntries: [
          skillEntry({ name: 'lib', scope: 'library', agent: undefined, kind: 'local', hasSkillMd: false }),
          skillEntry({ name: 'local', hasSkillMd: false }),
        ],
      }),
    );
    const byId = new Map(report.issues.map((i) => [i.id, i]));
    expect(byId.get('skill-missing-md:skill:library:lib')?.severity).toBe('error');
    expect(byId.get('skill-missing-md:skill:agent:claude:local')?.severity).toBe('warning');
  });

  it('指向中央库的健康软链不重复报缺描述', () => {
    const result = ids(
      baseInput({
        skills: { librarySkills: ['demo'], scans: [{ agent: 'claude', dirExists: true, skills: [{ name: 'demo', kind: 'linked' }] }] },
        skillEntries: [
          skillEntry({ name: 'demo', scope: 'library', agent: undefined, kind: 'local', description: '' }),
          skillEntry({ name: 'demo', kind: 'linked', description: '' }),
        ],
      }),
    );
    // 只有中央库这一条 info，软链本身不重复
    expect(result.filter((id) => id.startsWith('skill-empty-description'))).toEqual([
      'skill-empty-description:skill:library:demo',
    ]);
  });

  it('识别中央库与 agent 本地同名、以及多个 agent 之间同名', () => {
    const result = ids(
      baseInput({
        skills: {
          librarySkills: ['dup'],
          scans: [
            { agent: 'claude', dirExists: true, skills: [{ name: 'dup', kind: 'local' }] },
            { agent: 'pi', dirExists: true, skills: [{ name: 'dup', kind: 'local' }] },
          ],
        },
        skillEntries: [
          skillEntry({ name: 'dup', scope: 'library', agent: undefined, kind: 'local' }),
          skillEntry({ name: 'dup' }),
          skillEntry({ name: 'dup', agent: 'pi' }),
        ],
      }),
    );
    expect(result).toContain('skill-dup-library:dup');
    expect(result).toContain('skill-dup-agents:dup');
  });

  it('未安装 skills 目录只提示 info', () => {
    const report = analyzeHealth(
      baseInput({
        skills: {
          librarySkills: [],
          scans: [{ agent: 'claude', dirExists: false, skills: [] }],
        },
      }),
    );
    expect(report.issues.map((i) => i.id)).toContain('skills-dir-missing:claude');
    expect(report.issues.find((i) => i.id === 'skills-dir-missing:claude')?.severity).toBe('info');
  });
});

describe('MCP 问题', () => {
  it('配置缺失是 info，解析失败是 error', () => {
    const report = analyzeHealth(
      baseInput({
        agentHealth: [
          { agent: 'claude', configExists: false, configParsable: true },
          { agent: 'pi', configExists: true, configParsable: false, configError: 'Unexpected token' },
        ],
      }),
    );
    const byId = new Map(report.issues.map((i) => [i.id, i]));
    expect(byId.get('agent-config-missing:claude')?.severity).toBe('info');
    expect(byId.get('agent-config-parse:pi')?.severity).toBe('error');
    expect(byId.get('agent-config-parse:pi')?.detail).toContain('Unexpected token');
  });

  it('中央清单损坏报 error', () => {
    const result = ids(baseInput({ mcpManifestError: 'Unexpected end of JSON input' }));
    expect(result).toContain('mcp-manifest-parse');
  });

  it('server 缺 command / url 报 warning', () => {
    const result = ids(
      baseInput({
        mcp: {
          manifest: {
            servers: [
              { name: 'no-cmd', type: 'stdio', agents: {} },
              { name: 'no-url', type: 'http', agents: {} },
            ],
          },
          perAgent: {},
        },
      }),
    );
    expect(result).toContain('mcp-no-command:no-cmd');
    expect(result).toContain('mcp-no-url:no-url');
  });

  it('路径型 command 不存在时报 warning', () => {
    const result = ids(
      baseInput({
        mcp: {
          manifest: {
            servers: [{ name: 'fs', type: 'stdio', command: '/opt/missing/mcp-server', agents: {} }],
          },
          perAgent: {},
        },
        missingCommands: [{ server: 'fs', command: '/opt/missing/mcp-server' }],
      }),
    );
    expect(result).toContain('mcp-missing-command:fs');
  });

  it('清单已勾选但配置缺失 → drift warning；配置本身缺失则不重复报', () => {
    const drifted = ids(
      baseInput({
        mcp: {
          manifest: { servers: [{ name: 'ctx7', type: 'stdio', command: 'npx', agents: { claude: true } }] },
          perAgent: { claude: [] },
        },
      }),
    );
    expect(drifted).toContain('mcp-drift:claude:ctx7');

    const missingConfig = ids(
      baseInput({
        mcp: {
          manifest: { servers: [{ name: 'ctx7', type: 'stdio', command: 'npx', agents: { claude: true } }] },
          perAgent: {},
        },
        agentHealth: [{ agent: 'claude', configExists: false, configParsable: true }],
      }),
    );
    expect(missingConfig).not.toContain('mcp-drift:claude:ctx7');
  });

  it('配置里存在但清单没有 → unmanaged info', () => {
    const result = ids(
      baseInput({
        mcp: { manifest: { servers: [] }, perAgent: { claude: ['legacy'] } },
      }),
    );
    expect(result).toEqual(['mcp-unmanaged:claude:legacy']);
  });
});

describe('辅助函数', () => {
  it('commandIsPathLike 只认路径形态', () => {
    expect(commandIsPathLike('/usr/local/bin/uvx')).toBe(true);
    expect(commandIsPathLike('~/bin/server')).toBe(true);
    expect(commandIsPathLike('./server')).toBe(true);
    expect(commandIsPathLike('npx')).toBe(false);
    expect(commandIsPathLike('  ')).toBe(false);
  });

  it('gradeForScore 分级', () => {
    expect(gradeForScore(100)).toBe('A');
    expect(gradeForScore(90)).toBe('A');
    expect(gradeForScore(89)).toBe('B');
    expect(gradeForScore(79)).toBe('C');
    expect(gradeForScore(60)).toBe('D');
    expect(gradeForScore(59)).toBe('F');
  });
});