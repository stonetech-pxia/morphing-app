# Morph（代号）

一个只需安装一次、之后通过自然语言持续修改**同一个 App** 的界面与功能的个人软件空间。
产品需求与边界见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](PRODUCT_HANDOFF_CLAUDE_CODE.md)。

> 当前状态：**M0–M2 已完成，M3 的真实 AI 已完成**（账号与云端数据只有设计）。进度与已知限制见 [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)。

## 试一试

1. 首页已经有图片、PDF、扫描、文字识别和二维码（D-104）；「工具」里还能添加翻译、压缩包、文字、报表。
2. 打开 PDF → 开始 → 选择两个以上 PDF → 确认文件名 → 得到合并结果，可分享 / 导出。
3. 点「AI 修改」，输入：`把首页改成文件工作台，导航栏只保留首页、工具、设置` → 在「现在 / 改完后」之间对比预览 → 确认修改。
4. 在 PDF 工具页点右上角「AI」，输入：`把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名` → 确认修改后再合并一次。
5. 「设置 → 改动记录」回到之前任何时候的样子；或在修改后的提示条上点「撤销」。
6. 让 AI 搭一个能记东西的页面：`新建一个记账页面` → 在页面上记几笔，统计会更新；AI 只改界面，读不到你记的内容。
7. 加图片和格式：`在首页顶部加一张横幅图片` → 点图片位从相册选照片（AI 看不到照片）；`首页加一段介绍，用粗体强调重点，再列三个要点`；`把首页图标换成🏡`。
8. 再试试改样式和布局：`字体大一点，去掉阴影`、`新建一个叫「记账」的页面`、`把 AI 入口删掉`（之后从「设置 → 修改这个 App」进入）。
9. 翻译（开发版）：「工具」里添加「翻译」→「翻译照片里的文字」；或在「快捷操作 → 现成的」里添加「截图翻译」「外文 PDF 翻成中文」。在本机翻译（iPhone 用系统翻译，需要 iOS 18；Android 用 Google ML Kit，每种语言第一次用时下载约 30 MB），只出纯文字，用来看懂意思，正式文件请找专业翻译。对 AI 说「把这份合同翻译成英文」会做一个翻译快捷操作，AI 自己不会给出译文。
10. 分享到 Morph（开发版）：在「照片」或「文件」里选几张照片或 PDF → 分享 → Morph → 收件页面列出能处理这些文件的工作流，点一个运行（例如「合并 PDF」），或者「存到 Morph 文件」。文件只在本机处理。

默认风格「Clay」沿用 Docudis 的设计 token（沙色背景、陶土橙主色、Sora / Karla 字体、22pt 圆角）。AI 能修改的范围见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-固定内核与可变层5)。

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
- **iOS 模拟器**：安装 Xcode（含 iOS 模拟器和 CocoaPods 能用的命令行工具），并让命令行使用它（只需一次，需要输入密码）：
  ```bash
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  ```
- 不需要 Apple 账号：开发版在本机编译，装进模拟器不用签名。

App 是**开发版构建**（expo-dev-client，D-084），不再用 Expo Go 打开：扫描和文字识别用 iOS 自带的 Vision，Expo Go 里没有这个原生模块（在 Expo Go 里仍能运行，扫描和识别会退回下载扩展包）。

### 2. 安装依赖

```bash
npm install
```

### 3. 编译并启动

```bash
npm run ios
```

第一次会运行 `expo prebuild` 生成 `apps/mobile/ios/`（不进 git，随时可以删掉重新生成；里面有主 App 和分享扩展 `MorphShare` 两个 target）、安装 CocoaPods、编译开发版并装进模拟器，再启动开发服务器，大约要几分钟；以后只改 JS 不用重新编译。改了原生代码（`apps/mobile/modules/`、`apps/mobile/plugins/`）、原生依赖或 app.json 后要再运行一次 `npm run ios`（改了 `plugins/` 时先删掉 `apps/mobile/ios/`）。CocoaPods 报 `Unicode Normalization not appropriate for ASCII-8BIT` 时，终端的语言环境不是 UTF-8，先 `export LANG=en_US.UTF-8`。

已经装过开发版、只想启动开发服务器时：

```bash
npm start
```

然后在模拟器里打开 Morph。如果模拟器连不上局域网 IP（提示 “The request timed out”），改用 localhost：

```bash
npm start -- --localhost
```

```bash
xcrun simctl openurl booted "exp+morph://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

真机需要 Apple 开发者账号签名（`npx expo run:ios --device`），目前还没有做。

**Android**：需要 JDK 17 和 Android SDK（设置 `ANDROID_HOME`），打开一台模拟器或用 USB 连上开启了调试的手机，然后：

```bash
npm run android
```

第一次会生成 `apps/mobile/android/`（不进 git）并用 Gradle 编译，大约要几分钟。文字识别用 Google ML Kit（模型打包进 App），拍照扫描用 ML Kit 文档扫描，需要手机上有 Google Play 服务（D-087）。

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
