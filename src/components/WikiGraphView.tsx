import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, RotateCcw, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { WikiGraph, WikiEntity, WikiRelation } from '../lib/wikiGraph';
import { entityTypeColor } from '../lib/wikiGraph';
import { Button } from './ui/controls';

// ════════════════════════════════════════════════════════════════════════════
// d3-force 风格力导向模拟（保证收敛：alpha 指数衰减到 alphaMin 后硬停）
// ════════════════════════════════════════════════════════════════════════════

const ALPHA_INITIAL = 1.0;
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 0.0228;
const ALPHA_TARGET = 0;
const VELOCITY_DECAY = 0.4;
const CHARGE = -400;
const LINK_DIST = 100;
const LINK_STRENGTH = 0.08;
const CENTER_GRAVITY = 0.06;
const COLLIDE_RADIUS = 28;
const MAX_VELOCITY = 15;

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number; // 拖拽固定位置
  fy?: number;
}

interface SimState {
  nodes: SimNode[];
  nodeMap: Map<string, SimNode>;
  edges: { source: SimNode; target: SimNode; relation: WikiRelation }[];
  alpha: number;
  running: boolean;
  frame: number;
}

function initSimState(graph: WikiGraph): SimState {
  // 初始位置：围绕原点的圆形随机分布（避免全部挤在 0,0）
  const nodes: SimNode[] = graph.entities.map((e, i) => {
    const angle = (2 * Math.PI * i) / graph.entities.length;
    const r = 50 + Math.random() * 150;
    return {
      id: e.id,
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.relations
    .filter((r) => nodeMap.has(r.from) && nodeMap.has(r.to))
    .map((r) => ({
      source: nodeMap.get(r.from)!,
      target: nodeMap.get(r.to)!,
      relation: r,
    }));
  return { nodes, nodeMap, edges, alpha: ALPHA_INITIAL, running: true, frame: 0 };
}

/** 单步模拟 tick（d3-force 模型） */
function simTick(sim: SimState): void {
  const { nodes, edges, alpha } = sim;

  // 1. Many-body 排斥（O(n²)，264 节点可接受）
  const chargeForce = CHARGE * alpha;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
      const f = chargeForce / d2;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
  }

  // 2. Link 弹簧
  for (const { source: s, target: t } of edges) {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - LINK_DIST) / d) * LINK_STRENGTH * alpha;
    s.vx += dx * f;
    s.vy += dy * f;
    t.vx -= dx * f;
    t.vy -= dy * f;
  }

  // 3. 向心力
  const cg = CENTER_GRAVITY * alpha;
  for (const n of nodes) {
    n.vx -= n.x * cg;
    n.vy -= n.y * cg;
  }

  // 4. 碰撞检测
  const cr2 = COLLIDE_RADIUS * COLLIDE_RADIUS;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < cr2 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (COLLIDE_RADIUS - d) / d * 0.5 * alpha;
        a.vx -= dx * push;
        a.vy -= dy * push;
        b.vx += dx * push;
        b.vy += dy * push;
      }
    }
  }

  // 5. 速度衰减 + 位置更新
  const vd = 1 - VELOCITY_DECAY;
  for (const n of nodes) {
    if (n.fx !== undefined && n.fy !== undefined) {
      n.x = n.fx;
      n.y = n.fy;
      n.vx = 0;
      n.vy = 0;
    } else {
      n.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n.vx * vd));
      n.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n.vy * vd));
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 组件
// ════════════════════════════════════════════════════════════════════════════

export function WikiGraphView({
  graph,
  onSelectEntity,
}: {
  graph: WikiGraph;
  onSelectEntity?: (entity: WikiEntity) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<WikiEntity | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<WikiRelation | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [, setTick] = useState(0);
  const dragNodeRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // ── 模拟状态 ──
  const simRef = useRef<SimState | null>(null);
  const rafRef = useRef(0);

  // 初始化/重建模拟
  useEffect(() => {
    simRef.current = initSimState(graph);
    dragNodeRef.current = null;
    // 立即运行模拟直到收敛（无动画直接算到停）
    const sim = simRef.current;
    while (sim.alpha > ALPHA_MIN && sim.frame < 2000) {
      simTick(sim);
      sim.alpha += (ALPHA_TARGET - sim.alpha) * ALPHA_DECAY;
      sim.frame++;
    }
    sim.running = false;
    setTick((t) => t + 1);
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph]);

  // 加热模拟（拖拽后调用）
  const reheat = useCallback((target: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.alpha = Math.max(sim.alpha, target);
    sim.running = true;
  }, []);

  // 模拟循环（仅在有交互时运行）
  useEffect(() => {
    const loop = () => {
      const sim = simRef.current;
      if (!sim) return;
      if (sim.running && sim.alpha > ALPHA_MIN) {
        simTick(sim);
        sim.alpha += (ALPHA_TARGET - sim.alpha) * ALPHA_DECAY;
        sim.frame++;
        setTick((t) => t + 1);
      } else if (sim.running) {
        sim.running = false; // 收敛停止
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const sim = simRef.current;
  const positions = useMemo(() => {
    if (!sim) return new Map<string, { x: number; y: number }>();
    const m = new Map<string, { x: number; y: number }>();
    for (const n of sim.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sim?.frame]); // sim.frame 变化触发重新读取

  const entityById = useMemo(() => {
    const m = new Map<string, WikiEntity>();
    for (const e of graph.entities) m.set(e.id, e);
    return m;
  }, [graph]);

  // 连接数（节点大小）
  const connCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of graph.relations) {
      m.set(r.from, (m.get(r.from) ?? 0) + 1);
      m.set(r.to, (m.get(r.to) ?? 0) + 1);
    }
    return m;
  }, [graph]);

  const nodeRadius = useCallback(
    (id: string) => Math.min(12, 4 + Math.sqrt(connCount.get(id) ?? 0) * 2),
    [connCount],
  );

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of graph.entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const visibleIds = useMemo(
    () => new Set(graph.entities.filter((e) => !hiddenTypes.has(e.type)).map((e) => e.id)),
    [graph, hiddenTypes],
  );
  const visibleRelations = useMemo(
    () => graph.relations.filter((r) => visibleIds.has(r.from) && visibleIds.has(r.to)),
    [graph, visibleIds],
  );

  const matched = useMemo(() => {
    if (!q.trim()) return null;
    const s = new Set<string>();
    for (const e of graph.entities) if (e.name.toLowerCase().includes(q)) s.add(e.id);
    return s;
  }, [graph, q]);

  const selectedRelations = useMemo(() => {
    if (!selected) return [];
    return graph.relations.filter((r) => r.from === selected.id || r.to === selected.id);
  }, [graph, selected]);

  // ── 视图操作 ──
  const applyView = useCallback(
    (v: { x: number; y: number; k: number }) => {
      setView(v);
      const g = svgRef.current?.querySelector('g');
      if (g) g.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
    },
    [],
  );

  const fitView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || positions.size === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [, p] of positions) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = 60;
    const w = maxX - minX + pad * 2 || 1;
    const h = maxY - minY + pad * 2 || 1;
    const k = Math.max(0.05, Math.min(2, Math.min(rect.width / w, rect.height / h)));
    applyView({
      k,
      x: rect.width / 2 - ((minX + maxX) / 2) * k,
      y: rect.height / 2 - ((minY + maxY) / 2) * k,
    });
  }, [applyView, positions]);

  // 图数据变化时自动适配
  const didFit = useRef(false);
  useEffect(() => {
    didFit.current = false;
  }, [graph]);
  useEffect(() => {
    if (!didFit.current && positions.size > 0) {
      didFit.current = true;
      requestAnimationFrame(() => fitView());
    }
  }, [positions, fitView]);

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const k2 = Math.max(0.05, Math.min(3, view.k * factor));
      const s = k2 / view.k;
      applyView({ k: k2, x: cx - (cx - view.x) * s, y: cy - (cy - view.y) * s });
    },
    [applyView, view],
  );

  const resetView = useCallback(() => {
    fitView();
  }, [fitView]);

  // 滚轮缩放（以光标为中心）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const k2 = Math.max(0.05, Math.min(3, view.k * factor));
      const s = k2 / view.k;
      applyView({ k: k2, x: cx - (cx - view.x) * s, y: cy - (cy - view.y) * s });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [view, applyView]);

  // ── 指针交互 ──
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const nodeEl = (e.target as Element).closest('[data-node-id]');
    if (nodeEl) {
      // 拖拽节点
      const nodeId = nodeEl.getAttribute('data-node-id')!;
      dragNodeRef.current = nodeId;
      const sim = simRef.current;
      const node = sim?.nodeMap.get(nodeId);
      if (node && sim) {
        const rect = containerRef.current!.getBoundingClientRect();
        const gx = (e.clientX - rect.left - view.x) / view.k;
        const gy = (e.clientY - rect.top - view.y) / view.k;
        dragOffsetRef.current = { dx: gx - node.x, dy: gy - node.y };
        node.fx = node.x;
        node.fy = node.y;
      }
      reheat(0.3);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    // 平移
    panningRef.current = true;
    panStartRef.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragNodeRef.current) {
      const sim = simRef.current;
      const node = sim?.nodeMap.get(dragNodeRef.current);
      if (node) {
        const rect = containerRef.current!.getBoundingClientRect();
        const gx = (e.clientX - rect.left - view.x) / view.k;
        const gy = (e.clientY - rect.top - view.y) / view.k;
        node.fx = gx - dragOffsetRef.current.dx;
        node.fy = gy - dragOffsetRef.current.dy;
        reheat(0.3);
      }
      return;
    }
    if (panningRef.current) {
      applyView({ ...view, x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
    }
  };

  const onPointerUp = () => {
    if (dragNodeRef.current) {
      const sim = simRef.current;
      const node = sim?.nodeMap.get(dragNodeRef.current);
      if (node) { node.fx = undefined; node.fy = undefined; }
      dragNodeRef.current = null;
      reheat(0.1); // 松手后短暂回弹
    }
    panningRef.current = false;
  };

  const toggleType = (t: string) =>
    setHiddenTypes((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n;
    });

  const toolBtn = 'h-7 w-7 inline-flex items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground transition-colors';
  const inputCls = 'h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input className={`${inputCls} w-full pl-6`} placeholder="搜索实体…" value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} />
        </div>
        <Button variant="ghost" size="icon-sm" className={toolBtn} title="放大" onClick={() => zoomBy(1.25)}><ZoomIn className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className={toolBtn} title="缩小" onClick={() => zoomBy(0.9)}><ZoomOut className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className={toolBtn} title="重置视图" onClick={resetView}><RotateCcw className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className={toolBtn} title="适配窗口" onClick={fitView}><Maximize className="h-4 w-4" /></Button>
      </div>

      {/* 图 + 侧栏 */}
      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {positions.size === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无图谱数据</div>
          ) : (
            <svg ref={svgRef} className="h-full w-full">
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {/* 边 */}
                {visibleRelations.map((r, i) => {
                  const a = positions.get(r.from);
                  const b = positions.get(r.to);
                  if (!a || !b) return null;
                  const isSel = selectedRelation === r;
                  const dimmed = matched && !matched.has(r.from) && !matched.has(r.to);
                  return (
                    <g key={i}>
                      {/* 透明粗线作为点击热区 */}
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="transparent"
                        strokeWidth={12}
                        className="cursor-pointer"
                        onClick={() => { setSelectedRelation(selectedRelation === r ? null : r); setSelected(null); }}
                      >
                        <title>{r.type}</title>
                      </line>
                      {/* 可见线 */}
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={isSel ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                        strokeWidth={isSel ? 2 : 1}
                        strokeOpacity={dimmed ? 0.1 : isSel ? 1 : 0.5}
                        pointerEvents="none"
                      />
                      {/* 选中边中点显示关系标签 */}
                      {isSel && (
                        <text
                          x={(a.x + b.x) / 2} y={(a.y + b.y) / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={10}
                          className="fill-primary"
                          pointerEvents="none"
                        >
                          {r.type}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* 节点 */}
                {graph.entities.map((e) => {
                  if (!visibleIds.has(e.id)) return null;
                  const p = positions.get(e.id);
                  if (!p) return null;
                  const dimmed = matched && !matched.has(e.id);
                  const isSel = selected?.id === e.id;
                  const r = nodeRadius(e.id);
                  return (
                    <g
                      key={e.id}
                      transform={`translate(${p.x},${p.y})`}
                      className="cursor-pointer"
                      data-node-id={e.id}
                      onClick={() => { setSelected(isSel ? null : e); setSelectedRelation(null); }}
                    >
                      <circle
                        r={r}
                        fill={entityTypeColor(e.type)}
                        fillOpacity={dimmed ? 0.2 : 0.85}
                        stroke={isSel ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                        strokeWidth={isSel ? 2.5 : 1.5}
                      />
                      <text
                        y={r + 12}
                        textAnchor="middle"
                        fontSize={10}
                        className="fill-foreground"
                        opacity={dimmed ? 0.2 : 0.9}
                        pointerEvents="none"
                      >
                        {e.name.length > 12 ? e.name.slice(0, 11) + '…' : e.name}
                      </text>
                      <title>{`${e.name} (${e.type})`}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        {/* 右侧详情面板 */}
        {(selected || selectedRelation) && (
          <div className="w-64 shrink-0 overflow-y-auto border-l border-border bg-card p-3 text-xs">
            {selectedRelation ? (
              <>
                <div className="mb-2 text-sm font-medium text-foreground">关系详情</div>
                <div className="mb-3">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{selectedRelation.type}</span>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-muted-foreground">从</div>
                    <button
                      type="button"
                      className="mt-0.5 text-left text-foreground hover:text-primary"
                      onClick={() => {
                        const e = entityById.get(selectedRelation.from);
                        if (e) { setSelected(e); setSelectedRelation(null); }
                      }}
                    >
                      {entityById.get(selectedRelation.from)?.name ?? selectedRelation.from}
                    </button>
                  </div>
                  <div>
                    <div className="text-muted-foreground">到</div>
                    <button
                      type="button"
                      className="mt-0.5 text-left text-foreground hover:text-primary"
                      onClick={() => {
                        const e = entityById.get(selectedRelation.to);
                        if (e) { setSelected(e); setSelectedRelation(null); }
                      }}
                    >
                      {entityById.get(selectedRelation.to)?.name ?? selectedRelation.to}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-4 text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedRelation(null)}
                >
                  ✕ 关闭
                </button>
              </>
            ) : selected ? (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: entityTypeColor(selected.type) }} />
                  <span className="text-sm font-medium text-foreground">{selected.name}</span>
                </div>
                <div className="mb-3 text-muted-foreground">{selected.type}</div>
                {selected.confidence !== undefined && (
                  <div className="mb-3 text-muted-foreground">置信度：{Math.round(selected.confidence * 100)}%</div>
                )}
                <div className="mb-1 font-medium text-foreground">关联（{selectedRelations.length}）</div>
                <div className="space-y-1">
                  {selectedRelations.map((r, i) => {
                    const other = r.from === selected.id ? r.to : r.from;
                    const oe = entityById.get(other);
                    return (
                      <button
                        key={i}
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted"
                        onClick={() => oe && setSelected(oe)}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: entityTypeColor(oe?.type ?? '') }} />
                        <span className="min-w-0 flex-1 truncate">{oe?.name ?? other}</span>
                        <span className="text-muted-foreground">{r.type}</span>
                      </button>
                    );
                  })}
                </div>
                {onSelectEntity && (
                  <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onSelectEntity(selected)}>
                    查看相关文章
                  </Button>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* 类型筛选图例 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5">
        {types.map(([t, count]) => {
          const hidden = hiddenTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition-opacity ${hidden ? 'opacity-30' : ''}`}
              onClick={() => toggleType(t)}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: entityTypeColor(t) }} />
              <span className="text-muted-foreground">{t}</span>
              <span className="text-muted-foreground/60">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

