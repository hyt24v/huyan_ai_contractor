# 布局借鉴报告:4 个 GitHub 桌面应用项目的布局与形态设计横向分析

> 面向「AI 包工头」(Tauri + React 桌面工具集)的布局设计参考。
> 本文目标存放路径:`docs/design-audit/layout-patterns.md`(本次按编排要求输出至子代理 artifact 目录)。
> 调研日期:2026-10-25。证据来源:各项目 README、官方文档、官网、Changelog 与公开 PR 描述(受网络限制未能浅克隆源码,GitHub 页面正文经搜索索引快照获取,细节处已标注证据等级)。

---

## 0. 四项目总览

| 项目 | 定位 | 星数 | 形态 |
|---|---|---|---|
| superset-sh/superset | 编排 100+ 并行 coding agent 的 agentic IDE(每个任务一个隔离 git worktree) | ~15.5K | macOS 桌面 IDE(另含 CLI/SDK/MCP/iOS) |
| yetone/magpie | 「所有 agent 的模型,一处搞定」——菜单栏统一切换各 agent 的模型/供应商,本地网关兜底 | ~20.8K | 菜单栏面板 + 常规窗口 + TUI + Web UI + CLI(同一套内嵌 Web UI) |
| alchaincyf/fanbox | vibe coding 驾驶舱:左文件、中变更、右终端,看清 agent 每一次改动 | ~1K | macOS 桌面三栏窗口(含 Dock 角标、定时任务) |
| inkeep/open-knowledge | 「漂亮的 AI-native Markdown IDE」:人和 agent 在同一份 md 上协作的知识库编辑器 | ~4.6K | 桌面应用(macOS/Win/Linux)+ 本地 Web/CLI |

---

## 1. Superset:多 pane 编排与状态总览

**一句话定位**:agentic IDE——每个任务一个隔离 git worktree,在一个窗口里跑、看、审、合并 100+ 个并行 coding agent。(来源:GitHub README、superset.sh 官网)

**整体布局**(依据 docs.superset.sh、changelog、PR #3088/#5824/#3122 描述还原):

```
┌──────────────────────────────────────────────────────────────┐
│ Dashboard Sidebar            │ Workspace Tab Bar(workspace 切换)│
│ ┌──────────────────┐        ├───────────────┬────────────────┤
│ │ 项目 / workspace  │        │ Pane          │ Pane(水平/垂直  │
│ │ 列表,行内状态点:  │        │ Terminal      │ Split)         │
│ │ ●工作 ●阻塞 ●等你 │        │ /Editor       │ Diff/Editor/   │
│ │ 可折叠为纯图标     │        │ /Diff         │ PR/Browser     │
│ │ 页脚: 用户/设置 ⚙  │        │ (PaneHeader 可 │ 配置操作按钮)   │
│ └──────────────────┘        ├───────────────┴────────────────┤
│                             │ Right Sidebar(⌘L):            │
│                             │ Changes(=Diff Viewer)/Pages/   │
│                             │ Run/文件树                      │
└──────────────────────────────────────────────────────────────┘
```

**关键设计**:
1. **Pane 数据模型:Tab → Split → Pane**(2026 年从 Root→Group→Pane 三层简化为 Tab→Split→Pane,N 叉加权分割,用 `react-resizable-panels` 做拖拽 resize;PaneHeader 的操作按钮可配置)。来源:[PR #3088](https://github.com/superset-sh/superset/pull/3088)。**Support: 直接证据(PR 描述)**。
2. **「Status at a glance」**:官网明言"一眼看出哪些 agent 在干活、哪些被阻塞、哪些在等你";changelog 提到 workspace 状态指示点(workspace status indicators)。来源:superset.sh 官网 + [2026-01-06 changelog](https://superset.sh/changelog/2026-01-06-sidebar-workspaces-status)。**Support: 直接证据**。
3. **一切皆可 pane 化**:PR 不再跳走,而是在 diff 旁边开一个 pane(标题、checks、描述、合并菜单);浏览器预览也是 pane。来源:[changelog](https://superset.sh/changelog)。**Support: 直接证据**。
4. **Dashboard 侧栏可折叠为纯图标紧凑模式**;搜索按钮直接开命令面板。来源:[PR #5824](https://github.com/superset-sh/superset/pull/5824)。**Support: 直接证据**。
5. 技术栈是 Electron + React + ElectricSQL(DeepWiki 架构页)。注意:**与 AI 包工头的 Tauri 栈不同**,但其 pane 模型是纯前端概念,React 可直接借鉴(`react-resizable-panels` 与栈无关)。

**对工具类 app 的适用性判断(researcher inference)**:Superset 的多 pane 分屏是为「同时盯多个长任务」而生的编排需求;AI 包工头的 9 个功能页彼此独立、无并行编排诉求,**整套 Tab→Split→Pane 不必抄**。但有三点可抄:①行内状态点 + 可折叠纯图标侧栏;②「状态总览」心智——把散布各页的健康/配置状态聚合成一眼可扫的列表;③内容类型路由的 pane(代码用 Monaco、Markdown 用 TipTap、图片用查看器)——AI 包工头的 JSON/Markdown 编辑器页本质上已是这个思路。

---

## 2. Magpie:菜单栏形态——弹层、窗口与「单屏清单」

**一句话定位**:本机所有 coding agent(Claude Code/Codex/Gemini CLI/OpenCode…)的模型与供应商,在菜单栏一处切换;背后一个本地网关统一服务,额度用完自动切下一个账号。(来源:README、README.zh-CN)

**形态结构**(来源:[docs/reference.md](https://github.com/yetone/magpie/blob/main/docs/reference.md)、[docs/subsystems/gui-shell.md](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md)):

```
macOS 菜单栏
   │ click
   ▼
┌─ 紧凑弹层面板(compact panel)─┐     ┌─ 常规独立窗口 ─┐
│  同一套内嵌 Web UI           │     │ 同一套 Web UI  │
│  ┌────────────────────────┐ │     │ (内容相同,更宽) │
│  │ Agent 列表,一行一个:     │ │     └───────────────┘
│  │ Claude Code  → Kimi  ▾ │ │            ▲
│  │ Codex        → DeepSeek│ │   `magpie web`:同一页面
│  │ (点击值 → 弹选择器改模型)│ │   直接开到浏览器
│  └────────────────────────┘ │   TUI / CLI:同一能力的
└──────────────────────────────┘   终端形态
```

**关键设计**:
1. **"That is the whole app"**:reference.md 原文——"magpie is a single screen that lists each AI agent on your machine and the model it is set to. Click a value, pick a model. That is the whole app."。**整个主界面只有一个列表**,没有多页导航。来源:reference.md。**Support: 直接证据(原文引用)**。
2. **弹层 vs 独立窗口的取舍:两者都要,共用一套 UI**。gui-shell.md 明确:tray 图标点击落下紧凑面板,另有常规窗口,两者渲染同一个小 Web UI(内嵌资源 + 本机 JSON API);无桌面环境时 `magpie web` 把同一页面开到浏览器。**面板负责"快",窗口负责"全"**。来源:gui-shell.md。**Support: 直接证据**。
3. **主界面什么时候出现**:点击菜单栏图标即出(面板);重操作/设置走窗口;无头环境走 Web/TUI。同一 JSON API 后端,形态只是壳。来源:gui-shell.md + README(列出的形态:菜单栏应用、窗口、TUI、Web 界面、CLI)。**Support: 直接证据**。
4. 佐证案例(cc-switch):同类工具 cc-switch v4.0.16 把托盘**从纯菜单改成快捷面板**——"点托盘图标弹出面板,能看到各应用正在用的供应商、模式、额度和用量,也能直接搜索、切换;想换回菜单可在设置里改"。说明在"切换类工具"品类里,**弹层面板已被验证优于纯右键菜单**。来源:[cc-switch releases](https://github.com/farion1231/cc-switch/releases)、[cc-switch 源码解析 ch27](https://book.cuiliang.ai/cc-switch-deep-dive/part-7/ch27-tray/)(后者还指出托盘图标用绿点实时反映运行状态)。**Support: 直接证据**。

**AI 包工头加 tray 值不值(researcher inference + 判断)**:
- **值,但只做"快捷面板",不做"全功能搬家"**。AI 包工头里高频低复杂度操作=切换配置套餐、切换模型服务/供应商;magpie 与 cc-switch 均证明这类操作收纳进托盘面板成立。健康检查的摘要状态可放托盘图标/面板首行(对应 cc-switch 绿点)。
- JSON/Markdown 编辑器这类重交互页不适合弹层,保留独立窗口——与 magpie"面板快、窗口全"的双形态一致。
- Tauri 原生支持 tray + 多窗口,技术成本低。**结论:P1 建议,见第 6 节**。

---

## 3. Fanbox:三栏驾驶舱的信息分区逻辑

**一句话定位**:vibe coding 驾驶舱——左边浏览文件,右边/下边开真实终端指挥 agent,中间看清每一次改动,被 agent 写过的文件卡片会点亮。(来源:README)

**布局**(依据 README + releases 描述还原):

```
┌───────────────────────────────────────────────────────────┐
│ 顶栏: 「本回合」收件箱按钮(变更/回放/存档三合一)            │
├──────────┬───────────────────────────┬────────────────────┤
│ 左:文件   │ 中:变更/预览               │ 右:终端            │
│ 树浏览/   │ ・agent 改哪个文件就看哪个  │ ・多会话标签栏       │
│ 预览/编辑 │   (文件跟随,代码流动高亮,  │ ・「谁在等我」紧凑    │
│          │   html/md 实时渲染)       │   会话列表:一行一个  │
│ 上下文   │ ・被写文件卡片点亮         │   [形状+颜色+文字]   │
│ (我在哪) │ ・悬停看 +/-、查看改动、   │   状态+项目+时长+    │
│          │   还原此文件、整回合回滚   │   最后一句回复       │
│          │ 结果(改了什么)            │ 行动(去处理)       │
├──────────┴───────────────────────────┴────────────────────┤
│ 状态栏(回合存档入口等)         Dock 角标 = 在等你的会话数    │
└───────────────────────────────────────────────────────────┘
```

**信息分区逻辑**(来源:README 原文 "browse files on the left, command agents on the right, watch every change in between",**直接证据**;分区命名为 researcher inference):
- **左=上下文(我在哪)**:文件系统,回答"项目里有什么"。
- **中=结果(改了什么)**:变更可视化是驾驶舱的"仪表盘",占据视觉中心——这与传统 IDE 把编辑器放中心、把 diff 藏进面板的做法相反,因为 vibe coding 场景里**人主要是审阅者而不是写作者**。
- **右=行动(去处理)**:终端 + 会话指挥,回答"下一步点哪里"。

**值得注意的微设计**:
1. **状态三重编码**(形状 + 颜色 + 文字同时区分 干活中/等你确认/等你输入/空闲/已退出),不依赖单一颜色——无障碍与扫读效率兼顾。来源:releases。**直接证据**。
2. **注意力外溢到 OS 层**:"在等你"的数量同步到 Dock 角标,窗口被遮住也看得见;⌘⌥L 直接跳到下一个等你的会话(优先级:等你确认 > 等你输入 > 刚完成没看)。来源:releases。**直接证据**。
3. **「本回合」收件箱**:把变更收件箱、会话回放、回合存档三个入口收成一个,按回合(agent 开工瞬间的存档)组织,支持整回合回滚。来源:releases。**直接证据**。
4. **手动优先**:文件跟随自动追着 agent 的改动走,但用户一手动浏览就自动停——自动化永不抢用户控制权。来源:[commit c854608](https://github.com/alchaincyf/fanbox/commit/c854608c948cb944c309333f33d3f833df005a03)。**直接证据**。

**对 AI 包工头的迁移(researcher inference)**:AI 包工头没有 agent 终端编排,但三栏分区逻辑可局部借用——例如 MCP/Skills 管理页:左=已装条目列表(上下文)、中=条目详情/diff(结果)、右=操作与日志(行动);JSON 编辑器页:左=文件/历史快照、中=编辑器、右=校验结果/预览。「手动优先于自动跟随」与「三重编码状态」是零成本可抄的微设计。

---

## 4. OpenKnowledge:AI-native 编辑器的界面美学

**一句话定位**:漂亮的 AI-native Markdown IDE——人和 agent 在同一份文件上协作的知识库/LLM wiki 编辑器,local-first。(来源:README、openknowledge.ai)

**布局**(依据官方 Editor 文档还原):

```
┌────────────────────────────────────────────────────┐
│ Header:项目切换 / 项目标签 / (窄屏时 Editor·Agents· │
│         Terminal 三选一切换)                        │
├──────────┬─────────────────────────────────────────┤
│ 文件侧栏  │  编辑器卡片(editor card,居中窄列,      │
│ (组织整个 │  大留白)                                │
│  项目)    │  ・WYSIWYG 默认,⌘⌥M 切源码,           │
│          │    同一 CRDT 文档双视图同步               │
│          │  ・frontmatter = Properties 属性面板      │
│          │  ・Problems 面板内联 lint                 │
│          │  ・斜杠命令插入内容块                     │
└──────────┴─────────────────────────────────────────┘
```

**美学要点**(来源:[Editor 文档](https://openknowledge.ai/docs/features/editor)、[Themes 文档](https://openknowledge.ai/docs/plugins/themes)):
1. **内容即主角**:WYSIWYG 默认(不是源码+预览双拼),源码模式只是 toggle;编辑区是居中的"卡片",周围大留白——典型的文档工具(Notion/Craft)式层级,而非 IDE 式密度。**Support: 直接证据**。
2. **结构降级为面板**:frontmatter 不让用户面对 YAML,而是变成 Properties 属性面板;lint 问题收进 Problems 面板并内联标记。元数据与诊断都"面板化",正文保持干净。**Support: 直接证据**。
3. **主题即插件**:base16 调色板,亮/暗模式各选一色,画廊式 tile 选择;主题文件是可移植 YAML,且"个人、永不提交进项目"。**Support: 直接证据**。
4. **单文件会话的克制**:`ok note.md` 打开散文件时是"临时单文件会话"——**去掉侧栏、项目标签、项目切换器,只剩 header + 编辑器卡片**,会话状态全放临时目录,不动用户目录一个字节。功能做减法的典范。**Support: 直接证据**。
5. **窄屏降级**:窄宽度时 header 提供 Editor/Agents/Terminal 三选一切换,而不是硬挤三栏。**Support: 直接证据**。

**对 AI 包工头的迁移(researcher inference)**:AI 包工头的 Markdown 编辑器页可直接抄 1、2、5——居中窄列编辑卡片、frontmatter 属性面板化、窄屏降级切换。主题方面,AI 包工头已有 HSL token 主题系统(见 AGENTS.md),方向一致;可借鉴"亮/暗各绑一套调色板 + 画廊式选择"的呈现方式。

---

## 5. 形态横评:四种形态各自解决什么问题

| 形态 | 代表 | 解决的问题 | 适合的场景 |
|---|---|---|---|
| IDE 多 pane 编排 | superset | 同时盯 N 个长任务/上下文 | 并行编排、审阅流 |
| 菜单栏弹层 + 复用窗口 | magpie | 高频低复杂度切换,不打断主工作 | 状态切换、速查 |
| 三栏驾驶舱(上下文/结果/行动) | fanbox | 审阅者视角的改动追踪 | 监控 + 审阅 + 操作一体 |
| 居中卡片文档工具 | open-knowledge | 内容沉浸、降低工具感 | 编辑器、写作、阅读 |
| 主从(列表-详情)工具窗 | cc-switch(参照) | 条目管理类 CRUD | 配置管理 |

---

## 6. 综合建议:AI 包工头的布局该不该改?

**当前形态评估(researcher inference)**:AI 包工头是 9 个并列、彼此独立的功能页(JSON/Markdown 编辑器、Skills、MCP、提示词、套餐、模型服务、健康检查、设置)。VS Code 式 activitybar 作为**一级导航**对这种"工具箱"结构是合适的——页间无共享上下文,不需要 superset 式 workspace 概念。但 VS Code 式的「侧栏」对多数功能页是浪费:JSON 编辑器之外的页面并没有树状资源可浏览,侧栏常沦为空壳或重复一级导航。**判断:保留 activitybar,弱化通用侧栏,改为「页内二级导航/主从布局」(接近 cc-switch 与各设置类应用):窄侧栏只在有列表资源的页面(Skills、MCP、提示词、套餐)出现,且是该页的"主"列表;其余页面全宽内容。**

### P0(立即值得做,低成本高收益)
1. **模型服务页改为「单屏清单」密度**(抄 magpie):一行一个 agent × 当前供应商/模型,点击值直接改,不跳表单。magpie 用"整个 app 只有一个列表"证明了这个密度成立;AI 包工头的模型服务页本质是同一件事。依据:magpie reference.md 原文。
2. **状态徽章三重编码 + 聚合总览**(抄 fanbox + superset):健康检查、Skills/MCP 安装状态统一用 形状+颜色+文字 三重编码;activitybar 或首页加一个"需要关注"聚合计数(对应 fanbox 的"谁在等我"和 Dock 角标思路)。依据:fanbox releases、superset 官网 status-at-a-glance。

### P1(本季度可做)
3. **托盘快捷面板**(抄 magpie 双形态 + cc-switch v4 验证):Tauri tray 点击出紧凑弹层,只承载:当前套餐/供应商速切 + 健康状态摘要 + "打开主窗口"。不做全功能;重操作回主窗口。依据:magpie gui-shell.md、cc-switch v4.0.16 release notes。**值不值:值——AI 包工头的切换类操作正是托盘面板被反复验证过的场景;但要克制范围,避免维护两套 UI(magpie 的解法是面板和窗口渲染同一套 Web UI 的不同密度,可借鉴)**。
4. **Markdown 编辑器页美学升级**(抄 open-knowledge):居中窄列编辑卡片 + 大留白;frontmatter 属性面板化;窄屏降级为单栏切换。依据:openknowledge.ai Editor 文档。

### P2(远期/可选)
5. **三栏分区用于富资源页**(抄 fanbox):Skills/MCP 详情页采用 左列表(上下文)/中详情与 diff(结果)/右操作与日志(行动)。编辑器类页面可加"右栏校验/预览"。
6. **内容类型路由的统一 Pane 容器**(抄 superset FilePane 思路):打开一个条目时按类型路由渲染器(JSON→校验编辑器、md→渲染编辑器、图片→查看器),为将来扩展留口。不需要上 Tab→Split→Pane 全套分屏。

### 不建议抄的
- superset 的多 workspace / git worktree 编排与多 pane 分屏:与工具箱属性不匹配,复杂度高。
- magpie 的 TUI/Web 多形态:桌面工具无此需求。

---

## 7. 最值得抄的 Top 5

1. **magpie「单屏清单」**:一屏列出所有 agent × 当前模型/供应商,点击即改——直接改造 AI 包工头的模型服务页。(github.com/yetone/magpie, docs/reference.md)
2. **cc-switch/magpie 式托盘快捷面板**:弹层而非纯菜单,承载速切 + 状态摘要;Tauri 实现成本低。(cc-switch v4.0.16 releases;magpie docs/subsystems/gui-shell.md)
3. **fanbox 状态三重编码(形状+颜色+文字)+「谁在等我」聚合计数**:状态可读性与注意力回收到 OS 层(Dock 角标/徽标)。(github.com/alchaincyf/fanbox releases)
4. **open-knowledge 居中编辑卡片 + 留白 + frontmatter 属性面板化**:编辑器页"去工具感"的具体手法。(openknowledge.ai/docs/features/editor)
5. **superset 的行内状态点 + 可折叠纯图标侧栏 + 按内容类型路由的 pane 渲染器**:状态总览心智与编辑器容器架构。(superset.sh、PR #3088/#3122)

---

## Contradictions / 证据矛盾

- **fanbox README 标语内部不一致**:GitHub 仓库简介写"左边文件,右边/下边终端,中间看清每一次改动",README 英文版写"command agents on the right"——终端在右还是在下存在版本差异(v2.11.0 提到"装完即三栏")。报告采用"三栏:左文件/中变更/右终端"的当前形态,与任务描述一致。
- **superset 星数与创建时间**:索引元数据显示仓库创建于 2025-10-21、星数 ~15.5K,增速异常快,可能经历过改名/迁移;未进一步核实,仅作量级参考。
- 无其他发现。

## Missing evidence / 未验证项

- 未能直接查看任何项目的界面截图或运行实例(GitHub raw 与页面直连被网络阻断);布局 ASCII 图基于官方文档与 PR 描述**还原**,属于 interpretation,非像素级事实。
- superset pane 模型的手感细节(拖拽、快捷键)未验证;引用自 PR #3088 描述。
- open-knowledge 的具体配色值/字号未提取(仅有主题机制文档)。
- magpie 弹层面板的精确尺寸、失焦关闭行为未找到文档。

## Sources

- Kept: [superset-sh/superset README](https://github.com/superset-sh/superset) — 定位与星数
- Kept: [superset.sh 官网](https://superset.sh/) — status at a glance、并行编排主张(直接引用)
- Kept: [Superset Docs: Workspaces](https://docs.superset.sh/workspaces) / [Diff Viewer](https://docs.superset.sh/diff-viewer) / [Editor & Files](https://docs.superset.sh/editor) / [Pull Requests](https://docs.superset.sh/pull-requests) — 布局结构
- Kept: [PR #3088 pane 模型](https://github.com/superset-sh/superset/pull/3088)、[PR #5824 侧栏重组](https://github.com/superset-sh/superset/pull/5824)、[PR #3122 文件树侧栏/内容路由 pane](https://github.com/superset-sh/superset/pull/3122)、[2026-01-06 changelog](https://superset.sh/changelog/2026-01-06-sidebar-workspaces-status) — pane/侧栏/状态指示点
- Kept: [yetone/magpie README](https://github.com/yetone/magpie)、[README.zh-CN](https://github.com/yetone/magpie/blob/main/README.zh-CN.md)、[docs/reference.md](https://github.com/yetone/magpie/blob/main/docs/reference.md)、[docs/subsystems/gui-shell.md](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md) — 菜单栏形态与"单屏清单"(直接引用)
- Kept: [alchaincyf/fanbox README](https://github.com/alchaincyf/fanbox/blob/master/README.md)、[Releases](https://github.com/alchaincyf/fanbox/releases)、[v2.11.0 release](https://github.com/alchaincyf/fanbox/releases/tag/v2.11.0)、[commit c854608](https://github.com/alchaincyf/fanbox/commit/c854608c948cb944c309333f33d3f833df005a03) — 三栏分区、三重编码、本回合、手动优先
- Kept: [inkeep/open-knowledge README](https://github.com/inkeep/open-knowledge/)、[Editor 文档](https://openknowledge.ai/docs/features/editor)、[Themes 文档](https://openknowledge.ai/docs/plugins/themes)、[Overview](https://openknowledge.ai/docs/get-started/overview) — 编辑器美学与单文件会话
- Kept: [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 及其 [Releases](https://github.com/farion1231/cc-switch/releases)、[托盘章节解析](https://book.cuiliang.ai/cc-switch-deep-dive/part-7/ch27-tray/) — 托盘弹层验证(参照案例)
- Rejected/deprioritized: DeepWiki superset 架构页 — 二手生成内容,仅用于确认技术栈;usemagpie.co/docs/install — 与布局无关;各项目 marketplace/聚合站条目 — SEO 冗余。

## Next steps

1. 若能恢复 GitHub 直连:浅克隆 4 个仓库,核实 superset `apps/desktop` 的实际布局组件树与 magpie 面板的窗口参数(尺寸/失焦关闭),把 interpretation 升级为直接证据。
2. 截图级对比:下载 superset / open-knowledge 官网截图,提取配色与留白数值,为 Markdown 编辑器页改版出具体 token 建议。
3. 针对 P1 托盘面板:在 AI 包工头仓库做 1 天 spike(Tauri tray + 弹层窗口复用现有主题 token),验证"面板/窗口共用一套 React 组件"的可行性。
