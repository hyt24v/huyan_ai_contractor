// JSONL 核心纯函数库：逐行解析 / 格式化 / 字段并集 / 路径取值
// 无 UI 依赖，可单测。

/** 递归的 JSON 值领域类型 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonlLineResult {
  line: number; // 1-based 原始行号
  raw: string;
  empty: boolean;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** 逐行解析 JSONL；空行 empty=true 且不参与错误统计 */
export function parseJsonl(text: string): JsonlLineResult[] {
  const lines = text.split('\n');
  return lines.map((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { line, raw, empty: true, ok: true };
    }
    try {
      return { line, raw, empty: false, ok: true, value: JSON.parse(trimmed) };
    } catch (e) {
      return {
        line,
        raw,
        empty: false,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

export interface JsonlStats {
  total: number; // 总行数
  empty: number;
  errors: number;
  valid: number; // 非空且合法
}

export function jsonlStats(results: JsonlLineResult[]): JsonlStats {
  let empty = 0;
  let errors = 0;
  let valid = 0;
  for (const r of results) {
    if (r.empty) empty++;
    else if (r.ok) valid++;
    else errors++;
  }
  return { total: results.length, empty, errors, valid };
}

export interface JsonlTransformResult {
  ok: boolean;
  text: string;
  errors: { line: number; error: string }[];
}

/**
 * 规范化 JSONL：每个合法行重新序列化为单行规范 JSON。
 * 非法行原样保留并记录错误；空行默认剔除（keepEmptyLines 可保留）。
 */
export function normalizeJsonl(
  text: string,
  opts?: { keepEmptyLines?: boolean },
): JsonlTransformResult {
  const results = parseJsonl(text);
  const errors: { line: number; error: string }[] = [];
  const out: string[] = [];
  for (const r of results) {
    if (r.empty) {
      if (opts?.keepEmptyLines) out.push('');
      continue;
    }
    if (r.ok) {
      out.push(JSON.stringify(r.value));
    } else {
      out.push(r.raw);
      errors.push({ line: r.line, error: r.error ?? '解析失败' });
    }
  }
  return { ok: errors.length === 0, text: out.join('\n'), errors };
}

/** 删除指定行（1-based），返回新文本 */
export function deleteLine(text: string, line: number): string {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return text;
  lines.splice(line - 1, 1);
  return lines.join('\n');
}

/** 复制指定行（插入到原行之后），返回新文本 */
export function duplicateLine(text: string, line: number): string {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return text;
  lines.splice(line, 0, lines[line - 1]);
  return lines.join('\n');
}

// ---------- 字段并集与路径取值 ----------

/**
 * 计算所有合法行的字段并集（对象递归展开为点路径，数组不展开）。
 * maxDepth 限制递归深度（1 = 仅顶层字段）。
 */
export function collectFields(rows: unknown[], maxDepth = 2): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();

  function walk(obj: unknown, prefix: string, depth: number): void {
    if (depth > maxDepth) return;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (!seen.has(path)) {
        seen.add(path);
        fields.push(path);
      }
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, path, depth + 1);
      }
    }
  }

  for (const row of rows) walk(row, '', 1);
  return fields;
}

/** 按点路径取值，如 a.b.c；不存在返回 undefined */
export function getByPath(obj: unknown, path: string): JsonValue | undefined {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as JsonValue | undefined;
}

/** 表格单元格的值摘要 */
export function cellPreview(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})`;
  const t = typeof value;
  if (t === 'object') return `Object{${Object.keys(value as object).length}}`;
  if (t === 'string') {
    const s = value as string;
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }
  return String(value);
}
