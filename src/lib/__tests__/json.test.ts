import { describe, expect, it } from 'vitest';
import {
  buildJsonTree,
  escapeJson,
  escapeRawControlChars,
  formatJson,
  minifyJson,
  parseJson,
  parseJsonTolerant,
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

  it('keepEscape：非 ASCII 输出为 \\uXXXX 转义', () => {
    const src = '{"name":"中文","emoji":"😀","plain":"abc"}';
    const r = formatJson(src, 2, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('\\u4e2d\\u6587');
    expect(r.text).toContain('\\ud83d\\ude00'); // emoji 代理对
    expect(r.text).toContain('"plain"');
    // 转义结果仍可被 JSON.parse 还原
    expect(JSON.parse(r.text)).toEqual(JSON.parse(src));
    // 压缩同样支持
    const m = minifyJson(src, true);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.text).not.toContain('中');
      expect(JSON.parse(m.text)).toEqual(JSON.parse(src));
    }
  });

  it('不保留转义（默认）：\\n/\\t/\\uXXXX 解码为真实字符', () => {
    const src = '{"a":"line1\\nline2\\t制表","b":"\\u4e2d\\u6587","c":"保持\\\\n和\\\"引号\\\""}';
    const r = formatJson(src, 2, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // \n 变成真实换行
    expect(r.text).toContain('line1\nline2');
    // \t 变成真实制表符
    expect(r.text).toContain('\t制表');
    // \uXXXX 解码为中文
    expect(r.text).toContain('"b": "中文"');
    // \\ 和 \" 保持转义，结构不破坏
    expect(r.text).toContain('保持\\\\n和\\\"引号\\\"');
    // 压缩同样解码
    const m = minifyJson(src, false);
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.text).toContain('line1\nline2');
  });

  it('非法输入返回错误', () => {
    expect(formatJson('{bad').ok).toBe(false);
    expect(minifyJson('{bad').ok).toBe(false);
  });
});

describe('parseJsonTolerant / escapeRawControlChars', () => {
  it('字符串内含真实换行的「原文显示态」也能解析', () => {
    const decoded = '{\n  "a": "line1\nline2"\n}';
    expect(parseJson(decoded).ok).toBe(false); // 严格模式报错
    const r = parseJsonTolerant(decoded);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 'line1\nline2' });
  });

  it('转义/解码显示可自由互切且无损', () => {
    const src = '{"msg":"你好\\n世界","q":"他说\\"嗨\\""}';
    const esc = formatJson(src, 2, true);
    expect(esc.ok).toBe(true);
    if (!esc.ok) return;
    expect(esc.text).toContain('\\u4f60\\u597d');
    const dec = formatJson(esc.text, 2, false);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.text).toContain('你好\n世界'); // 解码后是真换行
    // 再切回转义显示，值不变
    const back = formatJson(dec.text, 2, true);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(JSON.parse(back.text)).toEqual(JSON.parse(src));
    }
  });

  it('escapeRawControlChars 不动字符串外的换行', () => {
    const text = '{\n  "a": "x\ny"\n}';
    const out = escapeRawControlChars(text);
    expect(out).toBe('{\n  "a": "x\\ny"\n}');
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
