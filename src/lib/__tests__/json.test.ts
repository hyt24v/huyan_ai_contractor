import { describe, expect, it } from 'vitest';
import {
  buildJsonTree,
  escapeJson,
  formatJson,
  minifyJson,
  parseJson,
  positionToLineCol,
  unicodeToChinese,
  unescapeJson,
} from '../json';

describe('parseJson', () => {
  it('解析合法 JSON', () => {
    const r = parseJson('{"a": 1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('非法 JSON 返回带行列号的错误', () => {
    const text = '{\n  "a": 1,\n  bad\n}';
    const r = parseJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBeTruthy();
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBeGreaterThan(0);
    }
  });

  it('空字符串报错但不崩溃', () => {
    const r = parseJson('');
    expect(r.ok).toBe(false);
  });
});

describe('positionToLineCol', () => {
  it('计算行列号', () => {
    const text = 'ab\ncd\nef';
    expect(positionToLineCol(text, 0)).toEqual({ line: 1, column: 1 });
    expect(positionToLineCol(text, 2)).toEqual({ line: 1, column: 3 });
    expect(positionToLineCol(text, 3)).toEqual({ line: 2, column: 1 });
    expect(positionToLineCol(text, 6)).toEqual({ line: 3, column: 1 });
  });
});

describe('formatJson / minifyJson', () => {
  it('格式化', () => {
    const r = formatJson('{"a":1,"b":[2,3]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it('压缩', () => {
    const r = minifyJson('{ "a": 1, "b": [2, 3] }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('{"a":1,"b":[2,3]}');
  });

  it('格式化再压缩往返一致', () => {
    const original = '{"x":[1,2,{"y":"z"}]}';
    const f = formatJson(original);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const m = minifyJson(f.text);
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.text).toBe(original);
  });

  it('非法输入返回错误', () => {
    expect(formatJson('{bad').ok).toBe(false);
    expect(minifyJson('{bad').ok).toBe(false);
  });
});

describe('escapeJson / unescapeJson', () => {
  it('互逆', () => {
    const original = '{"a": "中文\t换行\n"}';
    const e = escapeJson(original);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.text).not.toContain('\n');
    const u = unescapeJson(e.text);
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.text).toBe(original);
  });

  it('unescape 非法输入报错', () => {
    expect(unescapeJson('abc\\q').ok).toBe(false);
  });
});

describe('unicodeToChinese', () => {
  it('解码 \\uXXXX', () => {
    expect(unicodeToChinese('\\u4f60\\u597d')).toBe('你好');
    expect(unicodeToChinese('abc\\u4e2d def')).toBe('abc中 def');
    expect(unicodeToChinese('没有转义')).toBe('没有转义');
  });
});

describe('buildJsonTree', () => {
  it('构建路径与类型', () => {
    const tree = buildJsonTree({ a: { b: [{ c: 1 }] }, 'x y': true });
    expect(tree.type).toBe('object');
    expect(tree.childCount).toBe(2);
    const a = tree.children!.find((n) => n.key === 'a')!;
    expect(a.path).toBe('a');
    const b = a.children![0];
    expect(b.path).toBe('a.b');
    const idx0 = b.children![0];
    expect(idx0.path).toBe('a.b[0]');
    const c = idx0.children![0];
    expect(c.path).toBe('a.b[0].c');
    expect(c.type).toBe('number');
    const xy = tree.children!.find((n) => n.key === 'x y')!;
    expect(xy.path).toBe('["x y"]');
    expect(xy.type).toBe('boolean');
  });

  it('数组根', () => {
    const tree = buildJsonTree([1, 'two', null]);
    expect(tree.type).toBe('array');
    expect(tree.childCount).toBe(3);
    expect(tree.children![2].type).toBe('null');
  });
});
