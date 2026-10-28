# 内置工具与工作流设计

本文是内置工具（图片、PDF、视频、扫描、文字识别、翻译、打包、二维码、打印）和跨工具工作流的设计。
决策编号见 [DECISIONS.md](DECISIONS.md)（D-060 起）；用户数据规则见 [DATA_DESIGN.md](DATA_DESIGN.md)。

## 0. 原则

1. **全部在手机本地运行**。T7 之前要求能在 Expo Go 里用；从 T8 起 App 用开发版构建（D-084），可以写本地原生模块调用**系统框架**（iOS 的 Vision / VisionKit / Core Image / AVFoundation，没有第三方原生代码）。Android 用 Google ML Kit（D-087）和 Jetpack Media3（视频，D-141）。视频在 Expo Go 里不能处理（`needsFullApp`）。系统做不了的情况（Expo Go、Android 上给照片找边、ML Kit 不认的语言）仍要有退路（纯 JS 或 WebView 扩展包），工作流配置在各平台通用。还没做的见 §9。
2. **AI 永远看不到用户的文件内容、文件名、OCR 出来的文字和记录内容**（D-036 / D-042 / D-046）。AI 只能看到动作目录、参数和工作流结构。用户说出的规格（「240 KB 以内」「600×600」）是规则，可以发给 AI。
3. **工作流是线性的、非图灵完备的**：一串步骤，每步一个登记过的动作，没有分支、循环和表达式（§7C）。
4. **单独使用一个工具 = 只含这一个动作（加上输入步骤）的工作流**。工具页和工作流共用同一个执行器。
5. **纯逻辑放在 `core` 和 `tool-*` 包里，用 Node 加真实文件测试**；平台能力（选照片、编码图片、WebView、打印、系统识别）由 App 注入，测试里换成假的。

## 1. 类型化的值（替代 D-014 的 4 个固定数据槽）

步骤之间传递**一个值**，值有类型：

| 类型      | 内容                                     | 说明                                                  |
| --------- | ---------------------------------------- | ----------------------------------------------------- |
| `images`  | 图片文件数组（JPEG / PNG / WebP / HEIC） | 每项带宽高、可选的拍摄时间                            |
| `pdf`     | PDF 文件数组（通常 1 个，拆分后多个）    | 每项带页数                                            |
| `files`   | 任意文件数组                             | 是 `images`、`pdf`、`zip`、`video`、`audio` 的父类型  |
| `zip`     | 一个 ZIP 文件                            |                                                       |
| `video`   | 视频文件数组（MOV / MP4 等）             | 每项带时长、宽高；原生模块边读边写（D-140、D-142）    |
| `audio`   | 音频文件数组（m4a / wav / mp3 等）       | 这一批只有类型和输入，动作由音频工具提供（D-140）     |
| `text`    | 一段文字（OCR、二维码识别、PDF 抽文字）  | **只留在本机**：复制、存成文件、生成 PDF，绝不发给 AI |
| `records` | 记录（以后接数据表时再用）               | 第一批只登记类型，没有动作产出它                      |

类型兼容：动作声明接受 `files` 时，`images` / `pdf` / `zip` / `video` / `audio` 都能接上；反过来不行。动作可以用 `rejects` 排除处理不了的子类型（`pdf.merge` 不收视频和音频，D-140）。

运行时的值（App 层）：

```ts
type RunItem = {
  uri;
  name;
  ext;
  mimeType;
  size;
  width?;
  height?;
  pageCount?;
  durationMs?;
  takenAt?;
};
type RunValue =
  | { type: 'images' | 'pdf' | 'files' | 'zip' | 'video' | 'audio'; items: RunItem[] }
  | { type: 'text'; text: string };
```

中间结果是缓存目录 `runs/<runId>/` 里的临时文件，执行结束（成功、取消、失败）后清理；只有「保存」步骤或用户在结果页点「保存」才会成为用户文件（`assets` 表）。`name` 是不含扩展名的显示名，随值一起传递，「命名」步骤改的就是它。

## 2. 动作契约

每个动作在 `core` 里声明契约（`ActionDefinition`），实现在 `tool-*` 包或 App 运行时里：

```ts
interface ActionDefinition {
  id: string; // 'image.compress'，按领域加前缀
  label: Localized; // 「压到指定大小」
  input: ValueType[]; // 接受的类型；[] = 输入动作（只能是第一步）
  rejects?: ValueType[]; // 接受 files 但处理不了的子类型（D-140）
  output: ValueType | 'same' | ((params) => ValueType); // 'same' = 类型不变（命名、保存、分享）
  params: ZodType; // 参数结构，执行前再解析一次（D-020）
  fields: ParamField[]; // 每个参数的界面元数据，编辑器据此生成表单
  local?: LocalStepKind; // 需要用户在本地操作的步骤（§4）
  pack?: PackId; // 需要的扩展包（§6）
  requires: Permission[];
  ai?: string; // 给 AI 的提示（英文）：用户怎么说时用它、怎么设参数，随动作目录发给模型（D-259）
  aiRules?: { n: number; text: string }[]; // 只关于这个动作的提示词规则，按编号插进「## Rules」
  phrases?: { match: RegExp; step?: (m, locale) => { params; ask?; table? } }[]; // 内置规则认的步骤说法（D-265）
}

interface ParamField {
  key: string; // 对应 params 的一个键
  label: Localized;
  kind: 'number' | 'choice' | 'toggle' | 'text' | 'nameTemplate' | 'color';
  unit?: 'px' | 'KB' | 'MB' | '%' | '°' | 'mm' | 'pt';
  min?;
  max?;
  step?;
  options?: { value; label: Localized }[]; // choice
  presets?: { label: Localized; values: Record<string, unknown> }[]; // 「护照 35×45」「4 MB」
  ask?: boolean; // 默认「每次运行时问」
  private?: boolean; // 用户自己写的文字（水印、文字戳）：发给 AI 前替换成占位符
}
```

测试保证每个动作的 `fields` 和 `params` 的键一一对应，`presets` 都能通过 `params` 校验。

加一个动作时只改它自己的定义：动作目录那一行（`label`、`description`、`ai`）、只关于它的规则（`aiRules`，编号取现在最后一条加 1）和内置规则认的说法（`phrases`，不同动作的说法不能重叠，`ai/workflow-phrases.test.ts` 检查）都从这里生成。快捷操作预设同样：提示词里那一行来自 `name`、`description` 和步骤，内置规则按名字找，另外的叫法写在 `words`。风格预设的叫法在 `presets.ts` 的 `said`（提示词规则 11）和 `aliases`（内置规则）。

### 工作流（schemaVersion 5）

```ts
Workflow = { id, name, icon?, toolId?, presetId?, steps: Step[1..12] }
Step     = { id, action, params, ask?: string[] }   // ask：这些参数每次运行时问用户
```

- `toolId`：由工具安装时创建（工具里的单功能工作流和「合并 PDF」），卸载工具时一起移除；用户可以改参数和步骤，但不能单独删除。
- `presetId`：从预设复制来的，编辑页提供「恢复预设」。
- 没有 `toolId` 的是用户自己的工作流（从预设添加、复制或新建）。

### 校验（`validateWorkspace`）

1. 每步的动作已登记，参数能通过 `params`。
2. 第一步必须是输入动作，输入动作只能是第一步。
3. **相邻两步类型能接上**：从第一步的输出开始，逐步检查当前类型是否被下一步接受，`'same'` 保持类型。
4. `ask` 里的键必须是该动作 `fields` 里的键。
5. 工具的工作流只用该工具声明过的权限（沿用 §7B）；跨工具的用户工作流不再限制动作必须属于同一个工具。

## 3. 执行器

`core/src/workflow/engine.ts` 是唯一按顺序执行动作的地方（替代 App 里的 `runner.ts` 的循环部分）：

- **进度**：每步开始、结束、步内进度（例如第 3/10 张）回调给界面。
- **取消**：界面随时可以取消；步骤之间和每张图片 / 每页之间检查。取消后清理临时文件。
- **出错**：`RunError(code, detail)`，每个 code 有中英文提示，detail 只含规格数字和文件显示名（显示给用户，不写入执行记录）。
- **执行前再解析参数**（D-020）；运行时询问的参数合并进本次运行，不写回配置。
- **结果可预览**：图片缩略图、PDF 页数和大小、文字全文（只在本机显示）。结果页始终提供「保存到文件」「分享」「存到相册」（图片）「打印」（PDF / 图片）「复制」（文字）。
- **`tool_runs` 只记录元数据**：工作流 ID、状态、错误代码、输出文件 ID，不记录内容和文件名。
- **大小上限**（P-006）：单个文件 50 MB、一次合计 100 MB；送进 WebView 的图片先缩到 1677 万像素以内（iOS canvas 上限）。视频和音频单独算：单个 4 GB、一次最多 10 个，开始处理前查剩余空间，不复制大文件（D-142）。
- **运行中问一句**：`LocalUi.choose` 只问固定的几种问题（文字写在 App 里），例如压缩 PDF 压不到时「转成图片 / 就用现在的」（D-145）。

动作实现的接口：

```ts
type ActionImpl = (input: RunValue | null, params, ctx: StepContext) => Promise<RunValue>;
interface StepContext {
  progress(done, total): void; // 步内进度
  throwIfCancelled(): void;
  local: LocalUi; // 打开本地操作界面（§4），用户取消时返回 null
  packs: PackGate; // 需要扩展包时暂停，请用户确认下载（§6）
  platform: ToolPlatform; // 注入的平台能力
}
```

## 4. 本地操作步骤

调研的 10 个场景里有 8 个需要用户亲手操作。这类步骤在工作流里只是一个占位（AI 只决定它出现在哪里），执行到这里时打开对应界面，用户的操作结果只在本次运行里使用：

| `local`     | 界面                                                                      | 用在                              |
| ----------- | ------------------------------------------------------------------------- | --------------------------------- |
| `crop`      | 裁剪框（可锁定比例），逐张确认                                            | 证件照、裁剪                      |
| `reorder`   | 列表 + 上移 / 下移 / 删除                                                 | 材料包、合并                      |
| `pages`     | 按页码选页、删页、排序、旋转（有 PDF 预览包时显示缩略图）                 | 选页、整理页面                    |
| `corners`   | 在照片上拖四个角                                                          | 扫描                              |
| `redact`    | 在图片上画框，选模糊或黑块                                                | 截图打码                          |
| `sign`      | 签名板（画一次可以存起来）+ 选页和位置                                    | 签回表格                          |
| `fillForm`  | PDF 表单字段逐个填写                                                      | 签回表格                          |
| `trimMedia` | 视频画面（音频以后是波形）+ 时间轴两个把手、±1 秒、只播放这一段，逐个确认 | 剪一段（视频、以后的音频，D-143） |

签名存在 `documentDirectory/signatures/`，不进配置、不进版本，也不发给 AI。

## 5. 动作目录（第一批）

前缀即领域，实现位置见括号。

- **输入输出（内核）**：`in.videos`（从相册选视频，不在选的时候转码，D-142）、`in.photos`（`source`：相册多选、拍照，或 `scanner` 系统文档相机——iOS 的 VisionKit、Android 的 ML Kit 文档扫描，实时找边、自动拍、多页、拍完已拉正，页面带 `straightened` 标记；没有文档相机的设备改用相机，D-086、D-087）、`in.files`（PDF / 图片 / 视频 / 音频 / 任意文件；这两个在第一步时也接收别的 App 分享进来的文件，§11）、`file.rename`（命名模板）、`file.filter`（按固定条件筛选，§14）、`file.save`（存到 Morph 文件）、`out.share`（一次分享全部文件，D-119）、`out.saveToFolder`（复制进「文件」里的文件夹：第一次由用户选，之后记住同一个，结果页可以换；iCloud 云盘、Google Drive 等网盘由它们自己的 App 同步，D-120、D-123）、`out.saveToPhotos`、`out.print`；`in.text`（用户输入一段文字，private）、`in.records`（读取一张数据表的记录，可按时间段，按表里第一个日期字段）。（App：expo-image-picker、expo-document-picker、本地模块 morph-share（Expo Go 里退回 expo-sharing / expo-file-system）、expo-media-library、expo-print）
- **图片**：`image.convert`、`image.resize`、`image.compress`（压到 ≤ N KB）、`image.crop`（本地框选）、`image.rotate`、`image.stripMetadata`、`image.idPhoto`、`image.stitch`、`image.grid`、`image.redact`（本地）、`image.watermark`、`image.printSheet`（证件照排到 4×6 / 5×7 / A4 / Letter 相纸，带裁切线）。（算法：`packages/tool-image`；编码：expo-image-manipulator；合成：Skia 离屏绘制 `composeImage`，画布单边不超过 8192、总像素不超过 1677 万，超出整体缩小，D-079）
- **视频**（工具 `video`，D-143）：`video.compress`（按大小 ≤ N MB 或按画质 1080p / 720p / 480p）、`video.convert`（转成 MP4，画质基本不变）、`video.trim`（本地 `trimMedia`，不重新编码）。输出一律 MP4（H.264 + AAC）。码率和分辨率在 `core/media.ts` 算，编码在本地模块 `morph-media`（iOS AVFoundation、Android Media3 Transformer，D-141）；输入是 `in.videos`（相册，1–10 个）或 `in.files`（`accept: videos`）。
- **PDF**：`pdf.fromImages`（A4 / Letter / 跟随图片，可设边距和 ≤ X MB）、`pdf.compress`（把已有 PDF 压到 ≤ X MB：先只压图片、保留文字，不够小时按 `whenTooBig` 问用户 / 转成图片 / 保留文字，D-145）、`pdf.merge`（PDF 和图片混合）、`pdf.pages`（本地选页 / 删页 / 排序 / 旋转）、`pdf.selectPages`（按页码规则：全部 / 奇数 / 偶数 / 范围）、`pdf.rotate`、`pdf.split`、`pdf.pageNumbers`、`pdf.stamp`（文字戳 / 日期戳）、`pdf.sign`（本地）、`pdf.fillForm`（本地）+ 拍平、`pdf.toImages`、`pdf.extractText`。（`packages/tool-pdf`：pdf-lib；`toImages` / `extractText` / 缩略图需要 PDF 预览包）
- **扫描**（工具 `scan`）：`scan.detect`（找边 → 本地调四角，每张都要确认 → 透视矫正，长边 2400；iOS 用 Vision 找边、Core Image 矫正，Android 和 Expo Go 用扫描包，D-086；文档相机拍的页面直接放行，也不需要扫描包；`flatten` 默认打开：拉正后用 UVDoc 展平弯曲的页面，装了文字识别模型时再按文字行去倾斜、逐行拉直，只重采样一次，模型在扩展包 `dewarp`，不下载照常扫描，D-274）、`scan.enhance`（自动 / 灰度 / 黑白 / 原样：去阴影、纠偏，自动按页面选彩色或灰度，黑白用局部阈值；Skia 着色器，不需要扩展包，D-266、D-275）。
- **文字识别**（工具 `ocr`）：`ocr.recognize`（images → text，参数 `lang` 是 `auto`（默认，不问；按手机语言选引擎和整理方式，D-278）或 12 种语言之一。中文、日文、英法德西葡意在 iOS 和 Android 上都用 PP-OCRv6（D-269：扩展包 `ppocr` 约 31 MB，ONNX Runtime 跑模型，前后处理在 `@morph/tool-ocr`）；韩文等其余语言 iOS 用 Vision 的 `VNRecognizeTextRequest`（D-085），Android 只剩韩文用 ML Kit（D-087）；系统也识别不了时 `packFor` 按语言确保语言包，语言包连同识别包一起下载）。中日文字之间多出来的空格在本机去掉（`tidyOcrText`）。`ocr.toExcel`（images → files，D-272）：带线的表格做成一个 xlsx（每页一张工作表），参数 `lang`（和 `ocr.recognize` 一样，默认 `auto`）和 `scope`（全部内容 / 仅表格内容）；找线、组表、写 xlsx 在 `@morph/tool-office`，只用本机识别（要每行的位置，不用文字识别包），结果页可以查看和编辑。
- **翻译**（工具 `translate`，D-170–D-176）：`translate.text`（text → text，参数 `from`：自动识别或 20 种语言之一，`to`：20 种语言之一，默认每次运行时问）。iOS 用系统的 Translation 框架（iOS 18 起；iOS 26 起已下载的语言直接建会话，要下载或更早的系统时挂一个看不见的 SwiftUI 视图用 `.translationTask`，语言包由系统弹窗下载），NaturalLanguage 识别语言；Android 用 ML Kit 翻译（每种语言模型约 30 MB，第一次用时 App 先问「首次使用需下载约 X MB」再下载，之后离线）和 ML Kit 语言识别（打包进 App）。翻译前在本机把文字拆成段（`splitForTranslation`：空行分段，段里折行的句子接起来，标题、短行、列表项另起），自动识别时每段单独识别语言、按原文语言分组翻，和目标语言相同的段原样保留，再按原来的分段拼回（`joinTranslation`）。只出纯文字（可以接 `text.toPdf` 排成 PDF），不保留原文件排版；结果页写明「本机翻译，适合看懂意思；正式文件请找专业翻译」。一次最多 10 万字。Expo Go 和 iOS 17 及更早报「不支持这个步骤」并说明原因；ML Kit 没有繁体中文。文字不上传、不发给 AI。
- **文字**（工具 `text`）：`text.copy`、`text.toFile`（.txt）、`text.toPdf`（expo-print，系统字体，中日韩都能显示）；文字加工 `text.tidy`、`text.replace`、`text.extract`、`text.lines`（§14，D-245）。
- **打包**（工具 `zip`）：`zip.create`、`zip.extract`。（`packages/tool-archive`：fflate，只用同步接口）
- **二维码**（工具 `qr`）：`qr.generate`（文字 → PNG，tool-qr 自带的 PNG 编码器）、`qr.read`（图片 → 文字，Skia 读像素后用 jsQR）。（`packages/tool-qr`：lean-qr、jsQR）
- **报表**（工具 `print`）：`print.records`（`records` → PDF；模板：表格 / 卡片 / 带合计的清单；记录值先转义再在本地填进去，AI 只选模板、标题和字段 ID，D-042、D-080）。模板在 `core/src/html.ts`。

文件名由用户选文件时决定，AI 只能给命名**模板**：`{date}`（= `{date:YYYY-MM-DD}`）、`{date:FORMAT}`、`{index}`、`{seq}`（两位序号 01、02…）、`{sourceName}`、`{taken}` / `{taken:FORMAT}`（照片拍摄日期，读不到时用当天）、`{ocr:规则}` / `{qr:规则}`（这张照片在本机识别出的文字 / 二维码内容里按固定规则取的一段，§14）。

## 6. 扩展包（按需下载）

小库直接打包进 App：pdf-lib、fflate、lean-qr、jsQR、exifr、Skia。大依赖做成扩展包：

| 扩展包       | 内容                                                | 大小（下载）  |
| ------------ | --------------------------------------------------- | ------------- |
| `scan`       | opencv.js + jscanify                                | 约 9 MB       |
| `ocr`        | tesseract.js、worker、核心 wasm                     | 约 4 MB       |
| `ocr-<lang>` | 每种语言一个模型（4.0.0_best_int）：eng、chi_sim 等 | 1.7–3 MB / 种 |
| `pdfview`    | pdf.js（legacy build）                              | 实测后填写    |
| `speech-*`   | Android 语音转文字的 whisper 模型 + 语音检测（§12） | 61 / 191 MB   |

机制：

- **清单写在代码里**（`core/src/packs.ts`）：id、版本、文件列表（下载地址、SHA-256、大小）、许可证。下载后逐个校验 SHA-256，不一致就删除整个版本目录并报错。
- **只能由用户触发下载**：界面显示大小，建议用 Wi-Fi。AI 和工作流都不能自己下载；执行到需要扩展包的步骤时暂停，弹窗请用户确认（`PackGate`），用户拒绝就取消本次运行。
- **存储**：`documentDirectory/packs/<id>/<version>/`，写完并校验后才写 `ready.json`，所以中断的下载不会被当成已安装。不进 revision，回滚不受影响；下载过就能离线使用。
- **管理**：「设置 → 扩展包」（`app/packs.tsx`）列出已下载的扩展包、占用空间、许可证和版本，可以删除（删除文字识别包时语言包一起删除）。Android 下载过的翻译语言（ML Kit 模型，不是扩展包，不在 `PACKS` 清单里）也列在这一页，可以删除（D-175）；iOS 的翻译语言由系统「设置 → 翻译」管理。
- **加载**：WebView 只加载我们随 App 发布的固定 HTML，库文件从本地扩展包目录读取，不访问网络（CSP `default-src 'none'`，见 T4 实验记录）。WebView 和 App 之间只有固定格式的消息（动作名 + 数据），不注入任何模型生成的字符串（open-tool-research N3）。
- **下载来源**：先用 jsDelivr 上固定版本的地址，以后换成自己的服务器（只改清单）。
- **App Store 2.5.2**：见 DECISIONS（待创始人确认）。
- **系统能做的就不要扩展包**（D-085–D-087）：执行器问 `packNotNeeded(动作, 参数, 输入)`，返回 true 就不确认扩展包——系统能识别这种语言（iOS 全部 12 种，Android 除俄文外 11 种），系统能找边（iOS），或者输入全是文档相机拉正过的页面。工作流页的「第一次运行时需要下载」也按这个算（`packsNeeded`）。扫描包和文字识别包留给 Android（相册照片找边、俄文、没有 Google Play 服务）和 Expo Go；PDF 预览包各平台都还需要。

**原生依赖**（Gradle / 系统框架，不在 `check:licenses` 里，新增时要更新这张表）：

| 依赖                                                                                          | 版本             | 平台    | 许可证 / 条款                     | 用途                                                          |
| --------------------------------------------------------------------------------------------- | ---------------- | ------- | --------------------------------- | ------------------------------------------------------------- |
| Vision、VisionKit、Core Image、ImageIO                                                        | 系统自带         | iOS     | Apple 系统框架                    | 文字识别、找边、拉正、文档相机                                |
| Translation（弱链接，iOS 18 起）、NaturalLanguage、SwiftUI                                    | 系统自带         | iOS     | Apple 系统框架                    | 本机翻译、识别语言（morph-translate，D-170）                  |
| `com.google.mlkit:translate`                                                                  | 17.0.3           | Android | 闭源，Google ML Kit 条款（P-015） | 本机翻译，语言模型第一次用时下载（每种约 30 MB）              |
| `com.google.mlkit:language-id`                                                                | 17.0.6           | Android | 闭源，Google ML Kit 条款（P-015） | 识别每段文字的语言，模型打包进 App                            |
| UIKit（`UIActivityViewController`、`UIDocumentPickerViewController`）、UniformTypeIdentifiers | 系统自带         | iOS     | Apple 系统框架                    | 一次分享多个文件、存到选定文件夹（morph-share，D-119、D-120） |
| `androidx.core`（FileProvider，随 React Native 已经在 App 里）、存储访问框架                  | 随 RN / 系统自带 | Android | Apache-2.0 / Android 系统接口     | 一次分享多个文件、存到选定文件夹（morph-share）               |
| `com.google.mlkit:text-recognition-korean`                                                    | 16.0.1           | Android | 闭源，Google ML Kit 条款（P-015） | 韩文识别，模型打包进 App（D-269）                             |
| `com.microsoft.onnxruntime:onnxruntime-android`                                               | 1.30.0           | Android | MIT                               | 跑 PP-OCRv6 文字识别模型（D-269）                             |
| `onnxruntime-objc`（CocoaPods）                                                               | 1.30.0           | iOS     | MIT                               | 跑 PP-OCRv6 文字识别模型（D-269）                             |
| `com.google.android.gms:play-services-mlkit-document-scanner`                                 | 16.0.0           | Android | 闭源，Google APIs 条款（P-015）   | 文档扫描界面（需要 Google Play 服务）                         |
| `com.google.android.gms:play-services-base`                                                   | 18.11.1          | Android | 闭源，Google APIs 条款（P-015）   | 检查有没有 Google Play 服务                                   |
| AVFoundation、CoreMedia、VideoToolbox                                                         | 系统自带         | iOS     | Apple 系统框架                    | 视频压缩、转格式、剪切、取画面（morph-media，D-141）          |
| `androidx.media3:media3-transformer`、`media3-effect`、`media3-common`                        | 1.9.1            | Android | Apache-2.0                        | 视频压缩、转格式、剪切（morph-media；和 expo-video 同版本）   |
| `ExpoShareIntentModule`（CocoaPods，随 npm 包 expo-share-intent）                             | 9.0.0            | iOS     | MIT                               | 分享到 Morph：主 App 读共享目录（§11）                        |
| `expo-share-intent`（Gradle 模块，随 npm 包）                                                 | 9.0.0            | Android | MIT                               | 分享到 Morph：接收 `ACTION_SEND`（§11）                       |
| Social、UniformTypeIdentifiers、ImageIO（分享扩展 `MorphShare`）                              | 系统自带         | iOS     | Apple 系统框架                    | 分享扩展复制文件（§11）                                       |
| Speech、AVFoundation、CryptoKit                                                               | 系统自带         | iOS     | Apple 系统框架                    | 语音转文字（morph-speech，§12）                               |
| whisper.cpp（含 ggml，CMake 构建时按 SHA-256 下载源码）                                       | 1.9.5            | Android | MIT                               | 语音转文字（§12）                                             |
| MediaExtractor、MediaCodec                                                                    | 系统自带         | Android | Android 系统接口                  | 把音频解码给 whisper（§12）                                   |
| `com.google.mlkit:face-detection`                                                             | 16.1.7           | Android | 闭源，Google ML Kit 条款（P-015） | 证件照自动框脸，模型打包进 App（D-252）                       |
| Vision（`VNDetectFaceRectanglesRequest`、`VNGeneratePersonSegmentationRequest`）、Core Image  | 系统自带         | iOS     | Apple 系统框架                    | 证件照自动框脸、换底色（D-252）                               |
| `expo-notifications`（npm 包，带 iOS / Android 原生代码）                                     | 58.1.6           | 两端    | MIT                               | 提醒：本地通知（D-251），不注册推送                           |

## 7. 预设工作流和编辑

预设写在 `core/src/workflows/presets.ts`，不随版本，是内设的快捷操作（D-236）：不用添加，在快捷操作页和收件页面直接运行，运行记录记在预设 ID 下（`builtInWorkflows()` / `findWorkflow()`）。保存修改、放到首页、合成两个快捷操作、或对 AI 说「添加签证照片工作流」时，才用 `presetWorkflow()` 以预设 ID 存进配置（一个可撤销的版本，带 `presetId` 和图标，没有 `toolId`），之后就和用户自己的工作流一样，可以改参数、改步骤、复制、放到页面上、删除；删掉后回到内设的那个。预设是用户工作流，**不要求先安装任何工具**；需要扩展包的预设在第一次运行到那一步时才请用户确认下载（§6）。

快捷操作页的「现成的」按生活场景分组（`PRESET_SCENARIOS`，D-130）：出国办证（签证 / 证件照、证件照打印、中文材料翻成英文）、交材料签文件（材料包、签回表格、扫描文档、多份材料合一、PDF 太大传不上去、外文 PDF 翻成中文、拍外文材料翻成中文）、报销记账（收据归档）、发照片和视频（照片发邮件、截图打码分享、批量发照片、视频太大发不出去、截图翻译）（D-146）。翻译预设翻成界面语言（英文界面翻成英文），名字也跟着变。

| id                     | 名称                | 步骤                                                                              | 扩展包    |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------- | --------- |
| `visa-photo`           | 签证 / 证件照       | 选照片 → 证件照（美签 600×600，≤ 240 KB）→ 命名                                   |           |
| `document-packet`      | 材料包              | 选照片 / 拍照 → 裁剪 → 排顺序（`file.order`）→ A4 PDF ≤ 4 MB → 命名 → 分享        |           |
| `email-photos`         | 照片发邮件 / 传网站 | 选照片 → 长边 1600 → 压到 500 KB → 分享                                           |           |
| `sign-return`          | 签回表格            | 选 PDF → 填表（没有字段时跳过）→ 签名 → 分享                                      | pdfview   |
| `scan-document`        | 扫描文档            | 文档相机扫描（或拍照后找边）→ 变清楚 → PDF → 命名 → 分享                          | scan      |
| `combine-documents`    | 多份材料合一        | 选 PDF 和图片 → 合并 → 选页 / 排序 / 旋转 → 命名 → 分享                           |           |
| `receipt-archive`      | 收据归档            | 扫描收据（或拍照后拉正）→ 压到 500 KB → 按日期命名 → 存到文件                     | scan      |
| `redact-screenshots`   | 截图打码分享        | 选截图 → 拼长图 → 打码 → 分享                                                     |           |
| `send-photos`          | 批量发照片          | 选照片 → 转 JPG → 去掉定位 → 长边 2048 → ZIP → 分享                               |           |
| `print-id-photos`      | 证件照打印          | 选照片 → 证件照 → 排到 6 寸相纸（裁切线）→ 打印或保存                             |           |
| `pdf-too-big`          | PDF 太大传不上去    | 选 PDF → 压缩 PDF（默认 2 MB，每次问）→ 分享                                      |           |
| `video-too-big`        | 视频太大发不出去    | 选视频 → 压缩视频（默认 20 MB，每次问）→ 分享                                     |           |
| `foreign-pdf`          | 外文 PDF 翻成中文   | 选 PDF → 提取文字 → 翻成中文 → 文字转 PDF → 命名「原名-中文」→ 分享               | pdfview   |
| `foreign-paper`        | 拍外文材料翻成中文  | 文档相机扫描 → 找边 → 识别文字（每次问语言）→ 翻成中文 → 文字转 PDF → 命名 → 分享 | scan、ocr |
| `papers-to-english`    | 中文材料翻成英文    | 文档相机扫描 → 找边 → 识别中文 → 翻成英文 → 文字转 PDF → 命名 → 分享              | scan、ocr |
| `screenshot-translate` | 截图翻译            | 选截图 → 识别文字（每次问语言）→ 翻成中文 → 复制文字                              | ocr       |

**「工作流」页**（`app/workflows.tsx`，入口在设置页和工具页）：我的工作流（运行 / 编辑）、预设库（添加；已添加的显示「已添加」，可以再添加一个）、工具自带的（默认收起）。这个页面由内核提供，AI 不能修改它。

**编辑页**（`app/workflow/[id].tsx`，`run/WorkflowEditor.tsx`）：

- 名字（1–40 字）；每一步按 `fields` 自动生成表单（`ParamForm`，含 `presets` 快捷按钮），「每次运行时问」逐个参数勾选。
- 「在这里加一步」只列出类型接得上的动作（`insertableActions`），新步骤的参数用 `initialParams(action)`；上移 / 下移 / 删除，接不上的步骤标红，不能保存。
- 改动先放在草稿里；「保存」用一个 `updateWorkflow` 生成一个版本（摘要「修改工作流「X」」），提示条可撤销，历史里可恢复。工作流在别处被改了（撤销、AI）而草稿没有未保存的改动时，草稿跟着更新。
- 「复制」「放到首页」（`addComponent` 一个 `workflowRunner`）、「恢复预设」（有 `presetId` 时）、「删除」（确认一次，文件不受影响；工具自带的不能删）。从运行页的结果区也可以进入编辑。

**新动作和参数**：

- `file.order`（本地 `reorder`）：用户排顺序、可去掉几项，任意类型的 `files` / `images` 都能接。
- `pdf.fillForm.whenNoFields`：`'stop'`（默认，报错）或 `'skip'`（原样交给下一步，「签回表格」用它处理扫描件）。
- 输入和常用动作补了 `presets`（「相册，最多 30 张」「PDF，最多 10 个」「240 KB / 500 KB / 1 MB / 2 MB」等）。

**修改操作**（`core/src/ops.ts`，说明在 `describe.ts`；编辑页和 AI 走同一个协议）：

| op                                               | 说明                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `addWorkflow {workflow}`                         | 不能带 `toolId`；最多 100 个工作流                                                    |
| `removeWorkflow {workflowId}`                    | 工具自带的不能删；同时移除运行它的 `workflowRunner`（说明里写「同时移除 N 个卡片」）  |
| `renameWorkflow {workflowId, name}`              |                                                                                       |
| `addWorkflowStep {workflowId, step, index?}`     | 不给 `index` 加在最后                                                                 |
| `moveWorkflowStep {workflowId, stepId, toIndex}` |                                                                                       |
| `removeWorkflowStep`、`setStepParams`            | 原有（`setStepParams` 含 `ask`）                                                      |
| `updateWorkflow {workflowId, name?, steps?}`     | 编辑页一次保存；AI 看到的私有参数是 `<user text>` 占位符，原样传回时保留旧值（D-082） |
| `setWorkflowHomeScreen {workflowId, homeScreen}` | 放到手机桌面 / 拿掉（D-271）；最多 4 个，`addWorkflow` 不能带这个标记                 |

所有修改之后照常跑 `validateWorkspace`（§2），接不上的工作流不会被提交。planner 的提示词包含动作目录（id、输入输出类型、参数结构及枚举和范围、需要的扩展包）、预设清单和规则 20（建工作流）、21（记录做成报表）。

## 8. 迁移（schemaVersion 4 → 5）

只有工作流的步骤格式变了：

| v4                                                              | v5                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pdf.selectFiles {min, max}`                                    | `in.files {accept: 'pdf', min, max}`                                            |
| `pdf.merge {}`                                                  | `pdf.merge {}`（现在也接受图片）                                                |
| `ui.askFileName {defaultTemplate}` + `file.save {nameTemplate}` | `file.rename {template: defaultTemplate}`，`ask: ['template']` + `file.save {}` |
| 只有 `file.save {nameTemplate}`（已去掉询问）                   | `file.rename {template: nameTemplate}` + `file.save {}`                         |

配 v4 的 fixture（默认、简化过步骤、去掉了询问三种）和测试。工具页的组件不动；工具新增的功能通过工具目录里的「更新」按钮（`updateTool`：补上缺少的工作流和工具页上的入口，保留用户的修改）加进来。

## 9. 还没做的（需要原生能力）

T8 起有了开发版构建（D-084），下面这些可以用原生模块做，但还没排期：

- 中文表单填写、「用 Morph 打开」（文件类型关联；「分享到 Morph」已经做了，见 §11）。证件照自动框脸和换底色已经做了（D-252）。
- 桌面小组件、Android 相册清理；音频（语音转文字、压小 / 转格式、剪一段、录音、拼接，由音频工具做，D-150 起）。
- 视频：iPhone 上后台继续处理（Android 已经可以，D-160；iOS 26 的后台任务等真机确认，D-163）、用 Morph 录像、HEVC 输出。
- Android 上给已有照片找边（ML Kit 没有这个接口，目前用扫描包；看过的替代办法都不行，见 D-253）。
- PDF 加密解密（第二批）；压缩 PDF 时用原生渲染代替 PDF 预览下载内容。

## 10. 里程碑

| 里程碑 | 内容                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| T0     | 合并分支；本文档                                                                            |
| T1     | 类型化动作和执行器；迁移「合并 PDF」；内核输入输出动作                                      |
| T2     | 图片：转格式、改尺寸、压到 N KB、裁剪界面、旋转、去定位；独立工具页                         |
| T3     | PDF：图片转 PDF、PDF ≤ X MB、混合合并、按页码选页 / 删页 / 重排 / 旋转 / 拆分、页码和文字戳 |
| T4     | 扩展包机制 + PDF 预览包（缩略图、签名定位）+ 签名 + 填表                                    |
| T5     | 扫描包（找边、调四角、增强）+ 文字识别包（按语言下载）                                      |
| T6     | Skia：拼长图、打码、水印、证件照排版；ZIP；二维码；用记录生成 PDF / 打印；文字转 PDF        |
| T7     | 预设工作流 + 编辑器 + AI 修改和新建工作流（修改操作、planner、mock、评测）                  |
| T8     | 开发版构建；iOS 原生文字识别和扫描（Vision、Core Image、文档相机）；扩展包留作退路          |
| T9     | Android：ML Kit 文字识别和文档扫描（D-087）                                                 |
| T10    | 分享到 Morph：iOS 分享扩展 + Android intent-filter，收件页面，分享的文件交给工作流（§11）   |

## 11. 分享到 Morph（D-114–D-118）

用户在照片、文件、邮件、微信等 App 里点分享 → 选 Morph → 文件进入 Morph，用户选一个工作流运行，或者存成 Morph 文件。

**原生部分**（expo-share-intent 9.0.0，MIT，D-114）：

```
iOS：别的 App ──分享──▶ 分享扩展 MorphShare（我们的 ShareViewController.swift，D-118）
        按顺序把文件复制到 App Group 共享目录（UUID.扩展名），写 UserDefaults[morphShareKey]
        ──morph://dataUrl=morphShareKey?nonce=…#media|file──▶ 主 App
Android：别的 App ──ACTION_SEND / ACTION_SEND_MULTIPLE（image/*、video/*、audio/*、application/*）──▶ MainActivity（singleTask）
主 App：ExpoShareIntentModule.getShareIntent → onChange（iOS 是 JSON，Android 是带 content:// 的对象）
```

- `ios/`、`android/` 仍由 prebuild 生成：`app.json` 里 `expo-share-intent` 的参数（激活规则：图片、文件各最多 50 个；Android 的 MIME 类型；扩展 target 名 `MorphShare`），加上本地插件 `plugins/with-share-extension.js`（显示名改成「Morph」，换上我们的控制器）。
- App 里的入口是 `share/useIncomingShare.ts`（根布局调用）：订阅原生模块的 `onChange` → `normalizeShare`（两种平台的数据 → 和选择器一样的 `PickedFile[]`，只收 `file://` / `content://`，文字和网址不收）→ 放进内存里的 `useIncoming` → 打开 `/share`。iOS 的唤起链接由 `app/+native-intent.tsx` 拦下（冷启动到首页，开着时留在当前页面）。Expo Go 和测试里没有原生模块时什么也不做；测试用假的原生模块（`__tests__/share-test.tsx`）。

**收件页面**（`/share`，D-117）：文件名和大小（只在本机显示）→「存到 Morph 文件」→「用工作流处理」：`shareFit(工作流, 文件)` 看第一步：

| 第一步                  | 收什么                                                                                         | 值的类型              |
| ----------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| `in.photos`             | 全是图片（来源是相册、相机还是扫描都行；没拉正的照片由后面的找边处理）                         | `images`              |
| `in.videos`             | 全是视频（D-144）                                                                              | `video`               |
| `in.files`              | 按 `accept`：`pdf` 全是 PDF、`images` 全是图片、`pdfOrImages`、`zip`、`videos`、`audio`、`any` | `FILE_ACCEPT[accept]` |
| `in.text`、`in.records` | 不收                                                                                           |                       |

个数还要在第一步的 `min`–`max` 之间：类型对、个数不对的列出来但不能运行（「需要至少 2 个文件」「最多 1 个文件」）。超过大小上限（P-006，`sharedSizeProblem`）时只显示错误。点「运行」才运行，不会自动运行。

**运行**（D-115）：`/run/<id>?shared=<分享 ID>` → `startRun({ incoming })` → `RunServices.incoming`。`in.photos` / `in.files` 在第一步看到 `incoming` 就不打开选择器，再按 `shareFitsInput` 检查一次类型和个数、按 P-006 检查大小，然后和选择器选的文件一样复制进本次运行的临时目录；第一步的「每次运行时问」不问。运行页第一步显示「分享进来的文件（N 个）」。

**清理**（D-116）：运行页面关闭、存到 Morph 文件之后、关掉收件页面时 `releaseShare` 删掉共享目录里这一批；又分享一批时删掉上一批剩下的。只删分享扩展写的 UUID 文件名。

**AI 看不到**：分享的文件、文件名、个数都不进配置和版本；只有用户在收件页面点「让 AI 搭一个」时，planner 会收到文件的类型和个数（例如「2 photos, 1 PDF」，D-124、D-129），文件名、大小、内容仍然不发；工作流格式没有变，AI 相关部分（提示词、mock 句式、评测）都没改。

**收件页面现场搭一个**（D-129）：用户自己的快捷操作 →「让 AI 搭一个」→ 第一步收得下这些文件的内设快捷操作（直接「运行」，D-236）→ 工具里的单个功能；AI 做好后回到收件页面，新的排在最前、标「刚做好」，仍由用户点「运行」。

## 12. 语音转文字（D-150、D-151，音频会话第一阶段）

只做了底层：本地模块 `modules/morph-speech`、下载内容、App 一侧的适配（`runtime/speech.ts`），还没有接进快捷操作——`audio` 值类型、`speech.transcribe` 动作、录音、结果页等第二阶段在视频会话的共用底层（原生媒体模块、剪一段界面）合进 main 之后再做。

```
JS（runtime/speech.ts）
  need(语言, 模型) → ready / systemDownload（iOS）/ pack（Android）/ unsupported
  prepare(语言)         iOS 让系统下载识别模型（用户确认后）
  transcribe(地址, …)  → 段落 → tidyTranscript（core/speech.ts）→ 文字
iOS（MorphSpeechModule.swift）
  iOS 26+：SpeechAnalyzer + SpeechTranscriber；设备没有它（isAvailable 为 false）或语言不支持时 DictationTranscriber
          文件按 1 秒一块读出、用 AVAudioConverter 转成 bestAvailableAudioFormat 再喂进去
  更早：  SFSpeechRecognizer + requiresOnDeviceRecognition（第一次弹「语音识别」权限）
Android（MorphSpeechModule.kt + cpp/morph_whisper.cpp）
  MediaExtractor + MediaCodec 解码 → 混成单声道 → 加窗 sinc 重采样到 16 kHz（Pcm.kt，有单元测试）
  → 每 5 分钟一段（在段尾 20 秒里最安静处切开）→ whisper_full（束搜索 5、语音检测、普通话简体提示词）
```

- **whisper.cpp 补丁**（`cpp/patch-whisper.cmake`，构建时打）：窗口以单个时间戳结束时不再跳过剩下的部分，从最后一个时间戳接着识别（开了语音检测，送进去的都是说话；三星真机上 5 分钟会议原来漏约 1 分钟）。换 whisper.cpp 版本时补丁找不到那一行会让构建失败。

- **语言**：`SPEECH_LANGUAGES`（12 种，同文字识别）；iOS 用 `SYSTEM_SPEECH_LOCALES`（BCP 47），whisper 用 `whisperLanguage`（国语也是 zh，靠 `whisperPrompt` 出繁体）。
- **整理**（`tidyTranscript`）：中文换全角标点、去中文之间的空格；去掉一整段都是字幕网站 / 「谢谢观看」/ [音乐] 这类 whisper 在静音里编出来的；中日文直接相连、其他语言用空格；停顿 3 秒以上换段（Android 开了语音检测后 whisper 给的时间是连着的，换段不起作用，第二阶段用语音检测的时间段补上）。
- **下载内容**：`speech-whisper-small`（190 MB）、`speech-whisper-base`（60 MB），都依赖 `speech-vad`（0.9 MB）。大于 32 MB 的文件走 `PackFs.downloadLarge`：expo-file-system 下载到磁盘并按字节报告进度，SHA-256 由 `MorphSpeech.sha256File` 在原生代码里边读边算（Android 用 MessageDigest，iOS 用 CryptoKit），不把几百 MB 读进 JS。
- **CPU 后端**（Android arm64）：ggml 编出 armv8.0 / 8.2（点积）/ 8.2（点积 + 半精度）/ 8.6（再加 i8mm）四种，运行时从新到旧挑这台手机支持的；带 SVE / SME 的几种不打包——苹果芯片上的 Android 模拟器声称支持 SVE2 / SME2，用上之后 22 秒的录音要 562 秒（正常版本 42 秒），Mac 上同样编译的版本直接非法指令退出。
- **取消**：原生侧是原子变量，whisper 在计算图的间隙检查，模拟器上 10–20 秒内生效；iOS 取消 Swift 任务并 `cancelAndFinishNow`。
- **错误码**：`ERR_SPEECH_UNSUPPORTED_LANGUAGE`、`_NEEDS_DOWNLOAD`、`_NOT_AUTHORIZED`、`_UNREADABLE_AUDIO`、`_MODEL`、`_CANCELLED`、`_UNAVAILABLE`（设备上系统识别用不了），App 一侧换成 `SpeechError.code`。

**实测**（2026-10-23，测试录音是 Mac 朗读声生成的 m4a / wav）：

| 环境                                                            | 结果                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android 模拟器 morph_api35（arm64，2.5 GB 内存），whisper small | 中文 22 秒 → 42 秒识别完，全对；中文 108 秒（前后和中间共 65 秒静音）→ 78 秒，两段都完整、没有编句子；英文 16 秒 → 30 秒，全对；取消有效；下载 190 MB 模型并校验成功                                                              |
| iOS 模拟器 iPhone 18 Pro Max（iOS 27）                          | 系统识别**在模拟器上不能用**：SpeechTranscriber `isAvailable` 为 false，DictationTranscriber 占名额后显示已安装但没有任何可用的音频格式，旧接口报「Failed to initialize recognizer」；现在都报 `ERR_SPEECH_UNAVAILABLE`，不会崩溃 |
| Mac（macOS 27，同一段 Swift 代码单独编译）                      | SpeechTranscriber：中文 2.3% / 22% 错字率，带 65 秒静音的录音完整；DictationTranscriber：4.7% / 36%，标点更多                                                                                                                     |
| 真机                                                            | 没有测（iPhone 没有；三星真机是创始人在用的手机，第一阶段没装）                                                                                                                                                                   |

## 13. 音频工具（D-152–D-158，音频会话第二阶段）

| 动作               | 输入 → 输出           | 参数                                                              | 实现                                                                              |
| ------------------ | --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `in.audio`         | → audio               | `source: files / record`、`min` / `max`                           | 文件选择器 `audio/*`；录音界面 `run/local/RecordScreen.tsx`（本地界面 `record`）  |
| `audio.transcribe` | audio → text          | `lang`（12 种）、`model`（Android：更准 / 更快）                  | morph-speech（§12）；iPhone 第一次用某种语言先问再让系统下载                      |
| `audio.compress`   | audio → audio         | `by: size / quality`、`maxMB`、`quality: high / standard / voice` | `planAudioSize` / `planAudioQuality` → morph-media `transcode`（`video: 'drop'`） |
| `audio.convert`    | audio → audio         | `format: m4a / wav`                                               | 已经是这种格式时不转                                                              |
| `audio.trim`       | audio → audio         | 无（本地操作 `trimMedia`，带波形）                                | 重新编码成 M4A，带 `range`                                                        |
| `audio.merge`      | audio → audio（1 个） | 无                                                                | morph-media `concat`                                                              |
| `audio.fromVideo`  | video → audio         | `format`                                                          | 没有声音的视频报 `noAudio`                                                        |
| `audio.fromText`   | text → audio          | `lang`（auto / 20 种）、`rate`（0.5–2）、`format: m4a / wav`      | morph-tts 系统声音读成 WAV，M4A 再交给 morph-media 转（§15，D-270）               |

- morph-media 补的部分：iOS `writeAudio`（`AVAssetReaderAudioMixOutput` → AAC `.m4a` / LPCM `.wav`）、`concat`（每段一路合成轨，首尾相接）、`waveform`（8 kHz 单声道峰值）；Android M4A 用 Media3（去掉画面、`ChannelMixingAudioProcessor` + `SonicAudioProcessor` 统一格式；封装用系统的 MediaMuxer，默认的 InAppMp4Muxer 会在文件头预留约 400 KB），WAV 和波形用 `AudioPcm.kt` 自己解码。
- App：`runtime/actions/audio.ts`、`MediaPlatform.encodeAudio / concatAudio / waveform`、`FilePlatform.speech`、`packNotNeeded`（iPhone 不用下载内容）。
- 错误：`audioTooSmall`、`noAudio`、`noSpeech`；`needsFullApp` 的说法改成「视频和音频」。
- 测试：`core/audio.test.ts`、`audio-actions-test.ts`（假的 media / speech）、`audio-journeys-test.tsx`（录音、转文字、波形剪切、压小的界面旅程）。

## 14. 条件、分组和文字加工（D-242 起）

仍然是线性步骤：条件、分组规则、提取规则都是从固定集合里选的**数据**，没有表达式、循环和分支，AI 看不到文件和文字。

**按条件筛选**（`file.filter`，D-242）：files 进、同类型出。平铺的参数，每种条件最多一条，「不限」的不检查，其余全部满足才保留：

| 参数                                   | 条件                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `kind`                                 | 图片 / PDF / 视频 / 音频 / 办公文档（先看 MIME，不可靠时看扩展名）                      |
| `size` + `sizeMB`                      | 大于 / 小于 N MB                                                                        |
| `orientation`                          | 横 / 竖 / 方（宽高差 2% 以内算方）；选择器没给宽高时用 `imageSize` 读                   |
| `date` + `days` / `period` / `from–to` | 最近 N 天、日历时间段（同数据表的 `PERIODS`）、两个日期之间；拍摄时间，没有时用修改时间 |
| `duration` + `seconds`                 | 视频、音频长于 / 短于 N 秒；没有时长时用 `media.probe` 读                               |

读不到的信息算不满足。一个都不剩时 `whenEmpty`：`stop` 报 `noneMatched`，`skip` 原样交给下一步。只是这次运行不用，从不删除文件。纯逻辑 `core/file-filter.ts`（Node 测试），App 实现在 `runtime/actions/io.ts`。

**分组后各出一份**（D-243）：不加「对每组执行」的循环，而是在「把一批文件变成文件」的三个动作上加 `group`：`pdf.fromImages`、`pdf.merge`、`zip.create`。`group`：`none`（默认，一份）、`count` + `groupSize`（按原来的顺序每 N 个一份）、`day` / `month`（按拍摄时间，没有时用修改时间；组按日期排，读不到日期的放最后「没有日期」）。输出仍是普通的文件数组，名字是日期或这一组第一个文件的名字，后面接 `file.rename {sourceName}`、分享、存到文件夹都照常。纯逻辑 `core/grouping.ts`。

**用识别出的文字命名**（D-244）：`{ocr:规则}` / `{qr:规则}`，规则是 `firstLine`、`invoiceNo`、`date`、`amount`、`phone`、`email`、`url`、`number`（`core/text-rules.ts`，不接受正则）。`file.rename` 看到这两种占位符时先在本机识别每张图片：文字用系统识别（界面语言 + 英文；没有时报 `needsRecognition`），二维码用 jsQR。文字只用来取名，不留下，不发给 AI。取不到时这一段不写；什么都不剩用原来的名字。

**「记一笔」预填**（D-244 的扩展，2026-10-28 定，原型在 `core/prefill/`，还没接进「记一笔」）：日期、金额、税额、单号以 `text-rules` 的规则为主，系统识别（iOS DataDetection / NSDataDetector，Android ML Kit 实体识别，下载模型前先问用户）只做补充；版式记忆保存一次就学会，后来的文件有任何对不上或不合理的地方就空着、不退回规则；不用大模型预填。「设置 → 数据」能一键清空预填记忆、导出（也是备份）、从文件恢复，也能导出 App 配置（D-273）。评测见 `tests/local-model-eval/PREFILL_REPORT.md`。

**文字加工**（D-245，`core/text-ops.ts`）：都是 text → text，文字只在本机处理。

| 动作           | 参数                                                | 做什么                                                         |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `text.tidy`    | `blankLines`：remove / single / keep；`spaces`      | 去掉多余空格和空行                                             |
| `text.replace` | `find`、`replaceWith`（都是私有参数）、`ignoreCase` | 按字面全部替换，不是正则；AI 只看到 `<user text>`（D-082）     |
| `text.extract` | `kind`：phone / email / url / number / date         | 一行一个，规则同 `{ocr:规则}`（`core/text-rules.ts`）          |
| `text.lines`   | `mode`：split / join；`separator`                   | 按逗号（含中文逗号、顿号）、分号、空格、制表符拆行，或接成一行 |

**证件照换底色 + 自动框脸**（D-252）：`image.idPhoto` 的 `background`（keep / white / blue / red / gray / custom + `color`）和 `autoCenter`。换底色在裁剪前对整张照片做：iOS 人像分割（`replacePersonBackground`），Android 主体分割（同去背景，第一次要确认下载模型）。自动框脸：系统人脸检测（`detectFaces`；iOS Vision、Android ML Kit）→ `@morph/tool-image` 的 `faceCrop`（头占照片高度按规格的 `HEAD_RATIO`）→ 作为裁剪界面的初始框，用户仍然确认。

## 15. 文字转语音（D-270）

`audio.fromText`：文字 → 一个音频文件。只出文件（后面接 `audio.convert`、`audio.compress`、`out.share`、`out.saveToFolder` 都行），不做阅读器、播放、高亮，也没有 AI 声音（D-113）。

- 参数：`lang`（`auto` 或和翻译相同的 20 种语言，`core/speak.ts` 的 `SPEAK_LANGUAGES`，声音用 `SPEAK_VOICE_LOCALES` 里的地区：zh-Hans → zh-CN、en → en-US…）、`rate`（0.5–2，1 是系统的正常语速）、`format`（`m4a` / `wav`；要 MP3 接「音频转格式」）。
- 分段（`splitForSpeech`，纯函数）：先用翻译的 `splitForTranslation` 把 PDF、文字识别断开的行接回去（系统读到换行会停顿），再按句子、逗号切，每段不超过 1000 字（Android 一次最多 4000 字），短段落合成一段；只有符号的行不读。一次最多 30 000 字（`MAX_SPEAK_CHARS`，中文约 2 小时）。
- 自动识别（`chooseSpeakLanguage`）：前 8 段交给系统的语言识别（`TranslatePlatform.detectLanguages`：iOS NaturalLanguage、Android ML Kit），按字数取最多的；认不出时按书写系统猜（假名 → 日文、谚文 → 韩文、汉字 → 简体中文、西里尔 → 俄文…），拉丁字母按界面语言（法语界面读法文，其余读英文）。一次只用一种声音。
- 原生模块 `modules/morph-tts`（`voiceStatus`、`synthesize(segments, {taskId, voice, rate, output})`、`cancel`、`onProgress`）：
  - iOS：`AVSpeechSynthesizer.write(_:toBufferCallback:)`，每段一个 `AVSpeechUtterance`，交回的 PCM 依次写进同一个 16 位 WAV（`AVAudioFile`）；空的缓冲区或 `didFinish` 表示这一段读完（只认正在等的那一段）。声音取这种语言质量最好的（增强 / 高级声音优先），不用趣味声音和个人声音；中文不退到 zh-HK（粤语）。语速换算：1 → `AVSpeechUtteranceDefaultSpeechRate`，两边线性。30 秒没有新的声音算卡住、报错。
  - Android：系统 `TextToSpeech`（多数是 Google「语音服务」；清单里声明 `TTS_SERVICE` 的 `<queries>`，Android 11 起不声明连不上引擎），每段 `synthesizeToFile` 一个 WAV（放在输出文件旁边、以 `.tts-` 开头），全部读完后 `Wav.join` 接成一个（只认 PCM，各段格式不同时报错），中间文件在 `finally` 里删。声音数据缺了（`LANG_MISSING_DATA`）不偷偷下载，报 `notDownloaded`。
  - 错误码：`ERR_TTS_NO_VOICE`、`ERR_TTS_NOT_DOWNLOADED`、`ERR_TTS_UNAVAILABLE`（没有朗读引擎）、`ERR_TTS_CANCELLED`、`ERR_TTS_FAILED`。失败、取消都删掉输出文件；取消由 App 每 0.3 秒看一次运行页的「停止」（和语音转文字一样），原生停掉系统朗读、结束正在等的那一段，Promise 一定结束。
- App（`runtime/actions/audio.ts`、`runtime/expo-tts.ts`、`FilePlatform.speaker`）：先检查声音（没有声音、没下载、没有引擎时说明去系统设置哪里添加：iPhone「辅助功能 → 朗读内容 → 声音」，Android「文字转语音输出」），再按 `estimateSpeechBytes` 检查剩余空间，读成 WAV（进度 0–90%），M4A 时用 `planAudioConvert` 交给 morph-media 转（单声道，按 64 kbps 的人声算码率）。文件名跟着文字的来源（PDF 的名字）。
- 预设：「PDF 转成音频」（选 PDF → 提取文字 → 朗读 → 分享）、「拍纸张读成音频」（扫描 → 找边 → 识别文字 → 朗读 → 分享），在「学习工作」；音频工具页加「文字转语音」（输入文字，每次问语言和语速）。
- 测试：`core/speak.test.ts`（参数、分段、选语言、预设接得上、步骤说法）、`tts-test.ts`（Expo 模块的包装：输出地址、进度、取消、错误码）、`speak-actions-test.ts`（执行器：选声音、语速、格式、错误说明、取消、空间、预设）、`modules/morph-tts/android/src/test/…/WavTest.kt`（WAV 的读和接）。
