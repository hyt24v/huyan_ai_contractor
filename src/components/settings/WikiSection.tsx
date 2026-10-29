// 设置 - 知识库节：多库路径管理
import { useState } from 'react';
import { BookOpen, FolderInput, RotateCcw, X } from 'lucide-react';
import { DEFAULT_WIKI_PATH, getWikiPaths, setWikiPaths } from '../../lib/settings';
import { pickDirectory } from '../../lib/pickDirectory';
import { Button } from '../ui/controls';
import { useToast } from '../../hooks/useToast';

export default function WikiSection() {
  const { toast, showToast } = useToast();
  const [paths, setPaths] = useState<string[]>(getWikiPaths());

  const persist = (next: string[]) => {
    setPaths(next);
    setWikiPaths(next);
  };

  const add = async () => {
    const dir = await pickDirectory('选择知识库目录（包含 wiki/ 子目录）');
    if (!dir) return;
    if (paths.includes(dir)) {
      showToast('该路径已在列表中', 'err');
      return;
    }
    persist([...paths, dir]);
    showToast('已添加知识库');
  };

  return (
    <div className="max-w-xl">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <BookOpen className="h-4 w-4" /> 知识库
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        个人知识库（LLM Wiki）根路径列表，可添加多个库并在知识库页切换。库目录下需包含 wiki/ 子目录。
      </p>
      <div className="mb-3 space-y-1.5">
        {paths.map((p) => (
          <div key={p} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <span className="flex-1 truncate font-mono text-xs" title={p}>{p}</span>
            {p === DEFAULT_WIKI_PATH && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">默认</span>
            )}
            <button
              type="button"
              onClick={() => {
                if (paths.length <= 1) {
                  showToast('至少保留一个知识库路径', 'err');
                  return;
                }
                persist(paths.filter((x) => x !== p));
                showToast('已移除');
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="移除"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void add()}>
          <FolderInput className="h-3.5 w-3.5" /> 添加路径…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            persist([DEFAULT_WIKI_PATH]);
            showToast('已重置为默认路径');
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> 重置
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        提示：<code>~</code> 开头自动展开为用户目录；授权范围外的路径只能只读浏览（页面会显示「只读」徽标）。
      </p>
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-md px-3 py-2 text-xs shadow-lg ${
            toast.tone === 'err' ? 'bg-destructive text-destructive-foreground' : 'bg-foreground text-background'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
