/** 轻量 Markdown 渲染预览(marked → HTML,DOMPurify 消毒),样式走主题 token,随明暗切换 */
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './markdown-preview.css';

export default function MarkdownPreview({ content }: { content: string }) {
  const raw = useMemo(
    () => marked.parse(content, { async: false }) as string,
    [content],
  );
  // skill 可从网络安装,markdown 是第三方内容:DOMPurify 允许列表消毒防 XSS
  return (
    <div
      className="md-preview"
      // pi-lens-ignore: 内容经 DOMPurify USE_PROFILES html 允许列表消毒(该规则文档自身的 FIX 示例即此写法)
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }),
      }}
    />
  );
}
