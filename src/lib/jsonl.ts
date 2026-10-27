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
  line: number; // 1-based 起始行号
  /** 多行记录的结束行号（缺省 = line，即单行记录） */
  endLine?: number;
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

/**
 * 记录级解析：把文本切分为顶层 JSON 值序列（括号配对扫描，字符串/转义感知），
 * 支持「多行美化 JSON 连写」（每个对象占多行、首尾相接）这类非标准 JSONL。
 * 空白不计入记录；无法解析的片段记为错误记录并继续向后同步。
 */
export function parseJsonRecords(text: string): JsonlLineResult[] {
  const records: JsonlLineResult[] = [];
  const n = text.length;
  const isWs = (c: string) =>
    c === ' ' || c === '\t' || c === '\r' || c === '\n';
  let i = 0;
  let line = 1;
  while (true) {
    while (i < n && isWs(text[i])) {
      if (text[i] === '\n') line++;
      i++;
    }
    if (i >= n) break;
    const start = i;
    const startLine = line;
    const c = text[i];
    if (c === '{' || c === '[') {
      let depth = 0;
      let inStr = false;
      let esc = false;
      while (i < n) {
        const ch = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        if (ch === '\n') line++;
        i++;
      }
    } else if (c === '"') {
      i++;
      let esc = false;
      while (i < n) {
        const ch = text[i];
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') {
          i++;
          break;
        }
        if (ch === '\n') line++;
        i++;
      }
    } else {
      // 原始值 token（true/false/null/数字或无法识别的垃圾片段）：读到换行为止。
      // 垃圾行按「一行一条错误记录」处理——不被空白切碎、行号保持正确（审核 #1）
      while (i < n && text[i] !== '\n') i++;
    }
    const raw = text.slice(start, i);
    try {
      records.push({
        line: startLine,
        endLine: line,
        raw,
        empty: false,
        ok: true,
        value: JSON.parse(raw),
      });
    } catch (e) {
      records.push({
        line: startLine,
        endLine: line,
        raw,
        empty: false,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return records;
}

/**
 * 智能 JSONL 解析：默认逐行（标准 JSONL，错误定位精确到行）；
 * 当有行解析失败时尝试记录级切分——若记录模式记录数 ≥2、至少 1 条合法
 * 且错误数严格更少，则判定为「多行美化 JSON 连写」，返回记录级结果。
 */
export function parseJsonlSmart(text: string): JsonlLineResult[] {
  const lineResults = parseJsonl(text);
  const lineErrors = lineResults.filter((r) => !r.empty && !r.ok).length;
  if (lineErrors === 0) return lineResults;
  const records = parseJsonRecords(text);
  const recordErrors = records.filter((r) => !r.ok).length;
  const recordOk = records.length - recordErrors;
  // records.length >= 1：整篇文档只有一条多行美化记录时也应走记录模式（审核 #3）
  if (records.length >= 1 && recordOk >= 1 && recordErrors < lineErrors) {
    return records;
  }
  return lineResults;
}

export interface JsonlStats {
  total: number; // 条目数（逐行模式 = 行数；记录模式 = 记录数）
  lines: number; // 条目覆盖的文本行数（多行记录模式下 > total，审核 #11）
  empty: number;
  errors: number;
  valid: number; // 非空且合法
}

export function jsonlStats(results: JsonlLineResult[]): JsonlStats {
  let empty = 0;
  let errors = 0;
  let valid = 0;
  let lines = 0;
  for (const r of results) {
    lines += (r.endLine ?? r.line) - r.line + 1;
    if (r.empty) empty++;
    else if (r.ok) valid++;
    else errors++;
  }
  return { total: results.length, lines, empty, errors, valid };
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
  const results = parseJsonlSmart(text);
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

/** 逐条美化（多行缩进），错误行原样保留 */
export function prettifyJsonl(
  text: string,
  opts?: { keepEmptyLines?: boolean; indent?: number },
): JsonlTransformResult {
  const results = parseJsonlSmart(text);
  const errors: { line: number; error: string }[] = [];
  const out: string[] = [];
  for (const r of results) {
    if (r.empty) {
      if (opts?.keepEmptyLines) out.push('');
      continue;
    }
    if (r.ok) {
      out.push(JSON.stringify(r.value, null, opts?.indent ?? 2));
    } else {
      out.push(r.raw);
      errors.push({ line: r.line, error: r.error ?? '解析失败' });
    }
  }
  return { ok: errors.length === 0, text: out.join('\n'), errors };
}

/** 删除指定行（1-based），endLine 可删除多行记录，返回新文本 */
export function deleteLine(text: string, line: number, endLine?: number): string {
  const lines = text.split('\n');
  const end = endLine ?? line;
  if (line < 1 || line > lines.length) return text;
  lines.splice(line - 1, end - line + 1);
  return lines.join('\n');
}

/** 复制指定行（插入到原行之后），endLine 可复制多行记录，返回新文本 */
export function duplicateLine(text: string, line: number, endLine?: number): string {
  const lines = text.split('\n');
  const end = endLine ?? line;
  if (line < 1 || line > lines.length) return text;
  // 不用 splice(...spread)：复制超大记录时展开运算符会触发调用参数上限 RangeError（审核 #16）
  return lines
    .slice(0, end)
    .concat(lines.slice(line - 1, end), lines.slice(end))
    .join('\n');
}

// ---------- 字段并集与路径取值 ----------

const SIMPLE_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * 拼接字段路径段：简单标识符用 .key；含点号等特殊字符的 key 用 ["key"] 形式，
 * 避免与嵌套点路径歧义（审核 #9）
 */
function joinFieldPath(prefix: string, key: string): string {
  if (SIMPLE_KEY_RE.test(key)) return prefix ? `${prefix}.${key}` : key;
  return `${prefix}["${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

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
      const path = joinFieldPath(prefix, k);
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

/** 解析字段路径：支持 a.b 与 a["b.c"] 混合形式（审核 #9） */
function parseFieldPath(path: string): string[] {
  const segs: string[] = [];
  let i = 0;
  let cur = '';
  while (i < path.length) {
    const c = path[i];
    if (c === '.') {
      if (cur !== '') segs.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '[' && path[i + 1] === '"') {
      let j = i + 2;
      let key = '';
      let closed = false;
      while (j < path.length) {
        const ch = path[j];
        if (ch === '\\' && j + 1 < path.length) {
          key += path[j + 1];
          j += 2;
          continue;
        }
        if (ch === '"' && path[j + 1] === ']') {
          closed = true;
          j += 2;
          break;
        }
        key += ch;
        j++;
      }
      if (closed) {
        if (cur !== '') segs.push(cur);
        cur = '';
        segs.push(key);
        i = j;
        continue;
      }
      // 未闭合的 [ 按普通字符处理
    }
    cur += c;
    i++;
  }
  if (cur !== '') segs.push(cur);
  return segs;
}

/** 按字段路径取值，如 a.b.c 或 a["b.c"]；不存在返回 undefined */
export function getByPath(obj: unknown, path: string): JsonValue | undefined {
  let cur: unknown = obj;
  for (const key of parseFieldPath(path)) {
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
