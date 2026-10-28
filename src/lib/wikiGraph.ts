/**
 * 知识库知识图谱：解析 ~/Desktop/huyan_wiki/wiki/.entities.json，
 * 提供无依赖的「按类型聚类环形」静态布局与类型配色。
 */

export interface WikiEntity {
  id: string;
  type: string;
  name: string;
  confidence?: number;
  attributes: Record<string, unknown>;
}

export interface WikiRelation {
  from: string;
  to: string;
  type: string;
  confidence?: number;
}

export interface WikiGraph {
  entities: WikiEntity[];
  relations: WikiRelation[];
}

/** 9 种实体类型配色（未知类型 fallback #94a3b8） */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  Concept: '#8b5cf6',
  Tool: '#3b82f6',
  Dataset: '#22c55e',
  Pattern: '#f59e0b',
  Platform: '#06b6d4',
  Person: '#ec4899',
  Event: '#ef4444',
  Standard: '#84cc16',
  Resource: '#64748b',
};

export const ENTITY_TYPE_FALLBACK_COLOR = '#94a3b8';

export function entityTypeColor(type: string): string {
  return ENTITY_TYPE_COLORS[type] ?? ENTITY_TYPE_FALLBACK_COLOR;
}

/**
 * 容错解析 .entities.json：
 * - 坏 JSON / 非对象 → 空图
 * - 缺 id/name 的实体跳过（type 缺省为 'Unknown'，attributes 缺省为 {}）
 * - relationships 里 to 指向不存在实体的边丢弃
 */
export function parseWikiGraph(text: string): WikiGraph {
  const empty: WikiGraph = { entities: [], relations: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  if (typeof raw !== 'object' || raw === null) return empty;
  const rawEntities = (raw as { entities?: unknown }).entities;
  if (!Array.isArray(rawEntities)) return empty;

  const entities: WikiEntity[] = [];
  const pending: { from: string; rel: unknown }[] = [];
  const seen = new Set<string>();

  for (const item of rawEntities) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id === '') continue;
    if (typeof e.name !== 'string' || e.name === '') continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    entities.push({
      id: e.id,
      type: typeof e.type === 'string' && e.type !== '' ? e.type : 'Unknown',
      name: e.name,
      confidence: typeof e.confidence === 'number' ? e.confidence : undefined,
      attributes:
        typeof e.attributes === 'object' && e.attributes !== null && !Array.isArray(e.attributes)
          ? (e.attributes as Record<string, unknown>)
          : {},
    });
    if (Array.isArray(e.relationships)) {
      for (const rel of e.relationships) pending.push({ from: e.id, rel });
    }
  }

  const ids = new Set(entities.map((en) => en.id));
  const relations: WikiRelation[] = [];
  for (const { from, rel } of pending) {
    if (typeof rel !== 'object' || rel === null) continue;
    const r = rel as Record<string, unknown>;
    if (typeof r.to !== 'string' || r.to === '') continue;
    if (!ids.has(r.to)) continue; // 丢弃指向不存在实体的边
    relations.push({
      from,
      to: r.to,
      type: typeof r.type === 'string' && r.type !== '' ? r.type : 'related',
      confidence: typeof r.confidence === 'number' ? r.confidence : undefined,
    });
  }

  return { entities, relations };
}

/**
 * 无依赖静态布局：按 type 聚类的环形布局。
 * - 每个类型一个簇，簇中心均匀分布在一个大圆上
 * - 簇内节点沿同心圆弧排布（内圈到外圈，每圈容量递增）
 * 返回 Map<entityId, {x, y}>
 */
export function layoutGraph(graph: WikiGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const entities = graph.entities;
  if (entities.length === 0) return positions;

  // 按 type 分组（保持首次出现顺序）
  const clusters = new Map<string, WikiEntity[]>();
  for (const e of entities) {
    const list = clusters.get(e.type);
    if (list) list.push(e);
    else clusters.set(e.type, [e]);
  }

  const RING_GAP = 42; // 簇内相邻环间距
  const FIRST_RING = 46; // 簇内最内环半径

  // 计算每个簇的半径（容纳所有节点的最外环半径 + 节点余量）
  const clusterList = Array.from(clusters.entries()).map(([type, members]) => {
    let remaining = members.length;
    let ring = 0;
    let radius = FIRST_RING;
    while (remaining > 0) {
      const capacity = ring === 0 ? 6 : 6 + ring * 6;
      radius = FIRST_RING + ring * RING_GAP;
      remaining -= capacity;
      ring++;
    }
    return { type, members, radius: radius + 30 };
  });

  // 大圆半径：让所有簇沿周长不挤压
  const totalCircumference = clusterList.reduce((sum, c) => sum + c.radius * 2 + 40, 0);
  const bigRadius =
    clusterList.length === 1
      ? 0 // 只有一个簇时直接放原点
      : Math.max(220, totalCircumference / (2 * Math.PI));

  clusterList.forEach((cluster, ci) => {
    const angle = (2 * Math.PI * ci) / clusterList.length - Math.PI / 2;
    const cx = bigRadius * Math.cos(angle);
    const cy = bigRadius * Math.sin(angle);

    let idx = 0;
    let ring = 0;
    while (idx < cluster.members.length) {
      const capacity = ring === 0 ? 6 : 6 + ring * 6;
      const r = FIRST_RING + ring * RING_GAP;
      const count = Math.min(capacity, cluster.members.length - idx);
      for (let k = 0; k < count; k++) {
        const a = (2 * Math.PI * k) / count - Math.PI / 2 + ring * 0.35;
        positions.set(cluster.members[idx + k].id, {
          x: cx + r * Math.cos(a),
          y: cy + r * Math.sin(a),
        });
      }
      idx += count;
      ring++;
    }
  });

  return positions;
}

// ── 树状布局（Tidy Tree：子节点聚拢在父节点下方，父居中，森林垂直排列）──

const LEVEL_W = 220;
const LEAF_H = 40;
const SIBLING_GAP = 6;

/** 树节点（内部使用） */
interface TreeNode {
  id: string;
  children: TreeNode[];
  depth: number;
  /** 布局结果 */
  x: number;
  y: number;
}

/** 从图构建树（BFS，每节点只访问一次；多根为森林） */
function buildForest(graph: WikiGraph): TreeNode[] {
  const { entities, relations } = graph;
  // 邻接表（双向）
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const e of entities) { adj.set(e.id, []); inDeg.set(e.id, 0); }
  for (const r of relations) {
    if (adj.has(r.from) && adj.has(r.to)) {
      adj.get(r.from)!.push(r.to);
      adj.get(r.to)!.push(r.from);
      inDeg.set(r.to, (inDeg.get(r.to) ?? 0) + 1);
    }
  }

  // 根：入度 0，或连接数 top 2%
  let rootIds = entities.filter((e) => (inDeg.get(e.id) ?? 0) === 0).map((e) => e.id);
  if (rootIds.length === 0) {
    const conn = new Map<string, number>();
    for (const r of relations) {
      conn.set(r.from, (conn.get(r.from) ?? 0) + 1);
      conn.set(r.to, (conn.get(r.to) ?? 0) + 1);
    }
    rootIds = [...conn.entries()].sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, Math.ceil(entities.length * 0.02)))
      .map(([id]) => id);
  }

  // BFS 构建树
  const visited = new Set<string>();
  const makeNode = (id: string, depth: number): TreeNode => {
    visited.add(id);
    const children: TreeNode[] = [];
    for (const cid of adj.get(id) ?? []) {
      if (!visited.has(cid)) {
        children.push(makeNode(cid, depth + 1));
      }
    }
    return { id, children, depth, x: 0, y: 0 };
  };

  const forest: TreeNode[] = [];
  for (const rid of rootIds) {
    if (!visited.has(rid)) forest.push(makeNode(rid, 0));
  }
  // 未访问的节点（断连组件）各自成树
  for (const e of entities) {
    if (!visited.has(e.id)) forest.push(makeNode(e.id, 0));
  }
  return forest;
}

/** Tidy tree 后序遍历分配 y 坐标 */
function assignY(node: TreeNode, nextY: { value: number }): void {
  if (node.children.length === 0) {
    node.y = nextY.value;
    nextY.value += LEAF_H + SIBLING_GAP;
    return;
  }
  for (const child of node.children) {
    assignY(child, nextY);
  }
  // 父节点居中于子节点
  const first = node.children[0].y;
  const last = node.children[node.children.length - 1].y;
  node.y = (first + last) / 2;
}

/** Tidy Tree 布局：左→右，每层一列，子树紧凑排列 */
export function layoutTree(graph: WikiGraph): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (graph.entities.length === 0) return result;

  const forest = buildForest(graph);
  const nextY = { value: 0 };

  for (const root of forest) {
    assignY(root, nextY);
    nextY.value += LEAF_H; // 树之间留空
  }

  // 收集结果
  const collect = (node: TreeNode) => {
    result.set(node.id, { x: node.depth * LEVEL_W, y: node.y });
    for (const c of node.children) collect(c);
  };
  for (const root of forest) collect(root);

  return result;
}
