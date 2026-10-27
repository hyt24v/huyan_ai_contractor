/** MCP 统一管理的纯逻辑（不碰文件系统，可单测） */
import type { AgentId } from './agents';

/** 一个 MCP server 的规格（各 agent 配置的公共子集） */
export interface McpServerSpec {
  type: 'stdio' | 'http';
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http */
  url?: string;
  headers?: Record<string, string>;
}

/** 中央清单里的一条：规格 + 启用到哪些 agent */
export interface CentralServer extends McpServerSpec {
  name: string;
  agents: Partial<Record<AgentId, boolean>>;
}

export interface CentralManifest {
  servers: CentralServer[];
}

export const emptyManifest = (): CentralManifest => ({ servers: [] });

// ---------- 从 agent 配置解析 ----------

/** 解析单个 agent 配置里的 mcpServers 对象，返回 name → spec 与 name → enabled(pi) */
export function parseMcpServersJson(text: string): {
  servers: Record<string, McpServerSpec>;
  enabled: Record<string, boolean>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { servers: {}, enabled: {} };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { servers: {}, enabled: {} };
  }
  const root = parsed as Record<string, unknown>;
  const mcp = root.mcpServers;
  if (typeof mcp !== 'object' || mcp === null) return { servers: {}, enabled: {} };
  const servers: Record<string, McpServerSpec> = {};
  const enabled: Record<string, boolean> = {};
  for (const [name, raw] of Object.entries(mcp as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const spec: McpServerSpec = r.url
      ? {
          type: 'http',
          url: String(r.url),
          ...(r.headers ? { headers: r.headers as Record<string, string> } : {}),
        }
      : {
          type: 'stdio',
          ...(r.command ? { command: String(r.command) } : {}),
          ...(Array.isArray(r.args) ? { args: r.args.map(String) } : {}),
          ...(r.env ? { env: r.env as Record<string, string> } : {}),
        };
    servers[name] = spec;
    enabled[name] = r.enabled !== false;
  }
  return { servers, enabled };
}

/** 把各 agent 扫到的 server 合并成中央清单 */
export function mergeIntoManifest(
  scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec>; enabled: Record<string, boolean> }>>,
  agentIds: AgentId[],
): CentralManifest {
  const names = new Set<string>();
  for (const id of agentIds) {
    const scan = scans[id];
    if (scan) for (const n of Object.keys(scan.servers)) names.add(n);
  }
  const servers: CentralServer[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    // 取第一个扫到的规格作为基准
    let spec: McpServerSpec = { type: 'stdio' };
    const agents: Partial<Record<AgentId, boolean>> = {};
    for (const id of agentIds) {
      const scan = scans[id];
      if (!scan) continue;
      if (scan.servers[name]) {
        if (Object.keys(spec).length <= 1) spec = scan.servers[name];
        agents[id] = scan.enabled[name] !== false;
      }
    }
    servers.push({ name, ...spec, agents });
  }
  return { servers };
}

// ---------- 写回 agent 配置 ----------

/** 生成单个 server 在 JSON 配置中的条目（pi 额外写 enabled） */
export function specToJsonEntry(
  spec: McpServerSpec,
  hasEnabledFlag: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    spec.type === 'http'
      ? {
          type: 'http',
          url: spec.url,
          ...(spec.headers ? { headers: spec.headers } : {}),
        }
      : {
          type: 'stdio',
          ...(spec.command ? { command: spec.command } : {}),
          ...(spec.args ? { args: spec.args } : {}),
          ...(spec.env ? { env: spec.env } : {}),
        };
  if (hasEnabledFlag) base.enabled = true;
  return base;
}

/**
 * 修改 JSON 配置文本的 mcpServers 节：应用 updates、删除 removals，保留其他键。
 *
 * 数据安全：原文件非空但 JSON 解析失败（或顶层不是对象）时**抛错**，调用方必须
 * 记入 errors 并跳过写入——像 .claude.json 这种整屋配置文件绝不能从 {} 重写。
 */
export function applyJsonServers(
  originalText: string,
  updates: Record<string, { spec: McpServerSpec; hasEnabledFlag: boolean }>,
  removals: string[],
): string {
  let root: Record<string, unknown> = {};
  if (originalText.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(originalText);
    } catch (e) {
      throw new Error(
        `配置 JSON 解析失败，已跳过写入（请手动修复后再分发）：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('配置 JSON 顶层不是对象，已跳过写入');
    }
    root = parsed as Record<string, unknown>;
  }
  const mcp: Record<string, unknown> =
    typeof root.mcpServers === 'object' && root.mcpServers !== null
      ? { ...(root.mcpServers as Record<string, unknown>) }
      : {};
  for (const name of removals) delete mcp[name];
  for (const [name, { spec, hasEnabledFlag }] of Object.entries(updates)) {
    mcp[name] = specToJsonEntry(spec, hasEnabledFlag);
  }
  root.mcpServers = mcp;
  return JSON.stringify(root, null, 2) + '\n';
}

// ---------- Codex TOML 外科手术 ----------

/** TOML 字符串转义（basic string）：反斜杠/引号/换行/控制字符都要转义，否则产出非法 TOML */
export function tomlStr(s: string): string {
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )}"`;
}

/**
 * 解析 TOML 字符串字面量：basic string `"..."` 反转义，literal string `'...'` 原样剥引号；
 * 非字符串输入原样 trim 返回。与 tomlStr 互逆，保证 round-trip 不劣化。
 */
export function parseTomlValue(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    const inner = t.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch !== '\\' || i + 1 >= inner.length) {
        out += ch;
        continue;
      }
      const n = inner[++i];
      switch (n) {
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'u': {
          const hex = inner.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            out += '\\u';
          }
          break;
        }
        default:
          // 未知转义保守保留两字符，避免静默改变语义
          out += `\\${n}`;
      }
    }
    return out;
  }
  return t;
}

/** 解析 TOML 字符串数组字面量：按引号切分元素，含逗号/空格的字符串不被拆开 */
export function parseTomlStringArray(raw: string): string[] {
  const m = raw.trim().match(/^\[([\s\S]*)\]$/);
  if (!m) return [];
  const inner = m[1];
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (quote === '"' && ch === '\\' && i + 1 < inner.length) {
        cur += inner[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      if (started) tokens.push(cur);
      cur = '';
      started = false;
      continue;
    }
    if (/\s/.test(ch) && !started) continue;
    cur += ch;
    started = true;
  }
  if (started) tokens.push(cur);
  return tokens.map((t) => parseTomlValue(t));
}

/** TOML 节头行：段名可含引号（引号内允许 ] 和 .），允许行尾注释 */
const TOML_HEADER_RE = /^\s*\[((?:[^\]"'#]|"[^"]*"|'[^']*')+)\]\s*(?:#.*)?$/;

/** 解析 TOML 节头行，返回点分路径段（处理引号）；非节头返回 null */
export function parseTomlHeader(line: string): string[] | null {
  const m = line.match(TOML_HEADER_RE);
  if (!m) return null;
  const inner = m[1];
  const segs: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let quoted = false;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
    } else if (ch === '.') {
      segs.push(quoted ? cur : cur.trim());
      cur = '';
      quoted = false;
    } else {
      cur += ch;
    }
  }
  segs.push(quoted ? cur : cur.trim());
  return segs;
}

/** 生成一个 server 的 TOML 段（codex 无 type 字段，有 url 即 http） */
export function serverToToml(name: string, spec: McpServerSpec): string {
  const qName = tomlStr(name);
  const lines: string[] = [`[mcp_servers.${qName}]`];
  if (spec.type === 'http') {
    if (spec.url) lines.push(`url = ${tomlStr(spec.url)}`);
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      lines.push('', `[mcp_servers.${qName}.headers]`);
      for (const [k, v] of Object.entries(spec.headers)) {
        lines.push(`${tomlStr(k)} = ${tomlStr(v)}`);
      }
    }
  } else {
    if (spec.command) lines.push(`command = ${tomlStr(spec.command)}`);
    if (spec.args && spec.args.length > 0) {
      lines.push(`args = [${spec.args.map(tomlStr).join(', ')}]`);
    }
    if (spec.env && Object.keys(spec.env).length > 0) {
      lines.push('', `[mcp_servers.${qName}.env]`);
      for (const [k, v] of Object.entries(spec.env)) {
        lines.push(`${tomlStr(k)} = ${tomlStr(v)}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Codex config.toml 外科手术：
 * 移除属于 removals/updates 名字的 mcp_servers.* 段，其余原样保留（注释不丢），
 * 新的 server 段追加到文件末尾。
 */
export function replaceTomlServers(
  originalText: string,
  updates: Record<string, McpServerSpec>,
  removals: string[],
): string {
  const drop = new Set([...removals, ...Object.keys(updates)]);
  const lines = originalText.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const path = parseTomlHeader(line);
    if (path) {
      skipping =
        path.length >= 2 &&
        path[0] === 'mcp_servers' &&
        drop.has(path[1]);
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  // 去掉尾部多余空行后追加新段
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  const blocks = Object.entries(updates).map(([n, s]) => serverToToml(n, s));
  const body = out.join('\n');
  if (blocks.length === 0) return body + '\n';
  return body + '\n\n' + blocks.join('\n\n') + '\n';
}

// ---------- 分发计算 ----------

/**
 * 对比中央清单与现状，算出每个 agent 的 updates/removals。
 * 语义与 computeMcpDiff 保持一致（同一事实源）：
 * - 清单勾选了该 agent → 写入/更新（用 canonicalSpec 判等，忽略键序）
 * - 清单存在但未勾选该 agent、且该 agent 配置里存在 → 移除
 * - 该 agent 配置里存在但清单没有 → 不纳入管理，不动
 */
export function planDistribution(
  manifest: CentralManifest,
  scans: Partial<Record<AgentId, { servers: Record<string, McpServerSpec> }>>,
  agentIds: AgentId[],
): Record<AgentId, { updates: Record<string, McpServerSpec>; removals: string[] }> {
  const plan = {} as Record<AgentId, { updates: Record<string, McpServerSpec>; removals: string[] }>;
  const byName = new Map(manifest.servers.map((s) => [s.name, s]));
  for (const id of agentIds) {
    const updates: Record<string, McpServerSpec> = {};
    const removals: string[] = [];
    const current = scans[id]?.servers ?? {};
    // 清单中勾选该 agent 的 → 写入/更新
    for (const server of manifest.servers) {
      if (!server.agents[id]) continue;
      const spec: McpServerSpec =
        server.type === 'http'
          ? {
              type: 'http',
              ...(server.url ? { url: server.url } : {}),
              ...(server.headers ? { headers: server.headers } : {}),
            }
          : {
              type: 'stdio',
              ...(server.command ? { command: server.command } : {}),
              ...(server.args ? { args: server.args } : {}),
              ...(server.env ? { env: server.env } : {}),
            };
      if (canonicalSpec(current[server.name]) !== canonicalSpec(spec)) {
        updates[server.name] = spec;
      }
    }
    // 清单里存在但没勾选该 agent、且该 agent 配置里存在 → 移除
    for (const name of Object.keys(current)) {
      const server = byName.get(name);
      if (server && !server.agents[id]) removals.push(name);
    }
    plan[id] = { updates, removals };
  }
  return plan;
}

/** 备份文件名：xxx.bak.<yyyymmdd-hhmmss> */
export function backupPath(path: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${path}.bak.${ts}`;
}

// ---------- 规格等价比较（与 mcpDiff 共用同一事实源） ----------

/** 把规格拍平成有序字段列表（用于逐行展示差异 / 等价比较） */
export function fieldEntries(spec: McpServerSpec): Array<[string, string]> {
  const out: Array<[string, string]> = [['type', spec.type]];
  if (spec.type === 'http') {
    if (spec.url !== undefined) out.push(['url', spec.url]);
    for (const [k, v] of Object.entries(spec.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      out.push([`headers.${k}`, v]);
    }
  } else {
    if (spec.command !== undefined) out.push(['command', spec.command]);
    if (spec.args !== undefined) out.push(['args', spec.args.join(' ')]);
    for (const [k, v] of Object.entries(spec.env ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      out.push([`env.${k}`, v]);
    }
  }
  return out;
}

/** 稳定序列化：忽略对象键顺序，用于判断语义等价 */
export function canonicalSpec(spec: McpServerSpec | undefined): string {
  if (!spec) return '';
  return JSON.stringify(fieldEntries(spec));
}

// ---------- 参数行解析（编辑面板） ----------

/** 按空白切分参数，支持单/双引号包裹含空格的参数（双引号内 \\ 与 \" 可转义） */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '\\' && i + 1 < text.length && (text[i + 1] === '"' || text[i + 1] === '\\')) {
        cur += text[++i];
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(cur);
        cur = '';
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

/** 参数数组 → 单行展示文本（含空白/引号的加双引号，与 splitArgs 互逆） */
export function joinArgs(args: string[]): string {
  return args
    .map((a) => (/[\s"']/.test(a) ? `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : a))
    .join(' ');
}

// ---------- 中央清单校验 ----------

/** 逐条校验清单结构，丢弃畸形条目（损坏/旧格式文件不直接透传到页面） */
export function sanitizeManifest(parsed: unknown): CentralManifest {
  if (typeof parsed !== 'object' || parsed === null) return emptyManifest();
  const servers: unknown = (parsed as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) return emptyManifest();
  const clean: CentralServer[] = [];
  const seen = new Set<string>();
  for (const raw of servers) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== 'string' || !s.name || seen.has(s.name)) continue;
    // 类型必须是 stdio/http，其他值视为畸形条目直接丢弃（不静默改写）
    if (s.type !== 'stdio' && s.type !== 'http') continue;
    seen.add(s.name);
    const agents: Partial<Record<AgentId, boolean>> = {};
    if (typeof s.agents === 'object' && s.agents !== null) {
      for (const [k, v] of Object.entries(s.agents)) {
        if (typeof v === 'boolean') agents[k as AgentId] = v;
      }
    }
    clean.push({
      name: s.name,
      type: s.type,
      ...(typeof s.command === 'string' && s.command ? { command: s.command } : {}),
      ...(Array.isArray(s.args) ? { args: s.args.map(String) } : {}),
      ...(typeof s.env === 'object' && s.env !== null
        ? { env: s.env as Record<string, string> }
        : {}),
      ...(typeof s.url === 'string' && s.url ? { url: s.url } : {}),
      ...(typeof s.headers === 'object' && s.headers !== null
        ? { headers: s.headers as Record<string, string> }
        : {}),
      agents,
    });
  }
  return { servers: clean };
}

// ---------- Codex TOML 读取 ----------

/** 解析 codex config.toml 里的 mcp_servers（与 serverToToml/replaceTomlServers 互逆） */
export function parseTomlMcpServers(text: string): {
  servers: Record<string, McpServerSpec>;
  enabled: Record<string, boolean>;
} {
  const servers: Record<string, McpServerSpec> = {};
  const enabled: Record<string, boolean> = {};
  let current: string | null = null;
  let sub: 'env' | 'headers' | null = null;
  const ensure = (name: string): McpServerSpec => {
    if (!servers[name]) servers[name] = { type: 'stdio' };
    return servers[name];
  };
  for (const line of text.split('\n')) {
    const header = parseTomlHeader(line);
    if (header) {
      if (header[0] === 'mcp_servers' && header.length >= 2) {
        current = header[1];
        sub = header[2] === 'env' ? 'env' : header[2] === 'headers' ? 'headers' : null;
        ensure(current);
      } else {
        current = null;
        sub = null;
      }
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = parseTomlValue(kv[1]);
    const val = kv[2];
    const spec = ensure(current);
    if (sub === 'env' || sub === 'headers') {
      const map = sub === 'env' ? (spec.env ??= {}) : (spec.headers ??= {});
      map[key] = parseTomlValue(val);
      continue;
    }
    if (key === 'command') spec.command = parseTomlValue(val);
    else if (key === 'url') {
      spec.type = 'http';
      spec.url = parseTomlValue(val);
    } else if (key === 'args') {
      spec.args = parseTomlStringArray(val);
    } else if (key === 'enabled') {
      enabled[current] = val.trim() !== 'false';
    }
  }
  // 丢弃既无 command 也无 url 的空节（无法构成有效 server，避免脏数据进入清单）
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec.command && !spec.url) {
      delete servers[name];
      delete enabled[name];
    }
  }
  return { servers, enabled };
}
