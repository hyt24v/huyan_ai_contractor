# cc-switch UI/UX 设计借鉴报告

> 调研对象：[farion1231/cc-switch](https://github.com/farion1231/cc-switch)（★148K，Tauri 2 + React 18 + TS + Vite + Rust，MIT）
> 调研方式：官方 README_ZH、官网 ccswitch.io（含 docs 与 changelog）、仓库内用户手册 `docs/user-manual/zh/`、DeepWiki 架构文档、release notes、关键 commit 记录。未能浅克隆源码（无 shell 权限），源码级结论以 DeepWiki / commit 摘要 / GitHub 文件页摘录为准。
> 调研时间：2026-10-25。cc-switch 当前大版本为 v4.x（v4.0.0 于 2026-10-04 发布 pre-release，v4.0.4 为首个 v4 正式版），本报告以 v4 界面为准，并标注 v3 旧版的差异。

---

## 1. 功能清单（逐条）

依据：README_ZH.md、docs/user-manual/zh/README.md（手册目录）、docs/user-manual/zh/1-getting-started/1.1-introduction.md、ccswitch.io/zh/changelog/4.0.0 与 4.0.4、release notes v3.13.0。

### 1.1 供应商管理（核心）
1. 预设模板一键添加：智谱 GLM、MiniMax、DeepSeek、Kimi、PackyCode 等；Claude 的 96 个预设按「同一家的不同套餐和地区合并成一行」收敛（changelog 4.0.4）。
2. 添加面板支持按**中文名和域名**搜索预设；预设自动填充端点，只需填 API Key（1.4-quickstart.md）。
3. 一键切换：切换只替换端点/Key/模型等**关键连接字段**，用户自加的插件、Hook、MCP、注释原样保留（README_ZH）。
4. 统一供应商（Universal provider）：跨应用共享一份配置（1.1-introduction.md）。
5. 拖拽排序（@dnd-kit）、复制（创建副本）、编辑、删除（当前启用时禁用删除）（1.3-interface.md 卡片元素表）。
6. 端点测速：测试模型可用性和响应速度（卡片上的测速按钮）。
7. 用量查询脚本配置：卡片直接显示「5 小时剩余 94%」「余额 8.99 CNY」，带重置倒计时「⏱ 2h30m」；点击额度重新查询（changelog 4.0.4）。
8. 供应商模型自动获取：`/v1/models` OpenAI 兼容发现，分组下拉展示，带针对性错误提示（v3.13.0）。
9. Claude Desktop 专属：第三方供应商、直连模式、模型映射（2.6 文档）。
10. OAuth/订阅类供应商：Codex OAuth、GitHub Copilot premium、Token Plan（Kimi/GLM/MiniMax）、DeepSeek/OpenRouter 等官方余额查询（v3.13.0）。

### 1.2 连接模式与高可用
11. 三种连接模式：直连（改写配置文件）/ 路由（本机 HTTP 代理转发）/ 聚合（按 `/model` 模型分流到多家供应商，仅 Claude Code、Codex）（2.2-switch.md）。
12. 本地路由：接口格式转换（Claude Code 用 OpenAI/Gemini 格式供应商等）、自动故障转移（按队列切备用）、热切换、记录每次请求用量与状态（4.1-service.md）。
13. 熔断机制：熔断时长可配，「设置 → 本地路由」可停止/重启服务、一键「全部回到直连」（5.2-questions.md）。

### 1.3 扩展管理（全局页）
14. 统一 MCP 面板：矩阵表（行=服务器、列=应用），按应用勾选同步到 8 个工具；列头批量操作（启用其余 N 个/全部启用/全部关闭）且**可撤销**；从各应用导入现有配置；Deep Link 导入；复制全部为 mcpServers JSON（3.1-mcp.md、README_ZH）。
15. 提示词库：按工具分别管理，Markdown 编辑器；启用时写入该工具提示词文件（CLAUDE.md/AGENTS.md/GEMINI.md），**启用前先把原文件内容存回提示词库**（README_ZH）。
16. Skills：发现（搜 skills.sh / 浏览 GitHub 仓库）→ 一键安装到支持的工具（README）。
17. 会话管理器：重写于 v4，AI 每轮做了什么、改了什么、哪步失败一目了然（changelog 4.0.0）。
18. 授权中心：托管 GitHub Copilot / Codex OAuth / xAI OAuth 凭据（5.1-config-files.md 目录结构佐证）。
19. 工作区文件与每日记忆（手册目录 3.5；Hermes 有「记忆」页签）。

### 1.4 观测与运维
20. 用量统计页：每请求的 Token/花费/输出速度；汇总卡片（总请求/总 Token/估算费用/成功率）；时间范围（今日/7 天/30 天/全部）；「全部」下有过去一年每日用量**热力图**；按供应商/模型统计；趋势图、请求日志（4.4-usage.md、changelog 4.0.0）。
21. 侧栏「用量统计」入口旁内联显示「今日 $xx」（界面概览文档）。
22. 「应用」页：集中显示每个 AI 工具的版本、安装位置、来源，支持安装/升级/批量升级；管理侧栏显示哪些应用（最多 10 个）（changelog 4.0.0、界面概览）。
23. 系统托盘：每应用一行子菜单，点选即切换；仅托盘轻量模式（退出销毁主窗口、按需重建，空闲近零占用）（v3.13.0）。
24. CLI / TUI：终端内全屏键盘界面，←→↑↓/Enter/Esc 导航，`[` `]` 切换应用，支持 SSH 会话（ccswitch.io tutorials）。
25. 自动更新：启动时检查，有新版本界面提示并一键下载安装；设置→关于手动检查（安装指南）。
26. 各 CLI 工具新版本检查：启动时查一次，有新版在侧栏「应用」上显示圆点（1.5-settings.md）。
27. 多语言：简中/繁中/English/日本語，切换即时生效（1.5-settings.md）。
28. 数据管理：SQLite 数据库为 SSOT（`~/.cc-switch/cc-switch.db`）；SQL 备份导出/导入；`~/.cc-switch/backups/` 与 `live-first-write/` 保留首次改写前的原配置（5.1、5.2 文档）。
29. 配置目录云同步：CC Switch 配置目录可指向云同步文件夹（1.5-settings.md）。

---

## 2. 页面结构（v4）

依据：界面概览（ccswitch.io/zh/docs?item=interface）、DeepWiki 15.1 Frontend Architecture、changelog 4.0.0。

### 2.1 整体：左侧栏 + 内容区（v4 从 v3 的「顶部导航栏 + 应用切换下拉」改为侧边栏布局 + 橙色主题）

```
┌──────────────┬────────────────────────────────────────────┐
│ [收起按钮]    │ 页头：应用名·页面名      [项目切换][+ 添加][⋯]│
│──────────────│ (OpenClaw/Hermes 页头下还有页签)            │
│ 应用列表      ├────────────────────────────────────────────┤
│  Claude Code │ [直连|路由|聚合] ←模式标签,圆点=当前生效      │
│  Codex  ·路由│────────────────────────────────────────────│
│  Gemini CLI  │  ┌─ 供应商卡片 ──────────────────────────┐ │
│  ... (≤10)   │  │≡ 图标 名称/备注/端点    额度  [操作*6] │ │
│──────────────│  └───────────────────────────────────────┘ │
│ 全局页        │  ┌─ 供应商卡片 ──────────────────────────┐ │
│  MCP         │  │ ...（拖拽手柄排序，操作按钮悬停显现）   │ │
│  Skills      │  └───────────────────────────────────────┘ │
│  提示词       │                                            │
│  会话         │                                            │
│  授权中心     │                                            │
│  用量统计 $xx│                                            │
│──────────────│                                            │
│ 应用 ●       │                                            │
│ 设置         │                                            │
└──────────────┴────────────────────────────────────────────┘
```

- 侧栏三段式：**应用列表 / 全局页 / 底部（应用、设置）**。侧栏可收起为仅图标（DeepWiki：compact 72px icon rail）。
- 应用名旁小标记表示该应用当前处于路由/聚合/模型映射；出问题时提示「需要处理」。
- 「应用」「设置」旁圆点 = 有 CLI 工具或 CC Switch 本身的新版本。
- 页头右侧：添加供应商、项目切换（默认隐藏，设置里开）、⋯ 菜单（查看会话、配置目录、安装与升级、在侧栏隐藏、查看此应用用量）。

### 2.2 设置页：整屏替换（不是弹窗/Tab）

```
┌──────────────┬────────────────────────────┐
│ ← 返回(Esc)  │  当前设置组内容              │
│──────────────│  开关即时保存;               │
│ 通用          │  路径类需点该块「保存」      │
│ 应用配置      │                            │
│ 本地路由      │                            │
│ 网络         │                            │
│ 数据         │                            │
│ 关于         │                            │
└──────────────┴────────────────────────────┘
```

设置独占一屏，左侧栏被替换为设置目录（6 组）；`Cmd/Ctrl + ,` 直达「通用」。原则：**设置里只放偏好，功能页全在侧栏**（1.5-settings.md 原文）。

### 2.3 MCP 页：矩阵表

行 = MCP 服务器，列 = 应用（只显示侧栏设为可见的应用），格子 = 启用开关；页头「从应用导入」「添加 MCP」+ ⋯ 菜单；搜索框过滤；列头批量操作可撤销（3.1-mcp.md）。

### 2.4 页面清单汇总
应用供应商页（×最多10）｜MCP｜Skills｜提示词｜会话｜授权中心｜用量统计｜应用管理｜设置（6 组）｜OpenClaw 专属（工作区/配置）｜Hermes 专属（记忆）。

---

## 3. 设置页逐项清单（重点）

依据：docs/user-manual/zh/1-getting-started/1.5-settings.md（main 分支）及 5.2-questions.md 交叉补全。**直接证据**为主。

### 3.1 通用
| 分组 | 设置项 | 说明 |
|---|---|---|
| 外观 | 界面语言 | 简中/繁中/EN/JA，即时生效无需重启 |
| 外观 | 明暗 | 跟随系统 / 浅色 / 深色 |
| 侧栏与页头 | 在侧栏显示哪些应用 | 点「前往『应用』」跳到应用页勾选，至少保留 1 个 |
| 侧栏与页头 | 显示项目切换 | 默认隐藏，开启后页头出现项目切换器 |
| 各应用的新版本 | 启动时检查各应用新版本 | 有新版在侧栏「应用」显示圆点，不自动升级 |
| 窗口与终端 | 开机自启 | 随系统启动运行（英文版文档确认 Launch on Startup） |

### 3.2 应用配置（每个应用一块：专属开关 + 配置目录）
- Claude Code：**应用到 Claude Code 插件**（写入 `~/.claude/config.json` 的 `primaryApiKey`，保持 CLI 与 VS Code 插件一致）；**跳过初次安装确认**。
- 配置目录：Claude Code / Codex / Gemini CLI / Grok Build / OpenCode / OpenClaw / Hermes / Pi 各一行，可指向自定义路径，留空用默认（`~/.claude/`、`~/.codex/`、`~/.gemini/`…）；改完点该块「保存」；MCP/Skills/提示词路径随之变化。

### 3.3 本地路由
- 路由服务启停/重启（重置状态）；「全部回到直连」一键恢复所有应用；熔断相关时长参数（默认有值）（来自 5.2 FAQ 的引用，部分细节未逐项核实，见「缺失证据」）。

### 3.4 网络
- 全局出站代理：CC Switch 访问外部 API 用的 HTTP/HTTPS 代理。

### 3.5 数据
- 存储位置：CC Switch 配置目录（默认 `~/.cc-switch/`，可指云同步文件夹，改后需重启，不自动搬文件）。
- 导出配置：导出 SQL 备份 `cc-switch-export-{timestamp}.sql`，含全部供应商、MCP、提示词预设、用量日志、应用设置。
- 导入：选择 SQL 文件（仅认 CC Switch 导出的备份）→ 确认覆盖。
- 备份与恢复：从 `~/.cc-switch/backups/` 恢复（5.2 FAQ 引用「设置 → 数据 → 备份与恢复」）。

### 3.6 关于
- 版本信息、检查更新（自动更新 + 手动检查）、开源协议。

**保存交互约定（值得注意）**：开关类设置即时保存；路径类设置改完必须点该块的「保存」——按数据类型区分保存粒度，避免误写路径。

---

## 4. 交互细节

### 4.1 添加供应商完整流程（1.4-quickstart.md）
1. 侧栏选中工具 → 页面右上角 **+**（添加供应商）
2. 预设下拉：支持**按中文名和域名搜索**；同一家的不同套餐/地区合并成一行；或选「自定义」
3. 预设自动填端点 → 只需填 API Key
4. 点「添加」→ 出现在列表
- 空状态：**供应商列表为空时自动弹出「导入配置」对话框**，空列表场景下文案优化、取消按钮变为「稍后设置」（commit 9541970，2025-08）；v3.12.2 起空状态还提示通用配置 Snippet 功能。

### 4.2 切换流程与状态反馈
- 独占式应用（Claude Code/Codex/Gemini/Grok Build）：卡片「切换」按钮 → 状态变为「使用中」。
- 共存式应用（OpenCode/OpenClaw/Hermes/MiniMax Code）：按钮为「添加」（Pi 为「启用」），可同时添加多个。
- **模式标签是"只读预览"**：点「直连/路由/聚合」标签只切换查看内容，不改配置；真正换模式要点写明后果的按钮（「开始路由」「切换到聚合模式」「回到直连」）；标签旁有「生效中」标记，回到直连可一步撤销（changelog 4.0.0）。这是非常好的"防误操作"设计。
- 生效方式因工具而异并明确告知：Claude Code 即时热重载；Codex 需重开终端；Gemini 每次请求重读配置（1.4-quickstart.md 生效方式表）。

### 4.3 系统托盘（2.2-switch.md、changelog 4.0.4）
- 右键托盘图标 → 每个切换式应用一行子菜单。
- 子菜单标题压缩为「**应用名 · [路由/聚合 ·] 在用供应商 · 额度摘要**」——不打开主界面即可知当前状态。
- 直连模式：点供应商即切换；需要路由的供应商后标「（需要路由）」，点了会打开应用页并弹提示（而不是静默失败）。
- 切换完成托盘短暂提示「已切换到 xxx，重启后生效」。
- **托盘图标只在真正需要处理时才显示提醒**（克制的打扰策略）。
- 轻量模式：退到托盘即销毁主窗口、按需重建（v3.13.0）。

### 4.4 状态反馈与颜色语义
- 额度：平时灰色不抢眼；百分比 <10% 加粗；余额用完才变红；带「⏱ 2h30m」重置倒计时；点击额度即重新查询（changelog 4.0.4）。**三级渐进强调**。
- 侧栏：应用名旁模式小标记、出问题提示「需要处理」、「应用/设置」旁更新圆点、「用量统计」旁「今日 $xx」。
- 删除保护：当前启用的供应商禁止删除（删除按钮禁用）。
- 错误提示：模型自动获取失败给出针对性错误提示；托盘切换给出结果 toast（前端用 sonner）。

### 4.5 快捷键与其他
- `Cmd/Ctrl + ,`：随时打开设置（直达「通用」）。
- `Esc`：设置页返回上一页。
- TUI：`[` `]` 切换应用，方向键 + Enter/Esc。
- 卡片操作按钮（启用/编辑/复制/测速/用量/删除 6 个）**悬停才显现**，平时隐藏保持简洁。
- 拖拽手柄 ≡ 上下拖动排序（@dnd-kit）。
- 端点地址可点击打开供应商官网。

---

## 5. 视觉语言

依据：changelog 4.0.0、DeepWiki 15.1、commit c0d9d02、App.tsx / AppSwitcher.tsx 源码摘录（GitHub 文件页）。标注：具体数值多为**研究者推断**，未逐一核实。

1. **主题**：v4 全新侧边栏布局 + **橙色主题**（changelog 原文「新界面采用侧边栏布局和橙色主题」）——单一高辨识度品牌色 + 中性灰底。
2. **技术栈**：Tailwind CSS + shadcn 风格 UI 基元（`src/components/ui/popover` 等）、`cn()` 工具函数、CSS 变量语义 token（DeepWiki 15.1；shadcn theming 模式）。暗色模式经 `useDarkMode` hook 管理并持久化、跟随系统（commit c0d9d02）。
3. **图标**：lucide-react 全套（Plus/Settings/ArrowLeft/Search/FolderOpen/KeyRound/Shield/Cpu/LayoutDashboard…，见 App.tsx import 摘录）；供应商有品牌图标且**可自定义颜色**。
4. **动效**：framer-motion 的 `motion` + `AnimatePresence`（App.tsx），推测用于页面切换与列表增删（推断）。
5. **反馈**：sonner toast。
6. **信息层级**：卡片单行承载 状态+操作+运行信息（「不用反复跳页面就能完成切换、编辑、测试和排查」——教程文档的设计自述）；次要信息（额度）弱化灰色，危险/关键信息（<10%、耗尽）逐级加粗变红。
7. **密度控制**：操作按钮悬停显现；侧栏可收成 72px 图标栏；预设列表合并同家套餐减行。
8. 圆角/阴影/间距具体数值：**未取得源码核实**（见缺失证据）。从 shadcn 惯例推断为 `--radius` token + 卡片式浅阴影（推断）。

---

## 6. 对「AI 包工头」的借鉴点

> AI 包工头页面简称：JSON 编辑器 / MD 编辑器 / Skills / MCP / 提示词 / 套餐(profiles) / 模型服务(providers) / 健康检查 / 设置。

| # | 借鉴点 | 对应 AI 包工头位置 | 优先级 | 说明 |
|---|---|---|---|---|
| 1 | **"预览不生效 + 写明后果的切换按钮"模式**：切换类操作分两步——先看后切，按钮文案写明后果，可一步撤销 | 套餐(profiles) 应用、模型服务切换 | **P0** | 直接消除"点了标签以为已切换"的误操作；包工头的套餐应用是破坏性操作，可配 `snapshotNow()` 撤销 |
| 2 | **设置页整屏替换 + Esc 返回 + 分组目录**，且"设置只放偏好，功能页不放进来" | 设置页 | **P0** | 包工头设置项会随 56 个 agent 增长，目录式分组比长滚动页更可扩展；`Cmd/Ctrl+,` 直达 |
| 3 | **卡片操作按钮悬停显现 + 拖拽手柄排序**（@dnd-kit） | Skills 列表、MCP 列表、模型服务列表、套餐列表 | **P0** | 包工头多个列表页都适用；平时清爽、悬停给全操作；排序对套餐优先级有用 |
| 4 | **当前生效项的多层标识**：列表内「使用中」状态 + 侧栏入口旁模式小标记 + 出问题「需要处理」 | providers 当前项、agent 可见性、健康检查异常项 | **P0** | 包工头的"当前生效套餐/服务"应有同样的三层可见性（行内→侧栏→托盘/标题栏） |
| 5 | **额度/状态的渐进色彩语义**：灰（正常）→ 加粗（<10%）→ 红（耗尽），点击即刷新 | 健康检查、模型服务状态 | P1 | 比一律红绿更健康；刷新交互"点数字重查"很妙 |
| 6 | **空状态即引导**：列表为空自动弹「导入现有配置」对话框，取消按钮文案改「稍后设置」 | Skills/MCP/providers/提示词首次使用 | P1 | 包工头的 MCP/Skills 页也可以"从各 agent 现有目录导入"作为空状态主行动 |
| 7 | **MCP 矩阵表**：行=服务器、列=agent，格子=开关，列头批量操作可撤销 | MCP 管理页 | P1 | 包工头管 56 个 agent，矩阵 + 搜索过滤 + "只作用于筛选结果"的批量操作几乎是必需品 |
| 8 | **侧栏内联摘要**（「今日 $xx」、更新圆点） | 侧栏健康检查旁显示异常数、套餐旁显示当前生效名 | P1 | 不开页面即可感知状态；与包工头 activitybar 的红点/角标一致 |
| 9 | **开关即时保存 / 路径手动保存的差异化约定** | 设置页 | P1 | 防止路径输一半就被应用；每种输入类型有明确保存预期 |
| 10 | **托盘菜单的信息压缩格式**「名称 · 模式 · 当前项 · 摘要」+ 需要路由的项标注并引导回主界面 | 若包工头未来加托盘 | P2 | 包工头目前似无托盘，立项时参考 |
| 11 | **提示词启用前自动备份原文件内容回库** | 提示词管理（写入 CLAUDE.md/AGENTS.md 时） | P1 | 与包工头"禁止删用户真实目录"的安全原则同构：写用户文件前先收编 |
| 12 | **从各工具导入现有配置**（MCP/供应商一键导入） | MCP/Skills/providers 的"从 agent 导入" | P1 | 降低迁移成本，包工头的 detectDir 检测正好做入口 |
| 13 | **「应用」页集中管理工具版本/安装/升级 + 可见性** | 设置→Agent 管理 | P2 | 包工头的 agent 可见性开关已类似；可补"版本/路径/来源"信息列 |
| 14 | **热力图（年度每日用量）+ 汇总卡片** | 健康检查/未来用量统计 | P2 | 数据可视化参考 |
| 15 | **仅托盘轻量模式**（销毁主窗口、按需重建） | 全局 | P2 | 常驻类工具的省电方案 |
| 16 | **多语言即时切换（i18n）** | 设置 | P2 | cc-switch 用 react-i18next（App.tsx）；包工头若有出海需求再上 |

---

## 最值得抄的 Top 5

1. **「先看后切」两段式切换**（模式标签只读预览 + 写明后果的切换按钮 + 一步撤销）→ 套餐应用/服务切换，P0。
2. **卡片操作悬停显现 + 拖拽排序**：单行卡片承载状态+全部操作，平时极简 → Skills/MCP/providers/套餐四个列表页统一采用，P0。
3. **设置页整屏化 + 分组目录 + `Cmd/Ctrl+,` + Esc 返回**，并把"设置=纯偏好、功能全部走侧栏"作为信息架构纪律 → 设置页重构，P0。
4. **MCP 矩阵表**（行=条目、列=agent、格子=开关、批量列操作可撤销、只作用于筛选结果）→ MCP 管理，P1（对 56-agent 场景是规模化正解）。
5. **状态可见性的三层穿透 + 渐进色彩语义**（行内「使用中」→ 侧栏小标记/角标 → 灰/加粗/红的健康表达）→ providers 当前项 + 健康检查，P0/P1。

---

## 矛盾与版本差异（已记录，未强行消解）

- **v3 vs v4 设置结构**：旧文档（cc-switch.atomgit 镜像、v3.16.5 tag 的 1.3-interface.md）里设置是「通用/高级/用量/关于」四个 Tab、且用量在设置内；v4 改为整屏 6 组（通用/应用配置/本地路由/网络/数据/关于），用量统计独立为侧栏全局页。本报告以 v4 为准。
- **界面布局**：v3 是顶部导航栏 + 应用切换下拉；v4 改为侧边栏。ccswitch.co 等第三方镜像站仍有 v3 旧文档（卡片操作 10 个按钮的旧版描述），引用时已区分。
- **受管应用数量**：README_ZH 标题列 12 个工具，介绍文档正文说 10 个；侧栏可见上限为 10。应为文档更新不同步，以 main 分支 README 为准。

## 缺失证据

- 具体圆角 px、阴影值、间距 scale、字体大小层级：未能读取 `src/index.css`/tailwind 配置（本环境无 shell、GitHub 文件页 fetch 失败），仅能从 shadcn/Tailwind 惯例推断。若需精确数值，建议浅克隆仓库查 `src/index.css` 与 `tailwind.config`。
- 「本地路由」设置组的完整逐项清单（熔断时长默认值等）：仅从 5.2 FAQ 间接引用，未获 1.5-settings.md 该节全文。
- 错误提示的完整文案库、快捷键完整列表（除 `Cmd/Ctrl+,` 与 `Esc` 外是否有其他）：未核实。
- v4 供应商卡片的确切元素布局（官方手册 v4 版卡片表格在检索摘录中被截断）。

## 来源清单

**保留（强来源）**
- [README_ZH.md](https://github.com/farion1231/cc-switch/blob/main/README_ZH.md) — 功能定位与核心特性
- [docs/user-manual/zh/1-getting-started/1.5-settings.md](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/1-getting-started/1.5-settings.md) — 设置页 6 组逐项（重点来源）
- [界面概览（官网 docs）](https://ccswitch.io/zh/docs?item=interface&section=getting-started) — v4 侧栏三段式、页头、模式标签
- [docs/user-manual/zh/2-providers/2.2-switch.md](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/2-providers/2.2-switch.md) — 切换流程、托盘菜单结构
- [docs/user-manual/zh/3-extensions/3.1-mcp.md](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/3-extensions/3.1-mcp.md) — MCP 矩阵表与批量操作
- [changelog 4.0.0](https://ccswitch.io/zh/changelog/4.0.0) / [4.0.4](https://ccswitch.io/zh/changelog/4.0.4) — v4 设计意图自述（橙色主题、额度颜色语义、托盘重组）
- [release-notes v3.13.0-zh](https://github.com/farion1231/cc-switch/blob/main/docs/release-notes/v3.13.0-zh.md) — 轻量模式、余额展示、模型自动获取
- [commit 9541970](https://github.com/farion1231/cc-switch/commit/9541970d10ffd0b99682c39d6e2aee549aeca018) — 空状态自动弹导入对话框（直接证据）
- [commit c0d9d02](https://github.com/farion1231/cc-switch/commit/c0d9d0296d30feb28b06b60fc54f289d576a5aae) — useDarkMode 暗色模式实现（直接证据）
- [DeepWiki 15.1 Frontend Architecture](https://deepwiki.com/farion1231/cc-switch/15.1-frontend-architecture) — Tailwind/shadcn、72px 收起侧栏、TanStack Query
- [docs/user-manual/zh/4-proxy/4.4-usage.md](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/4-proxy/4.4-usage.md) — 用量统计页结构
- [docs/user-manual/zh/5-faq/5.1-config-files.md](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/5-faq/5.1-config-files.md) — SQLite SSOT、目录结构
- [1.4-quickstart.md](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/1-getting-started/1.4-quickstart.md) — 添加/切换流程、生效方式表

**弃用/降级**
- ccswitch.co / cc-switch.atomgit.com / cc-switch.cc 等镜像与第三方教程站 — 多为 v3 旧版文档，仅作版本差异佐证
- SaladDay/cc-switch-cli — 第三方分叉项目，勿与官方 CLI 混淆
- ui.shadcn.com theming 页 — 通用背景，非 cc-switch 证据

## 后续建议

1. 浅克隆仓库，精读 `src/components/settings/`（确认 6 组实现）、`src/index.css`（精确 token 数值）、`src/components/providers/ProviderList.tsx`（v4 卡片布局）。
2. 实机安装 v4.0.20 截图各页面，核对 ASCII 布局图与空状态/错误态的实际视觉。
3. 对照包工头现有 `src/lib/themes.ts` token 体系，评估引入"悬停显现操作列"与"矩阵表"对现有组件的改造成本。
