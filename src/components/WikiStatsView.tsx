// 知识库统计仪表盘：主题分布 / 置信度分布 / 最近更新
import { BarChart3 } from 'lucide-react';
import type { WikiScan } from '../lib/wiki';
import { computeWikiStats } from '../lib/wikiLog';

const BUCKET_COLORS = ['bg-destructive/70', 'bg-warning/70', 'bg-primary/70', 'bg-json-string/70', 'bg-muted-foreground/40'];

export default function WikiStatsView({ scan }: { scan: WikiScan }) {
  const stats = computeWikiStats(scan);
  const maxTopic = Math.max(1, ...stats.topicCounts.map((t) => t.count));
  const maxBucket = Math.max(1, ...stats.confidenceBuckets.map((b) => b.count));

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-2">
      {/* 总览卡片 */}
      <div className="col-span-full grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '文章总数', value: String(stats.totalArticles) },
          { label: '主题', value: String(stats.topicCounts.length) },
          { label: '平均置信度', value: stats.avgConfidence === null ? '—' : stats.avgConfidence.toFixed(2) },
          { label: '已归档', value: String(stats.archived) },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border/70 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <div className="text-xl font-semibold">{c.value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 主题分布 */}
      <div className="rounded-xl border border-border/70 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium">
          <BarChart3 className="h-3.5 w-3.5" /> 主题分布
        </h3>
        <div className="space-y-1.5">
          {stats.topicCounts.map((t) => (
            <div key={t.topic} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate" title={t.topic}>{t.topic}</span>
              <div className="h-3.5 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full rounded bg-primary/70" style={{ width: `${(t.count / maxTopic) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground">{t.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 置信度分布 */}
      <div className="rounded-xl border border-border/70 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 text-xs font-medium">置信度分布</h3>
        <div className="flex h-36 items-end gap-2">
          {stats.confidenceBuckets.map((b, i) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{b.count}</span>
              <div
                className={`w-full rounded-t ${BUCKET_COLORS[i]}`}
                style={{ height: `${Math.max(2, (b.count / maxBucket) * 110)}px` }}
              />
              <span className="text-[10px] text-muted-foreground">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 最近更新 */}
      <div className="col-span-full rounded-xl border border-border/70 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 text-xs font-medium">最近更新</h3>
        <div className="space-y-1">
          {stats.recent.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{r.date}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{r.topic}</span>
              <span className="min-w-0 truncate">{r.title}</span>
            </div>
          ))}
          {stats.recent.length === 0 && <p className="text-xs text-muted-foreground">暂无带日期的文章</p>}
        </div>
      </div>
    </div>
  );
}
