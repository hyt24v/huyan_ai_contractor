# AI包工头

个人本地工具集合，纯前端、数据不出本机。支持网页版和 macOS 桌面 App（Tauri，对标 cc-switch 形式）。

## 桌面 App

```bash
npm run tauri:dev    # 开发模式（热更新）
npm run tauri:build  # 打包 AI包工头.app + .dmg（产物在 src-tauri/target/release/bundle/）
```

## 功能

- **JSON 编辑器**（对标 json.cn）：校验、格式化、压缩、转义/去转义、Unicode 转中文、复制、下载、打开本地文件/拖拽载入；右侧树形视图（展开/收起、复制值/路径）；错误行列定位跳转
- **JSONL 编辑器**：逐行校验（错误行红标 + 状态栏统计）、格式化/压缩（空行可选保留）、代码/表格双视图（表格取字段并集，非法行单独列出）、行级操作（跳转/删除/复制/下个错误）
- **Skills 管理**（Skills Manager 风格）：`~/ai-skills` 中央库卡片网格、按 Agent 的 Global Workspace、批量 Add Skill、标签/来源/预设过滤、Skill 详情预览、本地 skill 收编、GitHub URL 安装、Skill 审计、GitHub 市场、git 更新检查
- **MCP 管理**：中央清单 `~/.ai-baogongtou/mcp-central.json`，勾选分发到 Claude / Codex / Pi / Cursor / Gemini；分发前 Diff 预览、自动快照、历史回滚、漂移检测
- **健康检查**：Agent 配置 / Skills / MCP / 备份统一体检，输出评分与问题清单
- **配置套餐**：把 Skills + MCP + 提示词 + 模型服务打包成套餐，一键应用
- **模型服务**：Provider 预设与切换，支持 Claude Code / Codex / Pi，写入前自动备份
- **提示词**：维护 CLAUDE.md / AGENTS.md / GEMINI.md 等提示词库，按 Agent 写入并保留备份
- **界面**：⌘K 命令面板、左侧栏收起/展开（⌘B / Ctrl+B）、主题切换、纯本地运行
- **安全**：所有配置写入前自动备份；MCP 每 6 小时自动快照（应用打开期间）

## 开发

```bash
npm install
npm run dev      # 本地开发（http://localhost:1420）
npm test         # Vitest 单测
npm run build    # 产出 dist/ 纯静态文件，可丢任意静态托管
npm run preview  # 预览构建产物
```

## 技术栈

Vite + React 18 + TypeScript + Tailwind CSS（shadcn/ui 设计 token）+ Monaco Editor（本地打包，不走 CDN）+ HashRouter + Tauri 2（桌面壳）。

## 新增一个工具

1. 在 `src/pages/` 新建页面组件
2. 在 `src/App.tsx` 注册路由
3. 在 `src/lib/tools.ts` 的 `TOOLS` 数组加菜单项
