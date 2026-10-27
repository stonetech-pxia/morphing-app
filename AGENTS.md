# Morph：给编码代理的规则

先读 `PRODUCT_HANDOFF_CLAUDE_CODE.md` §1–§3、`docs/TOOLS_DESIGN.md` §0 和 `docs/DECISIONS.md`。移动端另有 `apps/mobile/AGENTS.md`（Expo 的写法）。创始人用中文交流，代码注释跟着周围代码写中文。

完整的背景和例子见 `~/Library/Application Support/Claude/side-session-notes/codex-handoff/CODEX_LESSONS.md`（这份文档不在仓库里）。下面是必须遵守的部分。

## 产品原则

- AI 只改 App，不替用户办事（D-113）：不写文案、不回答问题、不总结文件或录音、不自己运行快捷操作。
- AI 看不到文件内容、文件名、识别出的文字和记录内容；收件页面打开 AI 时只发文件的类型和个数。
- 收件页面不自动运行；每次修改都先进草稿（D-190），应用后能撤销。
- 给用户看的词用「快捷操作」「添加」「移除」（D-112）。

## 这台 Mac 也是生产服务器

- **绝不 `pkill -f "tsx src/main.ts"`**。生产服务是 launchd 的 `dev.stonetech.morph-api`。自己起的测试服务记下 PID，只停自己的，端口避开 8787 和 8788。
- **不 push、不部署，除非创始人明确要求。** 改了 `apps/api` 时，在汇报开头单独写明「需要部署生产才生效」。
- 真模型评测只用 Haiku：`npm run eval -- --model claude-haiku-5-5 --cases <ids>`。只在改了提示词、mock 或动作描述时跑，只跑受影响的用例。key 在主目录的 `.env` 里，绝不打印。

## Node 里的测试证明不了手机上能跑

- App 跑在 Hermes 上。Hermes 只有 `Intl.Collator`、`Intl.DateTimeFormat`、`Intl.NumberFormat`；**不要用 `Intl.PluralRules`、`ListFormat`、`RelativeTimeFormat`**，复数用 `messages.ts` 里的 `isSingular`。
- 改动涉及原生模块（AVFoundation、Media3、Vision、ML Kit、文件路径和扩展名）、JS 内置 API、触摸和布局、大文件和内存的，**必须在模拟器或真机上跑一次真实路径**。模拟器面板没有授权时，停下来请创始人授权，不要跳过。
- 不需要界面也能验证原生行为：临时加一个探针路由，直接调原生模块，用 `xcrun simctl io <UDID> screenshot` 读结果；用完用 `git checkout` 恢复，不提交。新加的路由文件要重启 Metro（加 `--clear`）才会生效。
- 原生改动要两边都编译：iOS 跑整个 App（`npx expo run:ios`），Android 至少跑改动模块的 `compileDebugKotlin` 和 `externalNativeBuildDebug`。引入第三方 C 库时，读它的构建开关，并比较开关前后的体积。
- iOS 处理音频只取主音轨（第一条启用的），按源文件的声道数处理。Android 解码图片先缩到目标尺寸。原生中间文件在任务结束时删掉，成功和失败都要删。取消任务一定要让 Promise 结束。

## 打包装到真机

- **只在创始人明确要求时才动他的手机**。平时需要真机测试，就写好测试步骤交给他。装哪个分支、哪个提交，先问清楚。
- 目前只在 Android（创始人的三星 SM-S948B，USB 连接）上打过包。**iPhone 真机还没打过包**：要先有苹果开发者团队和签名，prebuild 时会提示分享扩展没有 `DEVELOPMENT_TEAM`。这件事问创始人，不要自己猜着配。
- 环境：`export JAVA_HOME=~/development/jdk-17/Contents/Home ANDROID_HOME=~/development/android-sdk`。CocoaPods 和 Gradle 前面都加 `LANG=en_US.UTF-8`。
- **先备份手机上的数据。** release 包不能 `run-as`，所以先 `adb install -r` 一个 debug 包，**不要打开它**，再执行 `adb exec-out run-as app.morph.mobile tar cf - . > app-data.tar`，备份进 `side-session-notes/android-backups/<时间>/`。两种包都用 Expo 模板的调试密钥签名，所以能互相覆盖安装，数据保留。
- **打 release 包**（不依赖 Metro，JS 在打包时就固定了）：

  ```bash
  cd apps/mobile && npx expo prebuild --platform android --no-install
  cd android && EXPO_PUBLIC_MORPH_API_URL=https://morph-api.stonetech.dev \
    EXPO_PUBLIC_MORPH_TOOLS_URL=https://morph-tools.stonetech.dev \
    EXPO_PUBLIC_MORPH_CLIENT_TOKEN="$(grep '^MORPH_CLIENT_TOKEN=' ~/projects/morph-prod/.env | cut -d= -f2-)" \
    ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
  adb -s <序列号> install -r app/build/outputs/apk/release/app-release.apk
  ```

  三个环境变量都会打包进 App。漏掉一个，AI 或下载工具在手机上就用不了，而模拟器和单元测试都发现不了。令牌不是秘密（D-132），但不要打印到日志里。

- adb 的毛病：在命令沙盒里 adb server 会崩，要在沙盒外后台跑 `adb nodaemon server`。别的会话也在用 adb 时，换一个端口（`ANDROID_ADB_SERVER_PORT=5038`）。每条命令都带 `-s <序列号>`，失败了就重试。`adb devices` 显示 offline（usb_read e00002eb）时，只能重新插线，或者在手机上关掉再打开 USB 调试。
- 装完打开一次，确认 App 能启动、AI 修改能用。然后在汇报和项目记忆里写下：手机上现在是哪个分支、哪个提交，备份放在哪里。
- 模拟器上的开发版也会过期：原生代码改过之后，旧的开发版跑新的 JS 可能一启动就报错（例如「无法打开工作空间」）。遇到这种情况先 `npx expo run:ios --device <UDID> --no-bundler` 重新打开发版（不能同时带 `--port`），不要当成代码的 bug。

## 测试

- 修 bug 先写一个**在旧代码上会失败**的测试，再改代码让它通过。
- 断言要写「应该怎样」，不要把现在的行为照抄成断言。测试替身要模拟真实会出问题的属性：扩展名、文件所在目录、`content://` 和 `file://` 的区别、声道数。
- 界面用三种状态各走一遍：新用户（没有数据）、有数据、边界情况（个数不对、文件很大、类型混合）。

## 文件的归属

- 用户相册或「文件」里的原件、`content://`：永远不移动、不删除。
- 分享扩展放在 App Group 里的副本、选择器放在 `Caches/ImagePicker` 和 `Caches/DocumentPicker` 里的副本：属于收件那一批，批次释放时删；收件那一批不能移动，因为「再来一次」还要用。
- `cache/runs/<runId>/`：属于这次运行，可以移动，运行页面关闭时删。
- 要移动文件的步骤（例如改名）先判断文件是不是这次运行自己的，不是就复制。

## 多语言（en / zh / fr）

- 文案都放进 `packages/core/src/messages/` 的 `en.ts`、`zh.ts`、`fr.ts`（三份的键必须一样，少一个就编译不过；带数量的单数写法在 `enSingular` / `frSingular`），不要写 `zh ? '…' : '…'`（`npm run check:locales` 会查出来）。
- 每条带数量的文案都要有单数写法，并写明用哪个参数判断单复数。法语里 0 和 1 都用单数。
- 不要把翻译过的词拼成句子，每种语言写完整的句子。法语术语：记录 = entrée，数据表 = tableau，Morph 的设置页 = Paramètres，录音 = enregistrement。
- 改了界面文案，就把模拟器切成法语，从新装开始走一遍主流程。

## DECISIONS 和文档

- 没做完的不标「已定」。改一个决定时，把引用它的所有地方都 `grep` 出来一起更新。写「创始人确认」时，注明在哪里、哪一天确认的。
- 交接报告、测试计划、测量结果不进 git，放在 `~/Library/Application Support/Claude/side-session-notes/`。
- 决策编号经常撞号：合并前重新查一次 main 上最大的编号。新加表格行时，每一格都不要比那一列最宽的格子还宽（否则 prettier 会把整张表重新补空格）。
- 改规划提示词时不要破坏原有的规则结构，新内容接在规则末尾。

## 合并前

`npm run check` 全过；受影响的评测跑过；每个修复都有一个会失败的测试；原生和界面改动在模拟器上跑过；三种语言都看过；DECISIONS 前后一致。汇报分三类写清楚：模拟器上验证过的、只有单元测试的、只有真机能测的。
