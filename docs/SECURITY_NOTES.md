# 安全说明

原则见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](../PRODUCT_HANDOFF_CLAUDE_CODE.md) §8。本文件记录当前实际状态与待办。

## 不可违反的规则

1. 手机端不执行任何 AI 生成的代码；AI 只输出修改操作，必须经过 `core` 的 schema、白名单、权限和受保护元素校验。
2. 工作流只能调用已登记的动作；不支持 `eval`、shell、任意网络请求或动态加载代码。
3. **我们的**模型密钥、服务角色密钥只在服务端。手机端代码和 `EXPO_PUBLIC_*` 变量中不得出现任何密钥。
   例外：用户在「设置 → AI」里填写的**自己的** Claude API key，只保存在该设备的安全存储中（不同步、不随备份迁移），只发送给 api.anthropic.com，不写入日志，界面只显示末四位。
4. 回滚和卸载工具都不删除用户文件；删除文件是单独操作，需要用户确认。
5. 把文件内容发给第三方 AI 前必须告知并取得授权；发给模型的 workspace 摘要尽量少，文件名默认脱敏。
6. 执行记录（`tool_runs`）和日志中不写入文件内容。
7. **AI 读不到用户记录**（D-036）：记录不在配置里；AI 的输入只有配置和用户这句话；修改操作里没有读写记录的操作。有端到端测试检查发给模型的完整请求（DATA_DESIGN.md §10）。

## 当前状态（M3 第一部分 + 自带 key）

- Claude API key 只在仓库根目录 `.env`（已被 git 忽略），只由计划服务（`apps/api`）读取；手机端不持有任何密钥，只知道服务地址（`EXPO_PUBLIC_MORPH_API_URL`，不是秘密）。
- 发给模型的只有界面配置和用户的一句话；文件内容和文件名、用户记录的内容都不发送（它们都不在配置中）。计划服务的日志不记录用户输入。
- 计划服务只监听本机、有请求体大小 / 输入长度 / 每分钟 / 每天限额；模型输出在服务端和 App 端各校验一次。
- PDF 合并等文件处理全部在本机完成，不上传。
- 修改流程：模型（目前是 mock）输出先经过 `PlanSchema` 解析，再经过 `prepareOps`（结构、引用、受保护元素、权限、数据流校验），通过后才能预览和保存。测试见 `packages/core/src/*.test.ts`。
- 文件访问：工具只能读取 `AssetGrant` 授权给它的文件；卸载工具时撤销授权，文件保留。执行记录只保存状态和错误代码，不保存文件内容。
- 文件大小上限：单个 50 MB，单次合计 100 MB（`FILE_LIMITS`）。`.env*` 已加入 `.gitignore`（`.env.example` 除外）。
- **npm audit**：报告约 40 个 moderate/high 漏洞，全部来自 Expo CLI 等开发与构建工具的间接依赖（例如 `braces`、`node-forge`、`sprintf-js`），不会打包进 App。`npm audit fix --force` 会降级或破坏 Expo 依赖，因此不执行；每次升级 Expo SDK 后重新检查。
- **安装脚本**：npm 默认未执行 `fsevents`、`unrs-resolver`、`@parcel/watcher` 的安装脚本（npm 的 allowScripts 机制）。目前 lint、测试和打包都不受影响；如果以后出现相关问题，先审查脚本内容再批准。
- **许可证**：`npm run check:licenses` 确认全部依赖与 AGPL-3.0 兼容。

## 待办

- 账号上线时（见 [CLOUD_DESIGN.md](CLOUD_DESIGN.md)）：JWT 鉴权、Supabase RLS 与两用户隔离测试、按用户计量、隐私政策（GDPR / CCPA）、App 内删除账号与数据导出。
