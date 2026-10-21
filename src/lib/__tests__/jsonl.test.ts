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
  it('复制指定行', () => {
    expect(duplicateLine(text, 2)).toBe('l1\nl2\nl2\nl3');
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
