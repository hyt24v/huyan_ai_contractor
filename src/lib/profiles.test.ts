import { describe, expect, it } from 'vitest';
import {
  addProfile,
  duplicateProfile,
  emptyProfileStore,
  mergeProfileStores,
  normalizeProfile,
  normalizeProfileStore,
  parseProfiles,
  profileSummary,
  removeProfile,
  sanitizeStringList,
  serializeProfiles,
  summarizeProfile,
  updateProfile,
  validateProfileDraft,
  type Profile,
  type ProfileDraft,
  type ProfileStore,
} from './profiles';

const NOW = new Date('2026-10-22T08:00:00.000Z');

const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({
  name: '日常开发',
  description: '常用组合',
  skills: ['pdf', 'browser'],
  mcpServers: ['filesystem'],
  prompts: { claude: 'p1' },
  ...over,
});

function storeWith(): ProfileStore {
  const a = addProfile(emptyProfileStore(), draft(), { id: 'a', now: NOW });
  return addProfile(a.store, draft({ name: '写作' }), { id: 'b', now: NOW }).store;
}

describe('sanitizeStringList', () => {
  it('去空白、去空项、去重保序', () => {
    expect(sanitizeStringList([' b ', 'a', '', 'b', '  '])).toEqual(['b', 'a']);
  });
});

describe('validateProfileDraft', () => {
  it('名称必填且不能重名（编辑自身除外）', () => {
    const store = storeWith();
    expect(validateProfileDraft(draft({ name: '  ' })).errors).toEqual([
      '套餐名称不能为空',
    ]);
    expect(validateProfileDraft(draft(), store.profiles).ok).toBe(false);
    expect(validateProfileDraft(draft(), store.profiles, 'a').ok).toBe(true);
    expect(validateProfileDraft(draft({ name: '新套餐' }), store.profiles).ok).toBe(true);
  });
});

describe('addProfile', () => {
  it('规范化列表/prompts 并写入时间戳', () => {
    const { profile } = addProfile(
      emptyProfileStore(),
      draft({
        skills: [' pdf ', 'pdf', ''],
        mcpServers: [' filesystem '],
        prompts: { claude: ' p1 ', pi: '  ', gemini: 'p2' },
      }),
      { id: 'x', now: NOW },
    );
    expect(profile).toEqual({
      id: 'x',
      name: '日常开发',
      description: '常用组合',
      skills: ['pdf'],
      mcpServers: ['filesystem'],
      prompts: { claude: 'p1', gemini: 'p2' },
      providers: {},
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('空名称 / 重名抛错', () => {
    const store = storeWith();
    expect(() => addProfile(store, draft({ name: '' }))).toThrow(/名称不能为空/);
    expect(() => addProfile(store, draft())).toThrow(/同名套餐/);
  });
});

describe('updateProfile', () => {
  it('保留 createdAt，刷新 updatedAt', () => {
    const store = storeWith();
    const later = new Date('2026-10-25T00:00:00.000Z');
    const next = updateProfile(store, 'a', draft({ name: '改名' }), later);
    const p = next.profiles.find((x) => x.id === 'a')!;
    expect(p.name).toBe('改名');
    expect(p.createdAt).toBe(NOW.toISOString());
    expect(p.updatedAt).toBe(later.toISOString());
  });

  it('未知 id 抛错', () => {
    expect(() => updateProfile(storeWith(), 'nope', draft())).toThrow(/不存在/);
  });
});

describe('removeProfile', () => {
  it('按 id 删除', () => {
    const next = removeProfile(storeWith(), 'a');
    expect(next.profiles.map((p) => p.id)).toEqual(['b']);
  });
});

describe('duplicateProfile', () => {
  it('名称加副本，内容深拷贝', () => {
    const store = storeWith();
    const { store: next, profile } = duplicateProfile(store, 'a', {
      id: 'a-copy',
      now: NOW,
    });
    expect(profile.name).toBe('日常开发 副本');
    expect(profile.skills).toEqual(['pdf', 'browser']);
    profile.skills.push('mutated');
    expect(store.profiles[0].skills).toEqual(['pdf', 'browser']);
    expect(next.profiles).toHaveLength(3);
  });

  it('副本重名时继续加序号', () => {
    const store = storeWith();
    const first = duplicateProfile(store, 'a', { id: 'c1', now: NOW });
    const second = duplicateProfile(first.store, 'a', { id: 'c2', now: NOW });
    expect(second.profile.name).toBe('日常开发 副本 2');
  });
});

describe('summary', () => {
  it('统计 skills / MCP / 提示词数量', () => {
    const p = storeWith().profiles[0];
    expect(profileSummary(p)).toEqual({ skills: 2, mcpServers: 1, prompts: 1, providers: 0 });
    expect(summarizeProfile(p)).toBe('2 个 Skill · 1 个 MCP · 1 个提示词 · 0 个模型服务');
  });
});

describe('normalize / serialize / parse', () => {
  it('往返保持数据', () => {
    const store = storeWith();
    expect(parseProfiles(serializeProfiles(store))).toEqual(store);
  });

  it('空文本返回空 store，非法 JSON 抛错', () => {
    expect(parseProfiles('')).toEqual(emptyProfileStore());
    expect(() => parseProfiles('nope')).toThrow(/解析失败/);
  });

  it('跳过坏条目并修复重复 id', () => {
    const store = normalizeProfileStore({
      profiles: [
        { id: 'dup', name: 'A', skills: ['x'], mcpServers: [], prompts: {} },
        { id: 'dup', name: 'B', skills: [], mcpServers: [], prompts: {} },
        { name: '' },
        null,
      ],
    });
    expect(store.profiles).toHaveLength(2);
    expect(store.profiles[0].id).toBe('dup');
    expect(store.profiles[1].id).not.toBe('dup');
    expect(store.profiles[1].id).toMatch(/^profile_/);
  });

  it('normalizeProfile 缺 id 时生成，缺名称返回 null', () => {
    const p = normalizeProfile({ name: 'X', skills: 'bad', prompts: { nope: 'p' } });
    expect(p?.id).toMatch(/^profile_/);
    expect(p?.skills).toEqual([]);
    expect(p?.prompts).toEqual({});
    expect(normalizeProfile({ id: 'x' })).toBeNull();
  });
});

describe('mergeProfileStores', () => {
  it('追加导入，id 冲突重新生成、名称冲突加序号', () => {
    const base = storeWith();
    const incoming: ProfileStore = {
      profiles: [
        {
          id: 'a',
          name: '日常开发',
          skills: ['new'],
          mcpServers: [],
          prompts: {},
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      ],
    };
    const { store, added } = mergeProfileStores(base, incoming, NOW);
    expect(store.profiles).toHaveLength(3);
    expect(added).toHaveLength(1);
    expect(added[0].id).not.toBe('a');
    expect(added[0].name).toBe('日常开发 2');
    expect(store.profiles[0].skills).toEqual(['pdf', 'browser']);
    const imported: Profile = store.profiles[2];
    expect(imported.updatedAt).toBe(NOW.toISOString());
  });
});