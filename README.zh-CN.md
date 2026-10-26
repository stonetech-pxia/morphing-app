# Morph（代号）

一个只需安装一次、之后通过自然语言持续修改**同一个 App** 的界面与功能的个人软件空间。
产品需求与边界见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](PRODUCT_HANDOFF_CLAUDE_CODE.md)。

> 当前状态：**M0–M2 已完成，M3 的真实 AI 已完成**（账号与云端数据只有设计）。进度与已知限制见 [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)。

[English](README.md) · [常见疑问](#常见疑问)

## 两种用法

|            | TestFlight 测试版                               | 自己编译                                                                                                                                                                         |
| ---------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装       | 加入 TestFlight（链接上线后放在这里），只有 iOS | 按下面的[启动本地 demo](#启动本地-demo不需要任何付费账号或-api-key) 编译，iOS 和 Android 都可以                                                                                  |
| AI 修改    | 经官方转发服务器调用 Claude，有免费体验额度     | 默认用离线的内置规则；或在「设置 → AI」填自己的 Claude API key，从手机直连 Anthropic；也可以自己部署转发服务（`npm run api`，编译时把 `EXPO_PUBLIC_MORPH_API_URL` 设成你的地址） |
| 你的请求   | **测试期间会被保存，用来改进项目**（见下）      | 不经过我们的服务器                                                                                                                                                               |
| 文件和记录 | 只在手机上处理，不发送                          | 只在手机上处理，不发送                                                                                                                                                           |

**TestFlight 测试期间收集什么**：每次「AI 修改」时，App 发给转发服务器的内容会被保存下来，包括规划提示词、当前的界面配置、你说的话（包括同一次修改里之前说的）和模型的回复，以及设备 id 的哈希、平台、版本和时间。用途只有一个：找出 AI 听不懂或改错的说法，改进提示词和评测集。
**不收集**：文件内容和文件名、你在页面里记录的数据、照片。界面配置里有你自己写的标题和文字，请不要在对 AI 说的话里写敏感信息。不想被收集，请自己编译并使用自己的 API key。

## 试一试

1. 首页已经有图片、PDF、视频、扫描、文字识别和二维码（D-104、D-146）；「工具」里还能添加翻译、压缩包、文字、报表。
2. 打开 PDF → 开始 → 选择两个以上 PDF → 确认文件名 → 得到合并结果，可分享 / 导出。
3. 点「AI 修改」，输入：`把首页改成文件工作台，导航栏只保留首页、工具、设置` → 在「现在 / 改完后」之间对比预览 → 确认修改。
4. 在 PDF 工具页点右上角「AI」，输入：`把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名` → 确认修改后再合并一次。
5. 「设置 → 改动记录」回到之前任何时候的样子；或在修改后的提示条上点「撤销」。
6. 让 AI 搭一个能记东西的页面：`新建一个记账页面` → 在页面上记几笔，统计会更新；AI 只改界面，读不到你记的内容。
7. 加图片和格式：`在首页顶部加一张横幅图片` → 点图片位从相册选照片（AI 看不到照片）；`首页加一段介绍，用粗体强调重点，再列三个要点`；`把首页图标换成🏡`。
8. 再试试改样式和布局：`字体大一点，去掉阴影`、`新建一个叫「记账」的页面`、`把 AI 入口删掉`（之后从「设置 → 修改这个 App」进入）。
9. 分享到 Morph（开发版）：在「照片」或「文件」里选几张照片、视频或 PDF → 分享 → Morph → 收件页面列出能处理这些文件的快捷操作，点一个运行（例如「合并 PDF」「视频太大发不出去」），或者「存到 Morph 文件」。文件只在本机处理。
10. 视频太大发不出去（开发版）：打开「视频」→「压缩视频」→ 选视频 → 选「20 MB」→ 得到哪里都能放的 MP4，可以播放、分享、存到相册；「剪一段」拖两边的把手选要留下的部分。PDF 太大传不上去：PDF 工具里的「压缩 PDF」，文字仍可选中；压不到时会先问你要不要把页面转成图片。处理视频时请留在 Morph 里。
11. 翻译（开发版）：「工具」里添加「翻译」→「翻译照片里的文字」；或在「快捷操作 → 现成的」里添加「截图翻译」「外文 PDF 翻成中文」。在本机翻译（iPhone 用系统翻译，需要 iOS 18；Android 用 Google ML Kit，每种语言第一次用时下载约 30 MB），只出纯文字，用来看懂意思，正式文件请找专业翻译。对 AI 说「把这份合同翻译成英文」会做一个翻译快捷操作，AI 自己不会给出译文。

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

第一个启动本机的模型转发服务，第二个启动 App 并让它经这个服务调用 Claude（提示词在 App 里写，D-193）。

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
apps/api/           模型转发：加上 API key 把 App 写好的请求转给 Claude（只在服务端持有 key）
packages/planner/   Claude 规划器：提示词、校验与修正；服务端与 App（自带 key）共用
packages/core/      纯 TypeScript 内核：schema、修改操作、校验、迁移、mock AI、内置工具清单
packages/tool-pdf/  PDF 合并、压缩等（pdf-lib）
scripts/            仓库脚本（许可证检查）
docs/               架构、范围、决策、安全说明、mock AI 句式清单
```

## 常见疑问

**和直接让 ChatGPT / Claude 处理文件有什么不同？**
它们擅长理解内容（总结合同、整理表格），Morph 不做这些。Morph 做的是处理文件：合并、压缩、扫描、转换都在手机上用固定的工具完成，文件不上传，结果每次都一样；常做的事可以让 AI 搭成一个快捷操作，以后从分享菜单点一下就完成，不用每次重新上传、重新说明。AI 只在搭的时候用一次，日常操作不调用 AI。

**AI 能看到我的文件吗？**
不能。发给模型的只有界面配置和你说的那句话，文件内容、文件名和你记录的数据都不在其中，详见 [docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md)。用官方服务器时请求会经过我们（测试期间会保存，见[两种用法](#两种用法)）；用自己的 key 时直连 Anthropic。

**AI 什么都能改吗？**
不能。AI 只能在固定内核允许的范围里改界面、页面和快捷操作（见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-固定内核与可变层5)），不会生成任意代码。超出范围的要求会被拒绝，这时可以点「把这个需求告诉我们」。

**为什么只支持 Claude？能用本地模型吗？**
目前只支持 Claude（Anthropic API）。提示词和校验都在 App 里（`packages/planner`），换一种模型需要重新跑评测；本地模型和 OpenAI 兼容接口还没有做，需要的话请在 issue 里说明。

**代码是 AI 写的吗？**
是。大部分代码由 Claude Code 编写，一部分由 Codex 编写；产品决策、审核和测试由作者负责，每个决定都记在 [docs/DECISIONS.md](docs/DECISIONS.md)。`npm run check` 包含 lint、类型检查和测试，`npm run eval` 用评测集检验真实模型。

**以后会收费或者闭源吗？**
代码以 AGPL-3.0 开源，已经公开的代码不会收回；本机的文件工具不依赖我们的服务器。官方 App 以后可能对官方服务器提供的 AI 额度收费（定价未定），自己编译、使用自己的 key 不受影响。

**为什么不接受 Pull Request？**
官方 App 通过应用商店分发，合并外部代码前需要先确定贡献者许可协议（CLA），见 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提 issue。

**为什么叫 Morph？**
这是代号，和其他项目重名，正式名字还没定。

## 许可证

[AGPL-3.0](LICENSE)。目前暂不接受外部贡献（Pull Request），欢迎通过 issue 反馈问题和建议，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
