// wiki/log.md 操作日志解析 + 统计聚合（纯函数，供仪表盘/时间线视图）
import type { WikiScan } from './wiki';

export interface WikiLogEntry {
  date: string;
  kind: string; // update / ingest / lint / query archive ...
  title: string;
  body: string;
}

/** 解析 log.md 的 `## YYYY-MM-DD kind | 标题` 分节（新的在前） */
export function parseWikiLog(text: string): WikiLogEntry[] {
  const out: WikiLogEntry[] = [];
  const re = /^## (\d{4}-\d{2}-\d{2})\s+(\S+)\s*\|\s*(.+)$/gm;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    out.push({
      date: m[1],
      kind: m[2],
      title: m[3].trim(),
      body: text.slice(start, end).trim(),
    });
  }
  return out; // 文件本身即新在前
}

export interface WikiStats {
  totalArticles: number;
  archived: number;
  withConfidence: number;
  avgConfidence: number | null;
  topicCounts: { topic: string; count: number }[];
  confidenceBuckets: { label: string; count: number }[]; // <0.5 / 0.5-0.7 / 0.7-0.9 / ≥0.9 / 无标注
  recent: { title: string; topic: string; date: string }[]; // 最近更新 top N
}

export function computeWikiStats(scan: WikiScan, recentN = 10): WikiStats {
  const arts = scan.articles;
  const confs = arts.map((a) => a.confidence).filter((c): c is number => c !== undefined);
  const buckets = [
    { label: '< 0.5', count: 0 },
    { label: '0.5–0.7', count: 0 },
    { label: '0.7–0.9', count: 0 },
    { label: '≥ 0.9', count: 0 },
    { label: '无标注', count: 0 },
  ];
  for (const a of arts) {
    const c = a.confidence;
    if (c === undefined) buckets[4].count++;
    else if (c < 0.5) buckets[0].count++;
    else if (c < 0.7) buckets[1].count++;
    else if (c < 0.9) buckets[2].count++;
    else buckets[3].count++;
  }
  return {
    totalArticles: arts.length,
    archived: arts.filter((a) => a.archived).length,
    withConfidence: confs.length,
    avgConfidence: confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : null,
    topicCounts: scan.topics.map((t) => ({ topic: t.name, count: t.articles.length })),
    confidenceBuckets: buckets,
    recent: arts
      .filter((a) => a.date)
      .sort((a, b) => b.date!.localeCompare(a.date!))
      .slice(0, recentN)
      .map((a) => ({ title: a.title, topic: a.topic, date: a.date! })),
  };
}
