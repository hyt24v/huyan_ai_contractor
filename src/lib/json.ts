// JSON 核心纯函数库：解析 / 格式化 / 压缩 / 转义 / Unicode / 树构建
// 无 UI 依赖，可单测。

export interface JsonError {
  message: string;
  line?: number; // 1-based
  column?: number; // 1-based
  position?: number; // 0-based 字符偏移
}

export type ParseJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: JsonError };

/** 把 0-based 字符偏移转换为 1-based 行列号 */
export function positionToLineCol(
  text: string,
  position: number,
): { line: number; column: number } {
  let line = 1;
  let lastLineStart = 0;
  const end = Math.min(position, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      lastLineStart = i + 1;
    }
  }
  return { line, column: position - lastLineStart + 1 };
}

/** 从 JSON.parse 的错误消息中提取位置信息（兼容 V8 新旧两种格式） */
function extractError(e: unknown, text: string): JsonError {
  const message = e instanceof Error ? e.message : String(e);
  // 新版 V8: "... in JSON at position 42 (line 3 column 5)"
  const lc = message.match(/line (\d+) column (\d+)/);
  if (lc) {
    return { message, line: Number(lc[1]), column: Number(lc[2]) };
  }
  // 旧版 V8: "... at position 42"
  const pos = message.match(/position (\d+)/);
  if (pos) {
    const position = Number(pos[1]);
    const { line, column } = positionToLineCol(text, position);
    return { message, line, column, position };
  }
  return { message };
}

export function parseJson(text: string): ParseJsonResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: extractError(e, text) };
  }
}

/** 把字符串字面量中的原始控制字符（真实换行/制表/回车）转义回 \\n \\t \\r，使「不保留转义」显示后的文本仍可解析 */
export function escapeRawControlChars(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      out += ch + (text[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else out += ch;
  }
  return out;
}

/** 宽容解析：直接 parse 失败时，先把字符串里的原始控制字符转义再试一次（兼容「不保留转义」显示态） */
export function parseJsonTolerant(text: string): ParseJsonResult {
  const r = parseJson(text);
  if (r.ok) return r;
  return parseJson(escapeRawControlChars(text));
}

export type TransformResult =
  | { ok: true; text: string }
  | { ok: false; error: JsonError };

/**
 * 保留转义模式（对齐 json.cn「保留转义」）：合法 JSON 仅重排结构空白，
 * 字符串 token 逐字复制——\n、\uXXXX、\\ 等原样保留，中文等非 ASCII 不转义。
 * 输入不合法、字符串含原始控制字符或有尾部多余内容时返回 null，由调用方回退到宽容解析。
 */
function formatPreservingStrings(
  text: string,
  indent: number,
  minify = false,
): string | null {
  const unit = ' '.repeat(indent);
  const n = text.length;
  let i = 0;
  let depth = 0;
  let out = '';

  const fail = (): never => {
    throw new Error('preserve-format fallback');
  };
  const skipWs = () => {
    while (
      i < n &&
      (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')
    )
      i++;
  };
  /** 复制完整字符串 token（含首尾引号），遇原始控制字符或未闭合则 fail */
  const readStringToken = (): string => {
    let j = i + 1; // text[i] === '"'
    while (j < n) {
      const c = text[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '"') break;
      if (c < ' ') fail(); // 原始控制字符 → 回退
      j++;
    }
    if (j >= n) fail();
    const tok = text.slice(i, j + 1);
    i = j + 1;
    return tok;
  };
  const PRIMITIVE_RE = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;
  const readPrimitive = (): string => {
    let j = i;
    while (j < n && !' \t\r\n,{]}:'.includes(text[j])) j++;
    const tok = text.slice(i, j);
    if (!PRIMITIVE_RE.test(tok)) fail();
    i = j;
    return tok;
  };
  const pad = () => (minify ? '' : '\n' + unit.repeat(depth));
  const colon = minify ? ':' : ': ';

  const readValue = (): void => {
    skipWs();
    if (i >= n) fail();
    const c = text[i];
    if (c === '"') {
      out += readStringToken();
      return;
    }
    if (c === '{') {
      i++;
      skipWs();
      if (text[i] === '}') {
        i++;
        out += '{}';
        return;
      }
      depth++;
      out += '{';
      for (;;) {
        skipWs();
        if (text[i] !== '"') fail();
        out += pad() + readStringToken();
        skipWs();
        if (text[i] !== ':') fail();
        i++;
        out += colon;
        readValue();
        skipWs();
        if (text[i] === ',') {
          i++;
          out += ',';
          continue;
        }
        if (text[i] === '}') {
          i++;
          depth--;
          out += pad() + '}';
          return;
        }
        fail();
      }
    } else if (c === '[') {
      i++;
      skipWs();
      if (text[i] === ']') {
        i++;
        out += '[]';
        return;
      }
      depth++;
      out += '[';
      for (;;) {
        out += pad();
        readValue();
        skipWs();
        if (text[i] === ',') {
          i++;
          out += ',';
          continue;
        }
        if (text[i] === ']') {
          i++;
          depth--;
          out += pad() + ']';
          return;
        }
        fail();
      }
    } else {
      out += readPrimitive();
    }
  };

  try {
    readValue();
    skipWs();
    if (i !== n) fail(); // 尾部多余内容
    return out;
  } catch {
    return null;
  }
}

/**
 * 解码字符串字面量中的转义序列为真实字符（参考 json.cn「不保留转义」）：
 * \n → 换行、\t → 制表符、\r → 回车、\uXXXX → 对应字符。
 * \\ 和 \" 保持转义（否则破坏 JSON 结构）。
 * 注意：解码后含真实换行的字符串不再是严格合法 JSON，仅用于展示/阅读。
 */
export function decodeStringEscapes(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    // inString
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch !== '\\' || i + 1 >= text.length) {
      out += ch;
      continue;
    }
    const next = text[i + 1];
    if (next === 'n') {
      out += '\n';
      i++;
    } else if (next === 't') {
      out += '\t';
      i++;
    } else if (next === 'r') {
      out += '\r';
      i++;
    } else if (next === 'u' && i + 5 < text.length) {
      const hex = text.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
      } else {
        out += ch;
      }
    } else {
      // \\ 、\" 、\/ 、\b 、\f 等保持原样
      out += ch + next;
      i++;
    }
  }
  return out;
}

/**
 * 格式化（默认 2 空格缩进）。
 * keepEscape（保留转义，对齐 json.cn）：字符串中的转义序列 \n、\uXXXX、\\ 等原样保留，
 *   中文等非 ASCII 不转义；输入不合法时回退到宽容解析 + 标准序列化。
 * 否则（不保留转义）：解码 \n/\t/\r/\uXXXX 为真实字符（\\ 和 \" 保持转义以维持结构）。
 */
export function formatJson(
  text: string,
  indent = 2,
  keepEscape = false,
): TransformResult {
  if (keepEscape) {
    const preserved = formatPreservingStrings(text, indent);
    if (preserved !== null) return { ok: true, text: preserved };
  }
  const r = parseJsonTolerant(text);
  if (!r.ok) return r;
  const out = JSON.stringify(r.value, null, indent);
  return {
    ok: true,
    text: keepEscape ? out : decodeStringEscapes(out),
  };
}

/** 压缩为单行；keepEscape 同上（字符串 token 逐字保留） */
export function minifyJson(text: string, keepEscape = false): TransformResult {
  if (keepEscape) {
    const preserved = formatPreservingStrings(text, 0, true);
    if (preserved !== null) return { ok: true, text: preserved };
  }
  const r = parseJsonTolerant(text);
  if (!r.ok) return r;
  const out = JSON.stringify(r.value);
  return {
    ok: true,
    text: keepEscape ? out : decodeStringEscapes(out),
  };
}

/** 转义：把原始文本转为 JSON 字符串字面量内容（不带首尾引号） */
export function escapeJson(text: string): TransformResult {
  return { ok: true, text: JSON.stringify(text).slice(1, -1) };
}

/** 去除转义：把转义文本还原（输入不需要首尾引号） */
export function unescapeJson(text: string): TransformResult {
  try {
    const value: unknown = JSON.parse(`"${text}"`);
    if (typeof value !== 'string') {
      return { ok: false, error: { message: '输入不是合法的转义字符串' } };
    }
    return { ok: true, text: value };
  } catch (e) {
    return { ok: false, error: extractError(e, text) };
  }
}

/** Unicode 转中文：\uXXXX 解码 */
export function unicodeToChinese(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

// ---------- 树构建 ----------

export type JsonValueType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null';

export interface JsonTreeNode {
  key: string; // 展示用的 key（根为 'root'）
  path: string; // 如 a.b[0].c
  type: JsonValueType;
  preview: string; // 值摘要
  childCount: number;
  value?: string | number | boolean | null; // 原始值（仅叶子类型有）
  children?: JsonTreeNode[];
}

export function valueType(value: unknown): JsonValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  return 'boolean';
}

function preview(value: unknown, type: JsonValueType): string {
  switch (type) {
    case 'string': {
      const s = value as string;
      const short = s.length > 80 ? `${s.slice(0, 80)}…` : s;
      return `"${short}"`;
    }
    case 'number':
    case 'boolean':
      return String(value);
    case 'null':
      return 'null';
    case 'array':
      return `Array(${(value as unknown[]).length})`;
    case 'object':
      return `Object{${Object.keys(value as object).length}}`;
  }
}

function childPath(parentPath: string, key: string, isIndex: boolean): string {
  if (isIndex) return `${parentPath}[${key}]`;
  // key 含特殊字符时用 ["..."] 形式
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return parentPath ? `${parentPath}.${key}` : key;
  }
  return `${parentPath}["${key}"]`;
}

/** 把 JSON 值构建为树（根节点 path 为 ''） */
export function buildJsonTree(value: unknown): JsonTreeNode {
  function build(key: string, path: string, val: unknown): JsonTreeNode {
    const type = valueType(val);
    const node: JsonTreeNode = {
      key,
      path,
      type,
      preview: preview(val, type),
      childCount: 0,
    };
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'null') {
      node.value = val as string | number | boolean | null;
    }
    if (type === 'array') {
      const arr = val as unknown[];
      node.childCount = arr.length;
      node.children = arr.map((item, i) =>
        build(String(i), childPath(path, String(i), true), item),
      );
    } else if (type === 'object') {
      const entries = Object.entries(val as Record<string, unknown>);
      node.childCount = entries.length;
      node.children = entries.map(([k, v]) =>
        build(k, childPath(path, k, false), v),
      );
    }
    return node;
  }
  return build('root', '', value);
}

/**
 * 按 key / 值过滤树：保留命中节点及其祖先（JSON Hero 风格搜索）。
 * 返回 null 表示整棵子树都不命中。
 */
export function filterJsonTree(
  node: JsonTreeNode,
  query: string,
): JsonTreeNode | null {
  const q = query.trim().toLowerCase();
  if (q === '') return node;
  const selfMatch =
    node.key.toLowerCase().includes(q) ||
    node.preview.toLowerCase().includes(q);
  const filteredChildren = node.children
    ?.map((c) => filterJsonTree(c, q))
    .filter((c): c is JsonTreeNode => c !== null);
  if (selfMatch || (filteredChildren && filteredChildren.length > 0)) {
    return {
      ...node,
      children: filteredChildren,
      childCount: node.childCount,
    };
  }
  return null;
}

/** 复制文本到剪贴板（带回退） */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/** 触发浏览器下载 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
