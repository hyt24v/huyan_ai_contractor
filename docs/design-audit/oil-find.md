# oil-find 键盘优先交互设计借鉴报告

> 调研对象:[oil-oil/oil-find](https://github.com/oil-oil/oil-find)(macOS 即时文件搜索,Spotlight 替代品,「苹果版 Everything」,MIT 开源,当前版本 1.7.1 / 2026-10-17)
> 调研时间:2026-10-25
> 调研方式:README(中/英)、官网(find.oiloil.org,含 changelog 1.0.0→1.7.1)、源码全文(经 jsdelivr/gh-proxy 镜像读取 `Sources/OilFindApp/*.swift`、`Sources/OilFindCore/*.swift`、`L10n.swift` 等约 15 个核心文件,GitHub 直连被本环境拦截)
> 目的:为「AI 包工头」(Tauri + React,VS Code 风格布局)规划「命令面板/全局搜索(⌘K)」提供设计借鉴

---

## 1. 功能清单(逐条)

依据:README.zh-CN.md、官网 changelog、L10n.swift 全部文案键、AGENTS.md 目录结构。

**核心搜索**
1. 全局热键 ⇧⌘F 唤起/隐藏居中搜索面板(toggle,同一键开关)(`AppDelegate.handleHotKey` → `SearchPanel.toggle`)
2. 文件名内存索引搜索:列式存储 + C/NEON 向量化比较,官方实测 85 万文件每键 <10ms(README 基准表)
3. 拼音搜索:首字母(`wd`→「文档」)与全拼(`wendang`),可关(`Pinyin.swift`、`pinyinEnabled` 设置)
4. 查询语法:空格=与、`|` 或、`!` 排除、`*.png` 通配、`~/Desktop/` 路径限定、`ext:`、`kind:`(folder/app/doc/image/video/audio/code/archive)、`file:`/`folder:`、`size:>10mb`/`size:1mb..5mb`、`dm:today/week/日期`、`regex:`(`Query.swift`,README 语法表)
5. 路径粘贴识别:`file://`、带引号/转义路径、末尾 `:行:列` 均可识别(README)
6. 语法错误实时诊断:写错 regex/kind/size/dm 时底栏直接提示正确写法(changelog 1.1.0;`L10n` 中 `diag.*` 键)
7. ⌘/ 语法速查面板:5 个可点示例,点击即填入搜索框并搜索(`SyntaxReference.swift`,`onExample` 回调)

**结果操作**
8. Return 打开、⌘Return 在访达中显示、Space/⌘Y Quick Look 预览、⌘C 拷贝路径、⌥⌘C 拷贝名称、⌘⌫ 移到废纸篓(`SearchViewController.handleKey`)
9. 右键上下文菜单(打开/显示/预览/拷贝路径/拷贝名称/移到废纸篓)(`SearchViewController.contextMenu`)
10. 结果可拖出到其他应用(`ResultsView` 实现 `pasteboardWriterForRow` / dragging session)
11. 拷贝/删除后底栏 toast 反馈(「已拷贝:…」「已移到废纸篓:…」,停留 2.4s)(`FooterBar.showToast`)

**分类与排序**
12. 分类筛选条:全部/文件夹/应用/文档/图片/视频/音频/代码/压缩包 + 动态附加分类(AI 话题)(`FilterBar.names`)
13. 排序:相关度/名称/修改时间/大小,同名再按一次切换升降序,选择持久化(`FilterBar.showSortMenu`、`sortKey/sortAscending` 存 UserDefaults)

**索引与数据源**
14. FSEvents 实时增量更新,文件变动 1 秒内反映到结果;关机期间变动开机补齐(`FSWatcher.swift`、README)
15. 外置磁盘:插上即索引,可逐盘关闭;拔掉后免费版不可搜、Pro 保留目录可搜(`ExternalDriveCatalog.swift`)
16. 本地 AI 对话搜索:Claude Code(含桌面 Code 会话)、Codex、WorkBuddy,标题+正文,每个来源独立开关,未安装默认关(`AITopics/` 目录;changelog 1.7.0 起免费)
17. Pro(闭源,¥49 买断,7 天试用):图片内容识别、文档正文(PDF/Office/Pages/Markdown,扫描 PDF 前 10 页)、拔掉的磁盘可搜;同一安装包内激活(README Pro 表、`ApplicationExtension` 扩展点)

**应用管理**
18. 应用内自动更新:发现→下载→校验签名→重启,可关闭自动检查(`Update/` 目录、changelog 1.2.0)
19. 首次启动欢迎引导:展示快捷键、可改热键、引导授予完全磁盘访问(`WelcomeWindow.swift`)
20. 菜单栏图标:显示已索引数/索引中/重建索引入口/权限缺失提示/热键被占用提示(`AppDelegate.buildMenu`)
21. 多实例防护:二次启动通过分布式通知让已有实例弹出面板后自行退出(`AppDelegate.applicationDidFinishLaunching` 开头)

---

## 2. 快捷键体系(重点):逐项语义分析

全部按键处理集中在 `SearchViewController.handleKey(_:)`,全局热键在 `HotKey.swift`(Carbon `RegisterEventHotKey`)。

| 快捷键 | 作用 | 语义设计为什么合理 |
|---|---|---|
| **⇧⌘F** | 全局唤起/再按隐藏(toggle) | 单键开关而非「只开不关」,肌肉记忆零负担;⇧⌘F 与系统「查找」语义(F)对齐,加 Shift 避开各应用的 ⌘F 页内查找。源码层面 `toggle()` 有 `hiding` 状态锁,动画期间连按不抖 |
| **Return** | 打开 | 列表交互第一惯例:选中即执行默认动作 |
| **⌘Return** | 在访达中显示 | 「打开」的次常用变体挂在同一主键 + ⌘,语义是「打开它的位置」而非「打开它」,主从关系清晰 |
| **Space / ⌘Y** | Quick Look 预览 | **上下文感知复用是精髓**:`previewWithSpace` 仅当 `browsingResults == true`(用户按过方向键或用鼠标点选过)时拦截空格;输入态空格正常打字(changelog 1.4.2:「While typing, Space still types a space」)。⌘Y 是 macOS Quick Look 的系统惯例键,作为不受状态限制的兜底。两个键 = 一个零学习成本(空格,对齐 Finder)+ 一个绝对可靠(⌘Y) |
| **⌘C / ⌥⌘C** | 拷贝路径 / 拷贝名称 | ⌘C 先判断搜索框是否有选中文字:有则复制文本(保住文本编辑惯例),无则拷贝选中结果的路径;⌥ 变体降一级语义(路径→名称)。「修饰键越多,动作越轻」 |
| **⌘⌫** | 移到废纸篓 | 完全沿用 Finder 惯例;且源码里 `trashing: Set<URL>` 防连按重复删除,失败 `NSSound.beep()`,成功 toast |
| **Tab / ⇧Tab / ⌘1…9** | 循环/直达切换分类 | Tab 在搜索框里本来「无用」(不产生字符),被回收做筛选维度切换;⌘数字对齐浏览器切页签直觉,9 个分类刚好铺满 1-9 |
| **⌘/** | 语法速查 | `/` 与 `?`(⇧/)同键,是「帮助」的通用暗示;速查层打开时 Esc 只关速查层,再 Esc 才关面板——**分层退出** |
| **Esc** | 关速查 → 关 Quick Look → 关面板 | 逐层回退,每层 Esc 只撤销最近一层状态(`handleKey` 中 `syntaxVisible`/`quickLook.isVisible` 优先级判断) |
| **↑↓ / ⌘↑⌘↓ / Home / End / PageUp / PageDn** | 移动/首末/翻页 | 全键盘导航;越界时触发 9pt 的 nudge 弹跳动画(`ResultsView.nudge`)而非无声失败——给「到底了」的物理反馈 |
| **⌘W** | 关面板 | macOS 关窗惯例 |
| **⌘,** | 打开设置 | macOS 设置惯例 |

**实现层的三个关键细节(均可迁移):**

1. **输入法保护**:所有按键拦截前先查 `hasMarkedText()`(IME 组字中),中文输入拼音过程中方向键/空格/回车全部放行给输入法(`SearchPanel.performKeyEquivalent`、`SearchEditor.keyDown`)。**中文产品的命令面板必须抄这条。**
2. **nonactivating panel 没有 Edit 菜单**,手写补全 ⌘A/⌘C/⌘X/⌘V(以及设置窗里的 ⌘Z/⇧⌘Z)——键盘优先意味着连文本编辑惯例都不能破。
3. **热键可自定义且有防御**:设置页录制新热键,要求必须含 ⌘/⌃/⌥(防止普通字母被全局吃掉),Esc 取消录制、Delete 恢复默认,注册失败(被别的应用占用)即时红字提示且菜单栏出现「快捷键已被其他应用占用」常驻警示(`SettingsModel.record`、`AppDelegate.registerHotKey`)。

---

## 3. 搜索交互

### 3.1 输入即搜的反馈节奏(`SearchViewController.search`)

- **代际取消**:`SearchGeneration` 单调递增 token,每次按键 `generation.next()`,异步搜索完成回调先校验 `generation.current(token)`,过期结果直接丢弃——永远只显示最后一次输入的结果,无回跳。
- **增量收窄**:连续输入时把上一次结果传进 `Searcher.search(..., previous:)`,只在子集里继续过滤(官网实测:85 万文件,`r` 8.4ms → `readme` 0.2ms,越敲越快)。
- **结果缓存**:`SearchCache` 按 query+options 缓存,删字符回退查询时零等待。
- **滚动保护**:滚轮/惯性滚动/拖拽进行中,结果刷新被推迟(`resultRefreshAction` → `.deferRefresh`),滚动停止 120ms 静默期后才应用——列表绝不在用户眼皮底下跳动(changelog 1.4.2 专门修过「滚动时列表跳回选中项」)。
- **选择锚点**:刷新时按 `(sourceID, store, id, path)` 找回原选中项,找不到才回落到行号。
- **性能可视化**:底栏常驻「共 8,745 项 · 0.8 ms」,把速度做成可感知的品牌资产;超过 5000 条只排序前 5000 并如实标注(`footer.partial`)。
- 索引/AI 话题同步中时,搜索框右侧 clear 按钮让位给 spinner(同一位置二选一,布局不抖)。

### 3.2 结果列表信息密度(`ResultsView.ResultCell`,行高 50pt)

```
┌──────────────────────────────────────────────────────────┐
│ [32pt 图标]  read▮me.md(匹配字符 accent 色加粗)    今天 14:32 │
│              ~/Desktop/proj(父路径,~缩写,中间截断)  12.4 KB │
└──────────────────────────────────────────────────────────┘
```

- 图标异步解析真实文件图标;图片/文档类结果可升级为缩略图(圆角 3 + 0.5px 描边)。
- 匹配字符高亮:`Presentation.highlightRanges` 把查询里所有非否定字面量(含 glob 拆出的片段)全部找出、合并重叠区间,染成系统 accent 色 + semibold。
- 日期人性化:「今天 HH:mm / 昨天 HH:mm / M月d日 / yyyy/M/d」(`Presentation.dateText`)。
- 大小列等宽数字字体(`monospacedDigitSystemFont`)防跳动;文件夹显示「文件夹」、.app 显示「应用」而非尺寸。
- 离线来源:名称降灰(tertiary),路径后追加「· 未连接」,打开动作被拦截并在底栏给出原因。
- 悬停:4% 灰圆角 plate(半径 10)跟随鼠标;选中:accent 色 plate(浅色 0.16 / 深色 0.30 alpha),弹簧动画(刚度 1400/阻尼 64),按住方向键连移时切换为 0.045s 线性动画防粘滞。

### 3.3 空查询态与空结果态(`StateViews.swift`、`updateFooter`)

- **空查询 ≠ 空白**:显示「最近修改」的文件列表 + 底栏「最近修改 · 已索引 851,420 项」——面板一打开就有内容、可预览数据规模。
- **空结果**:大号放大镜图标 +「没有匹配的结果」+ 行动建议「换个更短的关键词,或试试 *.pdf、ext:png、!node_modules」。
- **语法写错**:空态标题变「查询写法有误」,正文给出正确写法(如「size: 的写法是 size:>10mb 或 size:1mb..5mb」)。
- **权限缺失**:追加「有些文件夹没有访问权限」+「授予权限…」按钮,一键跳系统设置。
- 设置页还有「检查文件为什么搜不到…」:选一个文件,告诉你它被哪条规则排除(范围/类型/用户排除/云端/外置盘)——诊断做成产品功能。

### 3.4 其他值得记录的交互

- **打开前的 press 微动画**:Return 后选中 plate 先压到 0.985 倍(0.08s)再弹回并执行打开(`pressOpen`)——在「按键」与「应用启动的延迟」之间插入即时反馈。
- **Quick Look 打开时**:方向键/翻页键直接改选中项并实时刷新预览;Esc/⌘Y 只关预览不关面板(`QuickLook.swift`)。
- **失焦即隐藏**:面板失去 key 状态且 Quick Look/菜单/拖拽都不在活动 → 自动隐藏(`hideIfInactive`)。
- **重开面板保留上下文**:查询与结果 10 分钟内直接复用不重新搜索;焦点回搜索框并全选文本(再敲字即覆盖,方向键即保留)。

---

## 4. 设置页:可配置项逐项(`SettingsWindow.swift` + `SettingsPreferences.swift`)

SwiftUI `Form`(grouped 风格、开关为 switch),宽 540、内容自适应高(上限 600):

**通用**
1. 语言:跟随系统 / 中文 / English(立即生效,全界面含菜单即时重载)
2. 自动检查更新(开关 + 说明「每天检查一次,只读取版本信息」)+ 手动「检查更新…」按钮 + 当前版本号
3. 登录时启动(SMAppService,失败显示错误)
4. **全局快捷键录制器**:点击→按下新组合;校验必须含 ⌘/⌃/⌥;冲突红字提示;Esc 取消、Delete 恢复默认 ⇧⌘F
5. 拼音搜索(开关 + 说明「输入 wd 或 wendang 就能找到『文档』」)
6. 按空格预览(开关 + 说明「选中结果后按空格预览;打字时空格照常输入」)

**索引**
7. 已索引 N 项 + 上次完整扫描时间
8. 未覆盖统计(可展开看示例路径):无权限文件夹 / 按范围排除 / 用户排除路径 / 排除的文件类型 / 仅云端文件夹 / 外置磁盘与网络卷
9. 「检查文件为什么搜不到…」诊断工具
10. 完全磁盘访问权限状态灯(绿/橙)+「打开系统设置」
11. 重建索引(进行中禁用并显示「正在重建…」)

**索引范围**(改动自动重建)
12. 开发依赖目录(node_modules、site-packages、.venv、Pods、DerivedData、.git 等)
13. 应用与包的内部文件(.app/.framework/.photoslibrary 内部)
14. 资源库 ~/Library(iCloud 云盘和网盘始终索引)
15. 系统目录(/System、/Library、/usr、/private、/opt)

**外置磁盘**
16. 总开关 + 逐盘开关 + 状态(已连接·N 文件 / 索引中 / 未连接·上次连接时间)+「移除…」(删目录,下次连接重建)

**AI 话题**
17. 总开关 + Claude Code / Codex / WorkBuddy 各自独立开关(未安装默认关)+ 已索引话题数 + 索引体积 + 隐私说明

**Pro**
18. 免费试用 7 天 / 输入授权码 / 授权状态(经 `ApplicationExtension` 中性扩展点注入)

**排除规则**
19. 排除的文件夹:列表(中间截断、悬停显示完整路径)+ 添加(多选文件夹面板)+ 逐项删除
20. 排除的文件类型:空格分隔文本框(如 `log js css`),改动自动重建索引

---

## 5. 视觉语言:Spotlight 风格浮层(`SearchPanel.swift` + `Theme.swift`)

| 维度 | 做法 |
|---|---|
| 窗口形态 | `NSPanel` + `[.borderless, .nonactivatingPanel]`(不抢主应用焦点),`level = .floating`,`canJoinAllSpaces` + `fullScreenAuxiliary`(全屏应用上也能浮出),`isMovable = false`(位置永远居中,不需要拖动) |
| 尺寸位置 | 800×560(上限屏宽-80/高-120),出现在**鼠标所在显示器**的正中央——多屏用户的眼睛在哪,面板就在哪 |
| 材质 | `NSVisualEffectView`(material: `.popover`, blending: `.behindWindow`)毛玻璃 + 22pt 连续圆角(`.continuous` corner curve,即「超椭圆」圆角)+ `maskImage` 保证内容也被裁成同圆角 |
| 叠色描边 | `SurfaceTint`:浅色叠 30% 白、深色叠 18% 黑统一色调;1 物理像素描边(浅色 10% 黑 / 深色 14% 白)——毛玻璃在任何壁纸上都有清晰边界 |
| 阴影 | `hasShadow = true` + `invalidateShadow()`(无边框窗口需手动触发阴影计算) |
| 布局分区 | 64pt 大搜索框(21pt 字号、19pt 放大镜图标)→ 1px 分隔线 → 40pt 筛选条 → 结果区 → 1px 分隔线 → 34pt 底栏(状态文本 + 快捷键键帽提示 + 设置按钮) |
| 动效 | 出现:spring(刚度 500/阻尼 36)+ scale 0.96→1 + 上移 8pt + 0.12s 淡入;消失:scale→0.985 + 0.13s easeIn 淡出;筛选胶囊:spring(900/50)滑动;toast:0.16s 上浮 6pt 淡入、停留 2.4s、0.12s 淡出;**全部动效读取 `accessibilityDisplayShouldReduceMotion`,减弱动态效果时降级为 0.1s 纯淡变** |
| 动效治理 | 所有时长/弹性参数集中在 `Theme.Motion` 枚举(注释:「Point measurements are fixed by the M3 design specification」),且所有动画替换前读 `presentation()` 当前值起步,动画可任意中断反转不跳变 |
| 底栏键帽提示 | 常驻键帽样式(灰底圆角 5 的小键盘帽 + 文字):「↩ 打开 ⌘↩ 在访达中显示 ⌘Y 预览 ⌘C 拷贝路径 ⌘/ 语法」,随上下文变化(选中 AI 话题时 ⌘C 变「复制」;空格预览开启且处浏览态时 ⌘Y 换成「空格」) |

---

## 6. 对「AI 包工头」命令面板(⌘K)的可借鉴点

场景设定:⌘K 唤起,搜索 skills / MCP / 提示词 / 配置套餐 / 配置文件 / 页面跳转。

### P0(不做就不算合格的命令面板)

1. **底栏常驻键帽提示条**——「↩ 打开 ↑↓ 选择 Tab 切换分类 ⌘/ 语法 esc 关闭」。命令面板最大的问题是可发现性,oil-find 把快捷键表做成 UI 的固定部件而不是隐藏文档,且随上下文动态换键帽。React 侧实现成本极低,收益最大。
2. **输入态/浏览态分离 + 分层 Esc**。oil-find 用 `browsingResults` 标志区分两种模态:输入态所有键归文本框,浏览态空格变预览、单键可用。Esc 逐层回退(详情层→面板),不一键清空。AI 包工头面板若支持「预览 skill 内容/配置 JSON」,必须抄这套模态管理。
3. **输入法保护**:组字中(hasMarkedText,Web 侧对应 `compositionstart/compositionend` / `KeyboardEvent.isComposing`)不拦截任何导航键。oil-find 每一处按键入口都有这层 guard;中文用户在命令面板里打拼音是主路径,漏了这条等于面板不可用。
4. **结果行双行信息密度范式 + 匹配字符高亮**:图标 + 名称(命中片段主题色加粗)+ 次级路径/归属(如 `agent: claude · ~/.claude/skills/…`)+ 右侧元信息(类型标签/更新时间)。高亮算法直接参考 `Presentation.highlightRanges`:拆分所有查询字面量 → 大小写不敏感找全部区间 → 排序合并重叠 → 一次渲染。
5. **空查询 =「最近使用/常用」,空结果 = 建议 + 语法引导**。⌘K 一打开就列出最近编辑的 skill/MCP 配置/最近访问页面,比空白输入框有用得多;无结果时给出「试试 type:skill、agent:codex」这类可点击建议。
6. **分类筛选条 + Tab 循环 / ⌘1-9 直达**:全部/Skills/MCP/提示词/套餐/配置/页面,胶囊指示器滑动动画。oil-find 证明 9 个以内分类 + Tab 是单手可达的最优解。

### P1(体验从合格到优秀)

7. **代际 token 取消 + 增量收窄 + 视口保护**:异步搜索(尤其跨 Rust 后端 invoke)必须丢弃过期响应;连续输入在上次结果子集内过滤;列表正在滚动时推迟刷新、刷新时按稳定 ID 恢复选中项。oil-find 的 `SearchGeneration`/`resultRefreshAction`/`selectionAnchor` 三件套可直接翻译成 React 状态机。
8. **底栏性能/规模可视化**:「共 N 项 · X ms」或「已索引 N 个 skill · M 条 MCP 配置」——同时是信任建设和调试信息。
9. **操作微反馈**:Return 后选中行 0.98 压缩弹回再执行跳转;破坏性操作(删除 skill 软链等,遵守项目「真实目录只提示不删除」红线)后底栏 toast「已移到回收站:xxx」停留 ~2.4s。
10. **⌘/ 语法速查层,示例可点击直接填入搜索框并执行**——教学闭环:用户不需要记住 `type:skill agent:claude`,点一下就看到效果。
11. **越界 nudge**:方向键到底/到顶时列表轻微弹跳 9pt,替代无声失败。

### P2(锦上添花 / 有中文用户场景再抄)

12. **拼音搜索**:中文 skill 名/提示词标题按拼音首字母可搜(`wd`→「文档」)。oil-find 把它做成可关闭的一级设置。前端可用 `pinyin-pro` 之类库,数据量小无需 C 级优化。
13. **动效参数集中治理**:所有时长/弹性集中成一个 `Motion` 常量表,并响应 `prefers-reduced-motion` 降级为纯淡变(对齐项目主题 token 体系,接入 `themes.ts`)。
14. **可自定义唤起热键 + 冲突提示**:录制式录入、必须含修饰键、占用即红字。Tauri 全局热键走 Rust 侧 `globalShortcut` API,交互形态照抄 oil-find 设置页。
15. **诊断式解释**:「为什么搜不到这个 skill?」——因为该 agent 未启用/目录不存在/被你排除。oil-find 把索引覆盖解释做成了设置页的一等功能,与 AI 包工头「健康检查」页天然契合。

### 技术差异备忘(研究者的提醒,非 oil-find 原文)

oil-find 是 AppKit 原生实现(毛玻璃/连续圆角/弹簧动画由系统提供);AI 包工头是 WebView,等效方案:毛玻璃用 `backdrop-filter: blur()`、圆角用项目圆角 token(`rounded-lg` 级)、弹簧动画用 CSS `linear()` easing 或 framer-motion。视觉语言可抄,实现栈不同,不要试图逐参数复刻物理曲线。

---

## 7. 最值得抄的 Top 5

1. **底栏常驻快捷键键帽提示条**(随上下文变化)——用最低的实现成本解决命令面板最大的可发现性问题。(`FooterBar.swift` 的 `KeyHint`)
2. **输入态/浏览态双模态 + 上下文感知的空格键 + 分层 Esc**——键盘优先的核心不是「快捷键多」,而是「同一个键在对的上下文做对的事」。(`SearchViewController.handleKey` 的 `browsingResults` 判断)
3. **空查询显示「最近使用」,空结果给出可点击的语法建议**——面板的每一个状态都产出价值,永不白屏。(`updateFooter` 的 `footer.recent` / `StateViews.empty` / `SyntaxReference.onExample`)
4. **代际 token 丢弃过期结果 + 增量收窄 + 滚动中不刷新**——「输入即搜」不闪烁、不回跳、不打断滚动的工程三件套。(`SearchGeneration` / `Searcher previous:` / `resultRefreshAction`)
5. **结果行命中字符主题色高亮 + 双行高密度布局 + 人性化时间列**——一眼定位「为什么是它」的信息设计。(`Presentation.highlightRanges` / `ResultCell` / `dateText`)

---

## 附:调研局限与证据说明

- 本环境无法直连 github.com/raw.githubusercontent.com,源码经 `cdn.jsdelivr.net`(文件树)与 `gh-proxy.com`(文件内容)镜像读取 @main 分支;关键 UI 逻辑均基于源码原文,未依赖二手转述。
- 「★81」未能验证:搜索快照显示 67 stars(2026-10 抓取),与任务描述的 81 存在出入,可能为快照延迟;此数字不影响任何设计结论。
- 视觉参数(圆角 22、面板 800×560、动画时长等)全部来自 `Theme.swift` 源码常量,非目测。
- Pro 功能(图片/文档内容搜索)闭源,仅能从 README 与官网描述其交互表象,未分析其实现。

## 主要来源

- [README.zh-CN.md](https://github.com/oil-oil/oil-find/blob/main/README.zh-CN.md) — 功能清单、快捷键表、性能基准
- 源码:`Sources/OilFindApp/SearchViewController.swift`(按键分发)、`ResultsView.swift`(列表与刷新策略)、`SearchPanel.swift`(浮层窗口)、`Theme.swift`(视觉/动效规范)、`FilterBar.swift`/`FooterBar.swift`/`SearchField.swift`(分区 UI)、`SettingsWindow.swift` + `SettingsPreferences.swift`(设置项)、`QuickLook.swift`、`StateViews.swift`(空态)、`SyntaxReference.swift`、`L10n.swift`(全部界面文案)、`AppDelegate.swift`(热键注册/菜单栏)、`Sources/OilFindCore/Presentation.swift`(高亮/格式化)、`Shortcut.swift` + `HotKey.swift`(热键模型)
- [官网](https://find.oiloil.org/)([英文](https://find.oiloil.org/en))、[语法页](https://find.oiloil.org/en/syntax)、[Changelog](https://find.oiloil.org/en/changelog)、[Pro 页](https://find.oiloil.org/en/pro)
