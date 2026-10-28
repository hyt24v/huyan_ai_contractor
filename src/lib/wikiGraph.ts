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

// ── 树状布局（BFS 分层，左→右排列，静态无动画）──

const LEVEL_W = 200;
const NODE_H = 50;

/** BFS 分层树状布局：入度 0 或连接数 top 2% 为根，每层内按父节点位置排序减少交叉 */
export function layoutTree(graph: WikiGraph): Map<string, { x: number; y: number }> {
  const { entities, relations } = graph;
  const result = new Map<string, { x: number; y: number }>();
  if (entities.length === 0) return result;

  // 邻接表（双向）
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const e of entities) { adj.set(e.id, []); inDegree.set(e.id, 0); }
  for (const r of relations) {
    if (adj.has(r.from) && adj.has(r.to)) {
      adj.get(r.from)!.push(r.to);
      adj.get(r.to)!.push(r.from);
      inDegree.set(r.to, (inDegree.get(r.to) ?? 0) + 1);
    }
  }

  // 根节点
  let roots = entities.filter((e) => (inDegree.get(e.id) ?? 0) === 0).map((e) => e.id);
  if (roots.length === 0) {
    const conn = new Map<string, number>();
    for (const r of relations) {
      conn.set(r.from, (conn.get(r.from) ?? 0) + 1);
      conn.set(r.to, (conn.get(r.to) ?? 0) + 1);
    }
    const sorted = [...conn.entries()].sort((a, b) => b[1] - a[1]);
    roots = sorted.slice(0, Math.max(1, Math.ceil(entities.length * 0.02))).map(([id]) => id);
  }

  // BFS 分层
  const level = new Map<string, number>();
  const visited = new Set<string>();
  let queue = roots.map((id) => ({ id, lv: 0 }));
  for (const { id, lv } of queue) { level.set(id, lv); visited.add(id); }
  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { id, lv } of queue) {
      for (const cid of adj.get(id) ?? []) {
        if (!visited.has(cid)) {
          visited.add(cid);
          level.set(cid, lv + 1);
          next.push({ id: cid, lv: lv + 1 });
        }
      }
    }
    queue = next;
  }
  const maxLv = Math.max(0, ...level.values());
  for (const e of entities) if (!level.has(e.id)) level.set(e.id, maxLv + 1);

  // 按层分组
  const layers = new Map<number, string[]>();
  for (const [id, lv] of level) {
    if (!layers.has(lv)) layers.set(lv, []);
    layers.get(lv)!.push(id);
  }

  // 布局：x = 层 * 宽度，y 在层内按父节点位置排序
  const sortedLvs = [...layers.keys()].sort((a, b) => a - b);
  for (const lv of sortedLvs) {
    const ids = layers.get(lv)!;
    if (lv === 0) {
      ids.sort();
    } else {
      const parentY = new Map<string, number>();
      for (const id of ids) {
        let sum = 0, cnt = 0;
        for (const r of relations) {
          if (r.to === id && level.get(r.from) === lv - 1 && result.has(r.from)) {
            sum += result.get(r.from)!.y; cnt++;
          }
          if (r.from === id && level.get(r.to) === lv - 1 && result.has(r.to)) {
            sum += result.get(r.to)!.y; cnt++;
          }
        }
        parentY.set(id, cnt > 0 ? sum / cnt : 0);
      }
      ids.sort((a, b) => (parentY.get(a) ?? 0) - (parentY.get(b) ?? 0));
    }
    const totalH = ids.length * NODE_H;
    for (let i = 0; i < ids.length; i++) {
      result.set(ids[i], { x: lv * LEVEL_W, y: i * NODE_H - totalH / 2 });
    }
  }

  return result;
}
