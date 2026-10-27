import { describe, expect, it } from 'vitest';
import { queryJsonPath, repairText, sortJsonKeys } from '../toolkit';

// 「不保留转义」显示态：字符串内含真实换行，严格 JSON.parse 会报 Bad control character，
// 但页面校验是宽容口径显示「合法」——排序/查询必须与校验口径一致（审核 #3）
const tolerantText = '{\n  "b": "line1\nline2",\n  "a": "中文"\n}';

describe('repairText JSONL 多行记录（审核 #2）', () => {
  it('合法的多行美化记录原样保留，不被逐行修复拆烂', () => {
    const text = '{\n  "a": 1\n}\n{"b":2}';
    const r = repairText(text, 'jsonl');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(text);
  });

  it('仅修复坏行，其余内容不动', () => {
    const text = '{"a":1}\n{b: 2}\n{"c":3}';
    const r = repairText(text, 'jsonl');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const lines = r.text.split('\n');
      expect(lines[0]).toBe('{"a":1}');
      expect(lines[2]).toBe('{"c":3}');
      // 坏行被修成可解析 JSON（jsonrepair 具体产出不做强断言）
      expect(() => JSON.parse(lines[1])).not.toThrow();
    }
  });

  it('jsonrepair 也修不了的行原样保留，整体返回 ok=false', () => {
    const r = repairText('{"a":1}\n{bad}', 'jsonl');
    expect(r.ok).toBe(false);
    expect(r.text).toBe('{"a":1}\n{bad}');
  });
});

describe('sortJsonKeys JSONL 多行记录（审核 #3）', () => {
  it('多行记录整体排序并统一为单行', () => {
    const r = sortJsonKeys('{\n  "b": 1,\n  "a": 2\n}', 'jsonl');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('{"a":2,"b":1}');
  });

  it('含无法解析行时返回明确错误信息且原样保留该行', () => {
    const r = sortJsonKeys('{"b":1,"a":2}\nnot json at all', 'jsonl');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.text).toBe('{"a":2,"b":1}\nnot json at all');
  });
});

describe('sortJsonKeys / queryJsonPath 宽容解析', () => {
  it('含真实换行的字符串也能排序', () => {
    const r = sortJsonKeys(tolerantText, 'json');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.indexOf('"a"')).toBeLessThan(r.text.indexOf('"b"'));
  });
  it('含真实换行的文档可查询', () => {
    const r = queryJsonPath(tolerantText, 'json', '$.a');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain('中文');
  });
});
