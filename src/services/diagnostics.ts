/**
 * 健康检查服务：fsPort + diagnostics.ts 纯逻辑的粘合层。
 * 只读：不会写配置、不会改动 skill 目录（scanAll 会在中央库缺失时创建空目录，与 Skills 页一致）。
 */
import { AGENTS, hasMcpSupport } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import {
  analyzeHealth,
  commandIsPathLike,
  type AgentHealthInput,
  type BackupInfo,
  type DiagnosticsInput,
  type HealthReport,
  type SkillHealthEntry,
} from '../lib/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import { linkPointsToLibrary, parseSkillMdMeta } from '../lib/skills';
import { scanAll, type SkillsSnapshot } from './agentSkills';
import { parseTomlMcpServers, scanMcp, type McpSnapshot } from './agentMcp';

const MANIFEST_FILE = '.ai-baogongtou/mcp-central.json';
const BACKUP_DIR = '.ai-baogongtou/backups';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function readSkillMd(
  path: string,
  fs: FsPort,
): Promise<{ description?: string } | null> {
  try {
    if (!(await fs.exists(path))) return null;
    return parseSkillMdMeta(await fs.readText(path));
  } catch {
    return null;
  }
}

/** 每个 agent 的 MCP 配置文件是否存在、能否解析 */
export async function collectAgentHealth(
  fs: FsPort = tauriFs,
): Promise<AgentHealthInput[]> {
  const out: AgentHealthInput[] = [];
  // 只检查可见且支持 MCP 管理的 agent(没有配置路径的 agent 无从检查)
  for (const agent of effectiveAgents().filter(hasMcpSupport)) {
    let configExists = false;
    try {
      configExists = await fs.exists(await absPath(agent.mcpFile!));
    } catch {
      // 读不到就当不存在，下面会以 info 呈现
    }
    let configParsable = true;
    let configError: string | undefined;
    if (configExists) {
      try {
        const text = await fs.readText(await absPath(agent.mcpFile!));
        if (text.trim()) {
          if (agent.mcpFormat === 'json') JSON.parse(text);
          else parseTomlMcpServers(text);
        }
      } catch (e) {
        configParsable = false;
        configError = errText(e);
      }
    }
    out.push({
      agent: agent.id,
      configExists,
      configParsable,
      ...(configError ? { configError } : {}),
    });
  }
  return out;
}

/** 中央清单文件是否是合法 JSON 且含 servers 数组 */
export async function checkManifest(fs: FsPort = tauriFs): Promise<string | undefined> {
  try {
    const p = await absPath(MANIFEST_FILE);
    if (!(await fs.exists(p))) return undefined;
    const text = await fs.readText(p);
    if (!text.trim()) return undefined;
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { servers?: unknown }).servers)
    ) {
      return '缺少 servers 数组';
    }
    return undefined;
  } catch (e) {
    return errText(e);
  }
}

/** 读取备份目录（如存在），返回数量与最近时间。快照是 ISO 命名的目录，如 2026-10-22T10-47-05-123Z(-2) */
export async function readBackups(fs: FsPort = tauriFs): Promise<BackupInfo> {
  try {
    const dir = await absPath(BACKUP_DIR);
    if (!(await fs.exists(dir))) return { enabled: false, count: 0 };
    const entries = await fs.readDir(dir);
    let count = 0;
    let latestRaw = '';
    let latest: string | undefined;
    for (const f of entries) {
      // 目录型快照：ISO 时间戳命名（ID 本身按字典序可排序）
      const iso = f.name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-\d{3}Z/);
      if (f.isDirectory && iso) {
        count++;
        if (f.name > latestRaw) {
          latestRaw = f.name;
          latest = `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6]}`;
        }
        continue;
      }
      // 文件型备份：名称中含 20261022-104705 样式的时间戳
      const m = f.name.match(/(\d{8})-(\d{6})/);
      if (!m) continue;
      count++;
      const raw = `${m[1]}${m[2]}`;
      if (raw > latestRaw.replace(/\D/g, '')) {
        latestRaw = raw;
        const d = m[1];
        const t = m[2];
        latest = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
      }
    }
    return { enabled: true, count, ...(latest ? { latest } : {}) };
  } catch {
    return { enabled: false, count: 0 };
  }
}

/** 逐个 skill 探测：软链是否失效/越界、SKILL.md 是否存在、描述是否为空 */
export async function collectSkillEntries(
  snapshot: SkillsSnapshot,
  fs: FsPort = tauriFs,
): Promise<SkillHealthEntry[]> {
  const entries: SkillHealthEntry[] = [];

  for (const name of snapshot.librarySkills) {
    const md = await readSkillMd(`${snapshot.libraryAbs}/${name}/SKILL.md`, fs);
    entries.push({
      name,
      scope: 'library',
      kind: 'local',
      hasSkillMd: md !== null,
      ...(md?.description ? { description: md.description } : {}),
    });
  }

  for (const scan of snapshot.scans) {
    const def = AGENTS.find((a) => a.id === scan.agent);
    if (!def) continue;
    const dirAbs = await absPath(def.skillsDir);
    for (const skill of scan.skills) {
      const p = `${dirAbs}/${skill.name}`;
      if (skill.kind === 'linked') {
        let broken = false;
        let outsideLibrary = false;
        try {
          const target = await fs.readLink(p);
          outsideLibrary = !linkPointsToLibrary(target, snapshot.libraryAbs);
          broken = !(await fs.exists(target));
        } catch {
          broken = true;
        }
        const md = broken ? null : await readSkillMd(`${p}/SKILL.md`, fs);
        entries.push({
          name: skill.name,
          scope: 'agent',
          agent: scan.agent,
          kind: 'linked',
          broken,
          outsideLibrary,
          hasSkillMd: md !== null,
          ...(md?.description ? { description: md.description } : {}),
        });
      } else {
        const md = await readSkillMd(`${p}/SKILL.md`, fs);
        entries.push({
          name: skill.name,
          scope: 'agent',
          agent: scan.agent,
          kind: 'local',
          hasSkillMd: md !== null,
          ...(md?.description ? { description: md.description } : {}),
        });
      }
    }
  }
  return entries;
}

/** 只检查路径形态的 command（裸命令依赖 PATH，无法离线判断） */
export async function collectMissingCommands(
  mcp: McpSnapshot,
  fs: FsPort = tauriFs,
): Promise<{ server: string; command: string }[]> {
  const out: { server: string; command: string }[] = [];
  for (const server of mcp.manifest.servers) {
    const command = server.command?.trim();
    if (server.type !== 'stdio' || !command || !commandIsPathLike(command)) continue;
    let p = command;
    if (command.startsWith('~/')) p = await absPath(command.slice(2));
    else if (!command.startsWith('/')) continue; // ./ 相对路径无法可靠解析
    try {
      // 绝对路径可能不在 fs scope 内（如 /usr/local/bin），用 Rust 命令检查；
      // ~/ 路径已转成 home 下绝对路径，走普通 fs 即可。
      const exists = p.startsWith('/') && !p.startsWith(await absPath(''))
        ? await invoke<boolean>('path_exists', { path: p })
        : await fs.exists(p);
      if (!exists) out.push({ server: server.name, command });
    } catch {
      out.push({ server: server.name, command });
    }
  }
  return out;
}

export interface DiagnosticsRun {
  report: HealthReport;
  skillsError?: string;
  mcpError?: string;
  agentHealth: AgentHealthInput[];
  backups: BackupInfo;
}

/** 跑一次完整健康检查（skills 与 mcp 并行，各自独立容错） */
export async function runDiagnostics(fs: FsPort = tauriFs): Promise<DiagnosticsRun> {
  const [skillsRes, mcpRes] = await Promise.allSettled([scanAll(fs), scanMcp(fs)]);
  const skills = skillsRes.status === 'fulfilled' ? skillsRes.value : undefined;
  const mcp = mcpRes.status === 'fulfilled' ? mcpRes.value : undefined;
  const skillsError = skillsRes.status === 'rejected' ? errText(skillsRes.reason) : undefined;
  const mcpError = mcpRes.status === 'rejected' ? errText(mcpRes.reason) : undefined;

  const [agentHealth, backups, manifestError] = await Promise.all([
    collectAgentHealth(fs).catch((): AgentHealthInput[] => []),
    readBackups(fs),
    checkManifest(fs).catch((): string | undefined => undefined),
  ]);

  const skillEntries = skills ? await collectSkillEntries(skills, fs).catch(() => []) : [];
  const missingCommands = mcp ? await collectMissingCommands(mcp, fs).catch(() => []) : [];

  const input: DiagnosticsInput = {
    ...(skills ? { skills } : {}),
    ...(mcp ? { mcp } : {}),
    ...(skillsError ? { skillsError } : {}),
    ...(mcpError ? { mcpError } : {}),
    ...(manifestError ? { mcpManifestError: manifestError } : {}),
    agentHealth,
    skillEntries,
    missingCommands,
    backups,
  };

  return {
    report: analyzeHealth(input),
    ...(skillsError ? { skillsError } : {}),
    ...(mcpError ? { mcpError } : {}),
    agentHealth,
    backups,
  };
}
