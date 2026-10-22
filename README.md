# Morph（代号）

一个只需安装一次、之后通过自然语言持续修改**同一个 App** 的界面与功能的个人软件空间。
产品需求与边界见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](PRODUCT_HANDOFF_CLAUDE_CODE.md)。

> 当前状态：**M0（仓库骨架）已完成**。App 目前只显示一个占位首页；动态界面、修改流程和 PDF 工具分别在 M1、M2 实现。进度见 [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)。

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

| 命令                     | 作用                                            |
| ------------------------ | ----------------------------------------------- |
| `npm run check`          | 依次运行下面全部检查                            |
| `npm run lint`           | ESLint                                          |
| `npm run format:check`   | Prettier 格式检查（`npm run format` 自动修复）  |
| `npm run typecheck`      | 所有工作区的 TypeScript 检查                    |
| `npm test`               | 所有工作区的测试（core 用 Vitest，App 用 Jest） |
| `npm run check:licenses` | 检查依赖许可证是否与 AGPL-3.0 兼容              |

## 目录结构

```
apps/mobile/        Expo App（Expo Router，路由在 src/app/）
packages/core/      纯 TypeScript 内核：schema、修改操作、校验、迁移、mock AI（M1 实现）
scripts/            仓库脚本（许可证检查）
docs/               架构、范围、决策、安全说明、mock AI 句式清单
```

## 许可证

[AGPL-3.0](LICENSE)。贡献者协议（CLA）待定，在接受外部贡献前确定，见 [docs/DECISIONS.md](docs/DECISIONS.md)。
