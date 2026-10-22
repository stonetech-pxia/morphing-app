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

| 表                | 内容                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `workspace_head`  | 当前 head revision ID                                             |
| `revisions`       | 不可变快照：ID、父 ID、schemaVersion、配置 JSON、来源、摘要、时间 |
| `change_requests` | 原始输入、ops、状态、关联 revision、错误                          |
| `assets`          | 用户文件元数据与本地路径（归属 workspace）                        |
| `asset_grants`    | 工具 → 文件的授权                                                 |
| `tool_runs`       | 工作流执行记录（不含文件内容）                                    |

用户文件存放在 App 文档目录的 `assets/<id>/<文件名>`，与 revision 分开，回滚和卸载工具都不会触及。

## 5.1 工作流执行（TOOLS_DESIGN.md）

执行器在 `packages/core/src/workflow/engine.ts`：按顺序执行步骤，步骤之间传递**一个有类型的值**（images / pdf / files / zip / text，D-060），执行前再检查一次类型链和参数，支持进度、取消、运行时询问参数和扩展包确认；`tool_runs` 只记录状态和错误代码。动作契约（输入输出类型、zod 参数、参数界面元数据）在 `core/src/workflow/contract.ts` 和各工具清单里。

App 侧：`apps/mobile/src/runtime/runner.ts` 把执行器接上存储和平台；动作实现在 `runtime/actions/`，纯逻辑调用 `packages/tool-*`（tool-pdf、tool-image、tool-archive、tool-qr，Node + 真实文件测试）；平台能力（选照片 / 文件、临时文件、分享、存相册、打印）通过 `FilePlatform`（`runtime/platform.ts`）注入，App 中由 Expo 模块实现，测试中用内存实现。运行页面 `app/run/[workflowId].tsx` 显示每一步、本地操作界面（`run/local/`）和结果预览。中间结果是缓存目录 `runs/<runId>/` 里的临时文件，只有「保存」才成为用户文件（D-063）。

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

| 风险                                                             | 应对                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. 声明式 DSL 逐渐膨胀成“另一门编程语言”，难以校验，也有上架风险 | 工作流保持线性、非图灵完备；新增组件或动作必须走代码评审，进入白名单           |
| 2. schema 演进后旧 revision 无法恢复                             | 每次升级都写 migrate 函数 + 测试；保留每个历史版本的 fixture，作为迁移回归测试 |
| 3. mock AI 让人高估真实 AI 的效果                                | 句式清单即验收口径；M3 用同一套句式做真实模型的评测集                          |
| 4. pdf-lib 在手机上处理大文件内存不足                            | 文件大小上限（§15）；超限给出明确提示；未来交给云端处理                        |
| 5. Expo SDK 升级频繁，可能带来破坏性变更                         | `core` 不依赖 Expo；App 层保持薄；升级前跑 `expo-doctor` 和全部测试            |

## 8. 待决事项

见 [DECISIONS.md](DECISIONS.md) 的「待创始人确认」部分。
