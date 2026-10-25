# Skills Manager（xingkongliang/skills-manager）UI/UX 设计审计报告

> 调研对象：xingkongliang/skills-manager(★~6.6-6.8K,Tauri 2 + React 19 + TS + Vite + Tailwind + Rust + SQLite,最新版 v1.43.0)
> 调研时间:2026-10-25。调研方式:README(中/英)、官网 skillsmanager.dev、context7 自动文档(_autodocs)、第三方体验笔记(博客园)及其实机截图、官网产品截图。
> 局限说明:GitHub 主站/raw 在本环境不可达,未能浅克隆源码逐文件核对;视觉结论来自官网与博客园的实机截图(直接证据),源码级结论来自 context7 收录的 `_autodocs/` 自动生成文档(间接但可靠)。

---

## 1. 功能清单(逐条)

依据:README.md / README.zh-CN.md「Features」一节、skillsmanager.dev、context7 `_autodocs`、博客园体验笔记。

### 核心:中央库 + 部署模型
1. **统一技能库**:所有 skill 先进中央库(默认 `~/.skills-manager/skills`,可在设置改),再按需"部署"到各 agent 目录。安装 ≠ 部署,两步分离。
2. **四种安装来源**:Git 仓库(支持 HTTPS/SSH/`owner/repo`/子路径/分支)、本地目录、`.zip`/`.skill` 压缩包、skills.sh 市场。Git 安装是**两段式**:`previewGitInstall` 先克隆到临时目录列出仓库内所有 skill → 用户勾选 → `confirmGitInstall` 入库(源码:`_autodocs/api-reference/tauri-api.md`)。
3. **部署模式二选一**:软链接(默认,改一处处处生效)或复制(设置里切换,给不跟随软链的工具用)。部署会写进各 agent 自己的 skills 目录,agent 侧零改动。
4. **Agent 图标徽章行**:每张 skill 卡片底部展示全部 agent 图标,点亮=已部署,**点图标即装/卸**,实时反映同步状态(README + 官网截图直接证据)。
5. **冲突保护**:部署目标路径存在非本应用管理的目录时**拒绝并指名路径**,提示用户「认领(adopt)进库」或移走;CLI 返回结构化错误码 `TARGET_CONFLICT`(README + `_autodocs`)。
6. **认领(Adopt)**:把 agent 目录里已有的、非本应用安装的 skill 收编进中央库,可顺带绑定 git 来源以便后续更新(`skills adopt --git-url`)。
7. **更新追踪**:Git 来源的 skill 记录 `source_revision` / `remote_revision` / `update_status` / `last_checked_at`(源码 `ManagedSkill` 接口),源有更新时卡片出现橙色 **Update** 徽章,支持一键更新/自动更新;本地来源支持"重新导入"。

### 组织:Preset / 标签 / 筛选
8. **Preset(预设)**:命名 skill 分组(名称+描述+emoji 图标),一个 skill 可属多个 preset。任意工作区顶部有 preset 标签行,点击一键激活/停用该 preset 在当前 agent 范围的全部 skill;**激活显示 ✓,部分安装显示数量角标**。应用 preset 是一次性复制,非实时同步(README 明确强调)。侧栏有 Preset 分组常驻列表 + 新建入口。
9. **标签(Tags)**:skill 可打多标签,标签颜色由工具函数 `getTagColor`/`getTagActiveColor` 按标签名稳定映射(源码 `context-and-utilities.md`);可按标签筛选,有 **「未打标签(Untagged)」专用筛选项**。
10. **来源筛选与分组**:可按来源(git/本地/市场)筛选;开启分组后每个来源一个标题并显示数量;同一仓库不管用 SSH/HTTPS/owner-repo/skills.sh 添加都算一个来源,网站来源按域名分组;多于 1 个 skill 的来源默认折叠,**搜索时所有分组自动展开**(Release notes #589/#530)。
11. **批量操作**:多选后批量启用/禁用、导出、删除;项目工作区同样支持(`useMultiSelect` hook 驱动,按当前搜索结果过滤后操作)。

### 三种工作区
12. **全局工作区**:每个 agent 一页,列出其全局目录下**所有** skill(含非本应用安装的),"始终反映 agent 实际看到的内容";另有「全部 Agents」总览页跨 agent 统一管理。
13. **项目工作区**:管理项目本地 skills 目录(如 `<proj>/.claude/skills`),与中央库**双向同步**;项目内 skill 三态展示:「仅项目 / 与中心一致(In sync)/ 中心较新(Center newer)」(官网截图直接证据);支持嵌套 skill 目录、导出时按 agent 分配;有「关联项目」入口 + 目录扫描发现(选 `.claude`/`.trae` 类目录 → 扫描 → 勾选添加)。
14. **关联工作区(Linked)**:任意目录挂为 skill 根,独立管理,不参与全局 preset 同步。

### 备份与多端同步
15. **Git 备份**:一键 GitHub 登录(8 位 device-flow,token 存 OS 钥匙串,自动建私有仓库 `skills-manager-backup`),或高级模式粘贴任意 Git URL(HTTPS+PAT/SSH/自建)。
16. **自动同步**:停止编辑几分钟后后台 commit+push;其他设备的推送自动 merge 回来;「立即备份」手动入口常显;历史里每条备份标注是哪台设备。
17. **Skill 级合并**:按 skill 粒度而非文本行合并(一台改名+一台改内容可干净合并)。
18. **冲突不阻塞不覆盖**:冲突 skill 保留本地版本,进 **「需要注意(Needs attention)」** 列表并在库卡片上打徽章;用户选 **保留我的 / 用远端 / 两者都留**,选择前先自动打安全快照,一切可撤销。
19. **快照与恢复**:手动备份生成快照版本(annotated git tag),Backup 页历史可恢复任意快照;恢复前先把当前状态存成快照。
20. **断连三级**:仅断本机 / 吊销 GitHub 授权 / 删除远端备份(走 GitHub 的输入名称确认)。
21. **备份边界**:secrets(API key、token、代理设置)和机器相关配置永不离开本机;>100MB 的 skill 自动排除并标注;SQLite 不入 git(元数据可从 skill 文件重建)。
22. **新机引导**:空库首次启动问「全新开始 or 从备份恢复」。

### Agent 生态
23. **56 个内置 agent**,设置页列表以「本机检测到的」排前;支持**自定义工具**(指定 skills 目录)和**覆盖内置工具默认路径**(全局路径 + 项目相对路径两级 override,见 `ToolInfo.has_path_override` / `has_project_path_override`)。
24. **让 Agent 管理 Skills**:Dashboard 一键向选定 agent 部署 `manage-skills` 技能 + 发布 CLI 到 `~/.skills-manager/bin`,让 Claude Code 等通过本应用(而非绕过它直写目录)安装/部署/查询,来源/preset/更新追踪不丢。
25. **CLI**:与桌面端共享同一 SQLite、中央库、同步引擎;`--json` 机器可读输出;破坏性命令 `--dry-run` / `--yes`。

### 其他
26. **市场**:skills.sh 榜单 + 关键词搜索,卡片显示安装量(3.7M 等)和「已安装」状态;可选 SkillsMP AI 语义搜索(API key)。
27. **文档预览**:应用内直接看 SKILL.md/README,并可与上游版本对比内容。
28. **活动日志**:安装/移除/更新/同步本地记录;**设置 → 导出日志**打包近期日志+活动历史为 zip 便于报 issue。
29. **应用内更新**:只提示不自动下载;安装、重启各需一次点击。
30. **新手提示(coach mark)**:截图可见右上角浮层提示「也支持批量添加:在『添加 Skill』弹窗里按 tag 筛选…」可关闭。

---

## 2. 页面结构

依据:博客园实机截图(侧栏全貌,直接证据)+ README。

```
┌──────────────────────────────────────────────────────────┐
│ 自定义标题栏(useDragWindow,左 logo+Skills Manager,可拖拽) │
├────────────┬─────────────────────────────────────────────┤
│ 侧栏        │ 内容区                                       │
│            │                                             │
│ ◈ Dashboard│  页头:标题(文件夹图标+名称+数量徽章)          │
│ ≡ 技能库    │       副标题:路径 · x/y 已启用               │
│ ↓ 安装 Skills│      [搜索框] [全部|已启用|已停用] [视图切换]│
│            │       [刷新] [+ 添加 Skill](主色按钮)         │
│ ▸ Preset   │  Preset 行:标签 + preset pills(✓/计数)      │
│   Default  │  ┌────────┐ ┌────────┐ ┌────────┐          │
│   🌱前端 20 │  │skill卡  │ │skill卡 │ │skill卡 │  2~3 列  │
│   +新建    │  │ 名称    │ │        │ │        │          │
│            │  │ 描述…   │ │        │ │        │          │
│ ▸ 全局工作区│  │ tag pill│ │        │ │        │          │
│   全部Agents│  │────────│ │        │ │        │          │
│   Cursor 20│  │来源·预设 │ │        │ │        │          │
│   TRAE  20 │  │agent图标行│        │ │        │          │
│   …        │  └────────┘ └────────┘ └────────┘          │
│ ▸ 项目工作区│                                             │
│   📁proj ●20│                                             │
│   + 关联项目│                                             │
│            │                                             │
│ ⚙ 设置(垫底)│                                             │
└────────────┴─────────────────────────────────────────────┘
```

页面清单(侧栏顺序):
1. **Dashboard**:问候语 + 「当前 Preset」chip(显示激活预设)+ 「让 agent 管理 skills」一键设置入口。
2. **技能库(我的 Skills)**:中央库全部 skill,卡片网格,搜索 + 来源/标签筛选 + 来源分组。
3. **安装 Skills**:三个 tab——**浏览榜单**(市场)/ **本地安装** / **Git 安装**;Git 安装为「输入地址 → 克隆并预览 → 勾选 → 导入」向导卡片。
4. **Preset 分组**:每个 preset 一项(emoji + 名称 + skill 数徽章),点击进 preset 视图;底部「+ 新建 Preset」。
5. **全局工作区分组**:「全部 Agents」总览 + 每个 agent 一页(图标 + 名称 + skill 数徽章)。
6. **项目工作区分组**:每个项目一项(文件夹图标 + 状态圆点 + 数量徽章);底部「+ 关联项目」。
7. **关联工作区**(README 提及,归入项目区或独立分组)。
8. **备份(Backup)**:侧栏入口;状态卡(Backed up + 最近快照时间 + 仓库 + 分支 + 本设备名)、立即备份、历史快照恢复、Needs attention、断连三级。
9. **设置**(侧栏垫底)。

---

## 3. 设置页功能项(逐项,重点)

依据:README「Flexible app settings」「Supported Tools」「Backup」+ context7 `_autodocs`(getSettings/ToolInfo/useTheme/i18n)+ 博客园设置页截图 + Release notes。

| # | 设置项 | 细节 |
|---|--------|------|
| 1 | **中央仓库路径** | 自定义/重置回 `~/.skills-manager`(`getCentralRepoPath`/`setCentralRepoPath`,传 null 恢复默认) |
| 2 | **同步模式** | symlink / copy 全局默认切换 |
| 3 | **主题** | light / dark / system,`useTheme` 双写 localStorage + Tauri settings,system 模式监听 `prefers-color-scheme` |
| 4 | **字号** | 全局文本缩放(`getSettings("text_size")` → `applyTextSize()`) |
| 5 | **语言** | 简中(默认)/ 繁中 / English(react-i18next) |
| 6 | **托盘行为** | 托盘驻留相关行为配置(README 列举) |
| 7 | **代理** | 网络代理设置(注意:代理属 secrets,不进备份) |
| 8 | **Git 同步配置** | 远程仓库地址输入框 + 保存;截图可见文案「这里只保存远程仓库地址等偏好,初始化与同步操作请在『我的 Skills』页面执行」——**设置只存偏好,操作留在业务页** |
| 9 | **更新检查** | 应用更新检查开关/入口;语义是"检查只通知,安装重启各一次点击" |
| 10 | **Agent 展示排序** | 调整 56 个 agent 在全应用的出现顺序(Release notes) |
| 11 | **Agent 列表管理** | 全部支持工具列表,**本机检测到的排最前**;每个 agent:启用/禁用、全局路径覆盖、项目相对路径覆盖(`ToolInfo` 接口直接证据) |
| 12 | **自定义工具** | 新增自定义 agent(指定 skills 目录),与内置工具同等管理 |
| 13 | **默认 Preset** | 默认场景配置(第三方文档站总结,中等置信) |
| 14 | **SkillsMP API Key** | 开启市场 AI 语义搜索(第三方文档站总结,中等置信) |
| 15 | **导出日志** | 打包近期日志+活动历史为 zip 用于反馈 |
| 16 | **GitHub 备份连接** | 登录/断开(设置或 Backup 页承担;device-flow,token 入钥匙串) |

设置页视觉:分区用小号灰色大写标题(如「GIT 同步配置」),每个分区一张卡片,卡片内 label + 一行说明文字 + 输入框 + 保存按钮(博客园截图直接证据)。

---

## 4. 交互细节

### 4.1 Skill 卡片信息架构(官网/博客园截图,直接证据)

```
┌────────────────────────────────────────────┐
│ ● brainstorming                    [toggle]│  ← 状态圆点 + 粗体名 + 绿色 iOS 开关
│ Turn rough ideas into fully formed… (截断2行)│
│ [workflow] [testing]               ← 彩色 tag pill(粉/黄/蓝,按名稳定取色)
│                                            │
│ ↥ Update                         ← 橙色更新徽章(仅源有更新时)
├────────────────────────────────────────────┤
│ [gh] git · Everyday   [C][G][C][g][✦][▣]  │
│  来源类型  所属preset   agent 图标行:点亮=已部署
│                        点击即装/卸;未部署灰色
└────────────────────────────────────────────┘
```

- 名称/描述/标签/来源/preset/部署状态/更新状态**全部压缩在一张卡片**,无二级页面跳转负担;详情(文档预览、源元数据、上下游对比)点进详情。
- 项目工作区卡片变体:状态 pill(仅项目=灰 / 与中心一致=绿 / 中心较新=蓝)+ 右上角文档图标+文件数 + 上传/下载方向按钮 + 删除。
- 市场卡片变体:作者头像黑圆 + 名称 + 外链图标 + 勾选;@owner/repo 绿色 + 安装量徽章 + 「✓ Installed」绿 pill。

### 4.2 批量与选择
- `useMultiSelect({items, filtered, getKey, isItemActive})`:多选基于**当前过滤结果**,跨页复用同一 hook;多选后批量启用/禁用/导出/删除。
- 选中卡片:绿色左边框/绿色描边(深色模式截图直接证据)。
- 「+ 添加 Skills」统一选择器弹层:搜索中央库 + **常显的 agent chips(带全选/清空)** + 批量添加——一次操作把 N 个 skill 推给 M 个 agent。

### 4.3 搜索过滤
- 页头搜索框占位符按上下文变化(「搜索项目中的 Skills…」)。
- 分段控件「全部 / 已启用 / 已停用」做状态过滤。
- 来源/标签过滤 + 「未打标签」pill;分组视图**搜索时自动展开所有折叠组**(很细的洞察:折叠和搜索天然冲突,它直接消解了)。

### 4.4 冲突与状态语义
- 部署冲突:拒绝 + 指名路径 + 给 adopt 出口,不静默覆盖。
- 同步冲突:不阻塞其他 skill,冲突项进「Needs attention」+ 卡片徽章,三选(我的/远端/都留),选前自动快照。
- Preset 三态:✓ 全激活 / 数字角标部分 / 无标记未激活(`computePresetStatus` 返回 active/partial + installed/total)。

### 4.5 反馈
- Toast 在右下(深色卡片白字,成功操作列出全部 skill 名 + 绿色「安装成功」)。
- 破坏性 CLI 操作要 `--yes`,GUI 侧删除有图标按钮+确认。
- 错误是结构化 `AppError{kind}`(not_found/cancelled/TARGET_CONFLICT…),前端按 kind 给具体文案。

---

## 5. 视觉语言(截图直接证据 + 源码佐证)

| 维度 | 做法 |
|------|------|
| **圆角** | 卡片大圆角(≈12-16px)、按钮/pill 中圆角、tag 全圆角 pill;分级使用(与 AI 包工头已借鉴的 control/inner/outer 分级思路一致) |
| **阴影** | 几乎不用重阴影,浅色卡片靠 1px 浅边框 + 微阴影;层级靠底色区分而非投影 |
| **深色模式** | 侧栏近黑底,内容区稍亮的深色,**两层底色拉出层次**;侧栏选中项 = 浅灰底圆角块 |
| **主色** | 翡翠绿(emerald):主按钮实心绿白字、toggle 开态绿、tab 激活下划线绿、成功文案绿、卡片选中描边绿——**全 App 单一强调色**,状态色(橙=更新/警告、蓝=信息、灰=中性)与强调色正交 |
| **状态表达** | 三色体系固定:绿=正常/已启用/一致,橙=更新/需注意,蓝=中心较新;tag 用低饱和彩色 pill(粉/黄/蓝)按名稳定映射(`getTagColor`) |
| **计数徽章** | 无处不在的灰色小 pill 数字:侧栏 preset/agent/项目全带数量 |
| **图标** | agent 品牌图标直接做 toggle 按钮(点亮=彩色,未点亮=灰),`agentIconNeedsDarkInvert` 处理深色下反色;分组标题用小号灰字 |
| **开关** | iOS 风格 toggle 直接放卡片右上角,启用状态一眼可见、一键可切 |
| **留白与密度** | 卡片网格 2-3 列,卡内四段式(标题/描述/tag/操作行),信息密度高但每段职责单一 |
| **徽标卡片** | Backup 状态卡用浅绿大色块底 + 白底圆角图标方块——状态页用"整卡着色"表达健康度 |
| **标题栏** | 自定义无边框标题栏(`useDragWindow`),应用感强 |
| **agent 图标 invert** | `dark:invert` 条件类,黑白 logo 在深色主题保持可见(源码直接证据) |

---

## 6. 对「AI 包工头」的可借鉴点

> AI 包工头现状:Tauri+React18+TS+Vite,VS Code 风格 activitybar+侧栏+内容区;有 Skills/MCP/提示词/套餐/模型服务/健康检查/设置页;56 agent 可见性管理;主题 token 系统(圆角分级、侧栏选中态已借鉴过)。以下按优先级排序。

### P0(直接提升核心体验,改动可控)

1. **Skill 卡片底部「agent 图标徽章行 = 部署开关」**
   → 对应:Skills 管理页 skill 列表项。现在包工头展示 skill.agents 状态,可升级为**点图标即装/卸**,点亮=彩色、未装=灰,复用现有 agent 图标资源。这是 skills-manager 最有辨识度、官网首屏主推的交互。依据:README「click a badge to install or remove」+官网卡片截图。
2. **「+ 添加 Skills」统一选择器弹层:搜索库 + 常显 agent chips(全选/清空)+ 批量推送**
   → 对应:Skills 管理页的添加/分发流程。解决 N skill × M agent 矩阵操作。依据:README「Add from Library sheet」。
3. **启用态用卡片右上角 iOS toggle 直切**
   → 对应:Skills/MCP 列表项。比现在的状态标签+操作按钮更省一次点击;配合防竞态的 toast 反馈(包工头已有 useToast)。依据:官网截图。
4. **状态语义三色正交体系**(绿=正常/一致,橙=可更新/需注意,蓝=有新版,灰=中性)写进 themes.ts token 约定
   → 对应:健康检查页 + Skills 同步状态 + MCP 状态。包工头已有 token 体系,补一组语义状态 token 并全站统一。依据:截图直接证据。
5. **冲突处理三段论:拒绝→指名→给 adopt 出口;同步冲突三选+选前快照**
   → 对应:Skills 批量/套餐操作(包工头 AGENTS.md 已规定真实目录禁删),可把「检测到非我管理的目录」做成显式 UI 状态而非仅报错;配 `useEditorHistory.snapshotNow()` 实现"选前快照"。依据:README TARGET_CONFLICT/Needs attention 段。

### P1(结构性增强)

6. **侧栏分组 + 计数徽章 + 状态圆点**(Preset 组/全局工作区组/项目组的折叠分组,每项带数量 pill,项目带状态点)
   → 对应:包工头侧栏(目前 activitybar+侧栏两级),Skills 侧栏可按「套餐/来源/项目」分组并挂数量徽章。依据:博客园侧栏截图。
7. **Preset pill 行 + 三态(✓/计数/无)一键应用**
   → 对应:配置套餐(profiles)页。套餐标签直接放在工作区页头,点击即整套激活/停用,partial 显示 n/m。依据:README + 项目工作区截图。
8. **设置页「分区卡片 + 每行 label/说明/控件」模式,设置只存偏好、操作留在业务页**
   → 对应:设置页。包工头设置项在涨(主题、56 agent 可见性),可采用:分区小号灰标题 + 卡片容器;Git/远程类配置在设置存地址,初始化/同步按钮留在 Skills 页。依据:博客园设置截图文案。
9. **Agent 列表「检测到的排最前 + 每项启用开关 + 路径覆盖 + 自定义工具」**
   → 对应:设置→Agent 管理。包工头已有检测与开关,可补:路径覆盖(全局/项目两级)、自定义 agent 注册。依据:`ToolInfo` 接口。
10. **更新追踪:记录 source_revision/remote_revision,卡片出橙色 Update 徽章**
    → 对应:Skills 管理页(git 来源 skill)。依据:`ManagedSkill` 接口。
11. **「未打标签」专用筛选项 + 搜索时自动展开折叠分组**
    → 对应:Skills/MCP/提示词的过滤条。细节但高频。依据:README + Release notes。
12. **导出日志 zip(日志+活动历史打包)**
    → 对应:健康检查/设置页,配合包工头健康检查做"一键打包诊断信息"。依据:README Export Logs。

### P2(差异化能力,视路线投入)

13. **Git 备份/多端同步**(skill 级合并、快照恢复、断连三级、secrets 不落盘)→ 对应:配置套餐的分享/备份方向;投入大。
14. **项目工作区三态对比(仅项目/一致/中心较新)+ 双向同步** → 对应:若包工头要做项目级 skill 管理。
15. **Dashboard 页**(问候 + 当前套餐 chip + 新手引导任务卡 + coach mark)→ 对应:包工头可加首页;coach mark 提示批量操作技巧。
16. **CLI + agent 自管理(发布 CLI 到固定路径 + manage-skills skill)** → 对应:包工头若想让 agent 驱动自身。
17. **市场接入(skills.sh 榜单 + 安装量徽章 + Installed 状态 pill)** → 对应:Skills 发现。

---

## 最值得抄的 Top 5

1. **Agent 图标徽章行即开关**:每张 skill 卡片底部一排 agent 图标,点亮=已部署,点击即装/卸——把"56 个工具的矩阵分发"压缩成一个手势。(P0,Skills 管理页)
2. **「+ 添加 Skills」统一选择器**:搜索库 + 常显 agent chips(全选/清空)+ 批量推送,N×M 矩阵操作一个弹层完成。(P0,Skills 添加流程)
3. **Preset pill 三态(✓/n/无)+ 页头一键应用**:套餐不再是配置页里的死数据,而是工作区顶部可点的快捷开关。(P1,配置套餐页)
4. **三色正交状态语义 + 卡片右上 toggle**:绿/橙/蓝/灰状态 token 全站统一,启用态用 toggle 直切,卡片即是控制台。(P0,themes.ts + Skills/MCP 列表)
5. **冲突安全模型**:部署冲突拒绝并指名路径+给 adopt 出口;同步冲突不阻塞、三选解决、选前自动快照——与包工头"禁删用户真实目录"的安全红线完全同构,可直接落进现有 snapshot 机制。(P0,Skills 批量/套餐操作)

---

## 主要来源

- README.md / README.zh-CN.md(github.com/xingkongliang/skills-manager)——功能清单、设置项、CLI、备份语义
- skillsmanager.dev——产品叙事、FAQ、四张功能截图(直接视觉证据)
- context7.com/xingkongliang/skills-manager/llms.txt——`_autodocs` 自动文档:`ManagedSkill`/`ToolInfo` 接口、useTheme/useMultiSelect、getTagColor、computePresetStatus(源码级佐证)
- cnblogs.com/lanyelinxiang/p/20072450——中文实机体验 + 侧栏全貌/项目工作区/Git 设置/安装流程截图(直接视觉证据)
- GitHub Releases 页(经搜索摘要)——来源分组、agent 排序等迭代细节
