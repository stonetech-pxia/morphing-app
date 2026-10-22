# 配置 Claude API key

M3 接入真实 AI 时需要一个 Claude API key。**没有 key 时 App 照常工作**，使用 mock AI（规则解析器）。

> 不能用 Claude Pro/Max 订阅代替 API key：官方明确不允许把 claude.ai 登录或订阅额度用于自己开发的产品（见 [Agent SDK 文档](https://code.claude.com/docs/en/agent-sdk/overview)）。API 按用量计费，开发阶段花费很低（见第 4 节）。

## 1. 创建 key

1. 打开 [Claude Console](https://platform.claude.com/) 并登录（没有账号就注册），按页面提示添加付款方式。
2. 进入 [API keys 页面](https://platform.claude.com/settings/keys)，点 **Create key**：
   - **名字**：例如 `morph-dev`。
   - **过期时间**：建议选一个期限（例如 90 天），到期再换新的。
   - **Linked account**：选你自己（个人开发用）。
   - **Workspace**：选一个工作区（选 `Default` 即可）。**一定要选**：没有绑定工作区的 key，每次请求都要额外带工作区参数。
3. 复制 key。它以 `sk-ant-` 开头，**只显示这一次**，丢了只能重新创建。

## 2. 设置花费上限（强烈建议）

进入 [Billing 页面](https://platform.claude.com/settings/billing)，在 **Spend limits** 里点 **Set limit**，填一个开发期上限，例如 **$10/月**。

达到上限后，请求会被拒绝，不会继续扣费。到下个月或调高上限后恢复。App 会自动退回 mock AI。

## 3. 把 key 放进项目

在仓库根目录执行（只需一次）：

```bash
cp .env.example .env
```

用编辑器打开根目录的 `.env`，把 key 填在等号后面，不要加引号或空格：

```
ANTHROPIC_API_KEY=sk-ant-api03-……
```

检查是否填好。这条命令只检查格式，不会显示 key：

```bash
grep -q '^ANTHROPIC_API_KEY=sk-ant-' .env && echo "已填好" || echo "还没填好"
```

检查它不会被提交到 git：

```bash
git check-ignore -q .env && echo "安全：不会被提交" || echo "危险：会被提交，先别提交"
```

## 4. 大概会花多少钱

一次“修改 App”的请求，约 3,000–5,000 个输入 token 加几百个输出 token：

| 模型              | 输入 / 输出（每百万 token） | 每次修改约 | 1000 次约 |
| ----------------- | --------------------------- | ---------- | --------- |
| Claude Haiku 5.5  | $0.10 / $0.50               | $0.001     | $1        |
| Claude Sonnet 5.5 | $2 / $10                    | $0.02–0.03 | $20–30    |
| Claude Opus 5.5   | $4 / $20                    | $0.03–0.06 | $30–60    |

价格以 [官方定价](https://platform.claude.com/docs/en/about-claude/pricing) 为准。最终用哪个模型，用句式测试集实测后再定（DECISIONS P-010）。实际用量可以在 Console 的 [Usage 页面](https://platform.claude.com/usage) 查看。

## 5. 安全规则

- **key 只放在根目录的 `.env` 里**，只由服务端读取（M3 的 `apps/api`）。
- **绝不能**写进手机 App 的代码，也不能放进以 `EXPO_PUBLIC_` 开头的变量：这类变量会被打包进 App，任何人都能取出。
- **不要把 key 粘贴到聊天里**，包括发给 Claude Code。Claude Code 不会读取 `.env` 的内容，只会用第 3 节的命令检查格式。
- 怀疑泄露时：立即在 [API keys 页面](https://platform.claude.com/settings/keys) 删除这个 key，再创建一个新的。
