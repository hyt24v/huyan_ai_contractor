import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { JsonTreeNode } from '../lib/json';

/**
 * JSON 节点图视图（参考 jsoncrack）：左→右分层树布局，
 * 卡片节点 + 贝塞尔连线，滚轮缩放（以光标为中心）+ 拖拽平移。
 * 节点数超 MAX_NODES 时裁剪并标注 …，避免大 JSON 卡死。
 */

const CARD_W = 200;
const CARD_H = 52;
const GAP_X = 56;
const GAP_Y = 14;
const MAX_NODES = 400;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;

/** 与树视图一致的类型色（token 见 themes.ts --json-*） */
const TYPE_COLOR: Record<JsonTreeNode['type'], string> = {
  string: 'text-json-string',
  number: 'text-json-number',
  boolean: 'text-json-boolean',
  null: 'text-json-null',
  object: 'text-muted-foreground',
  array: 'text-muted-foreground',
};

type LayoutNode = {
  node: JsonTreeNode;
  x: number;
  y: number;
  /** 子节点因节点预算耗尽被裁剪 */
  truncated: boolean;
  children: LayoutNode[];
};

type Edge = { key: string; x1: number; y1: number; x2: number; y2: number };

function layoutTree(root: JsonTreeNode): {
  nodes: LayoutNode[];
  edges: Edge[];
  width: number;
  height: number;
} {
  let budget = MAX_NODES;
  let leafTop = 0;
  let maxX = CARD_W;
  const nodes: LayoutNode[] = [];
  const edges: Edge[] = [];

  const build = (n: JsonTreeNode, depth: number): LayoutNode => {
    budget--;
    const ln: LayoutNode = {
      node: n,
      x: depth * (CARD_W + GAP_X),
      y: 0,
      truncated: false,
      children: [],
    };
    maxDepthX(ln);
    nodes.push(ln);
    if (n.children && n.children.length > 0) {
      for (const c of n.children) {
        if (budget <= 0) {
          ln.truncated = true;
          break;
        }
        ln.children.push(build(c, depth + 1));
      }
    }
    if (ln.children.length === 0) {
      ln.y = leafTop;
      leafTop += CARD_H + GAP_Y;
    } else {
      const first = ln.children[0];
      const last = ln.children[ln.children.length - 1];
      ln.y = (first.y + last.y) / 2;
      for (const c of ln.children) {
        edges.push({
          key: `${ln.node.path}->${c.node.path}`,
          x1: ln.x + CARD_W,
          y1: ln.y + CARD_H / 2,
          x2: c.x,
          y2: c.y + CARD_H / 2,
        });
      }
    }
    return ln;
  };
  const maxDepthX = (ln: LayoutNode) => {
    maxX = Math.max(maxX, ln.x + CARD_W);
  };

  build(root, 0);
  const height = Math.max(leafTop - GAP_Y, CARD_H);
  return { nodes, edges, width: maxX, height };
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export default function JsonGraphView({ root }: { root: JsonTreeNode | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 24, y: 24, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(
    null,
  );

  const graph = useMemo(() => (root ? layoutTree(root) : null), [root]);

  const fit = () => {
    const el = containerRef.current;
    if (!el || !graph) return;
    const rect = el.getBoundingClientRect();
    const zoom = clampZoom(
      Math.min(rect.width / graph.width, rect.height / graph.height, 1) * 0.92,
    );
    setView({
      x: (rect.width - graph.width * zoom) / 2,
      y: (rect.height - graph.height * zoom) / 2,
      zoom,
    });
  };

  // 数据变化时自动适配（首次挂载 rect 已可用，因 effect 在绘制后运行）
  const graphKey = graph ? `${graph.width}x${graph.height}` : '';
  useEffect(() => {
    if (graph) fit();
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

  if (!root || !graph) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        输入合法 JSON 后，这里会显示节点图
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full cursor-grab touch-none overflow-hidden bg-background active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        panRef.current = {
          px: e.clientX,
          py: e.clientY,
          vx: viewRef.current.x,
          vy: viewRef.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const pan = panRef.current;
        if (!pan) return;
        setView((v) => ({
          ...v,
          x: pan.vx + (e.clientX - pan.px),
          y: pan.vy + (e.clientY - pan.py),
        }));
      }}
      onPointerUp={(e) => {
        panRef.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        panRef.current = null;
      }}
    >
      {/* 缩放层：连线（SVG）+ 卡片节点同一坐标系 */}
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          width={graph.width}
          height={graph.height}
          className="absolute left-0 top-0 overflow-visible text-border"
        >
          {graph.edges.map((e) => {
            const mx = (e.x1 + e.x2) / 2;
            return (
              <path
                key={e.key}
                d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {graph.nodes.map((ln) => {
          const n = ln.node;
          return (
            <div
              key={n.path || n.key}
              className="absolute select-none rounded-md border bg-card px-2 py-1.5 font-mono transition-colors hover:border-primary/50"
              style={{ left: ln.x, top: ln.y, width: CARD_W, height: CARD_H }}
            >
              <div className="flex h-4 items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                <span className="truncate">{n.key || '(root)'}</span>
                {n.childCount > 0 && (
                  <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                    {n.type === 'array' ? `[${n.childCount}]` : `{${n.childCount}}`}
                  </span>
                )}
                {ln.truncated && (
                  <span className="shrink-0 text-muted-foreground" title="节点过多已裁剪">
                    …
                  </span>
                )}
              </div>
              <div
                className={`mt-0.5 truncate text-[11px] ${TYPE_COLOR[n.type]}`}
                title={n.preview}
              >
                {n.childCount > 0
                  ? n.type === 'array'
                    ? '数组'
                    : '对象'
                  : n.preview}
              </div>
            </div>
          );
        })}
      </div>

      {/* 缩放工具条 */}
      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border bg-card/90 px-1 py-0.5 backdrop-blur">
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => zoomBy(1 / 1.25)}
          title="缩小"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className="h-6 min-w-10 rounded-sm px-1 text-center text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setView({ x: 24, y: 24, zoom: 1 })}
          title="重置为 100%"
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => zoomBy(1.25)}
          title="放大"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={fit}
          title="适配窗口"
        >
          <Maximize className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
