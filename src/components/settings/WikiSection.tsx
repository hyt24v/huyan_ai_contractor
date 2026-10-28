// 设置 - 知识库节：库路径配置
import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { DEFAULT_WIKI_PATH, getWikiPath, setWikiPath } from '../../lib/settings';
import { Button, Input } from '../ui/controls';
import { useToast } from '../../hooks/useToast';

export default function WikiSection() {
  const { toast, showToast } = useToast();
  const [path, setPath] = useState(getWikiPath());

  return (
    <div className="max-w-xl">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <BookOpen className="h-4 w-4" /> 知识库
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        个人知识库（LLM Wiki）根路径。知识库页将读取该目录下的 wiki/ 文章与 .entities.json 图谱。
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={DEFAULT_WIKI_PATH}
          className="h-8 flex-1 text-xs"
        />
        <Button
          size="sm"
          onClick={() => {
            setWikiPath(path);
            showToast('已保存，知识库页将重新扫描');
          }}
        >
          保存
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setPath(DEFAULT_WIKI_PATH);
            setWikiPath(DEFAULT_WIKI_PATH);
            showToast('已恢复默认路径');
          }}
        >
          重置
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        提示：<code>~</code> 开头自动展开为用户目录；授权范围外的路径只能只读浏览。
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
