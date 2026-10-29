// 知识库（LLM Wiki）数据层：frontmatter 解析 / 目录扫描 / 搜索
// 遵守仓库 AGENTS.md 规范：wiki/ 禁物理删除、index.md/log.md 由 agent 簿记（本模块不写这两个文件）
import { home, tauriFs, type FsPort } from './fsPort';

export interface WikiFrontmatter {
  title?: string;
  date?: string;
  tags: string[];
  aliases: string[];
  archived: boolean;
  /** 原样保留的 frontmatter 文本（含 --- 边界），保存时回写 */
  raw: string;
}

export interface WikiArticle {
  topic: string;
  subdir?: string;
  name: string;
  relPath: string; // 相对 wiki/ 根
  title: string;
  date?: string;
  tags: string[];
  aliases: string[];
  confidence?: number;
  archived: boolean;
}

export interface WikiTopic {
  name: string;
  articles: WikiArticle[];
}

export interface WikiScan {
  topics: WikiTopic[];
  articles: WikiArticle[];
  canvases: { topic: string; name: string; relPath: string }[];
}

const DEFAULT_WIKI_PATH = '~/Desktop/huyan_wiki';

export function defaultWikiPath(): string {
  return DEFAULT_WIKI_PATH;
}

export async function resolveWikiPath(p: string): Promise<string> {
  if (p.startsWith('~/')) return (await home()) + p.slice(1);
  return p.replace(/\/$/, '');
}

/** 解析 YAML frontmatter 子集：`key: value`、`- item` 列表。损坏时返回空值+原文 */
export function parseFrontmatter(text: string): WikiFrontmatter {
  const empty: WikiFrontmatter = { tags: [], aliases: [], archived: false, raw: '' };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return empty;
  const raw = m[0];
  const out: WikiFrontmatter = { ...empty, raw };
  const lines = m[1].split('\n');
  let listKey: 'tags' | 'aliases' | null = null;
  for (const line of lines) {
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) {
      out[listKey].push(unquote(li[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) {
      listKey = null;
      continue;
    }
    const key = kv[1];
    const val = unquote(kv[2].trim());
    if (key === 'title') out.title = val || undefined;
    else if (key === 'date') out.date = val || undefined;
    else if (key === 'archived') out.archived = val === 'true';
    else if (key === 'tags' || key === 'aliases') {
      listKey = key;
      if (val.startsWith('[')) {
        // 行内数组 tags: [a, b]
        out[key] = val
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean);
        listKey = null;
      }
    } else {
      listKey = null;
    }
  }
  return out;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
}

/** 去掉 frontmatter 后的正文 */
export function stripFrontmatter(text: string): string {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? text.slice(m[0].length) : text;
}

/** 从正文提取 Confidence 标注（"> **Confidence: 0.70**"） */
export function extractConfidence(body: string): number | undefined {
  const m = body.slice(0, 2000).match(/Confidence[:：]\s*\*?\*?\s*([\d.]+)/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/** 扫描 wiki/ 目录（主题目录 + 可选二级分类），读每篇 frontmatter */
let lastScanCache: { root: string; scan: WikiScan } | null = null;

/** 读取上次扫描缓存（stale-while-revalidate：页面切回先展示缓存，后台再扫） */
export function peekWikiScan(root: string): WikiScan | null {
  return lastScanCache && lastScanCache.root === root ? lastScanCache.scan : null;
}

export function storeWikiScan(root: string, scan: WikiScan): void {
  lastScanCache = { root, scan };
}

export async function scanWiki(wikiRoot: string, fs: FsPort = tauriFs): Promise<WikiScan> {
  const wikiDir = `${wikiRoot}/wiki`;
  const topics: WikiTopic[] = [];
  const canvases: WikiScan['canvases'] = [];
  const entries = await fs.readDir(wikiDir);
  for (const e of entries) {
    if (!e.isDirectory) continue; // 根级 index.md / log.md 由 agent 簿记，不进文章列表
    const topic: WikiTopic = { name: e.name, articles: [] };
    await collectTopic(`${wikiDir}/${e.name}`, e.name, undefined, topic, canvases, fs);
    if (topic.articles.length > 0) topics.push(topic);
  }
  topics.sort((a, b) => b.articles.length - a.articles.length);
  return { topics, articles: topics.flatMap((t) => t.articles), canvases };
}

async function collectTopic(
  dir: string,
  topicName: string,
  subdir: string | undefined,
  topic: WikiTopic,
  canvases: WikiScan['canvases'],
  fs: FsPort,
): Promise<void> {
  const entries = await fs.readDir(dir);
  for (const e of entries) {
    const rel = `${topicName}/${subdir ? `${subdir}/` : ''}${e.name}`;
    if (e.isDirectory) {
      if (!subdir) await collectTopic(`${dir}/${e.name}`, topicName, e.name, topic, canvases, fs);
      continue;
    }
    if (e.name.endsWith('.canvas')) {
      canvases.push({ topic: topicName, name: e.name.replace(/\.canvas$/, ''), relPath: rel });
      continue;
    }
    if (!e.name.endsWith('.md')) continue;
    let fm: WikiFrontmatter = { tags: [], aliases: [], archived: false, raw: '' };
    let confidence: number | undefined;
    try {
      const text = await fs.readText(`${dir}/${e.name}`);
      fm = parseFrontmatter(text);
      confidence = extractConfidence(stripFrontmatter(text));
    } catch {
      /* 读失败按无 frontmatter 处理 */
    }
    const name = e.name.replace(/\.md$/, '');
    topic.articles.push({
      topic: topicName,
      subdir,
      name,
      relPath: rel,
      title: fm.title || name,
      date: fm.date,
      tags: fm.tags,
      aliases: fm.aliases,
      confidence,
      archived: fm.archived,
    });
  }
  topic.articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function searchWiki(articles: WikiArticle[], q: string): WikiArticle[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return articles;
  return articles.filter((a) =>
    [a.title, a.name, a.topic, a.subdir ?? '', ...a.tags, ...a.aliases]
      .join('\n')
      .toLowerCase()
      .includes(needle),
  );
}
