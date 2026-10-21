import { describe, expect, it } from 'vitest';
import {
  detectMode,
  inferStringKind,
  queryJsonPath,
  repairText,
  sortJsonKeys,
} from './toolkit';

describe('detectMode', () => {
  it('整体可解析 → json', () => {
    expect(detectMode('{"a":1}')).toBe('json');
    expect(detectMode('[1,2,3]')).toBe('json');
    expect(detectMode('{"a":1,\n"b":2}')).toBe('json');
  });
  it('多行且每行是 JSON → jsonl', () => {
    expect(detectMode('{"a":1}\n{"b":2}')).toBe('jsonl');
    expect(detectMode('{"a":1}\n\n{"b":2}')).toBe('jsonl');
  });
  it('单行 JSON → json', () => {
    expect(detectMode('{"a":1}')).toBe('json');
  });
  it('都不可解析时兜底 json', () => {
    expect(detectMode('not json at all')).toBe('json');
    expect(detectMode('')).toBe('json');
  });
});

describe('repairText', () => {
  it('修复单引号和尾逗号', () => {
    const r = repairText("{'a':1,}", 'json');
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
  });
  it('jsonl 逐行修复（jsonrepair 会尽量修好坏行）', () => {
    const r = repairText("{'a':1}\n{bad", 'jsonl');
    const lines = r.text.split('\n');
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    // jsonrepair 激进修复：{bad → {"bad":null}
    expect(JSON.parse(lines[1])).toEqual({ bad: null });
  });
});

describe('sortJsonKeys', () => {
  it('递归排序对象 key，数组顺序不变', () => {
    const r = sortJsonKeys('{"b":1,"a":{"d":4,"c":3},"arr":[{"z":1,"y":2}]}', 'json');
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text)).toEqual({
      a: { c: 3, d: 4 },
      arr: [{ y: 2, z: 1 }],
      b: 1,
    });
    // 验证 key 顺序
    expect(Object.keys(JSON.parse(r.text))).toEqual(['a', 'arr', 'b']);
  });
  it('jsonl 每行排序', () => {
    const r = sortJsonKeys('{"b":1,"a":2}\n{"d":4,"c":3}', 'jsonl');
    expect(r.ok).toBe(true);
    const [l1, l2] = r.text.split('\n');
    expect(Object.keys(JSON.parse(l1))).toEqual(['a', 'b']);
    expect(Object.keys(JSON.parse(l2))).toEqual(['c', 'd']);
  });
});

describe('queryJsonPath', () => {
  it('json 基本查询', () => {
    const r = queryJsonPath('{"a":{"b":[1,2,3]}}', 'json', '$.a.b[1]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.count).toBe(1);
      expect(JSON.parse(r.text)).toBe(2);
    }
  });
  it('多结果包成数组', () => {
    const r = queryJsonPath('[{"x":1},{"x":2}]', 'json', '$[*].x');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.count).toBe(2);
      expect(JSON.parse(r.text)).toEqual([1, 2]);
    }
  });
  it('jsonl 按行组成数组查询', () => {
    const r = queryJsonPath('{"name":"a"}\n{"name":"b"}', 'jsonl', '$[*].name');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.text)).toEqual(['a', 'b']);
    }
  });
  it('表达式错误返回 error', () => {
    // jsonpath-plus 很宽容，'$[?(@.a===]' 是少数会抛错的写法
    const r = queryJsonPath('{"a":1}', 'json', '$[?(@.a===]');
    expect(r.ok).toBe(false);
  });
});

describe('inferStringKind', () => {
  it('识别 url/image/email/color/date', () => {
    expect(inferStringKind('https://example.com/a.png')).toBe('image');
    expect(inferStringKind('https://example.com')).toBe('url');
    expect(inferStringKind('a@b.com')).toBe('email');
    expect(inferStringKind('#ff6600')).toBe('color');
    expect(inferStringKind('2026-10-21')).toBe('date');
    expect(inferStringKind('hello')).toBeNull();
  });
});
