import { describe, expect, it } from 'vitest';
import { ENTITY_TYPE_COLORS, layoutGraph, parseWikiGraph } from '../wikiGraph';

describe('parseWikiGraph', () => {
  it('正常解析实体与关系', () => {
    const text = JSON.stringify({
      entities: [
        {
          id: 'a',
          type: 'Concept',
          name: 'Alpha',
          confidence: 0.9,
          attributes: { zh: '甲' },
          relationships: [{ to: 'b', type: 'uses', confidence: 0.8 }],
        },
        { id: 'b', type: 'Tool', name: 'Beta', attributes: {} },
      ],
      lastUpdated: '2026-01-01',
    });
    const g = parseWikiGraph(text);
    expect(g.entities).toHaveLength(2);
    expect(g.entities[0]).toMatchObject({
      id: 'a',
      type: 'Concept',
      name: 'Alpha',
      confidence: 0.9,
      attributes: { zh: '甲' },
    });
    expect(g.entities[1].confidence).toBeUndefined();
    expect(g.relations).toEqual([{ from: 'a', to: 'b', type: 'uses', confidence: 0.8 }]);
  });

  it('坏 JSON 返回空图', () => {
    expect(parseWikiGraph('{bad json')).toEqual({ entities: [], relations: [] });
    expect(parseWikiGraph('')).toEqual({ entities: [], relations: [] });
    expect(parseWikiGraph('[1,2,3]')).toEqual({ entities: [], relations: [] });
    expect(parseWikiGraph('{"entities":"nope"}')).toEqual({ entities: [], relations: [] });
  });

  it('丢弃指向不存在实体的孤立边', () => {
    const text = JSON.stringify({
      entities: [
        {
          id: 'a',
          type: 'Concept',
          name: 'Alpha',
          relationships: [
            { to: 'ghost', type: 'uses' },
            { to: 'b', type: 'extends' },
          ],
        },
        { id: 'b', type: 'Tool', name: 'Beta' },
      ],
    });
    const g = parseWikiGraph(text);
    expect(g.relations).toEqual([{ from: 'a', to: 'b', type: 'extends', confidence: undefined }]);
  });

  it('缺字段的实体跳过，缺省字段有兜底', () => {
    const text = JSON.stringify({
      entities: [
        { id: 'no-name', type: 'Concept' }, // 缺 name → 跳过
        { name: 'NoId', type: 'Concept' }, // 缺 id → 跳过
        'not-an-object', // 非对象 → 跳过
        { id: 'ok', name: 'Ok' }, // 缺 type/attributes → 兜底
        { id: 'ok', name: 'Dupe' }, // 重复 id → 跳过
        { id: 'bad-rel', name: 'BadRel', type: 'Tool', relationships: [{ type: 'x' }, null] },
      ],
    });
    const g = parseWikiGraph(text);
    expect(g.entities.map((e) => e.id)).toEqual(['ok', 'bad-rel']);
    expect(g.entities[0].type).toBe('Unknown');
    expect(g.entities[0].attributes).toEqual({});
    expect(g.relations).toEqual([]);
  });
});

describe('layoutGraph', () => {
  const graph = parseWikiGraph(
    JSON.stringify({
      entities: [
        { id: 'c1', type: 'Concept', name: 'C1' },
        { id: 'c2', type: 'Concept', name: 'C2' },
        { id: 'c3', type: 'Concept', name: 'C3' },
        { id: 't1', type: 'Tool', name: 'T1' },
        { id: 't2', type: 'Tool', name: 'T2' },
        { id: 'd1', type: 'Dataset', name: 'D1' },
      ],
    }),
  );
  const positions = layoutGraph(graph);

  it('所有实体都有坐标', () => {
    expect(positions.size).toBe(6);
    for (const e of graph.entities) {
      const p = positions.get(e.id);
      expect(p).toBeDefined();
      expect(Number.isFinite(p!.x)).toBe(true);
      expect(Number.isFinite(p!.y)).toBe(true);
    }
  });

  it('空图返回空 Map', () => {
    expect(layoutGraph({ entities: [], relations: [] }).size).toBe(0);
  });

  it('同类型实体同属一簇（簇间距大于簇内距）', () => {
    const dist = (a: string, b: string) => {
      const pa = positions.get(a)!;
      const pb = positions.get(b)!;
      return Math.hypot(pa.x - pb.x, pa.y - pb.y);
    };
    // 簇内最大距离（Concept 簇 3 节点同环，直径 = 2*46 = 92）
    expect(dist('c1', 'c2')).toBeLessThanOrEqual(92.01);
    expect(dist('c1', 'c3')).toBeLessThanOrEqual(92.01);
    // 簇中心间距离（大圆半径 >= 220，3 簇夹角 120°，弦长 >= 220*sqrt(3) ≈ 381）
    expect(dist('c1', 't1')).toBeGreaterThan(300);
    expect(dist('c1', 'd1')).toBeGreaterThan(300);
  });

  it('同一类型的簇中心一致（到簇中心等距）', () => {
    // 同簇同环节点到簇中心等距：Concept 3 节点两两构成的外接圆半径一致
    const p1 = positions.get('c1')!;
    const p2 = positions.get('c2')!;
    const p3 = positions.get('c3')!;
    // 外接圆圆心即簇中心：三节点等距分布，中心 = 重心
    const cx = (p1.x + p2.x + p3.x) / 3;
    const cy = (p1.y + p2.y + p3.y) / 3;
    const r1 = Math.hypot(p1.x - cx, p1.y - cy);
    const r2 = Math.hypot(p2.x - cx, p2.y - cy);
    const r3 = Math.hypot(p3.x - cx, p3.y - cy);
    expect(Math.abs(r1 - r2)).toBeLessThan(1e-6);
    expect(Math.abs(r1 - r3)).toBeLessThan(1e-6);
  });
});

describe('ENTITY_TYPE_COLORS', () => {
  it('覆盖全部 9 种类型', () => {
    const types = [
      'Concept',
      'Pattern',
      'Dataset',
      'Tool',
      'Platform',
      'Person',
      'Event',
      'Standard',
      'Resource',
    ];
    for (const t of types) {
      expect(ENTITY_TYPE_COLORS[t]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(Object.keys(ENTITY_TYPE_COLORS)).toHaveLength(9);
  });

  it('颜色值符合规格', () => {
    expect(ENTITY_TYPE_COLORS.Concept).toBe('#8b5cf6');
    expect(ENTITY_TYPE_COLORS.Tool).toBe('#3b82f6');
    expect(ENTITY_TYPE_COLORS.Dataset).toBe('#22c55e');
    expect(ENTITY_TYPE_COLORS.Pattern).toBe('#f59e0b');
    expect(ENTITY_TYPE_COLORS.Platform).toBe('#06b6d4');
    expect(ENTITY_TYPE_COLORS.Person).toBe('#ec4899');
    expect(ENTITY_TYPE_COLORS.Event).toBe('#ef4444');
    expect(ENTITY_TYPE_COLORS.Standard).toBe('#84cc16');
    expect(ENTITY_TYPE_COLORS.Resource).toBe('#64748b');
  });
});
