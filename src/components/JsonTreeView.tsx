import { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Copy,
  Image,
  Link2,
  Mail,
  Search,
  X,
} from 'lucide-react';
import {
  copyToClipboard,
  filterJsonTree,
  type JsonTreeNode,
} from '../lib/json';
import { inferStringKind, type StringKind } from '../lib/toolkit';

/** 类型色走主题 token（themes.ts 注入 --json-*，6 套主题各配对比度合格的颜色） */
const TYPE_COLOR: Record<JsonTreeNode['type'], string> = {
  string: 'text-json-string',
  number: 'text-json-number',
  boolean: 'text-json-boolean',
  null: 'text-json-null',
  object: 'text-muted-foreground',
  array: 'text-muted-foreground',
};

const KIND_META: Record<
  NonNullable<StringKind>,
  { label: string; Icon: typeof Link2 }
> = {
  url: { label: '链接', Icon: Link2 },
  image: { label: '图片', Icon: Image },
  date: { label: '日期', Icon: Calendar },
  email: { label: '邮箱', Icon: Mail },
  color: { label: '颜色', Icon: Link2 },
};

/** 字符串值的类型徽章（JSON Hero 风格类型推断） */
function KindBadge({ node }: { node: JsonTreeNode }) {
  if (node.type !== 'string' || typeof node.value !== 'string') return null;
  const kind = inferStringKind(node.value);
  if (!kind) return null;
  const { label, Icon } = KIND_META[kind];
  return (
    <span className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
      {kind === 'color' ? (
        <span
          className="h-2.5 w-2.5 rounded-[2px] border border-border"
          style={{ backgroundColor: node.value }}
        />
      ) : (
        <Icon className="h-2.5 w-2.5" />
      )}
      {label}
    </span>
  );
}

/** 搜索关键词高亮：命中片段包 <mark>（大小写不敏感，多处命中全部标记） */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[2px] bg-warning/40 text-inherit">
        {text.slice(idx, idx + query.length)}
      </mark>
      <Highlight text={text.slice(idx + query.length)} query={query} />
    </>
  );
}

/** 弱值（null / false / 0 / 空串）加 pill 底色，避免淹没在行里 */
function weakPillClass(node: JsonTreeNode): string {
  if (node.type === 'null') return 'rounded-sm bg-muted px-1 italic';
  if (node.type === 'boolean' && node.value === false)
    return 'rounded-sm bg-json-boolean/10 px-1';
  if (node.type === 'number' && node.value === 0)
    return 'rounded-sm bg-json-number/10 px-1';
  if (node.type === 'string' && node.value === '')
    return 'rounded-sm bg-muted px-1';
  return '';
}

/** 字符串值：超 80 字符截断 + 行内展开/收起；截断时 title 悬浮全文 */
function StringValue({
  node,
  query,
}: {
  node: JsonTreeNode;
  query: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const full = typeof node.value === 'string' ? node.value : '';
  const truncated = full.length > 80;
  if (!truncated) {
    return (
      <span className={`truncate ${TYPE_COLOR.string}`} title={`"${full}"`}>
        &quot;
        <Highlight text={full} query={query} />
        &quot;
      </span>
    );
  }
  return (
    <span
      className={`${TYPE_COLOR.string} ${expanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}
      title={expanded ? undefined : `"${full}"`}
    >
      &quot;
      <Highlight text={expanded ? full : `${full.slice(0, 80)}…`} query={query} />
      &quot;
      <button
        className="ml-1 shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? '收起' : `展开（共 ${full.length} 字符）`}
      </button>
    </span>
  );
}

function TreeNode({
  node,
  depth,
  forceOpen,
  query,
}: {
  node: JsonTreeNode;
  depth: number;
  forceOpen: boolean;
  query: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const [copied, setCopied] = useState<'value' | 'path' | null>(null);
  const expandable = node.childCount > 0;
  const expanded = forceOpen || open;

  const copy = async (what: 'value' | 'path') => {
    const text =
      what === 'path'
        ? node.path || '(root)'
        : node.raw !== undefined
          ? JSON.stringify(node.raw, null, 2)
          : String(node.value ?? node.preview);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    }
  };

  const pill = weakPillClass(node);

  return (
    <div>
      <div
        className="group flex h-7 items-center gap-1 rounded-sm pr-2 font-mono text-[13px] hover:bg-accent/60"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${expandable ? '' : 'invisible'}`}
          onClick={() => setOpen((o) => !o)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <span className="shrink-0 text-sky-600 dark:text-sky-400">
          <Highlight text={node.key} query={query} />
        </span>
        <span className="shrink-0 text-muted-foreground">:</span>
        {node.type === 'string' && typeof node.value === 'string' ? (
          <StringValue node={node} query={query} />
        ) : (
          <span
            className={`truncate ${TYPE_COLOR[node.type]} ${pill}`}
            title={node.preview}
          >
            <Highlight text={node.preview} query={query} />
          </span>
        )}
        <KindBadge node={node} />
        <span className="ml-auto hidden shrink-0 gap-1 group-hover:flex">
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => copy('value')}
            title="复制值"
          >
            {copied === 'value' ? (
              <span className="text-[10px] text-success">✓</span>
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => copy('path')}
            title="复制路径"
          >
            {copied === 'path' ? (
              <span className="text-[10px] text-success">✓</span>
            ) : (
              <Link2 className="h-3 w-3" />
            )}
          </button>
        </span>
      </div>
      {expanded && node.children && (
        /* 缩进参考线：每层一条 1px 竖线（对齐父行 chevron 中心），hover 该层任意行时加深 */
        <div className="group/level relative">
          <span
            aria-hidden
            className="absolute bottom-0 top-0 border-l border-border/40 transition-colors group-hover/level:border-border"
            style={{ left: `${depth * 14 + 12}px` }}
          />
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              forceOpen={forceOpen}
              query={query}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JsonTreeView({ root }: { root: JsonTreeNode | null }) {
  const [search, setSearch] = useState('');
  const searching = search.trim() !== '';

  const filtered = useMemo(
    () => (root && searching ? filterJsonTree(root, search) : root),
    [root, search, searching],
  );

  const matchCount = useMemo(() => {
    if (!filtered || !searching) return 0;
    const q = search.trim().toLowerCase();
    let n = 0;
    const walk = (node: JsonTreeNode) => {
      if (
        node.key.toLowerCase().includes(q) ||
        node.preview.toLowerCase().includes(q)
      ) {
        n++;
      }
      node.children?.forEach(walk);
    };
    walk(filtered);
    return n;
  }, [filtered, search, searching]);

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        输入合法 JSON 后，这里会显示树形视图
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 搜索框 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 key 或值…"
          className="h-6 min-w-0 flex-1 bg-transparent text-xs focus-visible:outline-none"
        />
        {searching && (
          <>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {matchCount} 个匹配
            </span>
            <button
              onClick={() => setSearch('')}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              title="清除搜索"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {/* 树 */}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {filtered ? (
          <TreeNode
            node={filtered}
            depth={0}
            forceOpen={searching}
            query={searching ? search.trim() : ''}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            没有匹配的节点
          </div>
        )}
      </div>
    </div>
  );
}
