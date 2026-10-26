// 统一编辑器核心：模式识别 / 智能修复 / 键排序 / JSONPath 查询 / 字符串类型推断
// 无 UI 依赖，可单测。

import { jsonrepair } from 'jsonrepair';
import { JSONPath } from 'jsonpath-plus';
import { parseJson } from './json';
import {
  parseJsonlSmart,
  parseJsonRecords,
  type JsonValue,
} from './jsonl';

// ---------- 模式识别 ----------

export type EditorMode = 'json' | 'jsonl';

/**
 * 自动识别文本是 JSON 还是 JSONL：
 * - 整体可解析 → json
 * - 否则 ≥2 个非空行且至少 1 行可独立解析 → jsonl
 * - 兜底 → json（展示 JSON 解析错误更合适）
 */
export function detectMode(text: string): EditorMode {
  const trimmed = text.trim();
  if (trimmed === '') return 'json';
  if (parseJson(trimmed).ok) return 'json';
  const nonEmpty = text.split('\n').filter((l) => l.trim() !== '');
  if (nonEmpty.length >= 2) {
    const okCount = nonEmpty.filter((l) => parseJson(l).ok).length;
    if (okCount >= 1) return 'jsonl';
    // 多行美化 JSON 连写（每条记录跨多行）：按顶层 JSON 值切分再判
    const records = parseJsonRecords(text);
    if (records.length >= 2 && records.some((r) => r.ok)) return 'jsonl';
  }
  return 'json';
}

// ---------- 智能修复 ----------

export interface RepairResult {
  ok: boolean;
  text: string;
  /** 修复后仍然无法解析的错误信息 */
  error?: string;
}

/** 修复脏 JSON / JSONL（单引号、尾逗号、缺引号、注释等），JSONL 逐行修复 */
export function repairText(text: string, mode: EditorMode): RepairResult {
  if (mode === 'json') {
    try {
      const repaired = jsonrepair(text);
      const r = parseJson(repaired);
      if (r.ok) return { ok: true, text: repaired };
      return { ok: false, text: repaired, error: r.error.message };
    } catch (e) {
      return {
        ok: false,
        text,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  // JSONL：逐行修复，修不好的行原样保留
  const lines = text.split('\n');
  let allOk = true;
  const out = lines.map((line) => {
    if (line.trim() === '') return line;
    try {
      const repaired = jsonrepair(line);
      if (!parseJson(repaired).ok) allOk = false;
      return repaired;
    } catch {
      allOk = false;
      return line;
    }
  });
  return { ok: allOk, text: out.join('\n') };
}

// ---------- 键排序 ----------

/** JSON.parse 结果结构上恒为 JsonValue，此处做边界类型转换 */
function asJsonValue(v: unknown): JsonValue {
  return v as JsonValue;
}

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, JsonValue>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return Object.fromEntries(
      entries.map(([k, v]) => [k, sortValue(v)] as const),
    );
  }
  return value;
}

/** 对象 key 递归排序（数组顺序保持不变），JSONL 逐行排序 */
export function sortJsonKeys(text: string, mode: EditorMode): RepairResult {
  if (mode === 'json') {
    const r = parseJson(text);
    if (!r.ok) return { ok: false, text, error: r.error.message };
    return { ok: true, text: JSON.stringify(sortValue(asJsonValue(r.value)), null, 2) };
  }
  const lines = text.split('\n');
  let allOk = true;
  const out = lines.map((line) => {
    if (line.trim() === '') return line;
    const r = parseJson(line);
    if (!r.ok) {
      allOk = false;
      return line;
    }
    return JSON.stringify(sortValue(asJsonValue(r.value)));
  });
  return { ok: allOk, text: out.join('\n') };
}

// ---------- JSONPath 查询 ----------

export type QueryResult =
  | { ok: true; text: string; count: number }
  | { ok: false; error: string };

/**
 * JSONPath 查询。
 * - json 模式：查询整个文档
 * - jsonl 模式：把所有合法行的值组成数组再查询
 * 结果恒为数组，格式化输出；单结果时标注数量。
 */
export function queryJsonPath(
  text: string,
  mode: EditorMode,
  path: string,
): QueryResult {
  const p = path.trim();
  if (p === '') return { ok: false, error: '请输入 JSONPath 表达式' };
  let doc: unknown;
  if (mode === 'json') {
    const r = parseJson(text);
    if (!r.ok) return { ok: false, error: `JSON 解析失败：${r.error.message}` };
    doc = r.value;
  } else {
    const rs = parseJsonlSmart(text);
    const values: JsonValue[] = [];
    for (const l of rs) {
      if (!l.empty && l.ok) values.push(asJsonValue(l.value));
    }
    if (values.length === 0) return { ok: false, error: '没有合法行可查询' };
    doc = values;
  }
  try {
    const result: unknown = JSONPath({ path: p, json: doc, wrap: true });
    const arr = Array.isArray(result) ? result : [result];
    return {
      ok: true,
      text: JSON.stringify(arr.length === 1 ? arr[0] : arr, null, 2),
      count: arr.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- 字符串类型推断（JSON Hero 风格） ----------

export type StringKind = 'url' | 'image' | 'date' | 'email' | 'color' | null;

export function inferStringKind(s: string): StringKind {
  if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(s)) {
    return 'color';
  }
  if (/^https?:\/\/\S+$/.test(s)) {
    if (/\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(s)) return 'image';
    return 'url';
  }
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) return 'email';
  if (
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
      s,
    ) &&
    !Number.isNaN(Date.parse(s))
  ) {
    return 'date';
  }
  return null;
}
