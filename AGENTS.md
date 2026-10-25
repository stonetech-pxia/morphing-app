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

- 文案都放进 `packages/core/src/messages.ts`，不要写 `zh ? '…' : '…'`（`npm run check:locales` 会查出来）。
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
