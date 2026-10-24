# AGENTS.md — AI 包工头项目规则

面向在本仓库工作的编码 Agent。README.md 面向用户，本文件面向开发者/Agent。

## 项目速览

- Tauri 桌面应用「AI包工头」：React 18 + TS + Vite 前端，Rust 后端（`src-tauri/`）
- 纯本地工具集：JSON 编辑器、Markdown 编辑器、Skills/MCP/提示词/配置套餐/模型服务管理、健康检查
- 测试：`npm test`（Vitest）；类型：`npx tsc -b --force`；后端：`cd src-tauri && cargo check`

## 分支与发布规则（重要）

**发版时机（最高优先级规则）**：不要把每个任务/修复都发成一个版本。只有用户**明确说「发版」并给出版本号**时才允许打 tag 发布；平时只 commit + push 分支，不打 tag。版本号由用户指定，agent 不自作主张递升。

两条发布线，靠 **tag 命名 + Pre-release 标记** 区分（GitHub Release 绑定 tag，不绑定分支）：

| | test 分支 | main 分支 |
|---|---|---|
| 用途 | 新功能开发、验证 | 稳定版本 |
| tag 格式 | `vX.Y.Z-beta.N`（如 `v0.6.0-beta.1`） | `vX.Y.Z` |
| Releases 标记 | 🟠 Pre-release（不占 Latest） | 🟢 Latest |

发布步骤：

1. 版本号写入 6 处：`package.json`、`package-lock.json`（2 处）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（只改 `name = "app"` 那一条）
2. commit + push 分支
3. `git tag vX.Y.Z[-beta.N] && git push origin <tag>` 触发 `.github/workflows/release.yml`
4. tag 带 `-` 后缀时 workflow 自动标记 Pre-release（`contains(github.ref_name, '-')`），勿手工改

版本号约定：正式版之前一直保持 `0.x`；不自动升 `1.0`，必须用户明确说发正式版。版本号本身也由用户在发版时给出，agent 不主动升号。

**合并规则**：test 验证稳定后合回 main 发正式版；用户未明确要求时不要主动合 main。

## 提交前必做验证

```bash
npx tsc -b --force   # 0 错误
npm test             # vitest 全过
cd src-tauri && cargo check   # 改 Rust 时
```

推送默认 `git push origin test`（当前开发分支是 test）。

## 项目约定

- **主题系统**：不要用 `.dark` class 硬编码颜色；颜色走 `src/lib/themes.ts` 的 token（HSL CSS 变量），新组件用 Tailwind token（`bg-card`、`text-muted-foreground`、`bg-activitybar` 等）。圆角用 `rounded-sm/md/lg`（映射 control/inner/outer 分级 token），不要写死 `rounded-[...]`。
- **Monaco**：主题注册统一在 `src/monacoSetup.ts`（`app-<themeId>`），组件用 `useAppThemeId()` 跟随，禁止在组件里重复注册。
- **Toast**：用 `src/hooks/useToast.ts`（防定时器竞态），失败必须传 `'err'` tone。
- **编辑历史**：用 `src/hooks/useEditorHistory.ts` + `src/components/HistoryDropdown.tsx`，破坏性操作（清空/载入/恢复）前必须 `snapshotNow()`。
- **文件系统**：前端只通过 `src/lib/fsPort.ts`（FsPort）访问 fs，不直接调 invoke；新增路径要同步加 `src-tauri/capabilities/default.json` 对应命令的 allow 列表。fs:scope 里**禁止**重新引入 `$HOME/**` 这种宽泛授权。
- **用户数据安全**：任何批量/套餐操作**禁止**删除用户本地的真实目录（skill 目录等）；对真实目录只能报错提示用户处理，只有软链可以直接删。
- **编辑器防抖快照**：`editorHistory.ts` 配额写满时自动减半重试，单条 >512KB 不存，最多 50 条。
- **Agent 注册表与可见性**：`src/lib/agents.ts` 注册 56 个 agent（id 兼容：原有 5 个 claude/codex/pi/cursor/gemini 勿改）。可见性走 `src/lib/agentVisibility.ts`：默认显示「检测到的」（detectDir/skillsDir 存在），用户在 设置→Agent 管理 用开关自定义；组件用 `useAgents()` hook，服务层用 `effectiveAgents()`，MCP/提示词等只对有配置路径的 agent 开放（`hasMcpSupport`/`PROMPT_TARGETS`）。agents 记录只含可见 agent，读 `skill.agents[x]` 必须 `(… ?? 'none')` 兜底。新增 agent 目录时同步跑 `default.json` 的 fs allow 追加（见 git 历史中的生成脚本）。

## 已知工具坑（不是代码 bug）

- **pi-lens 编辑后诊断陈旧**：edit 后常报「Cannot find name X」「module not found」等假错误（LSP 快照滞后）。以 `npx tsc -b --force` 为准，0 错误即通过，**不要**为让门禁变绿改代码。
- **playwright run-code 不回传 console.log**：断言式验证用「失败即 throw」+ 返回值，不要靠 console.log。
- **git push 偶发 git-lfs locks/verify 网络 EOF**：仓库级 `git config lfs.locksverify false` 后重推（已配置）。
