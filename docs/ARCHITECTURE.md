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
│ packages/tool-pdf（M2）  pdf-lib 合并实现（清单在 core/src/tools）  │
├───────────────────────────────────────────────────────────────┤
│ apps/api（M3 创建）  Hono + 真实 AIProvider + Supabase              │
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

受保护元素（§5.1）：AI 修改入口、设置/历史/撤销与恢复入口必须始终可达，由 `core` 的校验器强制执行。

## 3. 修改流程（§7D）

```
用户输入
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

## 5.1 工作流执行（M2）

`apps/mobile/src/runtime/runner.ts` 是唯一执行动作的地方：按顺序执行步骤，步骤之间通过固定数据槽（files → document → fileName → savedFile）传递数据。平台能力（选择文件、读写、分享）通过 `FilePlatform` 注入，App 中由 Expo 模块实现，测试中用内存实现 + 真实 PDF。

## 6. 外部能力接口（§14.2）

- `AIProvider`：M1 实现 mock 版本（规则解析，句式见 [MOCK_AI_PHRASES.md](MOCK_AI_PHRASES.md)）。M3 增加服务端的真实模型版本，输出同样经过 `core` 校验。
- 以下只约定形状，不写代码：`SyncProvider`（跨设备同步）、`StorageProvider`（云端文件）、`ExecutionProvider`（动作在本地还是云端执行）。

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
