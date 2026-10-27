import { describe, expect, it } from 'vitest';
import { queryJsonPath, sortJsonKeys } from '../toolkit';

// 「不保留转义」显示态：字符串内含真实换行，严格 JSON.parse 会报 Bad control character，
// 但页面校验是宽容口径显示「合法」——排序/查询必须与校验口径一致（审核 #3）
const tolerantText = '{\n  "b": "line1\nline2",\n  "a": "中文"\n}';

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
