// 知识库页：LLM Wiki 浏览/检索/编辑
// 遵守仓库规范：不物理删除（归档=frontmatter archived:true）、不写 index.md/log.md
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BarChart3,
  BookOpen,
  FilePlus2,
  History,
  Library,
  Network,
  Presentation,
  Save,
  Search,
  Tag,
} from 'lucide-react';
import { rawFs, tauriFs, type FsPort } from '../lib/fsPort';
import {
  getActiveWikiPath,
  getWikiPaths,
  onSettingsChanged,
  setActiveWikiPath,
} from '../lib/settings';
import {
  resolveWikiPath,
  scanWiki,
  searchWiki,
  parseFrontmatter,
  stripFrontmatter,
  type WikiArticle,
  type WikiScan,
} from '../lib/wiki';
import MarkdownPreview from '../components/MarkdownPreview';
import { WikiGraphView } from '../components/WikiGraphView';
import WikiStatsView from '../components/WikiStatsView';
import WikiCanvasView from '../components/WikiCanvasView';
import { parseWikiGraph, type WikiGraph, type WikiEntity } from '../lib/wikiGraph';
import { parseWikiLog, type WikiLogEntry } from '../lib/wikiLog';
import { Button, Input } from '../components/ui/controls';
import { Dialog } from '../components/ui/overlay';
import { EmptyState } from '../components/ui/states';
import { useToast } from '../hooks/useToast';

type EditMode = 'edit' | 'split' | 'preview';
const MODE_KEY = 'huyan_tool:wiki_edit_mode';

function confidenceClass(c?: number): string {
  if (c === undefined) return 'bg-muted text-muted-foreground';
  if (c >= 0.8) return 'bg-json-string/15 text-json-string';
  if (c >= 0.5) return 'bg-warning/15 text-warning';
  return 'bg-destructive/15 text-destructive';
}

export default function WikiPage() {
  const { toast, showToast } = useToast();
  const [libs, setLibs] = useState<string[]>(getWikiPaths());
  const [wikiPath, setWikiPathState] = useState(getActiveWikiPath());
  const [readOnly, setReadOnly] = useState(false);
  const [scan, setScan] = useState<WikiScan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState<string | null>(null); // null = 全部
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WikiArticle | null>(null);
  const [body, setBody] = useState(''); // 去 frontmatter 的正文草稿
  const [fmRaw, setFmRaw] = useState(''); // 原样保留的 frontmatter
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<EditMode>(() => {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === 'edit' || v === 'preview' ? v : 'split';
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const bodyRef = useRef('');

  type ViewMode = 'browse' | 'graph' | 'log' | 'stats';
  const [view, setView] = useState<ViewMode>('browse');
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [logEntries, setLogEntries] = useState<WikiLogEntry[] | null>(null);
  const [canvasSel, setCanvasSel] = useState<{ name: string; relPath: string } | null>(null);
  const [canvasContent, setCanvasContent] = useState('');
  const [graphError, setGraphError] = useState('');

  const refresh = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const root = await resolveWikiPath(path);
      let fs: FsPort = tauriFs;
      let ro = false;
      let found = false;
      try {
        found = await tauriFs.exists(`${root}/wiki`);
      } catch {
        found = false; // plugin-fs 无授权
      }
      if (!found && (await rawFs.exists(`${root}/wiki`))) {
        fs = rawFs;
        ro = true; // 授权范围外：只读降级
        found = true;
      }
      if (!found) {
        setScan(null);
        setReadOnly(false);
        setError(`未找到知识库目录：${root}/wiki（可在 设置 → 知识库 修改路径）`);
        return;
      }
      setReadOnly(ro);
      setScan(await scanWiki(root, fs));
      setGraph(null);
      setLogEntries(null);
      setCanvasSel(null);
      setSelected(null);
    } catch (e) {
      setError(`扫描失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(getActiveWikiPath());
    return onSettingsChanged(() => {
      setLibs(getWikiPaths());
      const p = getActiveWikiPath();
      setWikiPathState(p);
      void refresh(p);
    });
  }, [refresh]);

  const activeFs = readOnly ? rawFs : tauriFs;

  /** 读 wiki 内文件：主通道失败时回退 rawFs（自定义 Rust 命令，不受 scope 限制） */
  const readWikiFile = useCallback(
    async (rel: string): Promise<string> => {
      const root = await resolveWikiPath(wikiPath);
      const p = `${root}/wiki/${rel}`;
      try {
        return await activeFs.readText(p);
      } catch (e) {
        if (activeFs === rawFs) throw e;
        return rawFs.readText(p);
      }
    },
    [wikiPath, activeFs],
  );

  const openView = useCallback(
    async (v: ViewMode) => {
      setView(v);
      if (v === 'graph' && !graph) {
        try {
          setGraph(parseWikiGraph(await readWikiFile('.entities.json')));
          setGraphError('');
        } catch (e) {
          setGraph({ entities: [], relations: [] });
          setGraphError(e instanceof Error ? e.message : String(e));
        }
      }
      if (v === 'log' && !logEntries) {
        try {
          setLogEntries(parseWikiLog(await readWikiFile('log.md')));
        } catch {
          setLogEntries([]);
        }
      }
    },
    [graph, logEntries, wikiPath, activeFs],
  );

  const openCanvas = useCallback(
    async (c: { name: string; relPath: string }) => {
      try {
        const root = await resolveWikiPath(wikiPath);
        setCanvasContent(await activeFs.readText(`${root}/wiki/${c.relPath}`));
        setCanvasSel(c);
        setSelected(null);
      } catch (e) {
        showToast(`画布读取失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      }
    },
    [wikiPath, activeFs, showToast],
  );

  const jumpToEntity = useCallback((e: WikiEntity) => {
    setView('browse');
    setQuery(e.name);
  }, []);

  const articles = useMemo(() => {
    if (!scan) return [];
    let list = topic ? scan.articles.filter((a) => a.topic === topic) : scan.articles;
    list = searchWiki(list, query);
    return list;
  }, [scan, topic, query]);

  const openArticle = useCallback(
    async (a: WikiArticle) => {
      if (dirty && !window.confirm('当前文章有未保存的修改，切换将丢弃，继续？')) return;
      try {
        const root = await resolveWikiPath(wikiPath);
        const text = await activeFs.readText(`${root}/wiki/${a.relPath}`);
        setSelected(a);
        setCanvasSel(null);
        setFmRaw(parseFrontmatter(text).raw);
        setBody(stripFrontmatter(text));
        bodyRef.current = stripFrontmatter(text);
        setDirty(false);
      } catch (e) {
        showToast(`读取失败：${e instanceof Error ? e.message : String(e)}`, 'err');
      }
    },
    [dirty, showToast, wikiPath, activeFs],
  );

  const save = useCallback(async () => {
    if (!selected) return;
    if (readOnly) {
      showToast('该知识库未获写入授权，仅可浏览', 'err');
      return;
    }
    try {
      const root = await resolveWikiPath(wikiPath);
      await tauriFs.writeText(`${root}/wiki/${selected.relPath}`, fmRaw + body);
      setDirty(false);
      showToast('已保存（index/log 簿记由 wiki agent 维护）');
      await refresh(wikiPath);
    } catch (e) {
      showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }, [selected, readOnly, wikiPath, fmRaw, body, refresh, showToast]);

  const toggleArchive = useCallback(async () => {
    if (!selected) return;
    if (readOnly) {
      showToast('该知识库未获写入授权，仅可浏览', 'err');
      return;
    }
    try {
      const root = await resolveWikiPath(wikiPath);
      const path = `${root}/wiki/${selected.relPath}`;
      const text = await tauriFs.readText(path);
      const fm = parseFrontmatter(text);
      let next: string;
      if (selected.archived) {
        next = text.replace(/^archived:\s*true\r?\n/m, '');
      } else if (fm.raw) {
        next = text.replace(/^(---\r?\n[\s\S]*?)\r?\n---/m, `$1\narchived: true\n---`);
      } else {
        next = `---\narchived: true\n---\n\n${text}`;
      }
      await tauriFs.writeText(path, next);
      showToast(selected.archived ? '已取消归档' : '已归档（不物理删除，遵守 wiki 规范）');
      setSelected(null);
      await refresh(wikiPath);
    } catch (e) {
      showToast(`操作失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }, [selected, readOnly, wikiPath, refresh, showToast]);

  const createArticle = useCallback(async () => {
    const t = newTopic.trim();
    const title = newTitle.trim();
    if (!t || !title) {
      showToast('主题和标题不能为空', 'err');
      return;
    }
    if (readOnly) {
      showToast('该知识库未获写入授权，仅可浏览', 'err');
      return;
    }
    try {
      const root = await resolveWikiPath(wikiPath);
      const dir = `${root}/wiki/${t}`;
      const path = `${dir}/${title}.md`;
      if (await tauriFs.exists(path)) {
        showToast('同名文章已存在，换个标题', 'err');
        return;
      }
      await tauriFs.mkdir(dir);
      const date = new Date().toISOString().slice(0, 10);
      await tauriFs.writeText(
        path,
        `---\ntitle: ${title}\ndate: ${date}\ntags:\n  - ${t}\n---\n\n# ${title}\n\n> **Confidence: 0.50** | 来源×0 | ${date} 创建\n\n`,
      );
      setCreateOpen(false);
      setNewTitle('');
      showToast(`已创建 ${t}/${title}.md`);
      await refresh(wikiPath);
    } catch (e) {
      showToast(`创建失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }, [newTopic, newTitle, readOnly, wikiPath, refresh, showToast]);

  const modeBtn = (m: EditMode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => {
        setMode(m);
        window.localStorage.setItem(MODE_KEY, m);
      }}
      className={`rounded px-2 py-0.5 text-[11px] whitespace-nowrap ${
        mode === m ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具条 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Library className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium">知识库</span>
        <span className="text-[11px] text-muted-foreground">
          {scan ? `${scan.articles.length} 篇 · ${scan.topics.length} 主题 · ${scan.canvases.length} 画布` : wikiPath}
        </span>
        <select
          value={wikiPath}
          onChange={(e) => setActiveWikiPath(e.target.value)}
          className="h-7 max-w-40 rounded-md border border-border bg-background px-1.5 text-xs"
          title={wikiPath}
        >
          {libs.map((p) => (
            <option key={p} value={p}>
              {p.split('/').filter(Boolean).pop()}
            </option>
          ))}
        </select>
        {readOnly && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">只读</span>
        )}
        <div className="ml-1 flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {(
            [
              ['browse', '浏览', BookOpen],
              ['graph', '图谱', Network],
              ['log', '日志', History],
              ['stats', '统计', BarChart3],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              onClick={() => void openView(v)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] whitespace-nowrap ${
                view === v ? 'pill-active' : 'pill-inactive hover:text-foreground'
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题 / 标签 / 别名…"
            className="h-7 w-56 pl-7 text-xs"
          />
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={readOnly}
          title={readOnly ? '该知识库未获写入授权' : undefined}
        >
          <FilePlus2 className="h-3.5 w-3.5" /> 新建文章
        </Button>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {graphError && view === 'graph' && (
        <div className="flex items-center gap-1.5 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">图谱数据读取失败：{graphError}</span>
        </div>
      )}
      {view !== 'browse' ? (
        view === 'graph' ? (
          graph ? (
            <WikiGraphView graph={graph} onSelectEntity={jumpToEntity} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">图谱加载中…</div>
          )
        ) : view === 'log' ? (
          <div className="flex-1 overflow-y-auto p-3">
            {!logEntries ? (
              <p className="text-xs text-muted-foreground">加载中…</p>
            ) : logEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无操作日志（wiki/log.md）</p>
            ) : (
              logEntries.map((e) => (
                <div key={`${e.date}-${e.title}`} className="mb-2 rounded-md border border-border bg-card p-2.5">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{e.date}</span>
                    <span className="rounded bg-muted px-1 py-px text-[10px">{e.kind}</span>
                  </div>
                  <div className="mt-0.5 text-xs font-medium">{e.title}</div>
                </div>
              ))
            )}
          </div>
        ) : scan ? (
          <WikiStatsView scan={scan} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">暂无数据</div>
        )
      ) : (
      <div className="flex min-h-0 flex-1">
        {/* 主题树 */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-border p-1.5">
          <button
            type="button"
            onClick={() => setTopic(null)}
            className={`mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs ${
              topic === null ? 'pill-active' : 'pill-inactive hover:bg-accent/50'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">全部主题</span>
            <span className="text-[10px] text-muted-foreground">{scan?.articles.length ?? 0}</span>
          </button>
          {(scan?.topics ?? []).map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setTopic(t.name)}
              className={`mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs ${
                topic === t.name ? 'pill-active' : 'pill-inactive hover:bg-accent/50'
              }`}
            >
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">{t.articles.length}</span>
            </button>
          ))}
        </aside>

        {/* 文章列表 */}
        <section className="w-64 shrink-0 overflow-y-auto border-r border-border p-1.5">
          {loading && <p className="p-3 text-xs text-muted-foreground">扫描中…</p>}
          {!loading && articles.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">没有匹配的文章</p>
          )}
          {articles.map((a) => (
            <button
              key={a.relPath}
              type="button"
              onClick={() => void openArticle(a)}
              className={`mb-1 w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                selected?.relPath === a.relPath
                  ? 'pill-active'
                  : 'pill-inactive hover:bg-accent/50'
              } ${a.archived ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex-1 truncate text-xs font-medium">{a.title}</span>
                {a.confidence !== undefined && (
                  <span className={`rounded px-1 py-px text-[10px] ${confidenceClass(a.confidence)}`}>
                    {a.confidence.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="truncate">{a.subdir ? `${a.topic}/${a.subdir}` : a.topic}</span>
                {a.date && <span className="shrink-0">· {a.date}</span>}
              </div>
            </button>
          ))}
          {(scan?.canvases ?? [])
            .filter((c) => !topic || c.topic === topic)
            .map((c) => (
              <button
                key={c.relPath}
                type="button"
                onClick={() => void openCanvas(c)}
                className={`mb-1 flex w-full items-center gap-1.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                  canvasSel?.relPath === c.relPath
                    ? 'pill-active'
                    : 'pill-inactive hover:bg-accent/50'
                }`}
              >
                <Presentation className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">画布</span>
              </button>
            ))}
        </section>

        {/* 预览 / 编辑 */}
        <section className="flex min-w-0 flex-1 flex-col">
          {canvasSel ? (
            <WikiCanvasView content={canvasContent} />
          ) : !selected ? (
            <EmptyState
              className="flex-1"
              icon={<BookOpen className="h-10 w-10" />}
              title="选择左侧文章开始阅读或编辑"
            />
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 truncate text-xs font-medium">{selected.title}</span>
                {selected.tags.slice(0, 4).map((t) => (
                  <span key={t} className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                    <Tag className="h-2.5 w-2.5" />
                    {t}
                  </span>
                ))}
                <div className="flex-1" />
                <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
                  {modeBtn('edit', '编辑')}
                  {modeBtn('split', '分屏')}
                  {modeBtn('preview', '预览')}
                </div>
                <Button size="sm" variant="outline" disabled={!dirty} onClick={() => void save()}>
                  <Save className="h-3.5 w-3.5" /> 保存
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleArchive()}>
                  {selected.archived ? (
                    <>
                      <ArchiveRestore className="h-3.5 w-3.5" /> 取消归档
                    </>
                  ) : (
                    <>
                      <Archive className="h-3.5 w-3.5" /> 归档
                    </>
                  )}
                </Button>
              </div>
              <div className="flex min-h-0 flex-1">
                {mode !== 'preview' && (
                  <textarea
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      setDirty(true);
                    }}
                    className={`resize-none overflow-y-auto bg-background p-3 font-mono text-xs leading-relaxed outline-none ${
                      mode === 'split' ? 'w-1/2 border-r border-border' : 'w-full'
                    }`}
                    spellCheck={false}
                  />
                )}
                {mode !== 'edit' && (
                  <div className="min-w-0 flex-1 overflow-y-auto p-3">
                    <MarkdownPreview content={body} />
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      )}

      {/* 新建文章弹窗 */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建文章"
        width="max-w-sm"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={() => void createArticle()}>
              创建
            </Button>
          </>
        }
      >
            <label className="mb-1 block text-[11px] text-muted-foreground">主题目录</label>
            <Input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="已有或新主题，如 AI编码工具"
              list="wiki-topics"
              className="mb-2 h-8 text-xs"
            />
            <datalist id="wiki-topics">
              {(scan?.topics ?? []).map((t) => (
                <option key={t.name} value={t.name} />
              ))}
            </datalist>
            <label className="mb-1 block text-[11px] text-muted-foreground">文章标题（即文件名）</label>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="例如：MCP 协议精读"
              className="mb-3 h-8 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && void createArticle()}
            />
      </Dialog>

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
