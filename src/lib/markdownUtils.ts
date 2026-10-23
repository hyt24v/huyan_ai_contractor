// Markdown 编辑器工具函数：大纲提取、字数统计、HTML 导出
import { marked } from 'marked';

export interface OutlineItem {
  level: number; // 1-6
  text: string;
  line: number; // 0-based 源码行号
}

/** 从 markdown 源码提取标题大纲（跳过代码块内的 # 行） */
export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let inFence = false;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      items.push({ level: m[1].length, text: m[2].trim(), line: i });
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
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\s>*+-]+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/[*_~|]/g, ' ');

  const cjk = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) ?? []).length;
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

/** markdown → 完整 HTML 文档（内联样式，可独立打开/分享） */
export function markdownToHtmlDoc(markdown: string, title = 'Document'): string {
  const body = marked.parse(markdown, { async: false }) as string;
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
