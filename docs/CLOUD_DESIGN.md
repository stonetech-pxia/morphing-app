# 云端设计（M3 第二部分：账号、云端数据、服务端鉴权）

> 状态：**设计稿，尚未实现**。实现前需要创始人确认第 8 节的事项（会产生 Supabase 和托管费用）。
> 已实现的部分：服务端 AI（`apps/api`），见 [ARCHITECTURE.md](ARCHITECTURE.md) §6。

## 1. 目标

- 用户登录后，工作空间（全部版本历史）和文件在多台设备间同步，换手机不丢。
- 托管 AI 按用户计量和限额（为 §14 的付费点做准备）。
- 未登录时 App 照常离线使用（本地优先，开源版不依赖云端）。

## 2. 架构

```
App ──(Supabase Auth 登录，拿到用户 JWT)──► Supabase Auth
App ──(JWT，受 RLS 保护)───────────────────► Supabase Postgres / Storage   版本、文件元数据、文件
App ──(JWT)──► Morph API（Hono，无状态）──► Claude API                       只做 AI 计划与计量
                    └──(service role，仅服务端)──► Postgres：ai_usage 计量表
```

- 数据读写由 App 直接访问 Supabase，**隔离完全依赖行级安全（RLS）**：每条数据都属于某个用户，策略只允许 `auth.uid()` 访问自己的数据。
- Morph API 不保存工作空间数据，只验证 JWT、计量、调用模型。service role key 只在服务端。
- 本地 SQLite 仍是 App 的工作副本；云端是同步目标，而不是唯一来源（开源版可以完全不配置云端）。

## 3. 数据模型（Postgres）

| 表                | 主要字段                                                                                                            | 说明                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `workspaces`      | `id`, `owner_id → auth.users`, `head_revision_id`, `updated_at`                                                     | 每个用户一个（§6 Workspace）      |
| `revisions`       | `id`, `workspace_id`, `parent_id`, `schema_version`, `config jsonb`, `source`, `summary`, `created_at`, `device_id` | 只追加，不修改、不删除            |
| `change_requests` | `id`, `workspace_id`, `input`, `plan jsonb`, `status`, `base_revision_id`, `result_revision_id`, `error`            | 可选同步（含用户原话，见第 6 节） |
| `assets`          | `id`, `workspace_id`, `name`, `mime_type`, `size`, `sha256`, `storage_path`, `source`, `created_at`, `deleted_at`   | 文件元数据；删除为软删除          |
| `asset_grants`    | `workspace_id`, `tool_id`, `asset_id`                                                                               | 与本地语义相同                    |
| `ai_usage`        | `user_id`, `day`, `requests`, `input_tokens`, `output_tokens`                                                       | 只由 Morph API 写入               |

RLS 策略（每张表都开启）：`workspace_id in (select id from workspaces where owner_id = auth.uid())`；`workspaces` 直接按 `owner_id = auth.uid()`。`ai_usage` 对客户端只读自己的行。

**提交新版本**用一个 Postgres 函数完成，语义与本地 `commitRevision` 相同：在事务中锁定 `workspaces` 行，检查 `head_revision_id = base`，插入 revision，移动 head；不一致则返回冲突。

## 4. 同步

- 版本是不可变快照，同步就是上传本地新增的 revision、下载对方新增的 revision。
- 离线修改先记在本地，联网后按顺序推送；若云端 head 已经不是本地的 base（另一台设备也改过），**两边的版本都保留在历史里**，App 提示用户选择当前使用哪一个（选择本身是一次“恢复”，生成新版本）。不自动合并配置。
- 首次登录：把本地的全部历史和文件上传到新建的云端工作空间；如果云端已有数据，询问用户保留哪一边作为当前版本（另一边仍在历史中）。

## 5. 文件

- Supabase Storage 私有 bucket `assets`，路径 `{user_id}/{asset_id}/{name}`；Storage 策略要求路径第一段等于 `auth.uid()`。
- 保存文件后后台上传；`sha256` 用于去重和完整性校验。
- 卸载工具、恢复版本都不删除云端文件（与本地不变量一致）；删除文件是单独、需确认的操作。
- 端到端加密作为后续增强（§14 的信任卖点），首版使用 Supabase 的静态加密。

## 6. 隐私与合规（海外）

- 发给模型的内容只有界面配置和用户的一句话；文件内容、文件名不发送（已实现）。
- `change_requests.input` 含用户原话，默认**不同步**到云端，只保留在本机。
- 上线前：隐私政策（GDPR / CCPA）、App Store 隐私标签与 Google Play 数据安全表、**App 内删除账号**（Apple 审核要求）及数据导出。
- 数据区域（美国 / 欧盟）在创建 Supabase 项目时确定，之后不易迁移。

## 7. 服务端鉴权与限额

- App 请求 Morph API 时带 `Authorization: Bearer <Supabase access token>`；服务端用 Supabase 的 JWKS 验证签名和过期时间。
- 限额从“每台设备的内存计数器 + 全局花费上限”（现状，D-132、D-193）改为按用户计量：写入 `ai_usage`，按 D-192 计算额度（一次性 50 次 + 每月 20 次，只有返回修改计划才计数），用完返回 429。届时去掉客户端令牌。
- 服务只监听 `127.0.0.1`，对外经 Cloudflare 隧道（现状，D-131）。
- 需要的自动测试：两个测试用户互相读写对方数据必须失败（RLS）；伪造或过期的 JWT 被拒绝；额度用完返回 429。

## 8. 待创始人决定

| #   | 事项                            | 建议                                                                                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | 是否现在开通 Supabase，以及套餐 | 开发期用免费层，上线前再评估                                                             |
| 2   | 数据区域                        | 先确定首发市场：美国用户为主选 US，欧洲为主选 EU                                         |
| 3   | Morph API 托管位置              | 已定：先放在创始人的 Mac mini 上（D-131）                                                |
| 4   | 文件是否默认同步                | 默认同步，可在设置中关闭                                                                 |
| 5   | 免费用户的 AI 额度              | 已定（D-192）：新用户送 50 次，之后每月 20 次，用 Haiku 5.5；付费额度随定价确定（P-008） |
