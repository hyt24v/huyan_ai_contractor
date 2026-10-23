/** 配置套餐服务：一次性应用 skills / MCP / 提示词，逐步容错并汇总结果 */
import { AGENTS, type AgentId } from '../lib/agents';
import { absPath, tauriFs, type FsPort } from '../lib/fsPort';
import type { CentralManifest } from '../lib/mcp';
import {
  emptyProfileStore,
  parseProfiles,
  serializeProfiles,
  type Profile,
  type ProfileStore,
} from '../lib/profiles';
import { enableSkill, scanAll } from './agentSkills';
import { distribute, loadManifest, saveManifest } from './agentMcp';
import { applyPrompt, loadPromptLibrary } from './agentPrompts';
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
      const agents: Partial<Record<AgentId, boolean>> = {};
      for (const a of AGENTS) agents[a.id] = true;
      return { ...server, agents };
    }),
  };
}

/**
 * 应用套餐。每一步独立 try/catch，部分失败也会继续后续步骤并写进 errors。
 * 顺序：skills → MCP → 提示词。
 */
export async function applyProfile(
  profile: Profile,
  fs: FsPort = tauriFs,
): Promise<ApplyProfileResult> {
  const applied: string[] = [];
  const errors: string[] = [];

  // 1) Skills：只启用中央库中真实存在的 skill，逐个 agent 建立软链
  if (profile.skills.length > 0) {
    try {
      const snapshot = await scanAll(fs);
      const library = new Set(snapshot.librarySkills);
      const missing = profile.skills.filter((s) => !library.has(s));
      for (const name of missing) {
        errors.push(`Skill「${name}」不在中央库，已跳过`);
      }
      let ok = 0;
      const enabled = new Set<string>();
      for (const name of profile.skills) {
        if (!library.has(name)) continue;
        for (const agent of AGENTS) {
          try {
            await enableSkill(name, agent.id, fs);
            ok += 1;
            enabled.add(name);
          } catch (e) {
            errors.push(`Skill「${name}」→ ${agentLabel(agent.id)} 启用失败：${errMsg(e)}`);
          }
        }
      }
      if (ok > 0) {
        applied.push(`Skills：${enabled.size} 个已启用到 ${AGENTS.length} 个 agent`);
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

  // 3) 提示词：每个 agent 独立应用（applyPrompt 内部会先备份）
  const promptEntries = Object.entries(profile.prompts) as [AgentId, string][];
  if (promptEntries.length > 0) {
    try {
      const lib = await loadPromptLibrary(fs);
      for (const [agent, promptId] of promptEntries) {
        const prompt = lib.prompts.find((p) => p.id === promptId);
        if (!prompt) {
          errors.push(`提示词 → ${agentLabel(agent)} 未找到（id: ${promptId}）`);
          continue;
        }
        try {
          const result = await applyPrompt(agent, prompt, fs);
          applied.push(
            `提示词「${prompt.name}」→ ${agentLabel(agent)}${
              result.backup ? '（原文件已备份）' : ''
            }`,
          );
        } catch (e) {
          errors.push(`提示词 → ${agentLabel(agent)} 写入失败：${errMsg(e)}`);
        }
      }
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