import { describe, expect, it } from 'vitest';
import {
  compareSnapshotIds,
  isSafeRelPath,
  isValidCopyName,
  isValidSnapshotId,
  parseSnapshot,
  prunePlan,
  serializeSnapshot,
  snapshotCopyName,
  snapshotDisplayTime,
  snapshotId,
  uniqueSnapshotId,
  type SnapshotRecord,
} from './backups';

describe('snapshotId', () => {
  it('生成 ISO 安全、可按字典序排序的 ID', () => {
    const id = snapshotId(new Date('2026-10-22T10:47:05.123Z'));
    expect(id).toBe('2026-10-22T10-47-05-123Z');
    expect(isValidSnapshotId(id)).toBe(true);
    expect(id).not.toContain(':');
    expect(id.startsWith('.')).toBe(false);
  });

  it('拒绝路径穿越与非法字符', () => {
    expect(isValidSnapshotId('../etc')).toBe(false);
    expect(isValidSnapshotId('2026-10-22')).toBe(false);
    expect(isValidSnapshotId('2026-10-22T10-47-05-123Z/../x')).toBe(false);
    expect(isValidSnapshotId('')).toBe(false);
  });

  it('允许重复后缀', () => {
    expect(isValidSnapshotId('2026-10-22T10-47-05-123Z-2')).toBe(true);
  });
});

describe('uniqueSnapshotId', () => {
  it('无冲突时原样返回', () => {
    expect(uniqueSnapshotId('a', [])).toBe('a');
  });

  it('冲突时追加递增后缀', () => {
    expect(uniqueSnapshotId('a', ['a'])).toBe('a-2');
    expect(uniqueSnapshotId('a', ['a', 'a-2'])).toBe('a-3');
  });
});

describe('compareSnapshotIds', () => {
  it('按时间升序，且重复后缀按数字排序', () => {
    const ids = [
      '2026-10-22T10-47-05-123Z-10',
      '2026-10-22T10-47-05-123Z',
      '2026-10-22T09-00-00-000Z',
      '2026-10-22T10-47-05-123Z-2',
    ];
    expect([...ids].sort(compareSnapshotIds)).toEqual([
      '2026-10-22T09-00-00-000Z',
      '2026-10-22T10-47-05-123Z',
      '2026-10-22T10-47-05-123Z-2',
      '2026-10-22T10-47-05-123Z-10',
    ]);
  });
});

describe('prunePlan', () => {
  const mk = (d: number) =>
    `2026-10-${String(d).padStart(2, '0')}T00-00-00-000Z`;

  it('保留最新 N 个，返回需要删除的旧快照', () => {
    const ids = [mk(1), mk(3), mk(2), mk(5), mk(4)];
    expect(prunePlan(ids, 2).sort()).toEqual([mk(1), mk(2), mk(3)].sort());
  });

  it('数量不超过 N 时不删除', () => {
    expect(prunePlan([mk(1), mk(2)], 20)).toEqual([]);
  });

  it('默认保留 20 个', () => {
    const ids = Array.from({ length: 25 }, (_, i) =>
      mk(i + 1),
    );
    const dropped = prunePlan(ids);
    expect(dropped).toHaveLength(5);
    expect(dropped).not.toContain(mk(25));
  });

  it('忽略非法 ID，避免误删未知目录', () => {
    expect(prunePlan([mk(1), 'not-a-snapshot', '../x'], 0)).toEqual([mk(1)]);
  });

  it('keep 为负按 0 处理', () => {
    expect(prunePlan([mk(1)], -3)).toEqual([mk(1)]);
  });
});

describe('snapshotCopyName', () => {
  it('去掉前导点并展平路径，避免隐藏文件与同名冲突', () => {
    expect(snapshotCopyName('.claude.json')).toBe('claude.json');
    expect(snapshotCopyName('.codex/config.toml')).toBe('codex~config.toml');
    expect(snapshotCopyName('.cursor/mcp.json')).toBe('cursor~mcp.json');
    expect(snapshotCopyName('.pi/agent/mcp.json')).toBe('pi~agent~mcp.json');
    expect(snapshotCopyName('.ai-baogongtou/mcp-central.json')).toBe(
      'ai-baogongtou~mcp-central.json',
    );
  });

  it('不同 agent 的 mcp.json 不冲突', () => {
    expect(snapshotCopyName('.cursor/mcp.json')).not.toBe(
      snapshotCopyName('.pi/agent/mcp.json'),
    );
  });

  it('编码无碰撞：路径分隔符与字面字符可区分', () => {
    // .claude/mcp.json vs 字面文件名 claude__mcp.json 不能映射到同一副本名
    expect(snapshotCopyName('.claude/mcp.json')).not.toBe(snapshotCopyName('claude__mcp.json'));
    // 字面 ~ 先转义为 ~~，不与分隔符 ~ 碰撞
    expect(snapshotCopyName('a~b')).toBe('a~~b');
    expect(snapshotCopyName('a~b')).not.toBe(snapshotCopyName('a/b'));
  });

  it('空路径有兜底名', () => {
    expect(snapshotCopyName('')).toBe('file');
  });
});

describe('isValidCopyName / isSafeRelPath', () => {
  it('拒绝带分隔符 / .. / 非法字符的副本名', () => {
    expect(isValidCopyName('claude.json')).toBe(true);
    expect(isValidCopyName('codex~config.toml')).toBe(true);
    expect(isValidCopyName('codex__config.toml')).toBe(true); // 旧格式快照仍可回滚
    expect(isValidCopyName('../../x')).toBe(false);
    expect(isValidCopyName('a/b')).toBe(false);
    expect(isValidCopyName('..')).toBe(false);
    expect(isValidCopyName('a..b')).toBe(false);
    expect(isValidCopyName('')).toBe(false);
  });

  it('相对路径不允许越界', () => {
    expect(isSafeRelPath('.claude.json')).toBe(true);
    expect(isSafeRelPath('.codex/config.toml')).toBe(true);
    expect(isSafeRelPath('../evil')).toBe(false);
    expect(isSafeRelPath('a/../../evil')).toBe(false);
    expect(isSafeRelPath('/abs/path')).toBe(false);
    expect(isSafeRelPath('')).toBe(false);
  });
});

describe('serializeSnapshot / parseSnapshot', () => {
  const record: SnapshotRecord = {
    id: '2026-10-22T10-47-05-123Z',
    label: '分发前自动快照',
    createdAt: '2026-10-22T10:47:05.123Z',
    files: [
      { file: '.claude.json', copy: 'claude.json', exists: true, bytes: 42 },
      { file: '.codex/config.toml', copy: 'codex__config.toml', exists: false, bytes: 0 },
    ],
  };

  it('序列化后可完整解析', () => {
    const text = serializeSnapshot(record);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseSnapshot(text)).toEqual(record);
  });

  it('非法 JSON / 结构返回 null', () => {
    expect(parseSnapshot('nope')).toBeNull();
    expect(parseSnapshot('null')).toBeNull();
    expect(parseSnapshot('{"id":"bad"}')).toBeNull();
  });

  it('容错缺失字段与非法 files 项', () => {
    const parsed = parseSnapshot(
      JSON.stringify({
        id: '2026-10-22T10-47-05-123Z',
        files: [{ file: '.claude.json' }, null, { nope: 1 }],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.label).toBe('');
    expect(parsed!.createdAt).toBe('');
    expect(parsed!.files).toEqual([
      { file: '.claude.json', copy: 'claude.json', exists: false, bytes: 0 },
    ]);
  });
});

describe('snapshotDisplayTime', () => {
  it('格式化 createdAt', () => {
    expect(
      snapshotDisplayTime({
        id: 'x',
        label: '',
        createdAt: '2026-10-22T10:47:05.123Z',
        files: [],
      }),
    ).toMatch(/^2026-10-22 \d{2}:\d{2}:\d{2}$/);
  });

  it('无有效时间时回退 ID', () => {
    expect(snapshotDisplayTime({ id: 'abc', label: '', createdAt: '', files: [] })).toBe('abc');
  });
});