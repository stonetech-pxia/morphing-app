# 配置 API key

有两种用法：

- **在 App 里直接使用（最简单）**：打开「设置 → AI」，选「我自己的 API key」，再选 provider：
  - **Anthropic（Claude）**：粘贴 key，选择模型，点「测试连接」。创建 key 和设置花费上限的步骤见下面第 1、2 节。
  - **OpenAI 兼容接口**：任意 provider，见第 7 节。

  key 只保存在这台手机的安全存储里，只发给对应的地址。

- **给本机模型转发服务使用（开发者）**：按第 3 节写进仓库根目录的 `.env`。转发服务只支持 Claude。

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

## 4. 使用与切换模型

启动模型转发服务后，终端会显示当前使用的模型（没有 key 时它不能用，App 里的内置规则不需要它）：

```bash
npm run api
```

默认模型是 `claude-haiku-5-5`（P-010）。要换模型，在 `.env` 里加一行（三个模型在评测中都是 22/22 通过）：

```
MORPH_AI_MODEL=claude-opus-5-5
```

用评测集测一个模型（会产生少量费用，Haiku 一轮约 $0.004）：

```bash
npm run eval -- --model claude-haiku-5-5
```

## 5. 大概会花多少钱

以下是 2026-10-22 用 22 个评测用例实测的平均值（系统提示词已缓存）：

| 模型              | 输入 / 输出（每百万 token） | 每次修改约 | 1000 次约 |
| ----------------- | --------------------------- | ---------- | --------- |
| Claude Haiku 5.5  | $0.10 / $0.50               | $0.0002    | $0.2      |
| Claude Sonnet 5.5 | $2 / $10                    | $0.003     | $3        |
| Claude Opus 5.5   | $4 / $20                    | $0.005     | $5        |

价格以 [官方定价](https://platform.claude.com/docs/en/about-claude/pricing) 为准。默认用 Haiku（DECISIONS P-010）。实际用量可以在 Console 的 [Usage 页面](https://platform.claude.com/usage) 查看。

## 6. 安全规则

- **key 只放在根目录的 `.env` 里**，只由服务端读取（M3 的 `apps/api`）。
- **绝不能**写进手机 App 的代码，也不能放进以 `EXPO_PUBLIC_` 开头的变量：这类变量会被打包进 App，任何人都能取出。
- **不要把 key 粘贴到聊天里**，包括发给 Claude Code。Claude Code 不会读取 `.env` 的内容，只会用第 3 节的命令检查格式。
- 怀疑泄露时：立即在 [API keys 页面](https://platform.claude.com/settings/keys) 删除这个 key，再创建一个新的。

## 7. 用其他 provider 的 key（OpenAI 兼容接口，D-241）

「设置 → AI」→「我自己的 API key」→「OpenAI 兼容接口」，依次填：

1. **Base URL**：点 provider 按钮会帮你填好，也可以自己填。App 会在后面加 `/chat/completions` 和 `/models`。

   | provider          | Base URL                                                  |
   | ----------------- | --------------------------------------------------------- |
   | OpenAI            | `https://api.openai.com/v1`                               |
   | OpenRouter        | `https://openrouter.ai/api/v1`                            |
   | DeepSeek          | `https://api.deepseek.com/v1`                             |
   | Gemini            | `https://generativelanguage.googleapis.com/v1beta/openai` |
   | Groq              | `https://api.groq.com/openai/v1`                          |
   | Ollama（本机）    | `http://localhost:11434/v1`                               |
   | LM Studio（本机） | `http://localhost:1234/v1`                                |

2. **模型名**：照 provider 文档里的写法填（OpenRouter 要带前缀，例如 `vendor/model`）。
3. 点「保存地址和模型」，再填 **key**。本地模型可以不填 key。
4. 点「测试连接」：App 会请求 `GET {Base URL}/models`（不消耗 token），检查地址、key，以及模型名在不在列表里。

要注意的：

- **只有 Claude 测试过。** 其他模型收到的说明一样，回复也要经过同样的检查和一次修正，改错了会被拦下，不会直接应用；但更容易理解错或拒绝。
- **地址必须是 `https://`**，`http://` 只能用于 `localhost`、`127.0.0.1`、`[::1]`。手机上的 `localhost` 是手机自己，所以手机连 Mac 上的 Ollama 要给它一个 https 地址（例如 Tailscale Serve、Cloudflare Tunnel 或带证书的反向代理）。iOS 模拟器里的 `localhost` 就是这台 Mac，可以直接用。
- **换地址会删掉这个 key**，免得把它发到新地址。Anthropic 的 key 和这里的 key 分开保存，切换 provider 不会把 Anthropic 的 key 发给别人。
- 发出去的内容和用 Claude 时一样：界面配置和你说的话，不包括文件和记录。它们会到你选的 provider，按那家的条款处理。
- 费用由你在那家的账号支付，建议在那边设花费上限。
