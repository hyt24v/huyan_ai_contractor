/** 更新说明(release notes)解析:把纯文本/markdown 风格的 notes 拆成可渲染结构 */

export interface ReleaseNotes {
  /** 版本亮点列表(`- ` 开头的行) */
  bullets: string[];
  /** 其余说明文字(安装指引等),保持原顺序 */
  paragraphs: string[];
}

/**
 * 解析更新说明文本:
 * - `- ` / `* ` 开头的行 → bullets
 * - `#` 开头的标题行剥掉 `#` 后并入 paragraphs
 * - `---` 分隔线忽略
 * - 空行忽略
 */
export function parseReleaseNotes(body: string): ReleaseNotes {
  const bullets: string[] = [];
  const paragraphs: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    const heading = line.match(/^#+\s+(.*)$/);
    paragraphs.push(heading ? heading[1] : line);
  }
  return { bullets, paragraphs };
}
