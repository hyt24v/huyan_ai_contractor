import { describe, expect, it } from 'vitest';
import {
  extractConfidence,
  parseFrontmatter,
  scanWiki,
  searchWiki,
  stripFrontmatter,
} from '../wiki';
import type { DirItem, FsPort } from '../fsPort';

const ARTICLE = `---
title: Codex 实战指南
date: 2026-05-14
tags:
  - AI编码工具
  - Codex
aliases:
  - Codex Tutorial
---

# Codex 实战指南

> **Confidence: 0.70** | 来源×1 | 2026-05 整理

正文内容。
`;

function fakeFs(files: Record<string, string>): FsPort {
  const dirs = new Map<string, Set<string>>();
  for (const p of Object.keys(files)) {
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join('/');
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir)!.add(segs[i]);
    }
  }
  const isDir = (p: string) => dirs.has(p);
  return {
    readText: async (p) => {
      if (!(p in files)) throw new Error('not found: ' + p);
      return files[p];
    },
    writeText: async () => {},
    exists: async (p) => p in files || isDir(p),
    readDir: async (p) => {
      const items: DirItem[] = [];
      for (const name of dirs.get(p) ?? []) {
        const full = `${p}/${name}`;
        items.push({ name, isDirectory: isDir(full), isSymlink: false });
      }
      return items;
    },
    mkdir: async () => {},
    remove: async () => {},
    rename: async () => {},
    copyDir: async () => {},
    readLink: async () => '',
    symlink: async () => {},
    gitClone: async () => {},
  };
}

describe('parseFrontmatter', () => {
  it('解析 title/date/tags/aliases 列表', () => {
    const fm = parseFrontmatter(ARTICLE);
    expect(fm.title).toBe('Codex 实战指南');
    expect(fm.date).toBe('2026-05-14');
    expect(fm.tags).toEqual(['AI编码工具', 'Codex']);
    expect(fm.aliases).toEqual(['Codex Tutorial']);
    expect(fm.archived).toBe(false);
    expect(fm.raw.startsWith('---')).toBe(true);
  });

  it('行内数组 tags: [a, b]', () => {
    const fm = parseFrontmatter('---\ntags: [a, "b c"]\n---\n正文');
    expect(fm.tags).toEqual(['a', 'b c']);
  });

  it('archived: true', () => {
    expect(parseFrontmatter('---\narchived: true\n---\n').archived).toBe(true);
  });

  it('无 frontmatter / 损坏回退', () => {
    const fm = parseFrontmatter('# 直接正文');
    expect(fm.title).toBeUndefined();
    expect(fm.tags).toEqual([]);
    expect(fm.raw).toBe('');
  });

  it('stripFrontmatter 去掉头部', () => {
    expect(stripFrontmatter(ARTICLE).trimStart().startsWith('# Codex')).toBe(true);
  });
});

describe('extractConfidence', () => {
  it('从标注行提取', () => {
    expect(extractConfidence(stripFrontmatter(ARTICLE))).toBe(0.7);
  });
  it('无标注返回 undefined', () => {
    expect(extractConfidence('没有标注')).toBeUndefined();
  });
});

describe('scanWiki', () => {
  const files: Record<string, string> = {
    '/w/wiki/index.md': '# index',
    '/w/wiki/log.md': '# log',
    '/w/wiki/.entities.json': '{}',
    '/w/wiki/AI工具/a.md': ARTICLE,
    '/w/wiki/AI工具/b.md': '# 无 frontmatter\n\n> Confidence: 0.9',
    '/w/wiki/AI工具/二级/c.md': '---\ntitle: 子分类文章\narchived: true\n---\n',
    '/w/wiki/AI工具/canvas1.canvas': '{"nodes":[]}',
    '/w/wiki/空主题/readme.txt': 'not md',
  };

  it('按主题收集文章，跳过根级簿记文件', async () => {
    const scan = await scanWiki('/w', fakeFs(files));
    expect(scan.topics).toHaveLength(1);
    const t = scan.topics[0];
    expect(t.name).toBe('AI工具');
    expect(t.articles).toHaveLength(3);
    expect(scan.articles).toHaveLength(3);
    expect(scan.canvases).toHaveLength(1);
    expect(scan.canvases[0].relPath).toBe('AI工具/canvas1.canvas');
  });

  it('frontmatter 字段映射 + 无 frontmatter 回退文件名', async () => {
    const scan = await scanWiki('/w', fakeFs(files));
    const a = scan.articles.find((x) => x.name === 'a')!;
    expect(a.title).toBe('Codex 实战指南');
    expect(a.confidence).toBe(0.7);
    const b = scan.articles.find((x) => x.name === 'b')!;
    expect(b.title).toBe('b');
    expect(b.confidence).toBe(0.9);
  });

  it('二级分类与归档标记', async () => {
    const scan = await scanWiki('/w', fakeFs(files));
    const c = scan.articles.find((x) => x.name === 'c')!;
    expect(c.subdir).toBe('二级');
    expect(c.archived).toBe(true);
  });

  it('纯 txt 主题不入列', async () => {
    const scan = await scanWiki('/w', fakeFs(files));
    expect(scan.topics.map((t) => t.name)).not.toContain('空主题');
  });
});

describe('searchWiki', () => {
  const articles = [
    { topic: 'T', name: 'a', relPath: 'T/a.md', title: 'Codex 指南', tags: ['AI'], aliases: [], archived: false },
    { topic: 'T', name: 'b', relPath: 'T/b.md', title: '医学术语', tags: ['医疗'], aliases: ['SNOMED'], archived: false },
  ];
  it('命中标题/标签/别名', () => {
    expect(searchWiki(articles, 'codex')).toHaveLength(1);
    expect(searchWiki(articles, 'snomed')[0].name).toBe('b');
    expect(searchWiki(articles, '')).toHaveLength(2);
  });
});
