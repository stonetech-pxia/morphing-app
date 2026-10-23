# 架构

产品事实来源：[PRODUCT_HANDOFF_CLAUDE_CODE.md](../PRODUCT_HANDOFF_CLAUDE_CODE.md)（下文 “§” 均指该文档章节）。

## 1. 分层与模块边界

```
┌───────────────────────────────────────────────────────────────┐
│ apps/mobile（Expo / React Native）                              │
│  src/app/        路由：首页、[pageId]、工具目录、历史、设置、AI 修改 │
│  src/renderer/   白名单组件表：配置中的 type → 真实组件            │
│  src/storage/    SQLite：revision、修改请求、文件、授权、执行记录    │
│  src/runtime/    工作流执行器 + 平台动作（选文件、保存、分享）       │
│  src/share/      分享到 Morph：接收、收件页面                    │
│  modules/morph-vision/  本地原生模块（iOS Swift：Vision；     │
│                  Android Kotlin：ML Kit）                     │
│  plugins/        本地 config plugin（iOS 分享扩展的控制器）      │
│  modules/morph-share/   一次分享多个文件、存到选定文件夹      │
│  modules/morph-media/   视频（以后音频）：iOS AVFoundation、   │
│                  Android Media3 Transformer                   │
│  ios/ android/   expo prebuild 生成（CNG，不进 git）            │
├───────────────────────────────────────────────────────────────┤
│ packages/core（纯 TypeScript，无平台依赖）                        │
│  schema · 修改操作（ops）· apply · validate · migrate ·            │
│  修改说明（describe）· AIProvider 接口 · mock AI                   │
├───────────────────────────────────────────────────────────────┤
│ packages/tool-*  pdf（pdf-lib）· image · archive（fflate）· qr   │
│                  纯逻辑，清单在 core/src/tools                    │
├───────────────────────────────────────────────────────────────┤
│ apps/api（M3）  Hono 计划服务 + Claude（账号与云端数据见 CLOUD_DESIGN）│
└───────────────────────────────────────────────────────────────┘
```

依赖规则：

- `core` 不得 import React、React Native、Expo 或任何平台 API。所有可在电脑上测试的逻辑都放在这里。
- `tool-*` 只依赖 `core` 的类型与动作接口；文件读写等平台能力由 App 注入。
- `apps/mobile` 依赖 `core` 和 `tool-*`；渲染器只能渲染白名单组件，不执行配置中的任何代码。
- 原生代码只写在本地 Expo 模块里（`apps/mobile/modules/`），只用系统框架（例外：iOS 分享扩展的控制器在 `apps/mobile/plugins/share-extension/`，由 config plugin 放进生成的扩展 target，D-118）；JS 侧用 `requireOptionalNativeModule`，模块不存在（Expo Go、Android、测试）时为 `null`，调用方必须有退路。
- AI（mock 或真实）只能输出**修改操作列表**，不能直接写配置、写数据库或生成代码。

## 2. 固定内核与可变层（§5）

| 固定内核（AI 不可改）                                                  | 可变层（AI 通过修改操作改）    |
| ---------------------------------------------------------------------- | ------------------------------ |
| 渲染器与组件白名单、校验器、迁移、存储、执行器、动作注册表、受保护元素 | 页面与组件树、导航、主题、布局 |
| 工具代码（随 App 发布）                                                | 工具安装状态、工具设置、工作流 |

受保护元素（§5.1）：只有「设置」必须留在导航栏或浮动按钮里，由 `core` 的校验器强制执行。设置页由内核固定提供「修改这个 App」「历史版本」「工具」三个入口，所以 AI 修改、历史和工具可以从导航栏完全移除，随时仍能修改和撤销（DECISIONS D-031）。

AI 可以修改的范围（schemaVersion 2，见 `packages/core/src/schema.ts`）：

- **样式**：主色、深浅模式、背景 / 卡片 / 文字 / 辅助色 / 第三色（深色模式可单独配色，schemaVersion 6）、字体（Clay / 系统 / 衬线 / 等宽）、字号比例、圆角、疏密、卡片样式（阴影 / 描边 / 平面 / 新粗野 / 新拟物 / 黏土 / 毛玻璃 / 霓虹发光 / 金属）、页面背景（纯色 / 渐变 / 极光）、导航栏样式（图标 + 文字 / 只有文字 / 只有图标）。正文对比度低于 4.5:1 的主题会被校验器拒绝。
- **组件**：标题、文字、工具卡片、添加工具入口、文件列表、流程执行器、按钮、快捷入口卡片、提示框、分隔线、间距，以及分组（竖排 / 横排 / 2–3 列网格，不能嵌套）；每个组件可设对齐、色调、大小，可隐藏。
- **页面**：新建、删除（首页和工具页除外）、改名、改图标；导航栏 1–5 项、浮动按钮最多 3 个，可以指向任何页面或系统入口。
- **图片与富文本**（schemaVersion 4）：图片位（照片由用户自己选）、文字和提示框里的粗体 / 斜体 / 链接 / 列表、emoji 图标（D-044–D-048）。
- **数据表结构**（schemaVersion 3）：AI 可以新建数据表、增删改字段，并用记录列表、快速添加表单、统计三个组件展示（见 [DATA_DESIGN.md](DATA_DESIGN.md)）。
- **不能改**：白名单之外的组件和属性、任意代码、系统页面（设置、工具目录、历史、数据、AI 修改页、记录编辑页）的内容、工具的代码和动作，以及**用户记录的内容**。

直接编辑（D-052–D-059）：用户也可以不经过 AI，点「编辑」或长按组件进入编辑模式，修改文字和外观、隐藏、删除、拖动排序（`apps/mobile/src/editing/`）。界面只负责把手势翻译成同一套修改操作（上移 / 下移 / 拖放的计算和相邻操作的合并在 `core/src/arrange.ts`），每一步先校验进草稿，「完成」时合成一个版本。能改的范围是上面列表的子集：只限导航栏页面和独立页面里的组件，不碰系统页面，也不改数据组件的文字和记录。

用户记录（DATA_DESIGN.md）：存在本地数据库的 `records` 表，不在配置里、不随版本恢复，也从不发给 AI。增删改由用户在页面上直接完成（`apps/mobile/src/data/records.ts`），不生成版本。

## 3. 修改流程（§7D）

```
用户输入                                       （直接编辑：长按 / 拖动 / 箭头直接得到 ops，跳过 AI，见下）
  → AIProvider.plan(输入, 当前配置的精简摘要)  → 修改操作列表 ops
  → core.apply(当前配置, ops)                   → 候选配置
  → core.validate(候选配置)                     结构 / 引用 / 权限 / 受保护元素
  → 预览：修改前后两份界面 + core.describe(ops) 生成的可读说明
  → 用户确认
  → storage.commit(baseRevisionId, 候选配置)    SQLite 事务：head 仍等于 base 才写入
  → 从数据库重新读取 head → 渲染
       ├─ 成功：提示“已应用”
       └─ 失败：自动提交“上一版配置”为新 revision，ChangeRequest 记为 rolled_back
```

撤销与恢复都是把旧配置作为**新 revision** 提交；历史只追加。

界面上的修改（安装 / 卸载工具、选照片、直接编辑）调用 `store.proposeOps(ops, 摘要)`，经过同样的 apply + validate，记为 `source: 'user'` 的 revision，提示条同样可以撤销。安装 / 卸载工具先弹窗列出修改说明再确认；选照片直接确认；直接编辑在点「完成」时把整份草稿作为一次修改提交（结果已经在用户眼前，不再显示预览页）。

## 4. 启动流程

```
读取 head revision → 按 schemaVersion 逐级 migrate → validate
  ├─ 通过：渲染
  └─ 失败：沿历史向前寻找最后一个有效 revision 并渲染，记录日志（不白屏）
```

首次启动时写入内置的默认 workspace 作为 revision 1。

## 5. 本地存储（M1/M2 唯一权威来源）

SQLite 表（`PRAGMA user_version` 管理数据库结构升级，见 `apps/mobile/src/storage/sqlite.ts`）：

| 表                | 内容                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `workspace_head`  | 当前 head revision ID                                               |
| `revisions`       | 不可变快照：ID、父 ID、schemaVersion、配置 JSON、来源、摘要、时间   |
| `change_requests` | 原始输入、ops、状态、关联 revision、错误                            |
| `assets`          | 用户文件元数据与本地路径（归属 workspace）                          |
| `asset_grants`    | 工具 → 文件的授权                                                   |
| `tool_runs`       | 工作流执行记录（不含文件内容）                                      |
| `app_meta`        | 设备上的小设置，例如使用习惯的统计（D-127）；不进配置、不随版本恢复 |

用户文件存放在 App 文档目录的 `assets/<id>/<文件名>`，与 revision 分开，回滚和卸载工具都不会触及。

## 5.1 工作流执行（TOOLS_DESIGN.md）

执行器在 `packages/core/src/workflow/engine.ts`：按顺序执行步骤，步骤之间传递**一个有类型的值**（images / pdf / files / zip / text / records，D-060），执行前再检查一次类型链和参数，支持进度、取消、运行时询问参数和扩展包确认；`tool_runs` 只记录状态和错误代码。动作契约（输入输出类型、zod 参数、参数界面元数据）在 `core/src/workflow/contract.ts` 和各工具清单里。

App 侧：`apps/mobile/src/runtime/runner.ts` 把执行器接上存储和平台；动作实现在 `runtime/actions/`，纯逻辑调用 `packages/tool-*`（tool-pdf、tool-image、tool-archive、tool-qr，Node + 真实文件测试）；平台能力（选照片 / 文件、临时文件、分享、存相册、打印）通过 `FilePlatform`（`runtime/platform.ts`）注入，App 中由 Expo 模块实现，测试中用内存实现。运行页面 `app/run/[workflowId].tsx` 显示每一步、本地操作界面（`run/local/`）和结果预览。中间结果是缓存目录 `runs/<runId>/` 里的临时文件，只有「保存」才成为用户文件（D-063）。

工作流的管理（D-081、D-082）：预设写在 `core/src/workflows/presets.ts`，添加时用 `presetWorkflow()` 复制进配置；增删改都是修改操作（`addWorkflow`、`updateWorkflow` 等，在 `core/src/ops.ts`），和 AI 一样经过校验、生成版本、可撤销。「工作流」页 `app/workflows.tsx`（`shell/WorkflowsScreen.tsx`）列出我的工作流、预设库和工具自带的；编辑页 `app/workflow/[id].tsx`（`run/WorkflowEditor.tsx`）按动作的 `fields` 生成表单（`run/ParamForm.tsx`），只列出类型接得上的动作（`insertableActions`），保存走 `run/workflow-change.ts`（proposeOps → confirm，不再弹预览）。这两个页面由内核提供，AI 不能修改。Mock AI 的工作流句式在 `core/src/ai/workflow-phrases.ts`。

扩展包（D-064、D-075）：清单在 `core/src/packs.ts`；下载、校验、删除在 `apps/mobile/src/packs/store.ts`（`documentDirectory/packs/<id>/<version>/`）；`PackHost` 按需挂载隐藏的 WebView，页面是随 App 发布的固定 HTML（`packs/pages/`），库文件经 `bridge.ts` 分块送进页面。用户在 `PackGate` 确认后才下载；「设置 → 扩展包」（`app/packs.tsx`）管理已下载的扩展包。扩展包页面：`pdfview`（pdf.js）、`scan`（OpenCV.js + jscanify：找边、透视矫正）、`ocr`（tesseract.js：worker 是前置脚本 + 内嵌 wasm 的核心 + worker.min.js 拼成的 Blob，语言数据由页面送进 worker）。送进页面的图片先在 App 里重新编码成 JPG 并缩到 1677 万像素以内（`imageForPage`）；离开运行页面时关掉扫描和识别页面释放内存。动作的扩展包由参数决定时用 `packFor`（执行器先问参数再确认下载）。

系统识别（D-084–D-087）：`FilePlatform.vision`（`VisionPlatform`，接口在 `runtime/platform.ts`，实现在 `runtime/expo-vision.ts`）包装本地模块 `MorphVision`（iOS：`modules/morph-vision/ios/MorphVisionModule.swift`；Android：`modules/morph-vision/android/…/MorphVisionModule.kt`，ML Kit，没有找边和拉正）：`recognizeText`（Vision 文字识别）、`findPaper`（文档分割 + 矩形检测）、`straighten`（Core Image 透视矫正，直接写进本次运行的临时目录）、`scanDocuments`（VisionKit 文档相机）。`vision` 为 `null`（Expo Go）、`canFindPaper` 为 false（Android）或 `supportsLanguage` 为 false（Android 上的俄文）时，`scan.detect` / `ocr.recognize` 退回扫描包 / 文字识别包；执行器通过 `runner.ts` 的 `packNotNeeded` 判断这一步要不要确认扩展包。测试里 `FakeFiles.vision` 默认是 `null`，换成 `FakeVision` 就是 iOS 的路径，再设 `canFindPaper = false`、`unsupported` 加上 `ru` 就是 Android。

分享到 Morph（D-114–D-118，TOOLS_DESIGN §11）：原生部分是 expo-share-intent（iOS 分享扩展 + App Group，Android intent-filter），iOS 扩展的控制器是我们自己的。根布局的 `share/useIncomingShare.ts` 订阅原生模块，`share/incoming.ts` 把两种平台的数据整理成选择器同样的 `PickedFile[]`、只放在内存里；收件页面 `app/share.tsx`（`share/ShareScreen.tsx`，内核页面）用 `core/src/share.ts` 的 `shareFit` 列出第一步接得上的工作流，点了才跳到 `/run/<id>?shared=<分享 ID>`；`startRun({ incoming })` 把文件交给第一步的 `in.photos` / `in.files`，它们不再打开选择器。共享目录里的副本由 `FilePlatform.removeShared` 删除。

输出去向（D-119、D-120）：`FilePlatform.shareUris` / `saveToFolder` 由 `runtime/expo-share.ts` 实现，包装本地模块 `MorphShare`（`modules/morph-share/`：iOS 的 `UIActivityViewController` 和选文件夹 + `NSFileCoordinator` 复制；Android 的 `ACTION_SEND_MULTIPLE` + 模块自带的 FileProvider 和存储访问框架）。模块为 `null`（Expo Go）时分享退回 expo-sharing 逐个打开，存到文件夹退回 expo-file-system 的 `Directory.pickDirectoryAsync`。记住的文件夹（D-123）由原生模块保存（iOS 书签在 UserDefaults，Android 长期授权 + SharedPreferences），JS 只拿到文件夹名（`rememberedFolder()`）；Expo Go 里只记在内存。依赖都从参数传进来，`__tests__/expo-share-test.ts` 用假的原生模块测两条路径；动作和结果页用 `FakeFiles.shareSheets` / `folderChoice` / `folder`。

视频和音频（D-140–D-148）：`FilePlatform.media`（`MediaPlatform`，接口在 `runtime/platform.ts`，实现在 `runtime/expo-media.ts`）包装本地模块 `MorphMedia`（`modules/morph-media/`：iOS `AVAssetReader` + `AVVideoComposition` + `AVAssetWriter`、Passthrough 导出、`AVAssetImageGenerator`；Android Media3 Transformer 1.9.1 和 MediaExtractor / MediaMetadataRetriever）。JS 接口按视频 + 音频设计（`probe`、`transcode`、`trim`、`thumbnails`、`cancel`、`progress` 事件；`concat`、`waveform` 留给音频工具）。码率和分辨率在 `core/src/media.ts` 算（纯函数，Node 测试），动作在 `runtime/actions/video.ts`；处理期间屏幕不灭，进度按百分比显示，「停止」会取消原生任务。视频不复制进运行目录：`FilePlatform.adoptIntoRun` 把选择器缓存里的副本移进来、分享进来的原地使用。结果页的视频 / 音频一行是 `run/MediaRow.tsx`（expo-video 播放），剪一段是 `run/local/TrimScreen.tsx`。模块为 `null`（Expo Go）时视频动作报 `needsFullApp`；测试里 `FakeFiles.media` 是 `FakeMedia`（按码率算输出大小）。压缩 PDF（D-145）不需要原生代码：`packages/tool-pdf/src/compress.ts` 找出 JPEG / Flate 图片交给系统编码器，`runtime/actions/pdf-compress.ts` 搜索质量和缩放，压不到时用 `LocalUi.choose` 问用户，转成图片用 PDF 预览下载内容。

图片合成（拼长图、宫格、打码、水印、相纸）：排版在 `packages/tool-image`，`runtime/actions/compose.ts` 生成固定的几种绘制步骤（`DrawOp`），`runtime/skia.ts` 离屏执行。超过 GPU 画布上限会让 App 直接崩溃（不是 JS 错误），所以画布一律先经过 `surfaceScale`。文字转 PDF 和报表用 `core/src/html.ts` 的固定模板 + expo-print。

## 6. 外部能力接口（§14.2）

- AI 来源由「设置 → AI」选择（`apps/mobile/src/ai/`）：内置规则 / Morph 服务器 / 用户自带 Claude API key。规划逻辑在 `packages/planner`，服务端和 App 共用。
- `AIProvider`（已实现）：
  - mock：规则解析，离线可用（句式见 [MOCK_AI_PHRASES.md](MOCK_AI_PHRASES.md)）。
  - Claude 规划器：`packages/planner/src/planner.ts`。服务端通过 SDK 调用（`apps/api`），自带 key 时 App 通过 `fetch` 直接调用 HTTP API（`packages/planner/src/http.ts`）。模型以 JSON 回复 core 的 `Plan` 格式，服务端用 `PlanSchema` + `prepareOps` 校验，不合格时带着问题清单请求一次修正。
  - remote：`apps/mobile/src/workspace/remote-ai.ts`，App 通过 `POST /v1/plan` 调用服务端；服务不可用时返回“没有做任何修改”的拒绝，不会静默退回 mock。
- 无论来源，计划到达 App 后都会再经过 `PlanSchema` 与 `prepareOps`（§8：模型输出从不被直接信任）。
- 评测：`packages/core/src/ai/eval-cases.ts` 是 mock 与真实模型共用的评测集；`npm run eval -- --model <id>` 用真实模型跑一遍（产生少量费用）。
- 以下只约定形状，不写代码：`SyncProvider`（跨设备同步）、`StorageProvider`（云端文件）、`ExecutionProvider`（动作在本地还是云端执行）。账号与同步的设计见 [CLOUD_DESIGN.md](CLOUD_DESIGN.md)。

## 7. 计划服务（apps/api）

```
App ──POST /v1/plan {input, locale, config}──► Hono
        校验请求（≤64KB，输入 ≤500 字）→ validateWorkspace(config) → 每分钟 / 每天限额
        → Claude（系统提示词可缓存；拒答时服务端回退）→ PlanSchema + prepareOps → 必要时修正一次
        ◄── {plan} 或 {error: bad_request | invalid_config | rate_limited | daily_limit | ai_unavailable}
```

- 没有配置 `ANTHROPIC_API_KEY` 时，服务使用 mock，接口不变。
- 只监听 `127.0.0.1`，日志只记录元数据（结果类型、输入长度、耗时），不记录用户输入和配置。

## 7. 最大的 5 项工程风险

| 风险                                                             | 应对                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. 声明式 DSL 逐渐膨胀成“另一门编程语言”，难以校验，也有上架风险 | 工作流保持线性、非图灵完备；新增组件或动作必须走代码评审，进入白名单                         |
| 2. schema 演进后旧 revision 无法恢复                             | 每次升级都写 migrate 函数 + 测试；保留每个历史版本的 fixture，作为迁移回归测试               |
| 3. mock AI 让人高估真实 AI 的效果                                | 句式清单即验收口径；M3 用同一套句式做真实模型的评测集                                        |
| 4. pdf-lib 在手机上处理大文件内存不足                            | 文件大小上限（§15）；超限给出明确提示；未来交给云端处理                                      |
| 5. Expo SDK 升级频繁，可能带来破坏性变更                         | `core` 不依赖 Expo；App 层保持薄；原生工程用 CNG 重新生成；升级前跑 `expo-doctor` 和全部测试 |

## 8. 待决事项

见 [DECISIONS.md](DECISIONS.md) 的「待创始人确认」部分。
