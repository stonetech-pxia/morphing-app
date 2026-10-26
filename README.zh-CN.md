# Morph（代号）

一个只需安装一次、之后通过自然语言持续修改**同一个 App** 的界面与功能的手机 App。自带一套文件工具（PDF、图片、视频、音频、扫描、文字识别、二维码、翻译），都在手机上处理。

[English](README.md)（最完整的说明，包括自建服务器、环境变量、目录结构）· [常见疑问](#常见疑问)

> **当前状态：早期。** App、文件工具和真实 AI（经转发服务器或用自己的 key）在 iOS 模拟器和 Android 真机上能用；部分功能只有自动化测试，还没在真机上试过。还没有 TestFlight 和 App Store 版本，也还没有用户。账号和云端同步只有设计。进度与已知限制见 [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)，产品需求见 [PRODUCT_HANDOFF_CLAUDE_CODE.md](PRODUCT_HANDOFF_CLAUDE_CODE.md)。

## 两种用法

|            | TestFlight 测试版                               | 自己编译                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装       | 加入 TestFlight（链接上线后放在这里），只有 iOS | 按下面的[自己编译](#自己编译)装进 iOS 模拟器或 Android 手机                                                                                                                                                                                                                  |
| AI 修改    | 经官方转发服务器调用 Claude，有免费体验额度     | 默认用离线的内置规则；或在「设置 → AI」填任意 provider 的 key（Anthropic，或任意 OpenAI 兼容接口：OpenAI、OpenRouter、DeepSeek、Gemini、Groq、Ollama、LM Studio 等），从手机直连；也可以自己部署转发服务（`npm run api`，编译时把 `EXPO_PUBLIC_MORPH_API_URL` 设成你的地址） |
| 你的请求   | **测试期间会被保存，用来改进项目**（见下）      | 不经过我们的服务器                                                                                                                                                                                                                                                           |
| 文件和记录 | 只在手机上处理，不发送                          | 只在手机上处理，不发送                                                                                                                                                                                                                                                       |

**TestFlight 测试期间收集什么**：每次「AI 修改」时，App 发给转发服务器的内容会被保存下来，包括规划提示词、当前的界面配置、你说的话（包括同一次修改里之前说的）和模型的回复，以及设备 id 的哈希、平台、版本和时间。用途只有一个：找出 AI 听不懂或改错的说法，改进提示词和评测集。
**不收集**：文件内容和文件名、你在页面里记录的数据、照片。界面配置里有你自己写的标题和文字，请不要在对 AI 说的话里写敏感信息。不想被收集，请自己编译并使用自己的 API key。

## 能做什么

- **文件工具，文件不出手机**：
  - **PDF**：合并、拆分、压缩、加页码、加密码 / 去掉密码（iOS）、填表、签回表格、Word / Excel / PPT 转 PDF（Android 只能转 Word）；扫描的 PDF 会带上可搜索的文字。
  - **图片**：证件照和证件照打印、去背景、调整、标注、打码、加水印、拼长图。
  - **视频**：压到指定大小（发不出去时）、剪一段、拼接、截一帧、去掉声音、换背景音乐、旋转、裁成指定比例、加速或慢放、导出 SRT 字幕、转 GIF。
  - **音频**：录音、语音转文字、压小、转格式（含 MP3）、剪一段、几段合成一段、提取视频里的声音、人声降噪、调整音量。
  - **扫描、文字识别、二维码、翻译、压缩包、文字、报表。**
- **分享和收件页面**：把照片、视频、PDF 分享给 Morph（或从首页的按钮打开），收件页面显示文件，并推荐最多 5 个合适的快捷操作，例如几份 PDF 推荐「多份材料合一」，一个视频推荐「视频太大发不出去」，点「运行」就完成。结果可以分享、存到文件夹、接着处理，或者合成一个新的快捷操作。
- **说一句话改 App**：外观的修改先进草稿，可以接着改、退一步、应用或离开；功能的修改（快捷操作、工具、数据表）直接保存，可以撤销。每个版本都在改动记录里。
- **长按编辑**：长按页面上的组件可以选中、拖动排序，或者打开编辑面板。
- **你记的数据 AI 看不到**：页面可以把记账、记录存进本机的数据表，AI 只改界面，读不到内容。
- **中文、英文、法语**，跟随系统语言。

## 试一试

下面的例句用真实 AI 都能理解；用离线内置规则时，请用 [docs/MOCK_AI_PHRASES.md](docs/MOCK_AI_PHRASES.md) 里的句式（内置规则是规则解析器，不是语言模型）。

1. **第一次打开**：看完介绍页，首页是空的，底部只有「首页 · AI 修改 · 设置」。新手引导第 1 步给一句话「加入「打开相册」和「打开文件」按钮」，发送后首页出现这两个按钮（「跳过引导」也会加上）；第 2 步请你打开一个文件。可以在设置里「重新看新手引导」。
2. **处理文件**：点「打开文件」选几份 PDF → 收件页面推荐「多份材料合一」等快捷操作 → 点「运行」。也可以在「照片」或「文件」里分享给 Morph。结果页可以「分享」「存到文件夹」「接着处理」「再来一次」。
3. **打开工具**：「设置 → 工具」列出已装的工具（预装 PDF、图片、视频、扫描、文字识别、二维码；点「添加」还能加音频、翻译、压缩包、文字、报表）。PDF →「打开」→ 点「合并 PDF」→ 选 2–20 个 PDF → 确认文件名。
4. **改外观**：点「AI 修改」，输入 `字体大一点，去掉阴影`。修改先进草稿，底部是「修改 / 退一步 / 应用 / 离开」，点「应用」才生效。
5. **加功能**：输入 `新建一个记账页面`，先建好「账目」数据表并提示「现在就记一笔」，页面在下一步做好。记录在「设置 → 数据」里，AI 读不到。
6. **改工具**：在工具页点右上角 ✨，输入 `把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名`。
7. **更多界面修改**：`在首页顶部加一张横幅图片`（再点图片位从相册选照片，AI 看不到照片）、`把首页图标换成🏡`、`新建一个叫「记账」的页面`、`把 AI 入口删掉`（之后从「设置 → 修改这个 App」进入）。
8. **随时撤销**：「设置 → 改动记录」回到之前任何版本（会先确认），或者在修改后的提示条上点「撤销」。
9. **视频太大发不出去**：视频 →「压缩视频」→ 选视频 → 选大小（默认 20 MB）和画质 → 得到哪里都能放的 MP4，可以播放、分享、存到相册；「剪一段」拖开始和结束的把手。iOS 上处理视频时请留在 Morph 里；Android 会在后台继续，并显示通知。
10. **PDF 太大传不上去**：PDF →「压缩 PDF」，文字仍可选中；压不到时会先问你要不要把页面转成图片。
11. **翻译**：「设置 → 工具」添加「翻译」→「翻译照片里的文字」；「设置 → 快捷操作」（Morph 可以做什么）里还有「截图翻译」「外文 PDF 翻成中文」。在本机翻译（iPhone 用系统翻译，需要 iOS 18；Android 用 Google ML Kit，每种语言第一次用时下载约 30 MB），只出纯文字，用来看懂意思，正式文件请找专业翻译。对 AI 说「把这份合同翻译成英文」会做一个翻译快捷操作，AI 自己不会给出译文。
12. **AI 做不到时**会直接说明，并提供「把这个需求告诉我们」，只发送这一句话。

AI 能修改的范围见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-固定内核与可变层5)。

## 自己编译

不需要任何付费账号或 API key；没填 key 时 AI 修改用离线的内置规则。

### 1. 准备环境

- Node.js 22.12 以上或 24（自带 npm）；跑 `npm run check` 还需要 C 编译器（`cc`）
- **iOS 模拟器**：安装 Xcode（含 iOS 模拟器和命令行工具），并让命令行使用它（只需一次，需要输入密码）：
  ```bash
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  ```
  不需要 Apple 账号：开发版在本机编译，装进模拟器不用签名。
- **Android**：JDK 17 和 Android SDK（设置 `ANDROID_HOME`），打开一台模拟器或用 USB 连上开启了调试的手机。拍照扫描需要手机上有 Google Play 服务。

App 是**开发版构建**（expo-dev-client，D-084），不能用 Expo Go 打开：在 Expo Go 里能运行，但扫描、视频、音频、语音、翻译、文档、多文件分享和后台任务这些原生功能都不能用，文字识别会退回下载扩展包。

### 2. 安装依赖并启动

```bash
npm install
```

```bash
npm run ios
```

或

```bash
npm run android
```

第一次 `npm run ios` 会运行 `expo prebuild` 生成 `apps/mobile/ios/`（不进 git，随时可以删掉重新生成；里面有主 App 和分享扩展 `MorphShare` 两个 target）、安装 CocoaPods、编译开发版并装进模拟器，再启动开发服务器，大约要几分钟；以后只改 JS 不用重新编译。改了原生代码（`apps/mobile/modules/`、`apps/mobile/plugins/`）、原生依赖或 app.json 后要再运行一次 `npm run ios`（改了 `plugins/` 时先删掉 `apps/mobile/ios/`）。CocoaPods 报 `Unicode Normalization not appropriate for ASCII-8BIT` 时，终端的语言环境不是 UTF-8，先 `export LANG=en_US.UTF-8`。

第一次 `npm run android` 会生成 `apps/mobile/android/`（不进 git）并用 Gradle 编译。文字识别用 Google ML Kit（模型打包进 App，D-087）。

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

iPhone 真机需要 Apple 开发者账号签名，真机和 TestFlight 都还没有配置。Android 正式包（装到手机上用）的编译方法见 [docs/DEPLOY.md](docs/DEPLOY.md)。

### 3. 使用真实 AI（可选）

**用自己的 key（最简单）**：在 App 的「设置 → AI」里选「我自己的 API key」，再选 Anthropic 或 OpenAI 兼容接口，填好 key（OpenAI 兼容接口还要填地址和模型名），就从手机直接调用。见 [docs/API_KEY_SETUP.md](docs/API_KEY_SETUP.md)。

**经本机转发服务**：在仓库根目录的 `.env`（照 `.env.example` 复制）里填 `ANTHROPIC_API_KEY`，然后开两个终端：

```bash
npm run api
```

```bash
npm run ios:ai
```

第一个在 `http://127.0.0.1:8787` 启动模型转发服务，第二个编译 App 并让它经这个服务调用 Claude（这个地址只有模拟器能连）。提示词在 App 里写，服务器只加上 key、模型和限额（D-193）。转发服务只监听本机，要给手机用得放在 HTTPS 隧道或反向代理后面，环境变量和部署方法见英文 README 和 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 常用命令

| 命令                                                       | 作用                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run check`                                            | 依次运行下面七项检查                                       |
| `npm run lint`                                             | ESLint                                                     |
| `npm run format:check`                                     | Prettier 格式检查（`npm run format` 自动修复）             |
| `npm run typecheck`                                        | 所有工作区的 TypeScript 检查                               |
| `npm test`                                                 | 所有工作区的测试（各个包和转发服务用 Vitest，App 用 Jest） |
| `npm run test:native-dsp`                                  | 编译并测试共用的 C 音频代码（响度、降噪）                  |
| `npm run check:licenses`                                   | 检查依赖许可证是否与 AGPL-3.0 兼容                         |
| `npm run check:locales`                                    | 检查每条界面文案都有翻译                                   |
| `npm run eval -- --model claude-haiku-5-5 [--cases A1,C1]` | 用评测集测试真实模型（产生少量 API 费用）                  |
| `npm run tools`                                            | 编译、签名和校验可下载工具的目录                           |

## 目录结构

```
apps/mobile/          Expo App（Expo Router，路由在 src/app/）
apps/mobile/modules/  原生模块：文字识别和扫描、视频音频、语音转文字、翻译、文档、分享、后台任务
apps/mobile/plugins/  iOS 分享扩展的配置插件
apps/api/             模型转发服务；scripts/eval.ts 评测，scripts/tools.ts 工具目录
packages/core/        纯 TypeScript 内核：schema、修改操作、校验、迁移、内置规则、工具清单
packages/planner/     规划器：提示词、校验与修正；服务端与 App（自带 key：Anthropic 或 OpenAI 兼容接口）共用
packages/tool-pdf/    PDF（pdf-lib）
packages/tool-image/  图片
packages/tool-qr/     二维码
packages/tool-archive/ 压缩包
tools/                可下载工具的示例和开发用签名 key（只在开发版里被信任）
scripts/              许可证、本地化和原生音频代码检查
docs/                 架构、范围、决策、安全说明、部署
```

## 常见疑问

**和直接让 ChatGPT / Claude 处理文件有什么不同？**
它们擅长理解内容（总结合同、整理表格），Morph 不做这些。Morph 做的是处理文件：合并、压缩、扫描、转换都在手机上用固定的工具完成，文件不上传，结果每次都一样；常做的事可以让 AI 搭成一个快捷操作，以后从分享菜单点一下就完成，不用每次重新上传、重新说明。AI 只在搭的时候用一次，日常操作不调用 AI。

**AI 能看到我的文件吗？**
不能。发给模型的只有界面配置和你说的那句话，文件内容、文件名和你记录的数据都不在其中，详见 [docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md)。用官方服务器时请求会经过我们（测试期间会保存，见[两种用法](#两种用法)）；用自己的 key 时直连你选的 provider，「设置 → AI」里会写明发到哪个地址。

**AI 什么都能改吗？**
不能。AI 只能在固定内核允许的范围里改界面、页面和快捷操作（见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-固定内核与可变层5)），不会生成任意代码。超出范围的要求会被拒绝，这时可以点「把这个需求告诉我们」。

**能用哪些模型？能用本地模型吗？**
自带 key 时任意 provider 都可以：选 Anthropic，或者选「OpenAI 兼容接口」，填 Base URL、模型名和 key（Ollama、LM Studio 这类本地模型可以不填 key）。OpenAI、OpenRouter、DeepSeek、Gemini、Groq 有按钮帮你填好地址。
测试过的：Claude 系列（默认 Haiku 5.5，`npm run eval` 的评测集是用 Claude 跑的）。没测试过的：其他所有模型和 provider。它们收到的说明一样，每个回复在应用前都要经过同样的检查，改错了会被拦下而不是直接应用；但比起 Claude，更容易理解错或拒绝。`http://` 只能用于 `localhost`，所以模型跑在另一台电脑上时（比如手机连 Mac 上的 Ollama）要用 `https://` 地址。测试版的官方转发服务器只用 Claude。

**代码是 AI 写的吗？**
是。大部分代码由 Claude Code 编写，一部分由 Codex 编写；产品决策、审核和测试由作者负责，每个决定都记在 [docs/DECISIONS.md](docs/DECISIONS.md)。`npm run check` 包含 lint、类型检查和测试，`npm run eval` 用评测集检验真实模型。

**以后会收费或者闭源吗？**
代码以 AGPL-3.0 开源，已经公开的代码不会收回；本机的文件工具不依赖我们的服务器。官方 App 以后可能对官方服务器提供的 AI 额度收费（定价未定），自己编译、使用自己的 key 不受影响。

**为什么不接受 Pull Request？**
官方 App 通过应用商店分发，合并外部代码前需要先确定贡献者许可协议（CLA），见 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提 issue。

**为什么叫 Morph？**
这是代号，和其他项目重名，正式名字还没定。

## 许可证

[AGPL-3.0](LICENSE)。附带的原生代码使用其他兼容的许可证：LAME 3.100（LGPL-2.0+，用于 MP3 编码）、RNNoise（BSD）、libebur128（MIT）、whisper.cpp（MIT，Android 编译时下载）。Android 版链接了闭源的 Google ML Kit，和 AGPL 的关系还在确认（P-015）。目前暂不接受外部贡献（Pull Request），欢迎通过 issue 反馈问题和建议，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
