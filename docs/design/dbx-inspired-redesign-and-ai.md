# UI 重塑 + AI 功能设计提案

> 参照 [t8y2/dbx](https://github.com/t8y2/dbx)（Tauri 2 + Vue3 + shadcn-vue + Tailwind 4 数据库工具）的设计语言，
> 为「AI包工头」做整体视觉重塑，并新增 AI 助手能力（复用现有「模型服务」配置）。
> 状态：**UI-P0 / AI-P0 已落地**（test 分支）。UI-P1/P2、AI-P1~P3 待后续分期。

---

## 一、dbx 设计语言提炼（调研结论）

### 1. 核心手法：「外壳 + 浮起面板」

dbx 专业工具质感的最大来源不是配色，而是**布局分层**：

```
┌ AppToolbar h-10（兼作 Tauri 拖拽标题栏，bg-muted/30）
├ 主区 flex-row，外壳底色 --dbx-chrome，gap-1 p-1 留缝
│   ├ 侧边栏（260px，可拖宽，宽度持久化）
│   ├ 内容面板 .dbx-panel（独立圆角卡片，1px border，浮在 chrome 色上）
│   └ 右侧 dock 面板组（AI 助手 / 历史 / 库，min-w-240，可拖可最大化）
└ Toast 浮层（fixed bottom-6 居中反色胶囊）
```

- 每个面板是 `border: 1px solid var(--border); border-radius: var(--radius-lg)` 的独立卡片
- **无阴影依赖**：层次感全靠 1px border + 色阶分层；阴影只用于浮层
- 暗色主题边框用**半透明白**（`rgb(110 110 114 / 0.28)`）而非实色灰，叠加更柔和

### 2. token 分层（三层）

| 层 | 内容 | 我们的现状 |
|---|---|---|
| shadcn 语义层 | `--background/--card/--muted/--primary/--border/...` | ✅ 已有，结构一致 |
| 应用外壳层 | `--dbx-chrome`（活动栏底色）、`--dbx-content`、`--dbx-sidebar-header` 等 6 个 | ❌ 缺失，需新增 |
| 状态四色变体 | success/warning/info 各带 `-bg`（color-mix 透明底） | ⚠️ 有色无规范变体 |

### 3. 密度规范（比 shadcn 默认小一档）

- 按钮：default `h-8 px-2.5 text-sm`，sm `h-7`，icon `size-8/7/6`，图标 `size-4`
- 输入框：`h-8 px-2.5 text-sm`，focus `ring-3 ring-ring/50`，暗色 `bg-input/30` 半透明底
- 工具条：`h-9~10`、`text-xs font-medium text-muted-foreground`
- 正文 `text-sm`，面板内 `text-xs` 为主，徽章/元信息 `text-[10px] font-mono`
- 选中态配方：primary 40% 边框 + 10% 底 + 1px 外环

### 4. 圆角三级可调

`data-corner-style="default|large|none"`：default 4/4/6px，large 6/10/14，none 全 0。
`rounded-sm/md/lg` 重映射到变量——与我们现有 `control/inner/outer` 三级 token 同构，低成本高感知。

### 5. 字体

UI 主字体 Geist Variable（可变字重 100–900），回退 PingFang SC / system-ui；
等宽 Fira Code / JetBrains Mono，用于编辑器、标识符、状态徽章。

### 6. AI 助手 UI 形态（AiAssistant.vue）

**右侧可拖宽 dock 面板**（非对话框），可最大化：
- 顶栏 `h-10 border-b px-3` + 一排 `h-6 w-6` ghost 图标按钮（新会话/历史/清空/最大化/关闭）
- 空态：居中 Bot 图标 `opacity-30` + 圆形建议 chips（`rounded-full border px-3 py-1.5 text-xs`）
- 气泡：用户 `bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs`，AI `bg-muted rounded-lg`
- composer：`rounded-md border bg-background` 容器 = 上下文 chips 行 + 自动增高 textarea
- 会话历史 Popover：搜索 + 行内运行状态图标 + 未读点

---

## 二、UI 重塑方案（映射到本项目）

### 我们现有的好底子（保留）

- 6 套主题 hex token → HSL 变量注入，Tailwind 全 token 化（无 `.dark` 硬编码）
- 圆角三级 token（`--radius-control/inner/outer`）
- activitybar + 侧边栏 + 主区卡片的骨架与 dbx 同构

### 差距与改造点

| # | 改造 | 内容 |
|---|---|---|
| U1 | **外壳层 token** | 新增 `--chrome`、`--chrome-muted`、`--content` 3 个应用级 token，6 套主题各补 3 个值；`themes.ts` 的 22 字段扩到 25 字段 |
| U2 | **panel 化主布局** | 主区外壳 `bg-chrome gap-1 p-1`，各面板 `.panel` 类（1px border + rounded-lg + bg-card）浮起；侧边栏底色从 `bg-card/50` 改 `--sidebar` token |
| U3 | **密度统一** | 全局控件向 h-8/h-7、text-xs 靠拢：抽 `Button/Input/Badge` 三个基础组件（cva 风格变体），替换散落的 `h-7 rounded-md border px-2.5 text-[11px]` 手写组合 |
| U4 | **暗色边框半透明化** | 暗色主题 `--border/--input` 改半透明白（hex→hsla 注入需支持 alpha，themes.ts 的 hexToHslTriple 要扩展） |
| U5 | **圆角用户可调** | 设置里加「圆角风格：默认/大/直角」，`data-corner-style` 切换三级 radius 变量 |
| U6 | **状态色变体规范** | `bg-success/15` 这类散落写法收敛为 `--success-bg` 等 token（或统一 color-mix 工具类） |
| U7 | **字体** | 引入可变字重 UI 字体（Geist 或 Inter Variable，本地打包 woff2）；等宽字体栈对齐 |
| U8 | **顶栏融合** | 参考 dbx：h-10 顶栏兼 Tauri 拖拽区，窗口控制/更新入口/健康徽标收进顶栏右侧 |

### 分期

- **UI-P0（基础层）**：U1 + U2 + U3 → 视觉质感立变，风险低
- **UI-P1（个性化）**：U4 + U5 + U6
- **UI-P2（精修）**：U7 + U8 + 各页面逐个过密度/对齐
- 每期结束跑 `tsc + vitest`，UI 改动注意保持主题 token 纪律（AGENTS.md 红线）

---

## 三、AI 功能方案

### 3.1 现状盘点（决定架构）

- **模型服务已有**：`src/lib/providers.ts` 的 `Provider { id, name, agent, baseUrl, apiKey?, model?, api }`，
  `api` 支持 `openai-responses | openai-completions | anthropic-messages` 三种；
  存在 `~/.ai-baogongtou/providers.json`（经 FsPort 读写）
- **HTTP 通道**：Rust `http_request` 命令（ureq 3）**目前只支持 GET 无 body**——AI 聊天必须扩展 POST
- **无任何 chat 调用代码**，需要新建 AI 服务层

### 3.2 架构

```
src/services/ai/
  client.ts      — 按 ProviderApi 适配三种协议，统一 chat(messages, opts) 接口
                   经扩展后的 Rust http_request（POST + JSON body + Authorization）
  session.ts     — 会话状态（消息列表、流式？先做非流式）、localStorage 持久化
  prompts.ts     — 四个场景的 system prompt 模板
src/components/ai/
  AiDock.tsx     — 右侧 dock 面板（dbx 形态：顶栏/气泡/composer/历史）
  AiBubble.tsx   — 消息气泡（Markdown 渲染）
  AiComposer.tsx — 上下文 chips + textarea
src-tauri: http_request 扩展支持 POST + body（ureq 3 已具备，仅改命令签名，注意 15s 超时对长生成要加大）
```

**设置项**：设置页新增「AI 助手」节——选择 Provider（从模型服务列表选）+ 模型覆盖 + 功能开关。

### 3.3 四大功能落点

| 功能 | 入口 | 上下文 | 产出 |
|---|---|---|---|
| F1 自然语言生成/改写 | AiDock 建议 chips + Skills/Prompts/MCP 页「✨ AI 生成」按钮 | 当前页类型 + 已有内容摘要 | 生成结果 → 预览 → 确认写入（破坏性操作前 snapshot） |
| F2 AI 诊断修复 | 健康检查页每个 issue 的「AI 分析」按钮 | `HealthIssue[]` + 相关文件片段 | 根因分析 + 修复建议（一键修复仅限软链类安全操作，删真实目录只给指引——AGENTS.md 红线） |
| F3 AI 对话助手 | activitybar 新增 ✨ 图标 → 右侧 dock | 用户自由提问 + 可选附加上下文 | 问答 |
| F4 编辑器内联辅助 | Monaco 选中内容 → 浮动工具条「解释/优化/修复」 | 选中片段 + 文件语言 | 替换/插入/复制，走 useEditorHistory 可撤销 |

### 3.4 分期

- **AI-P0（地基）**：Rust POST + `ai/client.ts` + 设置节 + F3 对话 dock 骨架（dbx 形态 UI）
- **AI-P1**：F1 生成/改写（Skills 页先落地）
- **AI-P2**：F2 诊断修复
- **AI-P3**：F4 编辑器内联

### 3.5 风险与红线

- 流式输出（SSE）ureq 支持有限，**P0 先做非流式**（loading 动画补偿），后续再评估
- AI 一键修复必须遵守 AGENTS.md：禁删真实目录、破坏性操作前 `snapshotNow()`、失败 toast 用 `'err'`
- API key 只在 Rust 侧拼进 Authorization 头，不进入日志/toast

---

## 四、建议实施顺序

1. **UI-P0**（外壳 token + panel 布局 + 基础组件）—— 先让质感对齐 dbx
2. **AI-P0**（AI 地基 + 对话 dock）—— dock 面板正好复用 UI-P0 的 panel 体系
3. 之后 UI-P1/P2 与 AI-P1/P2/P3 可穿插进行

每期独立 commit 到 `test` 分支，不打 tag 不发版（等用户明确发版指令）。
