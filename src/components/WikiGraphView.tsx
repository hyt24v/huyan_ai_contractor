import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, RotateCcw, Search, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import type { WikiGraph, WikiEntity, WikiRelation } from '../lib/wikiGraph';
import { entityTypeColor } from '../lib/wikiGraph';
import { Button } from './ui/controls';

// ════════════════════════════════════════════════════════════════════════════
// d3-force 风格力导向模拟（alpha 指数衰减到 alphaMin 后硬停，保证收敛）
// ════════════════════════════════════════════════════════════════════════════

const ALPHA_INITIAL = 1.0;
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 0.0228;
const ALPHA_TARGET = 0;
const VELOCITY_DECAY = 0.4;
const COLLIDE_RADIUS = 28;
const MAX_VELOCITY = 15;
const LABEL_FADE_K = 0.45; // 缩放低于此值隐藏标签

export interface ForceParams {
  charge: number; // 排斥力（负值）
  linkDist: number; // 弹簧距离
  linkStrength: number; // 弹簧强度
  centerGravity: number; // 中心引力
}

const DEFAULT_FORCES: ForceParams = {
  charge: -400,
  linkDist: 100,
  linkStrength: 0.08,
  centerGravity: 0.06,
};

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
}

interface SimState {
  nodes: SimNode[];
  nodeMap: Map<string, SimNode>;
  edges: { source: SimNode; target: SimNode; relation: WikiRelation }[];
  alpha: number;
  running: boolean;
  frame: number;
  /** 初次布局阶段：每个 rAF 批量跑多帧模拟，快速收敛且不阻塞首帧渲染 */
  preroll: boolean;
}

function initSimState(graph: WikiGraph): SimState {
  const nodes: SimNode[] = graph.entities.map((e, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, graph.entities.length);
    const r = 50 + Math.random() * 150;
    return { id: e.id, x: r * Math.cos(angle), y: r * Math.sin(angle), vx: 0, vy: 0 };
  });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.relations
    .filter((r) => nodeMap.has(r.from) && nodeMap.has(r.to))
    .map((r) => ({ source: nodeMap.get(r.from)!, target: nodeMap.get(r.to)!, relation: r }));
  return { nodes, nodeMap, edges, alpha: ALPHA_INITIAL, running: true, frame: 0, preroll: true };
}

function simTick(sim: SimState, f: ForceParams): void {
  const { nodes, edges, alpha } = sim;

  // 1. Many-body 排斥（charge 为负，-= 得排斥）
  const chargeForce = f.charge * alpha;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
      const fr = chargeForce / d2;
      a.vx -= dx * fr;
      a.vy -= dy * fr;
      b.vx += dx * fr;
      b.vy += dy * fr;
    }
  }

  // 2. Link 弹簧
  for (const { source: s, target: t } of edges) {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const fs = ((d - f.linkDist) / d) * f.linkStrength * alpha;
    s.vx += dx * fs;
    s.vy += dy * fs;
    t.vx -= dx * fs;
    t.vy -= dy * fs;
  }

  // 3. 向心力
  const cg = f.centerGravity * alpha;
  for (const n of nodes) {
    n.vx -= n.x * cg;
    n.vy -= n.y * cg;
  }

  // 4. 碰撞
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
        const push = ((COLLIDE_RADIUS - d) / d) * 0.5 * alpha;
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
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hideOrphans, setHideOrphans] = useState(false);
  const [localDepth, setLocalDepth] = useState<0 | 1 | 2>(0); // 0=全局 1/2=局部图谱
  const [showForces, setShowForces] = useState(false);
  const [forces, setForces] = useState<ForceParams>(DEFAULT_FORCES);
  const [q, setQ] = useState('');
  const [, setTick] = useState(0);
  const dragNodeRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const forcesRef = useRef(forces);
  forcesRef.current = forces;

  // ── 模拟状态 ──
  const simRef = useRef<SimState | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const sim = initSimState(graph);
    simRef.current = sim;
    dragNodeRef.current = null;
    // 不做同步预计算（264 节点 × 400 帧会阻塞主线程数秒）；
    // 交给下方 rAF 循环按 preroll 模式分批收敛，首帧立即出图
    setTick((t) => t + 1);
    return () => cancelAnimationFrame(rafRef.current);
  }, [graph]);

  const reheat = useCallback((target: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.alpha = Math.max(sim.alpha, target);
    sim.running = true;
  }, []);

  useEffect(() => {
    const loop = () => {
      const sim = simRef.current;
      if (sim) {
        if (sim.running && sim.alpha > ALPHA_MIN) {
          // preroll 阶段每帧批量 40 步（约 8 帧收敛），交互 reheat 后每帧 1 步
          const steps = sim.preroll ? 40 : 1;
          for (let i = 0; i < steps && sim.alpha > ALPHA_MIN; i++) {
            simTick(sim, forcesRef.current);
            sim.alpha += (ALPHA_TARGET - sim.alpha) * ALPHA_DECAY;
            sim.frame++;
          }
          if (sim.alpha <= ALPHA_MIN) {
            sim.preroll = false;
            sim.running = false;
          }
          setTick((t) => t + 1);
        } else if (sim.running) {
          sim.running = false;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const sim = simRef.current;
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    if (sim) for (const n of sim.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, sim?.frame]);

  const entityById = useMemo(() => {
    const m = new Map<string, WikiEntity>();
    for (const e of graph.entities) m.set(e.id, e);
    return m;
  }, [graph]);

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

  // 局部图谱：选中节点的 N 跳邻居
  const localSet = useMemo(() => {
    if (!selected || localDepth === 0) return null;
    const keep = new Set<string>([selected.id]);
    let frontier = [selected.id];
    for (let d = 0; d < localDepth; d++) {
      const next: string[] = [];
      for (const r of graph.relations) {
        if (frontier.includes(r.from) && !keep.has(r.to)) { keep.add(r.to); next.push(r.to); }
        if (frontier.includes(r.to) && !keep.has(r.from)) { keep.add(r.from); next.push(r.from); }
      }
      frontier = next;
    }
    return keep;
  }, [selected, localDepth, graph]);

  // 悬停邻居高亮集
  const hoverSet = useMemo(() => {
    if (!hoverId) return null;
    const s = new Set<string>([hoverId]);
    for (const r of graph.relations) {
      if (r.from === hoverId) s.add(r.to);
      if (r.to === hoverId) s.add(r.from);
    }
    return s;
  }, [hoverId, graph]);

  const visibleIds = useMemo(
    () =>
      new Set(
        graph.entities
          .filter((e) => !hiddenTypes.has(e.type))
          .filter((e) => !hideOrphans || (connCount.get(e.id) ?? 0) > 0)
          .filter((e) => !localSet || localSet.has(e.id))
          .map((e) => e.id),
      ),
    [graph, hiddenTypes, hideOrphans, connCount, localSet],
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

  const orphanCount = useMemo(
    () => graph.entities.filter((e) => (connCount.get(e.id) ?? 0) === 0).length,
    [graph, connCount],
  );

  const showLabels = view.k >= LABEL_FADE_K;

  // ── 视图操作 ──
  const applyView = useCallback((v: { x: number; y: number; k: number }) => {
    setView(v);
    const g = svgRef.current?.querySelector('g');
    if (g) g.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
  }, []);

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
    applyView({ k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k });
  }, [applyView, positions]);

  const didFit = useRef(false);
  useEffect(() => { didFit.current = false; }, [graph]);
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

  // 滚轮缩放
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
      const nodeId = nodeEl.getAttribute('data-node-id')!;
      dragNodeRef.current = nodeId;
      const node = simRef.current?.nodeMap.get(nodeId);
      if (node) {
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
    panningRef.current = true;
    panStartRef.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragNodeRef.current) {
      const node = simRef.current?.nodeMap.get(dragNodeRef.current);
      if (node) {
        const rect = containerRef.current!.getBoundingClientRect();
        node.fx = (e.clientX - rect.left - view.x) / view.k - dragOffsetRef.current.dx;
        node.fy = (e.clientY - rect.top - view.y) / view.k - dragOffsetRef.current.dy;
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
      const node = simRef.current?.nodeMap.get(dragNodeRef.current);
      if (node) { node.fx = undefined; node.fy = undefined; }
      dragNodeRef.current = null;
      reheat(0.1);
    }
    panningRef.current = false;
  };

  const toggleType = (t: string) =>
    setHiddenTypes((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n;
    });

  const updateForce = (key: keyof ForceParams, value: number) => {
    setForces((prev) => ({ ...prev, [key]: value }));
    reheat(0.5); // 滑块调整后重新模拟
  };

  const inputCls = 'h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  const FORCE_FIELDS: { key: keyof ForceParams; label: string; min: number; max: number; step: number }[] = [
    { key: 'charge', label: '排斥力', min: -1200, max: -50, step: 10 },
    { key: 'linkDist', label: '弹簧距离', min: 30, max: 300, step: 5 },
    { key: 'linkStrength', label: '弹簧强度', min: 0.01, max: 0.3, step: 0.01 },
    { key: 'centerGravity', label: '中心引力', min: 0, max: 0.2, step: 0.005 },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input className={`${inputCls} w-full pl-6`} placeholder="搜索实体…" value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} />
        </div>
        {selected && (
          <div className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px]">
            <span className="text-muted-foreground">局部</span>
            {([0, 1, 2] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`rounded-sm px-1.5 py-0.5 ${localDepth === d ? 'pill-active' : 'pill-inactive hover:text-foreground'}`}
                onClick={() => setLocalDepth(d)}
              >
                {d === 0 ? '全局' : `${d}跳`}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`rounded-md px-2 py-1 text-[11px] transition-colors ${hideOrphans ? 'pill-active' : 'pill-inactive hover:text-foreground'}`}
          title="隐藏没有任何关联的孤立节点"
          onClick={() => setHideOrphans((v) => !v)}
        >
          隐藏孤儿（{orphanCount}）
        </button>
        <div className="h-4 w-px bg-border" />
        <Button variant="outline" size="icon-sm" className="text-muted-foreground" title="力度调节" onClick={() => setShowForces((v) => !v)}><SlidersHorizontal className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon-sm" className="text-muted-foreground" title="放大" onClick={() => zoomBy(1.25)}><ZoomIn className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon-sm" className="text-muted-foreground" title="缩小" onClick={() => zoomBy(0.9)}><ZoomOut className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon-sm" className="text-muted-foreground" title="重置视图" onClick={fitView}><RotateCcw className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon-sm" className="text-muted-foreground" title="适配窗口" onClick={fitView}><Maximize className="h-4 w-4" /></Button>
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
          {/* 力度调节面板 */}
          {showForces && (
            <div className="absolute right-2 top-2 z-10 w-56 rounded-lg border border-border/70 bg-card p-3 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-foreground">力度调节</span>
                <Button variant="ghost" size="xs" onClick={() => { setForces(DEFAULT_FORCES); reheat(0.8); }}>
                  重置
                </Button>
              </div>
              {FORCE_FIELDS.map((f) => (
                <div key={f.key} className="mb-2">
                  <div className="mb-0.5 flex justify-between text-muted-foreground">
                    <span>{f.label}</span>
                    <span>{forces[f.key]}</span>
                  </div>
                  <input
                    type="range"
                    className="w-full"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={forces[f.key]}
                    onChange={(e) => updateForce(f.key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          )}

          {positions.size === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无图谱数据</div>
          ) : (
            <svg ref={svgRef} className="h-full w-full">
              <defs>
                <marker id="wiki-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" opacity={0.7} />
                </marker>
              </defs>
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {/* 边 */}
                {visibleRelations.map((r, i) => {
                  const a = positions.get(r.from);
                  const b = positions.get(r.to);
                  if (!a || !b) return null;
                  const isSel = selectedRelation === r;
                  const dimmed =
                    (matched && !matched.has(r.from) && !matched.has(r.to)) ||
                    (hoverSet && !hoverSet.has(r.from) && !hoverSet.has(r.to));
                  // 缩短终点避免箭头盖住节点
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const d = Math.sqrt(dx * dx + dy * dy) || 1;
                  const tr = nodeRadius(r.to) + 6;
                  const ex = b.x - (dx / d) * tr;
                  const ey = b.y - (dy / d) * tr;
                  return (
                    <g key={i}>
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="transparent"
                        strokeWidth={12}
                        className="cursor-pointer"
                        onClick={() => { setSelectedRelation(selectedRelation === r ? null : r); setSelected(null); }}
                      >
                        <title>{r.type}</title>
                      </line>
                      <line
                        x1={a.x} y1={a.y} x2={ex} y2={ey}
                        stroke={isSel ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                        strokeWidth={isSel ? 2 : 1}
                        strokeOpacity={dimmed ? 0.06 : isSel ? 1 : 0.5}
                        markerEnd="url(#wiki-arrow)"
                        pointerEvents="none"
                      />
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
                  const dimmed = (matched && !matched.has(e.id)) || (hoverSet && !hoverSet.has(e.id));
                  const isSel = selected?.id === e.id;
                  const isHover = hoverId === e.id;
                  const r = nodeRadius(e.id);
                  return (
                    <g
                      key={e.id}
                      transform={`translate(${p.x},${p.y})`}
                      className="cursor-pointer"
                      data-node-id={e.id}
                      onClick={() => { setSelected(isSel ? null : e); setSelectedRelation(null); }}
                      onDoubleClick={() => onSelectEntity?.(e)}
                      onMouseEnter={() => setHoverId(e.id)}
                      onMouseLeave={() => setHoverId(null)}
                    >
                      <circle
                        r={r}
                        fill={entityTypeColor(e.type)}
                        fillOpacity={dimmed ? 0.15 : 0.85}
                        stroke={isSel || isHover ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                        strokeWidth={isSel || isHover ? 2.5 : 1.5}
                      />
                      {(showLabels || isSel || isHover) && (
                        <text
                          y={r + 12}
                          textAnchor="middle"
                          fontSize={10}
                          className="fill-foreground"
                          opacity={dimmed ? 0.15 : 0.9}
                          pointerEvents="none"
                        >
                          {e.name.length > 12 ? e.name.slice(0, 11) + '…' : e.name}
                        </text>
                      )}
                      <title>{`${e.name} (${e.type})${onSelectEntity ? ' · 双击打开文章' : ''}`}</title>
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
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">{selectedRelation.type}</span>
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
                <Button variant="ghost" size="xs" className="mt-4" onClick={() => setSelectedRelation(null)}>
                  ✕ 关闭
                </Button>
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
                        className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left hover:bg-muted"
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
            <Button
              key={t}
              variant="ghost"
              size="xs"
              className={hidden ? 'opacity-30' : ''}
              onClick={() => toggleType(t)}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: entityTypeColor(t) }} />
              <span className="text-muted-foreground">{t}</span>
              <span className="text-muted-foreground/60">{count}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
