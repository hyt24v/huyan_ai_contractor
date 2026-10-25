# AI 包工头 · 设计借鉴方案（总览）

> 汇总 5 份分报告（2026-10-25，5 个并行 researcher subagent 产出）：
> [cc-switch](./cc-switch.md) · [skills-manager](./skills-manager.md) · [ColaMD](./colamd.md) · [oil-find](./oil-find.md) · [布局形态横向](./layout-patterns.md)
>
> 调研对象均为本机 GitHub star 列表中的 Apple/macOS 平台应用，与本项目同为桌面工具/编辑器品类，其中 cc-switch、skills-manager 与 AI 包工头同为 **Tauri + React + TS + Vite** 技术栈，借鉴成本最低。

---

## 一、跨项目共性主题（5 份报告收敛出的 6 条主线）

| # | 主题 | 证据来源 | 落点 |
|---|---|---|---|
| A | **「文件会被 agent 改」是一等公民** | ColaMD 全链路（磁盘监听/原子写入 watcher 自愈/活动指示器）+ fanbox 变更驾驶舱 | JSON/MD 编辑器页 |
| B | **切换类操作「先看后切」** | cc-switch 模式标签只读预览 + 写明后果的按钮 + 一步撤销 | 套餐应用、模型服务切换 |
| C | **矩阵分发压缩成一个手势** | skills-manager 的 agent 图标徽章行 + 统一选择器弹层 | Skills/MCP 管理页 |
| D | **设置 = 纯偏好，功能全走业务页** | cc-switch（整屏 6 组）+ skills-manager（分区卡片 + 文案明示）| 设置页重构 |
| E | **状态可见性分层穿透** | cc-switch（行内→侧栏→托盘）+ fanbox（形状+颜色+文字三重编码 + Dock 角标）| 健康检查、activitybar |
| F | **键盘优先 + 可发现性** | oil-find 全套（底栏键帽提示/双模态/IME 保护/分层 Esc）| 新增命令面板 ⌘K |

---

## 二、统一优先级路线图

### P0 —— 核心体验，改动可控

1. **磁盘变更自动同步**（ColaMD → JSON/MD 编辑器）
   - Rust 后端 `notify` 监听已打开文件 → 事件去抖 → 区分自写回声（保存后记录哈希比对）→ **干净状态静默重载；有未保存修改→三选（加载磁盘版/保留我的/对比），加载前 `snapshotNow()` 兜底**
   - 必须处理 rename 原子写入（收到 Rename/Remove 后重建 watcher）——ColaMD 用一整个 v1.6 修的坑
   - 编辑器页头加「外部变更」指示（呼吸圆点/短暂高亮），不打断、可感知
2. **「先看后切」两段式切换**（cc-switch → 套餐/模型服务）
   - 预览标签只读；真正生效的按钮文案写明后果；配 `snapshotNow()` 实现一步撤销
3. **Skill 卡片 = 控制台**（skills-manager → Skills 页）
   - 卡片底部 **agent 图标徽章行：点亮=已部署，点击即装/卸**（56 agent 矩阵分发压缩成一个手势）
   - 卡片右上角 iOS toggle 直切启用态
4. **命令面板 ⌘K（新功能）的 P0 内核**（oil-find）
   - 底栏常驻**键帽提示条**（随上下文变化）——解决可发现性，成本极低收益最大
   - **输入态/浏览态双模态**（输入态所有键归文本框，浏览态空格=预览）+ **分层 Esc**（逐层回退）
   - **IME 保护**（`isComposing`/`compositionstart` 期间不拦截导航键）——中文主路径，漏了等于不可用
   - 空查询 = 最近使用；空结果 = 可点击的语法建议
5. **设置页整屏化**（cc-switch + skills-manager）
   - 整屏替换（非弹窗）、左侧分组目录、`Cmd/Ctrl+,` 直达、Esc 返回
   - 纪律：**设置只放偏好，操作留在业务页**（skills-manager 设置页原话：「这里只保存偏好，同步操作请在业务页执行」）
   - 保存粒度差异化：开关即时保存，路径类点该块「保存」（cc-switch 约定）
6. **冲突安全模型显式化**（skills-manager → Skills 批量/套餐操作）
   - 拒绝 → 指名路径 → 给 adopt（认领）出口；同步冲突三选 + 选前自动快照——与本项目 AGENTS.md「禁删用户真实目录」红线同构

### P1 —— 结构性增强

7. **卡片操作悬停显现 + 拖拽手柄排序**（cc-switch @dnd-kit）→ Skills/MCP/providers/套餐四个列表页统一
8. **MCP 矩阵表**：行=服务器、列=agent、格子=开关、列头批量可撤销、只作用于筛选结果 → MCP 管理页（56 agent 场景的规模化正解）
9. **三色正交状态语义写进 themes.ts token**：绿=正常/一致，橙=可更新/需注意，蓝=有新版，灰=中性——全站统一，与品牌强调色正交
10. **模型服务页「单屏清单」密度**（magpie）：一行一个 agent × 当前供应商/模型，点击值直接改，不跳表单
11. **状态三重编码 + 聚合「需要关注」计数**（fanbox）：形状+颜色+文字同时编码；activitybar 挂聚合计数徽标
12. **空状态即引导**（cc-switch）：列表为空自动弹「从各 agent 导入现有配置」，取消键文案「稍后设置」
13. **侧栏分组 + 计数徽章 + 「未打标签」筛选项 + 搜索时自动展开折叠分组**（skills-manager）
14. **MD 编辑器大纲浮层 + 预览/源码同位置切换**（ColaMD/open-knowledge：两模式共享同一阅读位置，别让文字横跳）
15. **托盘快捷面板**（magpie 双形态 + cc-switch v4 验证）：只承载 套餐/供应商速切 + 健康摘要 + 打开主窗口；面板与窗口复用同一套 React 组件
16. **更新后首次启动展示更新日志**（ColaMD）——beta 线迭代快，低成本高感知

### P2 —— 远期/可选

17. 热力图/用量统计可视化（cc-switch）；Git 备份多端同步（skills-manager，投入大）；项目工作区三态双向同步；拼音搜索（pinyin-pro）；主题导出/导入为 CSS 文件（ColaMD，对接 themes.ts）；导出日志 zip 一键打包诊断（配合健康检查）

### 明确不抄

- superset 的 Tab→Split→Pane 多屏编排、多 workspace（与工具箱属性不匹配）
- magpie 的 TUI/Web 多形态
- ColaMD 的 WYSIWYG 内核（Monaco 架构不同，抄 UX 决策不抄形态）

---

## 三、设置页对标（用户重点关注）

### 三家设置页结构对比

| | cc-switch v4 | skills-manager | oil-find |
|---|---|---|---|
| 形态 | **整屏替换**，左侧 6 组目录 | 分区卡片，小号灰大写标题 | 原生 Form 分组，540 宽 |
| 直达 | `Cmd/Ctrl+,` + Esc 返回 | 侧栏垫底入口 | `Cmd,` |
| 保存约定 | 开关即时 / 路径手动点保存 | 输入框 + 该块保存按钮 | 即时（开关类） |
| 分组 | 通用 / 应用配置 / 本地路由 / 网络 / 数据 / 关于 | 中央库路径、同步模式、主题、字号、语言、托盘、代理、Git 同步、更新检查、agent 排序与管理、自定义工具、导出日志… | 通用 / 索引 / 索引范围 / 外置磁盘 / AI 话题 / 排除规则 / Pro |

### 值得抄的设置项（AI 包工头还没有的）

1. **界面语言即时切换**（三家都有；包工头目前是中文硬编码 → i18n 架构预留）
2. **全局热键录制器**（oil-find）：录制式录入、强制含修饰键、占用即红字提示——用于 ⌘K 唤起键自定义
3. **代理设置**（cc-switch「网络」组 / skills-manager）：访问外部 API 的 HTTP/HTTPS 代理
4. **数据管理组**（cc-switch）：配置目录位置（可指云同步文件夹）、SQL 式导出/导入、备份恢复
5. **检查更新 + 更新日志**（cc-switch/skills-manager/ColaMD 都有）
6. **Agent 管理增强**（skills-manager）：检测到的排最前（包工头已有）+ **全局/项目两级路径覆盖** + 自定义 agent 注册 + 展示排序
7. **诊断式设置项**（oil-find）：「检查文件为什么搜不到…」——与包工头健康检查页天然契合
8. **开机自启**（cc-switch/skills-manager/oil-find 均有）

### 建议的包工头设置分组（目标结构）

```
通用（语言/主题/字号/开机自启/热键）
Agent 管理（检测/开关/路径覆盖/自定义/排序）   ← 已有基础，增强
网络（代理）
数据（配置目录/导出导入/备份恢复）
关于（版本/检查更新/更新日志/开源协议）
```

---

## 四、形态层结论（布局横向报告）

- **保留 activitybar 一级导航**（工具箱结构合适），**弱化通用侧栏**：窄侧栏只在有列表资源的页面（Skills/MCP/提示词/套餐）出现且作为主列表，其余页面全宽内容——接近 cc-switch 的主从布局
- 编辑器页可向 open-knowledge 借「居中卡片 + 大留白 + frontmatter 属性面板化 + 窄屏降级」
- 托盘立项为 P1：弹层而非纯菜单，与主窗口共用组件

---

## 五、分报告索引与证据等级

| 报告 | 行数 | 核心交付 | 证据说明 |
|---|---|---|---|
| [cc-switch.md](./cc-switch.md) | 277 | 功能清单 29 条、设置 6 组逐项、ASCII 布局图、借鉴点 16 条 | 官方手册+changelog 直接证据为主；圆角/阴影数值未取得（建议后续浅克隆核实） |
| [skills-manager.md](./skills-manager.md) | 252 | 功能 30 条、设置 16 项、卡片信息架构 | 官网截图+context7 autodocs；GitHub 直连受限 |
| [colamd.md](./colamd.md) | 218 | 功能 30 条、磁盘同步全链路分析、减法哲学 | 官网/README/Releases；脏状态冲突策略官方未公开（已给出我们的设计方案） |
| [oil-find.md](./oil-find.md) | 230 | 功能 21 条、快捷键语义逐项分析、命令面板 P0/P1/P2 | **源码级**（经 jsdelivr/gh-proxy 镜像读 15 个 Swift 文件），证据最强 |
| [layout-patterns.md](./layout-patterns.md) | 230 | 4 项目形态横评、布局改不改的判断、Top5 | 官方文档+PR 描述还原，截图为 interpretation |

## 后续动作建议

1. 挑 P0 第 1 条（磁盘热同步）做 spike：Rust `notify` + Tauri event + 前端回声过滤，1-2 天可验证
2. 命令面板单独立项：oil-find 报告的 P0 六条即为验收标准
3. 如需 cc-switch 精确 token 数值（圆角/阴影），浅克隆其仓库查 `src/index.css` 与 `tailwind.config`
