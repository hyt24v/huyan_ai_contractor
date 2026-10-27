/** 配置套餐服务：一次性应用 skills / MCP / 提示词 / 模型服务，逐步容错并汇总结果 */
import { AGENTS, hasMcpSupport, type AgentId } from '../lib/agents';
import { effectiveAgents } from '../lib/agentVisibility';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import type { CentralManifest } from '../lib/mcp';
import {
  emptyProfileStore,
  parseProfiles,
  serializeProfiles,
  type Profile,
  type ProfileStore,
} from '../lib/profiles';
import { enableSkill, disableSkill, scanAll } from './agentSkills';
import { distribute, loadManifest, saveManifest } from './agentMcp';
import {
  loadPromptLibrary,
  savePromptLibrary,
  writePromptFile,
} from './agentPrompts';
import { setActivePrompt } from '../lib/prompts';
import { applyProvider, loadStore as loadProviderStore, setActive } from './providers';

const PROFILES_FILE = '.ai-baogongtou/profiles.json';
const PROFILE_BACKUP_DIR = '.ai-baogongtou/profile-backups';

export interface ApplyProfileResult {
  /** 成功的步骤描述（用于 UI 展示） */
  applied: string[];
  /** 失败信息（不会静默忽略） */
  errors: string[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function agentLabel(id: AgentId): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
}

/** 参与 MCP 管理的 agent：可见性开启且已知 MCP 配置路径（与 agentMcp 同口径） */
function mcpAgents() {
  return effectiveAgents().filter(hasMcpSupport);
}

export async function profilesFilePath(): Promise<string> {
  return absPath(PROFILES_FILE);
}

export async function loadProfiles(fs: FsPort = tauriFs): Promise<ProfileStore> {
  const file = await profilesFilePath();
  if (!(await fs.exists(file))) return emptyProfileStore();
  const text = await fs.readText(file);
  try {
    return parseProfiles(text);
  } catch {
    // 损坏时按空 store 加载，避免整个页面不可用（原文件不会自动覆盖）
    return emptyProfileStore();
  }
}

function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`
  );
}

/** 覆盖 profiles.json 前先备份；备份失败则中止写入 */
async function backupProfilesFile(file: string, fs: FsPort): Promise<void> {
  if (!(await fs.exists(file))) return;
  const content = await fs.readText(file);
  if (!content.trim()) return;
  const dir = await absPath(PROFILE_BACKUP_DIR);
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  let path = `${dir}/profiles-${stamp(new Date())}.json`;
  let i = 2;
  while (await fs.exists(path)) {
    path = `${dir}/profiles-${stamp(new Date())}-${i}.json`;
    i += 1;
  }
  await fs.writeText(path, content);
  // 保留策略：只留最近 20 份（文件名内嵌固定宽度时间戳，字典序即时间序）
  try {
    const names = (await fs.readDir(dir))
      .filter((e) => !e.isDirectory && e.name.startsWith('profiles-'))
      .map((e) => e.name)
      .sort();
    for (let j = 0; j < names.length - 20; j++) {
      await fs.remove(`${dir}/${names[j]}`, false);
    }
  } catch {
    // 清理失败不影响主流程
  }
}

export async function saveProfiles(
  store: ProfileStore,
  fs: FsPort = tauriFs,
): Promise<void> {
  const file = await profilesFilePath();
  const dir = file.slice(0, file.lastIndexOf('/'));
  if (!(await fs.exists(dir))) await fs.mkdir(dir);
  await backupProfilesFile(file, fs);
  await fs.writeText(file, serializeProfiles(store));
}

/**
 * 按套餐重算中央 MCP 清单的 agent 映射：
 * - 选中的 server 保留原有 agent 勾选；原本没勾任何 agent 的（新 server）默认全开；
 * - 未选中的 server 清空 agent 勾选 → distribute 时会从各 agent 配置移除（有 .bak 备份）。
 * 清单本身保留所有 server 规格，不会丢数据。
 */
export function buildProfileManifest(
  manifest: CentralManifest,
  selectedNames: readonly string[],
): CentralManifest {
  const selected = new Set(selectedNames);
  return {
    servers: manifest.servers.map((server) => {
      if (!selected.has(server.name)) return { ...server, agents: {} };
      const enabled = AGENTS.some((a) => server.agents[a.id]);
      if (enabled) return server;
      // 新 server 默认全开：只勾「可见且支持 MCP」的 agent，避免把 56 个注册项全置 true
      const agents: Partial<Record<AgentId, boolean>> = {};
      for (const a of mcpAgents()) agents[a.id] = true;
      return { ...server, agents };
    }),
  };
}

/**
 * 应用套餐。每一步独立 try/catch，部分失败也会继续后续步骤并写进 errors。
 * 顺序：skills → MCP → 提示词 → 模型服务。
 */
export async function applyProfile(
  profile: Profile,
  fs: FsPort = tauriFs,
): Promise<ApplyProfileResult> {
  const applied: string[] = [];
  const errors: string[] = [];

  // 1) Skills：只处理「可见」的 agent（effectiveAgents，与 MCP 步骤同口径），
  //    差量重算软链：启用套餐内的，移除不在套餐内但由本工具建立的软链（真实目录绝不动）
  if (profile.skills.length > 0) {
    try {
      const snapshot = await scanAll(fs);
      const agents = effectiveAgents();
      const library = new Set(snapshot.librarySkills);
      const missing = profile.skills.filter((s) => !library.has(s));
      for (const name of missing) {
        errors.push(`Skill「${name}」不在中央库，已跳过`);
      }
      let ok = 0;
      const enabled = new Set<string>();
      /** 本次新建的软链（skill → agent 列表），写进报告便于用户追溯/手动回滚 */
      const linkDetails = new Map<string, string[]>();
      for (const name of profile.skills) {
        if (!library.has(name)) continue;
        for (const agent of agents) {
          try {
            await enableSkill(name, agent.id, fs);
            ok += 1;
            enabled.add(name);
            const list = linkDetails.get(name) ?? [];
            list.push(agentLabel(agent.id));
            linkDetails.set(name, list);
          } catch (e) {
            errors.push(`Skill「${name}」→ ${agentLabel(agent.id)} 启用失败：${errMsg(e)}`);
          }
        }
      }
      // 重算语义：收回未选中的软链（disableSkill 只删软链，用户真实目录不动）
      const selected = new Set(profile.skills);
      const removedDetails: string[] = [];
      for (const scan of snapshot.scans) {
        for (const s of scan.skills) {
          if (s.kind !== 'linked' || selected.has(s.name)) continue;
          try {
            await disableSkill(s.name, scan.agent, fs);
            removedDetails.push(`${s.name} → ${agentLabel(scan.agent)}`);
          } catch (e) {
            errors.push(
              `Skill「${s.name}」→ ${agentLabel(scan.agent)} 移除软链失败：${errMsg(e)}`,
            );
          }
        }
      }
      if (ok > 0 || removedDetails.length > 0) {
        const parts = [
          `Skills：${enabled.size} 个已启用到 ${agents.length} 个可见 agent`,
        ];
        for (const [name, targets] of linkDetails) {
          parts.push(`新建软链 ${name} → ${targets.join('、')}`);
        }
        if (removedDetails.length > 0) {
          parts.push(`收回 ${removedDetails.length} 个未选中的软链（${removedDetails.join('；')}）`);
        }
        applied.push(parts.join('；'));
      }
    } catch (e) {
      errors.push(`Skills 应用失败：${errMsg(e)}`);
    }
  }

  // 2) MCP：按套餐勾选重算清单并分发
  if (profile.mcpServers.length > 0) {
    try {
      const manifest = await loadManifest(fs);
      const known = new Set(manifest.servers.map((s) => s.name));
      const matched = profile.mcpServers.filter((name) => known.has(name));
      for (const name of profile.mcpServers) {
        if (!known.has(name)) errors.push(`MCP「${name}」不在中央清单，已跳过`);
      }
      if (matched.length === 0) {
        // 关键保护：不能因为套餐里全是未知名字就把现有 MCP 配置全部移除
        errors.push('套餐中的 MCP server 都不在中央清单，已跳过 MCP 步骤');
      } else {
        const next = buildProfileManifest(manifest, matched);
        await saveManifest(next, fs);
        const { written, errors: distErrors } = await distribute(next, fs);
        for (const [agent, msg] of Object.entries(distErrors)) {
          errors.push(`MCP → ${agentLabel(agent as AgentId)} 写入失败：${msg}`);
        }
        applied.push(
          `MCP：${matched.length} 个 server，写入 ${
            written.length > 0 ? written.map(agentLabel).join('、') : '无变更'
          }`,
        );
      }
    } catch (e) {
      errors.push(`MCP 应用失败：${errMsg(e)}`);
    }
  }

  // 3) 提示词：库只加载/保存一次（避免每个 agent 都全量备份库文件），循环内只写目标文件
  const promptEntries = Object.entries(profile.prompts) as [AgentId, string][];
  if (promptEntries.length > 0) {
    try {
      let lib = await loadPromptLibrary(fs);
      let changed = false;
      for (const [agent, promptId] of promptEntries) {
        const prompt = lib.prompts.find((p) => p.id === promptId);
        if (!prompt) {
          errors.push(`提示词 → ${agentLabel(agent)} 未找到（id: ${promptId}）`);
          continue;
        }
        try {
          const result = await writePromptFile(agent, prompt, fs);
          lib = setActivePrompt(lib, agent, prompt.id);
          changed = true;
          applied.push(
            `提示词「${prompt.name}」→ ${agentLabel(agent)}${
              result.backup ? '（原文件已备份）' : ''
            }`,
          );
        } catch (e) {
          errors.push(`提示词 → ${agentLabel(agent)} 写入失败：${errMsg(e)}`);
        }
      }
      // 全部写完后一次性保存 active 映射（savePromptLibrary 内部会先备份库文件一次）
      if (changed) await savePromptLibrary(lib, fs);
    } catch (e) {
      errors.push(`提示词应用失败：${errMsg(e)}`);
    }
  }

  // 4) 模型服务：按 agent 应用 provider（写入前 applyProvider 内部会备份）
  const providerEntries = Object.entries(profile.providers ?? {}) as [AgentId, string][];
  if (providerEntries.length > 0) {
    try {
      const providerStore = await loadProviderStore(fs);
      for (const [agent, providerId] of providerEntries) {
        const provider = providerStore.providers.find((p) => p.id === providerId);
        if (!provider) {
          errors.push(`模型服务 → ${agentLabel(agent)} 未找到（id: ${providerId}）`);
          continue;
        }
        if (provider.agent !== agent) {
          errors.push(
            `模型服务「${provider.name}」属于 ${agentLabel(provider.agent)}，不能应用到 ${agentLabel(agent)}`,
          );
          continue;
        }
        try {
          const result = await applyProvider(provider, fs);
          if (!result.ok) {
            errors.push(`模型服务「${provider.name}」→ ${agentLabel(agent)} 写入失败：${result.message}`);
            continue;
          }
          await setActive(agent, provider.id, fs);
          applied.push(`模型服务「${provider.name}」→ ${agentLabel(agent)}`);
        } catch (e) {
          // 单个 provider 失败不影响其余
          errors.push(`模型服务「${provider.name}」→ ${agentLabel(agent)} 异常：${errMsg(e)}`);
        }
      }
    } catch (e) {
      errors.push(`模型服务应用失败：${errMsg(e)}`);
    }
  }

  return { applied, errors };
}