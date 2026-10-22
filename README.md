# Morph（代号）

一个只需安装一次、之后通过自然语言持续修改**同一个 App** 的界面与功能的个人软件空间。
产品需求与边界见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](PRODUCT_HANDOFF_CLAUDE_CODE.md)。

> 当前状态：**M0–M2 已完成，M3 的真实 AI 已完成**（账号与云端数据只有设计）。进度与已知限制见 [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)。

## 试一试

1. 「工具」→ 安装 PDF；首页出现 PDF 入口。
2. 打开 PDF → 开始 → 选择两个以上 PDF → 确认文件名 → 得到合并结果，可分享 / 导出。
3. 点「AI 修改」，输入：`把首页改成文件工作台，导航栏只保留首页、工具、设置` → 查看修改前 / 后预览 → 应用。
4. 在 PDF 工具页点右上角「AI」，输入：`把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名` → 应用后再合并一次。
5. 点浮动的「历史」按钮，恢复任意旧版本；或在修改后的提示条上点「撤销」。

AI 能听懂的句式见 [docs/MOCK_AI_PHRASES.md](docs/MOCK_AI_PHRASES.md)（mock AI 是规则解析器，不是语言模型）。

### 使用真实 AI（可选）

先按 [docs/API_KEY_SETUP.md](docs/API_KEY_SETUP.md) 配置 Claude API key，然后开两个终端：

```bash
npm run api
```

```bash
npm run ios:ai
```

第一个启动本机计划服务，第二个启动 App 并让它通过计划服务调用 Claude。

也可以不启动服务：在 App 的「设置 → AI」里选「我自己的 Claude API key」，粘贴 key 即可从手机直接调用 Claude。默认使用离线的内置规则。

## 启动本地 demo（不需要任何付费账号或 API key）

### 1. 准备环境

- Node.js 22 或 24（自带 npm）
- 二选一：
  - **iOS 模拟器**：安装 Xcode，并让命令行使用它（只需一次，需要输入密码）：
    ```bash
    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    ```
  - **自己的手机**：在 App Store / Google Play 安装 **Expo Go**，手机与电脑连同一个 Wi-Fi。

### 2. 安装依赖

```bash
npm install
```

### 3. 启动

```bash
npm run ios
```

会启动开发服务器，并在 iOS 模拟器中通过 Expo Go 打开 App。用真机时运行 `npm start`，再用手机相机扫描终端里的二维码。

如果模拟器提示 “The request timed out”，说明它无法通过局域网 IP 访问开发服务器，可改用 localhost：

```bash
npm run ios -- --localhost
```

## 常用命令

| 命令                                       | 作用                                            |
| ------------------------------------------ | ----------------------------------------------- |
| `npm run check`                            | 依次运行下面全部检查                            |
| `npm run lint`                             | ESLint                                          |
| `npm run format:check`                     | Prettier 格式检查（`npm run format` 自动修复）  |
| `npm run typecheck`                        | 所有工作区的 TypeScript 检查                    |
| `npm test`                                 | 所有工作区的测试（core 用 Vitest，App 用 Jest） |
| `npm run check:licenses`                   | 检查依赖许可证是否与 AGPL-3.0 兼容              |
| `npm run eval -- --model claude-haiku-5-5` | 用评测集测试真实模型（产生少量 API 费用）       |

## 目录结构

```
apps/mobile/        Expo App（Expo Router，路由在 src/app/）
apps/api/           计划服务：调用 Claude 生成修改计划（只在服务端持有 API key）
packages/planner/   Claude 规划器：提示词、校验与修正；服务端与 App（自带 key）共用
packages/core/      纯 TypeScript 内核：schema、修改操作、校验、迁移、mock AI、内置工具清单
packages/tool-pdf/  PDF 合并（pdf-lib）
scripts/            仓库脚本（许可证检查）
docs/               架构、范围、决策、安全说明、mock AI 句式清单
```

## 许可证

[AGPL-3.0](LICENSE)。目前暂不接受外部贡献（Pull Request），欢迎通过 issue 反馈问题和建议，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
