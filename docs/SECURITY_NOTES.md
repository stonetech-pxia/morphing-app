# 安全说明

原则见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](../PRODUCT_HANDOFF_CLAUDE_CODE.md) §8。本文件记录当前实际状态与待办。

## 不可违反的规则

1. 手机端不执行任何 AI 生成的代码；AI 只输出修改操作，必须经过 `core` 的 schema、白名单、权限和受保护元素校验。
2. 工作流只能调用已登记的动作；不支持 `eval`、shell、任意网络请求或动态加载代码。
3. 模型密钥、服务角色密钥只在服务端（M3）。手机端代码和 `EXPO_PUBLIC_*` 变量中不得出现任何密钥。
4. 回滚和卸载工具都不删除用户文件；删除文件是单独操作，需要用户确认。
5. 把文件内容发给第三方 AI 前必须告知并取得授权；发给模型的 workspace 摘要尽量少，文件名默认脱敏。
6. 执行记录（`tool_runs`）和日志中不写入文件内容。

## 当前状态（M2）

- 没有任何密钥，也没有任何网络请求；所有处理（含 PDF 合并）都在本机完成。
- 修改流程：模型（目前是 mock）输出先经过 `PlanSchema` 解析，再经过 `prepareOps`（结构、引用、受保护元素、权限、数据流校验），通过后才能预览和保存。测试见 `packages/core/src/*.test.ts`。
- 文件访问：工具只能读取 `AssetGrant` 授权给它的文件；卸载工具时撤销授权，文件保留。执行记录只保存状态和错误代码，不保存文件内容。
- 文件大小上限：单个 50 MB，单次合计 100 MB（`FILE_LIMITS`）。`.env*` 已加入 `.gitignore`（`.env.example` 除外）。
- **npm audit**：报告约 40 个 moderate/high 漏洞，全部来自 Expo CLI 等开发与构建工具的间接依赖（例如 `braces`、`node-forge`、`sprintf-js`），不会打包进 App。`npm audit fix --force` 会降级或破坏 Expo 依赖，因此不执行；每次升级 Expo SDK 后重新检查。
- **安装脚本**：npm 默认未执行 `fsevents`、`unrs-resolver`、`@parcel/watcher` 的安装脚本（npm 的 allowScripts 机制）。目前 lint、测试和打包都不受影响；如果以后出现相关问题，先审查脚本内容再批准。
- **许可证**：`npm run check:licenses` 确认全部依赖与 AGPL-3.0 兼容。

## 待办

- M3：服务端鉴权、Supabase RLS、用户隔离测试、超时与配额、隐私政策（GDPR / CCPA）、App 内删除账号。
