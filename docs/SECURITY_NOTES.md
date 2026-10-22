# 安全说明

原则见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](../PRODUCT_HANDOFF_CLAUDE_CODE.md) §8。本文件记录当前实际状态与待办。

## 不可违反的规则

1. 手机端不执行任何 AI 生成的代码；AI 只输出修改操作，必须经过 `core` 的 schema、白名单、权限和受保护元素校验。
2. 工作流只能调用已登记的动作；不支持 `eval`、shell、任意网络请求或动态加载代码。
3. 模型密钥、服务角色密钥只在服务端（M3）。手机端代码和 `EXPO_PUBLIC_*` 变量中不得出现任何密钥。
4. 回滚和卸载工具都不删除用户文件；删除文件是单独操作，需要用户确认。
5. 把文件内容发给第三方 AI 前必须告知并取得授权；发给模型的 workspace 摘要尽量少，文件名默认脱敏。
6. 执行记录（`tool_runs`）和日志中不写入文件内容。

## 当前状态（M0）

- 没有任何密钥、网络请求或用户数据处理。`.env*` 已加入 `.gitignore`（`.env.example` 除外）。
- **npm audit**：报告约 40 个 moderate/high 漏洞，全部来自 Expo CLI 等开发与构建工具的间接依赖（例如 `braces`、`node-forge`、`sprintf-js`），不会打包进 App。`npm audit fix --force` 会降级或破坏 Expo 依赖，因此不执行；每次升级 Expo SDK 后重新检查。
- **安装脚本**：npm 默认未执行 `fsevents`、`unrs-resolver`、`@parcel/watcher` 的安装脚本（npm 的 allowScripts 机制）。目前 lint、测试和打包都不受影响；如果以后出现相关问题，先审查脚本内容再批准。
- **许可证**：`npm run check:licenses` 确认全部依赖与 AGPL-3.0 兼容。

## 待办

- M1：校验器拒绝不合法或越权的修改操作，并有测试覆盖；渲染失败自动回退。
- M2：`AssetGrant` 授权检查；文件大小上限；权限被拒时有明确提示。
- M3：服务端鉴权、Supabase RLS、用户隔离测试、超时与配额、隐私政策（GDPR / CCPA）、App 内删除账号。
