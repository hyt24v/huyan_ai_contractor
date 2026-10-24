/** 设置-Agent 管理:列出支持的 agent,检测到的排前面,显示路径与状态摘要 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleOff } from 'lucide-react';
import { AGENTS, type AgentDef } from '../../lib/agents';
import { PROMPT_TARGETS } from '../../lib/agentTargets';
import { absPath, tauriFs } from '../../lib/fsPort';
import { parseMcpServersJson } from '../../lib/mcp';

interface AgentStatus {
  def: AgentDef;
  detected: boolean;
  skillsDir: string;
  mcpFile: string;
  promptFile: string | null;
  promptWritable: boolean;
  skillCount: number;
  mcpCount: number | null;
}

async function probeAgent(def: AgentDef): Promise<AgentStatus> {
  const skillsDir = await absPath(def.skillsDir);
  const mcpFile = await absPath(def.mcpFile);
  const prompt = PROMPT_TARGETS.find((p) => p.agent === def.id);
  const [hasSkillsDir, hasMcpFile] = await Promise.all([
    tauriFs.exists(skillsDir),
    tauriFs.exists(mcpFile),
  ]);
  const skillCount = (await tauriFs.readDir(skillsDir)).length;
  const mcpCount = hasMcpFile
    ? await (async () => {
        try {
          const text = await tauriFs.readText(mcpFile);
          if (def.mcpFormat === 'json') {
            return Object.keys(parseMcpServersJson(text).servers).length;
          }
          return (text.match(/^\[mcp_servers\.[^\]]+\]/gm) ?? []).length;
        } catch {
          return null;
        }
      })()
    : null;
  return {
    def,
    detected: hasSkillsDir || hasMcpFile,
    skillsDir,
    mcpFile,
    promptFile: prompt?.file ?? null,
    promptWritable: prompt?.writable ?? false,
    skillCount,
    mcpCount,
  };
}

export default function AgentsSection() {
  const [list, setList] = useState<AgentStatus[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all(AGENTS.map(probeAgent))
      .then((all) => {
        // 检测到的排前面,组内保持注册表顺序
        setList([...all].sort((a, b) => Number(b.detected) - Number(a.detected)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return <div className="text-xs text-destructive">读取 agent 状态失败:{error}</div>;
  }
  if (!list) {
    return <div className="text-xs text-muted-foreground">检测本机 agent 中…</div>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        已检测到的 agent 排在前面;Skills/MCP/提示词的详细操作在各自管理页完成。
      </p>
      <div className="space-y-2">
        {list.map((a) => (
          <div
            key={a.def.id}
            className="rounded-lg border border-border/60 bg-card px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[13px] font-medium text-foreground">
                  {a.def.name}
                </span>
                {a.detected ? (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    <CheckCircle2 className="h-3 w-3" />
                    已检测到
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <CircleOff className="h-3 w-3" />
                    未检测到
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[11px]">
                <Link
                  to="/skills"
                  className="flex items-center gap-0.5 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  Skills <ArrowRight className="h-3 w-3" />
                </Link>
                <Link
                  to="/mcp"
                  className="flex items-center gap-0.5 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  MCP <ArrowRight className="h-3 w-3" />
                </Link>
                <Link
                  to="/prompts"
                  className="flex items-center gap-0.5 rounded-sm px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  提示词 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              <div className="truncate">
                Skills:{a.skillsDir.replace(/^\/Users\/[^/]+/, '~')}
                {a.detected && <span className="ml-2 font-sans">({a.skillCount} 个)</span>}
              </div>
              <div className="truncate">
                MCP:{a.mcpFile.replace(/^\/Users\/[^/]+/, '~')}
                {a.mcpCount !== null && (
                  <span className="ml-2 font-sans">({a.mcpCount} 个 server)</span>
                )}
              </div>
              <div className="truncate">
                提示词:
                {a.promptFile
                  ? a.promptFile
                  : a.promptWritable
                    ? '-'
                    : '不落盘,需在应用内设置'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
