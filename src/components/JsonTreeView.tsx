import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Link2 } from 'lucide-react';
import { copyToClipboard, type JsonTreeNode } from '../lib/json';

const TYPE_COLOR: Record<JsonTreeNode['type'], string> = {
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-amber-600 dark:text-amber-400',
  boolean: 'text-violet-600 dark:text-violet-400',
  null: 'text-muted-foreground',
  object: 'text-muted-foreground',
  array: 'text-muted-foreground',
};

function TreeNode({ node, depth }: { node: JsonTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const [copied, setCopied] = useState<'value' | 'path' | null>(null);
  const expandable = node.childCount > 0;

  const copy = async (what: 'value' | 'path') => {
    const text = what === 'path' ? node.path || '(root)' : node.preview;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    }
  };

  return (
    <div>
      <div
        className="group flex h-6 items-center gap-1 rounded-sm pr-2 font-mono text-xs hover:bg-accent/60"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground ${expandable ? '' : 'invisible'}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <span className="shrink-0 text-sky-600 dark:text-sky-400">
          {node.key}
        </span>
        <span className="shrink-0 text-muted-foreground">:</span>
        <span className={`truncate ${TYPE_COLOR[node.type]}`}>
          {node.preview}
        </span>
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
      {open &&
        node.children?.map((child) => (
          <TreeNode key={child.key} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export default function JsonTreeView({ root }: { root: JsonTreeNode | null }) {
  if (!root) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        输入合法 JSON 后，这里会显示树形视图
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto py-1">
      <TreeNode node={root} depth={0} />
    </div>
  );
}
