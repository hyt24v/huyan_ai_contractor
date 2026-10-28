import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, RotateCcw, Search, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { entityTypeColor, layoutGraph } from '../lib/wikiGraph';
import type { WikiEntity, WikiGraph, WikiRelation } from '../lib/wikiGraph';

/**
 * 知识库知识图谱视图（纯展示）：按类型聚类环形布局的 SVG 图谱。
 * 滚轮缩放（以光标为中心）+ 拖拽平移 + 类型筛选 + 搜索高亮 + 右侧详情栏。
 */

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** 节点半径按 confidence 映射到 6-12px */
function nodeRadius(e: WikiEntity): number {
  const c = typeof e.confidence === 'number' ? Math.min(1, Math.max(0, e.confidence)) : 0.5;
  return 6 + c * 6;
}

function truncateName(name: string): string {
  return name.length > 8 ? `${name.slice(0, 8)}…` : name;
}

function attrText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type View = { x: number; y: number; zoom: number };

export function WikiGraphView({
  graph,
  onSelectEntity,
}: {
  graph: WikiGraph;
  onSelectEntity?: (entity: WikiEntity) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  const suppressClickRef = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // ── 力导向模拟 ──
  const [, setTick] = useState(0);
  const simPos = useRef(new Map<string, { x: number; y: number }>());
  const simVel = useRef(new Map<string, { x: number; y: number }>());
  const dragNodeRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const simSleeping = useRef(false);
  const temperature = useRef(1.0); // 冷却因子，1→0 渐停
  const simFrames = useRef(0); // 模拟帧数，超限硬停
  const relationsRef = useRef(graph.relations);
  relationsRef.current = graph.relations;

  const positions = simPos.current; // alias，模拟每帧更新 + setTick 触发重渲
  const entityById = useMemo(() => {
    const m = new Map<string, WikiEntity>();
    for (const e of graph.entities) m.set(e.id, e);
    return m;
  }, [graph]);

  /** 出现的类型及计数（按计数降序） */
  const typeStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of graph.entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const visibleEntities = useMemo(
    () => graph.entities.filter((e) => !hiddenTypes.has(e.type)),
    [graph, hiddenTypes],
  );
  const visibleIds = useMemo(() => new Set(visibleEntities.map((e) => e.id)), [visibleEntities]);
  const visibleRelations = useMemo(
    () => graph.relations.filter((r) => visibleIds.has(r.from) && visibleIds.has(r.to)),
    [graph, visibleIds],
  );

  const q = query.trim().toLowerCase();
  const matchedIds = useMemo(() => {
    if (!q) return null;
    const s = new Set<string>();
    for (const e of graph.entities) if (e.name.toLowerCase().includes(q)) s.add(e.id);
    return s;
  }, [graph, q]);

  const selected = selectedId ? (entityById.get(selectedId) ?? null) : null;
  const selectedRelations = useMemo(() => {
    if (!selected) return [];
    return graph.relations.filter((r) => r.from === selected.id || r.to === selected.id);
  }, [graph, selected]);

  /** 按可见节点 bbox 计算视图；mode=fit 缩放到适配，mode=reset 仅居中且 zoom=1 */
  const applyView = (mode: 'fit' | 'reset') => {
    const el = containerRef.current;
    if (!el || visibleEntities.length === 0) return;
    const rect = el.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const e of visibleEntities) {
      const p = simPos.current.get(e.id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) return;
    const pad = 40;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const zoom =
      mode === 'fit' ? clampZoom(Math.min(rect.width / w, rect.height / h)) : 1;
    setView({
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  };

  // 图数据变化时自动适配 + 初始化力导向模拟
  const graphKey = `${graph.entities.length}:${graph.relations.length}`;
  useEffect(() => {
    setSelectedId(null);
    setHiddenTypes(new Set());
    setQuery('');
    const layout = layoutGraph(graph);
    simPos.current = new Map(layout);
    simVel.current = new Map();
    for (const id of layout.keys()) simVel.current.set(id, { x: 0, y: 0 });
    simSleeping.current = false;
    temperature.current = 1.0;
    simFrames.current = 0;
    dragNodeRef.current = null;
    setTick((t) => t + 1);
    applyView('fit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  // 力导向模拟循环（排斥 + 弹簧 + 向心力，settles 后休眠，拖拽时唤醒）
  useEffect(() => {
    let running = true;
    let rafId = 0;

    const step = () => {
      if (!running) return;
      const pos = simPos.current;
      const vel = simVel.current;
      const rels = relationsRef.current;
      const ids = [...pos.keys()];
      const n = ids.length;
      const dragged = dragNodeRef.current;

      // 休眠检查：无拖拽且速度都小 → 跳过物理
      if (simSleeping.current && !dragged) {
        rafId = requestAnimationFrame(step);
        return;
      }

      // 冷却：温度从 1 渐降到 0，所有力乘以温度
      temperature.current *= 0.99;
      const t = temperature.current;
      simFrames.current++;

      // 硬停：600 帧（约 10 秒）后强制静止
      if (simFrames.current > 600 && !dragged) {
        for (const [, v] of vel) { v.x = 0; v.y = 0; }
        simSleeping.current = true;
        setTick((tk) => tk + 1);
        rafId = requestAnimationFrame(step);
        return;
      }

      let maxV = 0;

      // 排斥力（O(n²)，264 节点约 35k 对，每帧毫秒级）
      for (let i = 0; i < n; i++) {
        const a = pos.get(ids[i])!;
        const va = vel.get(ids[i])!;
        for (let j = i + 1; j < n; j++) {
          const b = pos.get(ids[j])!;
          const vb = vel.get(ids[j])!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d2 = dx * dx + dy * dy || 1;
          const d = Math.sqrt(d2);
          const f = (1200 / d2) * t * t; // t² 让低温度时力衰减更快
          dx = (dx / d) * f;
          dy = (dy / d) * f;
          va.x += dx;
          va.y += dy;
          vb.x -= dx;
          vb.y -= dy;
        }
      }

      // 弹簧力（沿边）
      for (const r of rels) {
        const a = pos.get(r.from);
        const b = pos.get(r.to);
        if (!a || !b) continue;
        const va = vel.get(r.from)!;
        const vb = vel.get(r.to)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 80) * 0.015 * t * t;
        va.x += (dx / d) * f;
        va.y += (dy / d) * f;
        vb.x -= (dx / d) * f;
        vb.y -= (dy / d) * f;
      }

      // 向心力 + 阻尼 + 位置更新
      for (const id of ids) {
        if (id === dragged) continue; // 拖拽节点不动
        const p = pos.get(id)!;
        const v = vel.get(id)!;
        v.x -= p.x * 0.003 * t;
        v.y -= p.y * 0.003 * t;
        v.x *= 0.78; // 强阻尼确保收敛
        v.y *= 0.78;
        p.x += v.x;
        p.y += v.y;
        maxV = Math.max(maxV, Math.abs(v.x) + Math.abs(v.y));
      }

      setTick((t) => t + 1);

      if (maxV < 0.3 && !dragged) simSleeping.current = true;
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  // 滚轮缩放（原生监听，passive:false 才能 preventDefault 阻止页面滚动）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const zoom = clampZoom(v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        const k = zoom / v.zoom;
        return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, zoom };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, zoom };
    });
  };

  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const selectEntity = (e: WikiEntity | null) => {
    setSelectedId(e?.id ?? null);
    if (e) onSelectEntity?.(e);
  };

  if (graph.entities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        暂无图谱数据
      </div>
    );
  }

  const toolBtn =
    'flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground';

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full cursor-grab touch-none overflow-hidden bg-background active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button')) return;
        if ((e.target as HTMLElement).closest('input')) return;

        // 点在节点上 → 拖拽节点（力导向）
        const nodeEl = (e.target as Element).closest('[data-node-id]');
        if (nodeEl) {
          const nodeId = nodeEl.getAttribute('data-node-id')!;
          dragNodeRef.current = nodeId;
          const rect = containerRef.current!.getBoundingClientRect();
          const zoom = viewRef.current.zoom;
          const x = (e.clientX - rect.left - viewRef.current.x) / zoom;
          const y = (e.clientY - rect.top - viewRef.current.y) / zoom;
          const pos = simPos.current.get(nodeId);
          if (pos) dragOffsetRef.current = { dx: pos.x - x, dy: pos.y - y };
          simSleeping.current = false;
          simFrames.current = 0;
          temperature.current = Math.max(temperature.current, 0.3); // 拖拽时保持一定活跃度
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }

        // 点在空白 → 平移
        panRef.current = {
          px: e.clientX,
          py: e.clientY,
          vx: viewRef.current.x,
          vy: viewRef.current.y,
          moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        // 节点拖拽：直接更新位置，唤醒模拟让其他节点响应
        if (dragNodeRef.current) {
          const rect = containerRef.current!.getBoundingClientRect();
          const zoom = viewRef.current.zoom;
          const x = (e.clientX - rect.left - viewRef.current.x) / zoom;
          const y = (e.clientY - rect.top - viewRef.current.y) / zoom;
          const pos = simPos.current.get(dragNodeRef.current);
          if (pos) {
            pos.x = x + dragOffsetRef.current.dx;
            pos.y = y + dragOffsetRef.current.dy;
            const vel = simVel.current.get(dragNodeRef.current);
            if (vel) { vel.x = 0; vel.y = 0; }
            suppressClickRef.current = true;
            setTick((t) => t + 1);
          }
          return;
        }
        // 平移
        const pan = panRef.current;
        if (!pan) return;
        if (Math.abs(e.clientX - pan.px) + Math.abs(e.clientY - pan.py) > 4) pan.moved = true;
        setView((v) => ({
          ...v,
          x: pan.vx + (e.clientX - pan.px),
          y: pan.vy + (e.clientY - pan.py),
        }));
      }}
      onPointerUp={(e) => {
        if (dragNodeRef.current) {
          dragNodeRef.current = null;
          simSleeping.current = false;
          simFrames.current = Math.min(simFrames.current, 400); // 松手后给 200 帧回弹时间
          temperature.current = Math.max(temperature.current, 0.2);
        }
        if (panRef.current?.moved) suppressClickRef.current = true;
        panRef.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        panRef.current = null;
      }}
    >
      <svg className="absolute left-0 top-0 h-full w-full">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {/* 边 */}
          {visibleRelations.map((r, i) => {
            const a = positions.get(r.from);
            const b = positions.get(r.to);
            if (!a || !b) return null;
            const dimmed =
              matchedIds !== null && !(matchedIds.has(r.from) && matchedIds.has(r.to));
            return (
              <line
                key={`${r.from}->${r.to}:${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="stroke-border"
                strokeWidth={1}
                opacity={dimmed ? 0.06 : 0.55}
              >
                <title>{r.type}</title>
              </line>
            );
          })}
          {/* 节点 */}
          {visibleEntities.map((e) => {
            const p = positions.get(e.id);
            if (!p) return null;
            const isSelected = e.id === selectedId;
            const isHovered = e.id === hoveredId;
            const dimmed = matchedIds !== null && !matchedIds.has(e.id);
            const r = nodeRadius(e);
            return (
              <g
                key={e.id}
                data-node-id={e.id}
                opacity={dimmed ? 0.15 : 1}
                className="cursor-pointer"
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  selectEntity(isSelected ? null : e);
                }}
                onPointerEnter={() => setHoveredId(e.id)}
                onPointerLeave={() => setHoveredId((h) => (h === e.id ? null : h))}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={entityTypeColor(e.type)}
                  className={isSelected || isHovered ? 'stroke-primary' : undefined}
                  strokeWidth={isSelected ? 3 : isHovered ? 2 : 0}
                />
                <text
                  x={p.x}
                  y={p.y + r + 11}
                  textAnchor="middle"
                  fontSize={10}
                  className="pointer-events-none select-none fill-muted-foreground"
                >
                  {isSelected || isHovered ? e.name : truncateName(e.name)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* 顶部：类型筛选 chips + 搜索 */}
      <div className="absolute left-3 right-40 top-3 flex flex-wrap items-center gap-1.5">
        {typeStats.map(([type, count]) => {
          const hidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] shadow-sm transition-opacity ${
                hidden ? 'opacity-40' : ''
              }`}
              title={hidden ? '点击显示该类型' : '点击隐藏该类型'}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: entityTypeColor(type) }}
              />
              <span className="text-foreground">{type}</span>
              <span className="text-muted-foreground">{count}</span>
            </button>
          );
        })}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索实体…"
            className="h-7 w-40 rounded-md border border-border bg-card pl-7 pr-2 text-xs text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      {/* 右上：缩放工具条 + 图例 */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex gap-1">
          <button type="button" className={toolBtn} title="放大" onClick={() => zoomBy(1.25)}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn} title="缩小" onClick={() => zoomBy(1 / 1.25)}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn} title="重置" onClick={() => applyView('reset')}>
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn} title="适配视图" onClick={() => applyView('fit')}>
            <Maximize className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolBtn}
            title="重新布局（力导向）"
            onClick={() => {
              for (const [, v] of simVel.current) {
                v.x = (Math.random() - 0.5) * 4;
                v.y = (Math.random() - 0.5) * 4;
              }
              simSleeping.current = false;
              simFrames.current = 0;
              temperature.current = 1.0;
            }}
          >
            <Zap className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-56 overflow-auto rounded-md border border-border bg-card/95 p-2 text-[11px] shadow-sm">
          {typeStats.map(([type, count]) => (
            <div key={type} className="flex items-center gap-1.5 py-0.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entityTypeColor(type) }}
              />
              <span className="text-foreground">{type}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：选中实体详情 */}
      {selected && (
        <div className="absolute bottom-3 right-3 top-3 w-64 overflow-auto rounded-md border border-border bg-card/95 p-3 text-xs shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-sm font-medium text-foreground">{selected.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: entityTypeColor(selected.type) }}
                />
                {selected.type}
                {typeof selected.confidence === 'number' && (
                  <span>· 置信度 {selected.confidence.toFixed(2)}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="关闭"
              onClick={() => selectEntity(null)}
            >
              ✕
            </button>
          </div>

          {Object.keys(selected.attributes).length > 0 && (
            <div className="mt-3">
              <div className="mb-1 font-medium text-muted-foreground">属性</div>
              <table className="w-full border-collapse">
                <tbody>
                  {Object.entries(selected.attributes).map(([k, v]) => (
                    <tr key={k} className="align-top">
                      <td className="break-all py-0.5 pr-2 text-muted-foreground">{k}</td>
                      <td className="break-all py-0.5 text-foreground">{attrText(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 font-medium text-muted-foreground">
              关联关系（{selectedRelations.length}）
            </div>
            {selectedRelations.length === 0 ? (
              <div className="text-muted-foreground">无</div>
            ) : (
              <ul className="space-y-1">
                {selectedRelations.map((r: WikiRelation, i: number) => {
                  const outgoing = r.from === selected.id;
                  const otherId = outgoing ? r.to : r.from;
                  const other = entityById.get(otherId);
                  return (
                    <li key={`${r.from}->${r.to}:${i}`}>
                      <button
                        type="button"
                        className="w-full rounded-sm px-1 py-0.5 text-left hover:bg-accent"
                        onClick={() => other && selectEntity(other)}
                        title={other ? `跳选 ${other.name}` : otherId}
                      >
                        <span className="text-muted-foreground">
                          {outgoing ? '→' : '←'} {r.type}{' '}
                        </span>
                        <span className="text-foreground">{other?.name ?? otherId}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
