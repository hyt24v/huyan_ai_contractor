// Markdown 编辑器工具函数：大纲提取、字数统计、HTML 导出
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export interface OutlineItem {
  level: number; // 1-6
  text: string;
  line: number; // 0-based 源码行号
}

/**
 * 从 markdown 源码提取标题大纲，口径与渲染端（Crepe/remark，CommonMark）对齐，
 * 保证「大纲第 N 项」与预览 DOM 中「第 N 个标题」一一对应：
 * - 代码围栏：``` / ~~~，缩进 ≤3 空格才算围栏（≥4 空格是缩进代码块）；
 *   闭合围栏需同字符且长度 ≥ 开口（如 ```` 内可含 ``` 行）；
 *   未闭合围栏按 CommonMark 语义吞到文末，其后标题不提取
 * - 支持引用块内标题（`> # x`，Crepe 会渲染为 <blockquote><h1>）
 * - 支持 Setext 标题（`Title\n===` → h1，`Title\n---` → h2）
 */
export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fenceCh = '';
  let fenceLen = 0;
  // 上一行若是「普通段落行」，记录为 Setext 标题候选文本
  let prevPara: { text: string; line: number } | null = null;
  const lines = markdown.split('\n');

  // 剥离行首引用块标记（`> `、`> > ` 等，允许 ≤3 空格缩进）
  const stripQuote = (s: string) => s.replace(/^(?: {0,3}>[ \t]?)+/, '');

  for (let i = 0; i < lines.length; i++) {
    const line = stripQuote(lines[i]);

    const fenceM = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceCh) {
      // 闭合：同字符、长度 ≥ 开口、行内除围栏符外只有空白
      if (
        fenceM &&
        fenceM[1][0] === fenceCh &&
        fenceM[1].length >= fenceLen &&
        /^ {0,3}(?:`+|~+)[ \t]*$/.test(line)
      ) {
        fenceCh = '';
        fenceLen = 0;
      }
      prevPara = null;
      continue;
    }
    if (fenceM) {
      fenceCh = fenceM[1][0];
      fenceLen = fenceM[1].length;
      prevPara = null;
      continue;
    }

    const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (atx) {
      items.push({ level: atx[1].length, text: atx[2].trim(), line: i });
      prevPara = null;
      continue;
    }

    // Setext 下划线（= → h1，- → h2），仅在上一行是普通段落行时生效
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (setext && prevPara) {
      items.push({
        level: setext[1][0] === '=' ? 1 : 2,
        text: prevPara.text,
        line: prevPara.line,
      });
      prevPara = null;
      continue;
    }

    // 记录候选段落行：非空、非列表项（标题/围栏已在上面处理）
    if (line.trim() && !/^ {0,3}([-*+]|\d{1,9}[.)])([ \t]|$)/.test(line)) {
      prevPara = { text: line.trim(), line: i };
    } else {
      prevPara = null;
    }
  }
  return items;
}

export interface WordCount {
  /** 中日韩字符 + 西文单词合计（Typora 口径的「字数」） */
  words: number;
  /** 不含空白 */
  chars: number;
  /** 预计阅读分钟数（中文 300 字/分，西文 200 词/分，取较慢者） */
  minutes: number;
}

/** 字数统计：CJK 按字、西文按词 */
export function countWords(markdown: string): WordCount {
  // 去掉代码块、图片、链接 URL、HTML 标签、markdown 标记，只统计正文
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^ {0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm, ' ') // 引用式链接定义行
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // 引用式链接用法
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\s>*+-]+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/[*_~|]/g, ' ');

  // CJK 表意文字 + CJK/全角标点（，。！？等，U+3000-303F、U+FF00-FF60）按字计
  const cjk = (text.match(/[一-鿿㐀-䶿豈-﫿　-〿＀-｠]/g) ?? []).length;
  const western = (text.match(/[A-Za-z0-9À-ɏ]+/g) ?? []).length;
  const words = cjk + western;
  const chars = (text.match(/\S/g) ?? []).length;
  // 阅读时间：CJK 300 字/分 + 西文 200 词/分
  const minutes = Math.max(
    words > 0 ? 1 : 0,
    Math.ceil(cjk / 300 + western / 200),
  );
  return { words, chars, minutes };
}

/**
 * marked 产物消毒：marked 默认透传原始 HTML，导出的 HTML 会发给别人打开，必须防存储型 XSS。
 * 与 MarkdownPreview.tsx 一致走 DOMPurify USE_PROFILES html 允许列表。
 */
function sanitizeHtml(html: string): string {
  if (DOMPurify.isSupported) {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  // 非 DOM 环境（node 单测等）兜底：保守剔除脚本标签 / on* 事件属性 / javascript: 协议
  return html
    .replace(
      /<\s*(script|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      '',
    )
    .replace(/<\s*\/?\s*(script|iframe|object|embed|form)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>]*\2/gi, '$1=$2#$2');
}

/** markdown → 完整 HTML 文档（内联样式，可独立打开/分享；内容已消毒） */
export function markdownToHtmlDoc(markdown: string, title = 'Document'): string {
  const body = sanitizeHtml(marked.parse(markdown, { async: false }) as string);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 0 auto; padding: 48px 24px;
    font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif;
    line-height: 1.75; color: #24292f; }
  img { max-width: 100%; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow-x: auto; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em;
    background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #d0d7de; margin: 0; padding: 0 1em; color: #57606a; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
  th { background: #f6f8fa; }
  h1, h2 { border-bottom: 1px solid #d8dee4; padding-bottom: 0.3em; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  hr { border: none; border-top: 1px solid #d8dee4; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 文件读取为 data URL（图片内嵌用） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}
