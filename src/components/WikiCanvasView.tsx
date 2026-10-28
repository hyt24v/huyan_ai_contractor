// Obsidian Canvas 只读渲染：节点卡片 + 连线，支持缩放/平移
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';

interface CanvasNode {
  id: string;
  type: string; // text / group / file / link
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  label?: string;
  file?: string;
}
interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  color?: string;
  label?: string;
}
interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// Obsidian 画布调色板 1-6
const CANVAS_COLORS: Record<string, string> = {
  '1': '#ef4444',
  '2': '#f59e0b',
  '3': '#eab308',
  '4': '#22c55e',
  '5': '#06b6d4',
  '6': '#a855f7',
};

export function parseCanvas(text: string): CanvasData {
  try {
    const d = JSON.parse(text) as CanvasData;
    if (!Array.isArray(d.nodes)) return { nodes: [], edges: [] };
    return { nodes: d.nodes, edges: Array.isArray(d.edges) ? d.edges : [] };
  } catch {
    return { nodes: [], edges: [] };
  }
}

export default function WikiCanvasView({ content }: { content: string }) {
  const data = useMemo(() => parseCanvas(content), [content]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  const bbox = useMemo(() => {
    if (data.nodes.length === 0) return { minX: 0, minY: 0, w: 100, h: 100 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }, [data]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || bbox.w === 0) return;
    const scale = Math.min(el.clientWidth / (bbox.w + 80), el.clientHeight / (bbox.h + 80), 1);
    setView({
      scale,
      x: (el.clientWidth - bbox.w * scale) / 2 - bbox.minX * scale,
      y: (el.clientHeight - bbox.h * scale) / 2 - bbox.minY * scale,
    });
  }, [bbox]);

  useEffect(() => {
    fit();
  }, [fit]);

  // wheel 缩放（passive: false 才能 preventDefault）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const next = Math.min(2.5, Math.max(0.1, v.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
        const k = next / v.scale;
        return { scale: next, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);

  if (data.nodes.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">画布为空或解析失败</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 cursor-grab overflow-hidden bg-background active:cursor-grabbing"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        dragRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        setView((v) => ({ ...v, x: d.vx + e.clientX - d.px, y: d.vy + e.clientY - d.py }));
      }}
      onPointerUp={() => (dragRef.current = null)}
      onDoubleClick={fit}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {data.edges.map((e) => {
            const a = nodeById.get(e.fromNode);
            const b = nodeById.get(e.toNode);
            if (!a || !b) return null;
            const x1 = a.x + a.width / 2;
            const y1 = a.y + a.height / 2;
            const x2 = b.x + b.width / 2;
            const y2 = b.y + b.height / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={e.id}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={e.color ? CANVAS_COLORS[e.color] ?? '#94a3b8' : '#94a3b8'}
                strokeWidth={2 / view.scale}
                opacity={0.5}
              />
            );
          })}
        </svg>
        {data.nodes.map((n) => {
          const color = n.color ? CANVAS_COLORS[n.color] : undefined;
          const isGroup = n.type === 'group';
          return (
            <div
              key={n.id}
              className={`absolute overflow-hidden rounded-md border p-2 text-[11px] leading-relaxed ${
                isGroup
                  ? 'border-dashed border-border bg-muted/30'
                  : 'border-border bg-card shadow-sm'
              }`}
              style={{
                left: n.x,
                top: n.y,
                width: n.width,
                height: n.height,
                borderColor: color,
                borderLeftWidth: color ? 3 : undefined,
              }}
            >
              {n.label && <div className="mb-1 text-[10px] font-semibold text-muted-foreground">{n.label}</div>}
              {n.file && <div className="text-[10px] text-primary">{n.file}</div>}
              {n.text && <div className="whitespace-pre-wrap break-words">{n.text}</div>}
            </div>
          );
        })}
      </div>
      <div className="absolute right-2 top-2 flex gap-1">
        <button
          type="button"
          onClick={fit}
          className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          适配
        </button>
      </div>
    </div>
  );
}
