import { describe, expect, it } from 'vitest';
import {
  cellPreview,
  collectFields,
  deleteLine,
  duplicateLine,
  getByPath,
  jsonlStats,
  normalizeJsonl,
  parseJsonl,
  parseJsonlSmart,
  parseJsonRecords,
  prettifyJsonl,
} from '../jsonl';

describe('parseJsonl', () => {
  it('逐行解析混合输入', () => {
    const text = '{"a":1}\n\n{bad}\n[1,2]';
    const rs = parseJsonl(text);
    expect(rs).toHaveLength(4);
    expect(rs[0].ok).toBe(true);
    expect(rs[1].empty).toBe(true);
    expect(rs[2].ok).toBe(false);
    expect(rs[2].error).toBeTruthy();
    expect(rs[3].ok).toBe(true);
    expect(rs[3].value).toEqual([1, 2]);
  });

  it('空文本只有一行空行', () => {
    const rs = parseJsonl('');
    expect(rs).toHaveLength(1);
    expect(rs[0].empty).toBe(true);
  });

  it('大输入不抛异常', () => {
    const big = Array.from({ length: 20000 }, (_, i) => `{"i":${i}}`).join('\n');
    const rs = parseJsonl(big);
    expect(rs).toHaveLength(20000);
    expect(rs.every((r) => r.ok)).toBe(true);
  });
});

describe('parseJsonRecords', () => {
  it('切分多行美化 JSON 连写', () => {
    const text = '{\n  "a": 1\n}\n{\n  "b": [1, 2]\n}';
    const rs = parseJsonRecords(text);
    expect(rs).toHaveLength(2);
    expect(rs[0].ok).toBe(true);
    expect(rs[0].value).toEqual({ a: 1 });
    expect(rs[0].line).toBe(1);
    expect(rs[0].endLine).toBe(3);
    expect(rs[1].ok).toBe(true);
    expect(rs[1].value).toEqual({ b: [1, 2] });
    expect(rs[1].line).toBe(4);
    expect(rs[1].endLine).toBe(6);
  });

  it('字符串内的括号/转义不影响切分', () => {
    // 第一条：字符串含 }{（括号不应触发配平）；第二条：字符串含转义引号
    const text = '{"s":"}{"}\n{"t":"a\\"b"}';
    const rs = parseJsonRecords(text);
    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs[0].value).toEqual({ s: '}{' });
    expect(rs[1].value).toEqual({ t: 'a"b' });
  });

  it('错误片段记为错误记录并继续向后同步', () => {
    const text = '{"a":1}\n{bad}\n{"b":2}';
    const rs = parseJsonRecords(text);
    expect(rs).toHaveLength(3);
    expect(rs[0].ok).toBe(true);
    expect(rs[1].ok).toBe(false);
    expect(rs[1].error).toBeTruthy();
    expect(rs[2].ok).toBe(true);
  });

  it('未闭合的记录截到文末', () => {
    const rs = parseJsonRecords('{"a":1}\n{"b":');
    expect(rs).toHaveLength(2);
    expect(rs[1].ok).toBe(false);
  });
});

describe('parseJsonlSmart', () => {
  it('标准 JSONL 保持逐行语义（含空行与错误行）', () => {
    const rs = parseJsonlSmart('{"a":1}\n\n{bad}\n[1,2]');
    expect(rs).toHaveLength(4);
    expect(rs[1].empty).toBe(true);
    expect(rs[2].ok).toBe(false);
  });

  it('多行美化 JSON 连写切换为记录级结果', () => {
    const text = '{\n  "name": "a"\n}\n{\n  "name": "b"\n}';
    const rs = parseJsonlSmart(text);
    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs[0].value).toEqual({ name: 'a' });
    expect(rs[1].endLine).toBe(6);
  });

  it('单行 JSONL 个别坏行仍按行报错（不误判为记录模式）', () => {
    const rs = parseJsonlSmart('{"a":1}\n{bad}');
    expect(rs).toHaveLength(2);
    expect(rs[1].line).toBe(2);
    expect(rs[1].ok).toBe(false);
  });

  it('normalizeJsonl 兼容多行记录：规范化为单行 JSONL', () => {
    const text = '{\n  "b": 2,\n  "a": 1\n}\n{\n  "c": 3\n}';
    const r = normalizeJsonl(text);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{"b":2,"a":1}\n{"c":3}');
  });
});

describe('jsonlStats', () => {
  it('统计行数', () => {
    const rs = parseJsonl('{"a":1}\n\n{bad}\n{"b":2}');
    const s = jsonlStats(rs);
    expect(s).toEqual({ total: 4, empty: 1, errors: 1, valid: 2 });
  });
});

describe('normalizeJsonl', () => {
  it('规范化合法行并剔除空行', () => {
    const text = '{ "a" : 1 }\n\n{"b":  [2]}';
    const r = normalizeJsonl(text);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{"a":1}\n{"b":[2]}');
  });

  it('keepEmptyLines 保留空行', () => {
    const r = normalizeJsonl('{"a":1}\n\n{"b":2}', { keepEmptyLines: true });
    expect(r.text).toBe('{"a":1}\n\n{"b":2}');
  });

  it('非法行原样保留并记录错误', () => {
    const r = normalizeJsonl('{"a":1}\n{bad}');
    expect(r.ok).toBe(false);
    expect(r.text).toBe('{"a":1}\n{bad}');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
  });
});

describe('deleteLine / duplicateLine', () => {
  const text = 'l1\nl2\nl3';
  it('删除指定行', () => {
    expect(deleteLine(text, 2)).toBe('l1\nl3');
    expect(deleteLine(text, 99)).toBe(text);
  });
  it('删除多行记录（endLine）', () => {
    expect(deleteLine('a\nb\nc\nd', 2, 3)).toBe('a\nd');
  });
  it('复制指定行', () => {
    expect(duplicateLine(text, 2)).toBe('l1\nl2\nl2\nl3');
  });
  it('复制多行记录（endLine）', () => {
    expect(duplicateLine('a\nb\nc\nd', 2, 3)).toBe('a\nb\nc\nb\nc\nd');
  });
});

describe('collectFields', () => {
  it('取字段并集（含嵌套点路径）', () => {
    const rows = [
      { a: 1, addr: { city: 'hz' } },
      { b: 2, addr: { zip: '310000' } },
    ];
    const fields = collectFields(rows);
    expect(fields).toContain('a');
    expect(fields).toContain('b');
    expect(fields).toContain('addr');
    expect(fields).toContain('addr.city');
    expect(fields).toContain('addr.zip');
  });

  it('数组与非对象行不展开', () => {
    const fields = collectFields([[1, 2], 42, { a: [1] }]);
    expect(fields).toEqual(['a']);
  });
});

describe('getByPath', () => {
  it('按路径取值', () => {
    const obj = { a: { b: { c: 7 } }, list: [1] };
    expect(getByPath(obj, 'a.b.c')).toBe(7);
    expect(getByPath(obj, 'a.x')).toBeUndefined();
    expect(getByPath(null, 'a')).toBeUndefined();
  });
});

describe('cellPreview', () => {
  it('各类值摘要', () => {
    expect(cellPreview(undefined)).toBe('');
    expect(cellPreview(null)).toBe('null');
    expect(cellPreview('x'.repeat(100))).toHaveLength(61); // 60 + …
    expect(cellPreview({ a: 1 })).toBe('Object{1}');
    expect(cellPreview([1, 2])).toBe('Array(2)');
    expect(cellPreview(3.14)).toBe('3.14');
  });
});

describe('prettifyJsonl（审核 #7）', () => {
  it('逐条美化为多行，错误行原样保留', () => {
    const r = prettifyJsonl('{"a":1}\nNOT_JSON\n[1,2]');
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.text).toBe('{\n  "a": 1\n}\nNOT_JSON\n[\n  1,\n  2\n]');
  });
  it('已美化的多行记录幂等（≥2 条记录才走记录模式）', () => {
    const pretty = '{\n  "a": 1\n}\n{\n  "b": 2\n}';
    const r = prettifyJsonl(pretty);
    expect(r.ok).toBe(true);
    expect(r.text).toBe(pretty);
  });
});
