import { describe, expect, it } from 'vitest';
import {
  emptyRulesLibrary,
  normalizeRule,
  parseRulesLibrary,
  ruleCentralFileName,
  ruleTargetFiles,
  serializeRulesLibrary,
  type RuleEntry,
} from '../rules';

const base: RuleEntry = {
  id: 'r1',
  name: '默认规则',
  content: '# hi\n',
  tags: ['a'],
  description: '',
  agents: { claude: true, cursor: false },
  versions: [],
  syncs: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('rules 纯逻辑', () => {
  it('normalizeRule 过滤非法 agent key 与非布尔值', () => {
    const r = normalizeRule({
      ...base,
      agents: { claude: true, 'bad-key!': true, codex: 'yes' as never },
    });
    expect(r.agents).toEqual({ claude: true });
  });

  it('parse/serialize round-trip', () => {
    const lib = { version: 1, rules: [base] };
    const back = parseRulesLibrary(serializeRulesLibrary(lib));
    expect(back.rules).toHaveLength(1);
    expect(back.rules[0].id).toBe('r1');
    expect(back.rules[0].agents.claude).toBe(true);
  });

  it('parseRulesLibrary 拒绝坏 JSON / 坏结构', () => {
    expect(() => parseRulesLibrary('{broken')).toThrow();
    expect(() => parseRulesLibrary('{"version":1}')).toThrow();
  });

  it('ruleCentralFileName 清洗非法字符', () => {
    expect(ruleCentralFileName('a/b\\c d')).toBe('a-b-c-d.md');
    expect(ruleCentralFileName('ok_id-1')).toBe('ok_id-1.md');
  });

  it('ruleTargetFiles 只含可写 agent，且反映勾选状态', () => {
    const targets = ruleTargetFiles(base);
    expect(targets.length).toBeGreaterThan(0);
    // cursor 不可写（全局规则不落盘），不应出现在目标里
    expect(targets.find((t) => t.agent === 'cursor')).toBeUndefined();
    const claude = targets.find((t) => t.agent === 'claude');
    expect(claude?.enabled).toBe(true);
    expect(claude?.file).toBe('.claude/CLAUDE.md');
  });

  it('emptyRulesLibrary 结构正确', () => {
    expect(emptyRulesLibrary()).toEqual({ version: 1, rules: [] });
  });
});
