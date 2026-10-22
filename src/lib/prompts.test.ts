import { describe, expect, it } from 'vitest';
import {
  activeForAgent,
  addPrompt,
  duplicatePrompt,
  emptyPromptLibrary,
  normalizeLibrary,
  parseLibrary,
  removePrompt,
  serializeLibrary,
  setActivePrompt,
  updatePrompt,
  usageCount,
  validatePromptDraft,
  type PromptLibrary,
} from './prompts';

const NOW = new Date('2026-10-22T08:00:00.000Z');

function libraryWith(...names: string[]): PromptLibrary {
  let lib = emptyPromptLibrary();
  names.forEach((name, i) => {
    lib = addPrompt(lib, { name, content: `# ${name}` }, { id: `p${i + 1}`, now: NOW })
      .library;
  });
  return lib;
}

describe('validatePromptDraft', () => {
  it('名称与内容都必填', () => {
    expect(validatePromptDraft({ name: '', content: '' }).errors).toEqual([
      '提示词名称不能为空',
      '提示词内容不能为空',
    ]);
    expect(validatePromptDraft({ name: '   ', content: '  \n ' }).ok).toBe(false);
    expect(validatePromptDraft({ name: 'a', content: 'b' }).ok).toBe(true);
  });
});

describe('addPrompt', () => {
  it('生成 id、裁剪名称、保留原文内容', () => {
    const { library, prompt } = addPrompt(
      emptyPromptLibrary(),
      { name: '  规范  ', content: '# Hello\n\n- 一\n' },
      { now: NOW },
    );
    expect(prompt.name).toBe('规范');
    expect(prompt.content).toBe('# Hello\n\n- 一\n');
    expect(prompt.updatedAt).toBe(NOW.toISOString());
    expect(prompt.id).toMatch(/^prompt_/);
    expect(library.prompts).toHaveLength(1);
  });

  it('空内容抛错', () => {
    expect(() =>
      addPrompt(emptyPromptLibrary(), { name: 'x', content: '   ' }),
    ).toThrow(/内容不能为空/);
  });
});

describe('updatePrompt', () => {
  it('只覆盖传入字段并刷新 updatedAt', () => {
    const lib = libraryWith('a');
    const later = new Date('2026-10-23T00:00:00.000Z');
    const next = updatePrompt(lib, 'p1', { content: '新内容' }, later);
    expect(next.prompts[0]).toMatchObject({
      id: 'p1',
      name: 'a',
      content: '新内容',
      updatedAt: later.toISOString(),
    });
    expect(lib.prompts[0].content).toBe('# a');
  });

  it('未知 id 或非法内容抛错', () => {
    const lib = libraryWith('a');
    expect(() => updatePrompt(lib, 'nope', { name: 'b' })).toThrow(/不存在/);
    expect(() => updatePrompt(lib, 'p1', { content: '' })).toThrow(/内容不能为空/);
  });
});

describe('removePrompt', () => {
  it('删除提示词并清理 active 引用', () => {
    const lib = setActivePrompt(libraryWith('a', 'b'), 'claude', 'p1');
    const next = removePrompt(lib, 'p1');
    expect(next.prompts.map((p) => p.id)).toEqual(['p2']);
    expect(next.active).toEqual({});
  });
});

describe('duplicatePrompt', () => {
  it('名称加副本并在重名时加序号', () => {
    const lib = libraryWith('a');
    const first = duplicatePrompt(lib, 'p1', { id: 'copy1', now: NOW });
    expect(first.prompt.name).toBe('a 副本');
    expect(first.prompt.content).toBe('# a');
    const second = duplicatePrompt(first.library, 'p1', { id: 'copy2', now: NOW });
    expect(second.prompt.name).toBe('a 副本 2');
    expect(() => duplicatePrompt(lib, 'nope')).toThrow(/不存在/);
  });
});

describe('activeForAgent / setActivePrompt', () => {
  it('按 agent 取启用的提示词', () => {
    const lib = setActivePrompt(libraryWith('a', 'b'), 'pi', 'p2');
    expect(activeForAgent(lib, 'pi')?.name).toBe('b');
    expect(activeForAgent(lib, 'claude')).toBeUndefined();
    expect(usageCount(lib, 'p2')).toBe(1);
  });

  it('传 null 清除，未知 id 抛错', () => {
    const lib = setActivePrompt(libraryWith('a'), 'codex', 'p1');
    expect(setActivePrompt(lib, 'codex', null).active).toEqual({});
    expect(() => setActivePrompt(lib, 'codex', 'missing')).toThrow(/不存在/);
  });

  it('active 指向已删除的 id 时视为未启用', () => {
    const lib: PromptLibrary = {
      prompts: [],
      active: { gemini: 'ghost' },
    };
    expect(activeForAgent(lib, 'gemini')).toBeUndefined();
  });
});

describe('serializeLibrary / parseLibrary', () => {
  it('往返保持内容与启用关系', () => {
    const lib = setActivePrompt(libraryWith('a', 'b'), 'cursor', 'p1');
    const parsed = parseLibrary(serializeLibrary(lib));
    expect(parsed).toEqual(lib);
  });

  it('空文本返回空库，非法 JSON 抛错', () => {
    expect(parseLibrary('   ')).toEqual(emptyPromptLibrary());
    expect(() => parseLibrary('{oops')).toThrow(/解析失败/);
  });

  it('跳过损坏条目、去重 id、丢弃未知 agent 与悬空 active', () => {
    const lib = normalizeLibrary({
      prompts: [
        { id: 'a', name: 'A', content: 'x', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a', name: '重复 id', content: 'y' },
        { id: 'b', name: '空内容', content: '   ' },
        { id: '', name: '无 id', content: 'z' },
        'not-an-object',
      ],
      active: { claude: 'a', pi: 'missing', unknown: 'a', gemini: 42 },
    });
    expect(lib.prompts.map((p) => p.id)).toEqual(['a']);
    expect(lib.active).toEqual({ claude: 'a' });
  });
});