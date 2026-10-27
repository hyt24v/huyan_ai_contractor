// markdownUtils 单测：大纲提取（围栏/引用/Setext）、字数统计、HTML 导出消毒
import { describe, expect, it } from 'vitest';
import {
  countWords,
  extractOutline,
  markdownToHtmlDoc,
} from './markdownUtils';

describe('extractOutline', () => {
  it('提取 ATX 标题及层级', () => {
    const md = '# 一级\n\n## 二级\n\n正文\n\n### 三级\n';
    expect(extractOutline(md)).toEqual([
      { level: 1, text: '一级', line: 0 },
      { level: 2, text: '二级', line: 2 },
      { level: 3, text: '三级', line: 6 },
    ]);
  });

  it('跳过代码围栏内的 # 行（``` 和 ~~~）', () => {
    const md = '# 真标题\n\n```js\n# 假标题\n```\n\n~~~\n# 也假\n~~~\n\n## 第二个\n';
    const outline = extractOutline(md);
    expect(outline.map((o) => o.text)).toEqual(['真标题', '第二个']);
  });

  it('四反引号围栏内的三反引号行不会误闭合', () => {
    const md = '````\n```\n# 还在围栏里\n````\n# 真标题\n';
    const outline = extractOutline(md);
    expect(outline).toEqual([{ level: 1, text: '真标题', line: 4 }]);
  });

  it('缩进 ≥4 空格的 ``` 是缩进代码块，不作为围栏开关', () => {
    // 该行按 CommonMark 不是围栏；其后的 # 标题仍应被提取
    const md = '    ```\n# 标题\n';
    const outline = extractOutline(md);
    expect(outline).toEqual([{ level: 1, text: '标题', line: 1 }]);
  });

  it('未闭合围栏吞到文末，其后标题不提取（CommonMark 语义）', () => {
    const md = '# 之前\n\n```\n# 被吞掉\n';
    expect(extractOutline(md).map((o) => o.text)).toEqual(['之前']);
  });

  it('识别引用块内的标题，顺序与渲染 DOM 一致', () => {
    const md = '> # 引用标题\n\n# 正文标题\n\n## 小结\n';
    const outline = extractOutline(md);
    expect(outline.map((o) => [o.level, o.text])).toEqual([
      [1, '引用标题'],
      [1, '正文标题'],
      [2, '小结'],
    ]);
  });

  it('识别 Setext 标题（=== 为 h1，--- 为 h2）', () => {
    const md = '主标题\n===\n\n次标题\n---\n\n# ATX\n';
    const outline = extractOutline(md);
    expect(outline.map((o) => [o.level, o.text, o.line])).toEqual([
      [1, '主标题', 0],
      [2, '次标题', 3],
      [1, 'ATX', 6],
    ]);
  });
});

describe('countWords', () => {
  it('CJK 标点（，。！？）计入字数', () => {
    // 4 个汉字 + ，！ 2 个标点 + hello 1 词 = 7
    expect(countWords('你好，世界！hello').words).toBe(7);
  });

  it('引用式链接定义行的 URL 不计入西文单词', () => {
    const md = '[ref]: https://example.com/a/b\n\nhello [文本][ref]\n';
    // hello(1 词) + 文本(2 字) = 3；URL 不计（旧行为会把 URL 拆成 5 个西文词）
    expect(countWords(md).words).toBe(3);
  });

  it('忽略代码块、图片和行内代码', () => {
    const md = '正文\n\n```\ncode words here\n```\n\n![alt](https://x.com/a.png) `inline`\n';
    expect(countWords(md).words).toBe(2);
  });

  it('空文本 words 为 0，minutes 为 0', () => {
    expect(countWords('')).toEqual({ words: 0, chars: 0, minutes: 0 });
  });
});

describe('markdownToHtmlDoc', () => {
  it('消毒 <script> 与 on* 事件属性（存储型 XSS 回归）', () => {
    const html = markdownToHtmlDoc(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(2)');
  });

  it('消毒 javascript: 链接协议', () => {
    const html = markdownToHtmlDoc('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('保留正常 markdown 渲染产物', () => {
    const html = markdownToHtmlDoc('**加粗** 和 `code`');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('标题转义进 <title>', () => {
    const html = markdownToHtmlDoc('x', '<img onerror=alert(1)>');
    expect(html).toContain('<title>&lt;img onerror=alert(1)&gt;</title>');
  });
});
