# 内置工具与工作流设计

本文是内置工具（图片、PDF、扫描、文字识别、打包、二维码、打印）和跨工具工作流的设计。
决策编号见 [DECISIONS.md](DECISIONS.md)（D-060 起）；用户数据规则见 [DATA_DESIGN.md](DATA_DESIGN.md)。

## 0. 原则

1. **全部在手机本地运行**。T7 之前要求能在 Expo Go 里用；从 T8 起 App 用开发版构建（D-084），可以写本地原生模块调用**系统框架**（iOS 的 Vision / VisionKit / Core Image，没有第三方原生代码）。Android 用 Google ML Kit（D-087）。系统做不了的情况（Expo Go、Android 上给照片找边、ML Kit 不认的语言）仍要有退路（纯 JS 或 WebView 扩展包），工作流配置在各平台通用。还没做的见 §9。
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
| `files`   | 任意文件数组                             | 是 `images`、`pdf`、`zip` 的父类型                    |
| `zip`     | 一个 ZIP 文件                            |                                                       |
| `text`    | 一段文字（OCR、二维码识别、PDF 抽文字）  | **只留在本机**：复制、存成文件、生成 PDF，绝不发给 AI |
| `records` | 记录（以后接数据表时再用）               | 第一批只登记类型，没有动作产出它                      |

类型兼容：动作声明接受 `files` 时，`images` / `pdf` / `zip` 都能接上；反过来不行。

运行时的值（App 层）：

```ts
type RunItem = { uri; name; ext; mimeType; size; width?; height?; pageCount?; takenAt? };
type RunValue =
  { type: 'images' | 'pdf' | 'files' | 'zip'; items: RunItem[] } | { type: 'text'; text: string };
```

中间结果是缓存目录 `runs/<runId>/` 里的临时文件，执行结束（成功、取消、失败）后清理；只有「保存」步骤或用户在结果页点「保存」才会成为用户文件（`assets` 表）。`name` 是不含扩展名的显示名，随值一起传递，「命名」步骤改的就是它。

## 2. 动作契约

每个动作在 `core` 里声明契约（`ActionDefinition`），实现在 `tool-*` 包或 App 运行时里：

```ts
interface ActionDefinition {
  id: string; // 'image.compress'，按领域加前缀
  label: Localized; // 「压到指定大小」
  input: ValueType[]; // 接受的类型；[] = 输入动作（只能是第一步）
  output: ValueType | 'same' | ((params) => ValueType); // 'same' = 类型不变（命名、保存、分享）
  params: ZodType; // 参数结构，执行前再解析一次（D-020）
  fields: ParamField[]; // 每个参数的界面元数据，编辑器据此生成表单
  local?: LocalStepKind; // 需要用户在本地操作的步骤（§4）
  pack?: PackId; // 需要的扩展包（§6）
  requires: Permission[];
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
- **大小上限**（P-006）：单个文件 50 MB、一次合计 100 MB；送进 WebView 的图片先缩到 1677 万像素以内（iOS canvas 上限）。

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

| `local`    | 界面                                                      | 用在           |
| ---------- | --------------------------------------------------------- | -------------- |
| `crop`     | 裁剪框（可锁定比例），逐张确认                            | 证件照、裁剪   |
| `reorder`  | 列表 + 上移 / 下移 / 删除                                 | 材料包、合并   |
| `pages`    | 按页码选页、删页、排序、旋转（有 PDF 预览包时显示缩略图） | 选页、整理页面 |
| `corners`  | 在照片上拖四个角                                          | 扫描           |
| `redact`   | 在图片上画框，选模糊或黑块                                | 截图打码       |
| `sign`     | 签名板（画一次可以存起来）+ 选页和位置                    | 签回表格       |
| `fillForm` | PDF 表单字段逐个填写                                      | 签回表格       |

签名存在 `documentDirectory/signatures/`，不进配置、不进版本，也不发给 AI。

## 5. 动作目录（第一批）

前缀即领域，实现位置见括号。

- **输入输出（内核）**：`in.photos`（`source`：相册多选、拍照，或 `scanner` 系统文档相机——iOS 的 VisionKit、Android 的 ML Kit 文档扫描，实时找边、自动拍、多页、拍完已拉正，页面带 `straightened` 标记；没有文档相机的设备改用相机，D-086、D-087）、`in.files`（PDF / 图片 / 任意文件；这两个在第一步时也接收别的 App 分享进来的文件，§11）、`file.rename`（命名模板）、`file.save`（存到 Morph 文件）、`out.share`（一次分享全部文件，D-119）、`out.saveToFolder`（复制进「文件」里的文件夹：第一次由用户选，之后记住同一个，结果页可以换；iCloud 云盘、Google Drive 等网盘由它们自己的 App 同步，D-120、D-123）、`out.saveToPhotos`、`out.print`；`in.text`（用户输入一段文字，private）、`in.records`（读取一张数据表的记录，可按时间段，按表里第一个日期字段）。（App：expo-image-picker、expo-document-picker、本地模块 morph-share（Expo Go 里退回 expo-sharing / expo-file-system）、expo-media-library、expo-print）
- **图片**：`image.convert`、`image.resize`、`image.compress`（压到 ≤ N KB）、`image.crop`（本地框选）、`image.rotate`、`image.stripMetadata`、`image.idPhoto`、`image.stitch`、`image.grid`、`image.redact`（本地）、`image.watermark`、`image.printSheet`（证件照排到 4×6 / 5×7 / A4 / Letter 相纸，带裁切线）。（算法：`packages/tool-image`；编码：expo-image-manipulator；合成：Skia 离屏绘制 `composeImage`，画布单边不超过 8192、总像素不超过 1677 万，超出整体缩小，D-079）
- **PDF**：`pdf.fromImages`（A4 / Letter / 跟随图片，可设边距和 ≤ X MB）、`pdf.merge`（PDF 和图片混合）、`pdf.pages`（本地选页 / 删页 / 排序 / 旋转）、`pdf.selectPages`（按页码规则：全部 / 奇数 / 偶数 / 范围）、`pdf.rotate`、`pdf.split`、`pdf.pageNumbers`、`pdf.stamp`（文字戳 / 日期戳）、`pdf.sign`（本地）、`pdf.fillForm`（本地）+ 拍平、`pdf.toImages`、`pdf.extractText`。（`packages/tool-pdf`：pdf-lib；`toImages` / `extractText` / 缩略图需要 PDF 预览包）
- **扫描**（工具 `scan`）：`scan.detect`（找边 → 本地调四角，每张都要确认 → 透视矫正，长边 2400；iOS 用 Vision 找边、Core Image 矫正，Android 和 Expo Go 用扫描包，D-086；文档相机拍的页面直接放行，也不需要扫描包）、`scan.enhance`（提亮 / 灰度 / 黑白 / 原样；Skia 颜色矩阵，不需要扩展包）。
- **文字识别**（工具 `ocr`）：`ocr.recognize`（images → text，参数 `lang` 选 12 种语言之一。iOS 用 Vision 的 `VNRecognizeTextRequest`（accurate + 语言纠错，中日韩等补上英文），不需要下载，D-085；Android 用 ML Kit 文字识别 v2（模型打包进 App），俄文不支持，D-087；系统识别不了时 `packFor` 按语言确保语言包，语言包连同识别包一起下载）。中日文字之间多出来的空格在本机去掉（`tidyOcrText`）。
- **文字**（工具 `text`）：`text.copy`、`text.toFile`（.txt）、`text.toPdf`（expo-print，系统字体，中日韩都能显示）。
- **打包**（工具 `zip`）：`zip.create`、`zip.extract`。（`packages/tool-archive`：fflate，只用同步接口）
- **二维码**（工具 `qr`）：`qr.generate`（文字 → PNG，tool-qr 自带的 PNG 编码器）、`qr.read`（图片 → 文字，Skia 读像素后用 jsQR）。（`packages/tool-qr`：lean-qr、jsQR）
- **报表**（工具 `print`）：`print.records`（`records` → PDF；模板：表格 / 卡片 / 带合计的清单；记录值先转义再在本地填进去，AI 只选模板、标题和字段 ID，D-042、D-080）。模板在 `core/src/html.ts`。

文件名由用户选文件时决定，AI 只能给命名**模板**：`{date}`（= `{date:YYYY-MM-DD}`）、`{date:FORMAT}`、`{index}`、`{seq}`（两位序号 01、02…）、`{sourceName}`、`{taken}` / `{taken:FORMAT}`（照片拍摄日期，读不到时用当天）。

## 6. 扩展包（按需下载）

小库直接打包进 App：pdf-lib、fflate、lean-qr、jsQR、exifr、Skia。大依赖做成扩展包：

| 扩展包       | 内容                                                | 大小（下载）  |
| ------------ | --------------------------------------------------- | ------------- |
| `scan`       | opencv.js + jscanify                                | 约 9 MB       |
| `ocr`        | tesseract.js、worker、核心 wasm                     | 约 4 MB       |
| `ocr-<lang>` | 每种语言一个模型（4.0.0_best_int）：eng、chi_sim 等 | 1.7–3 MB / 种 |
| `pdfview`    | pdf.js（legacy build）                              | 实测后填写    |

机制：

- **清单写在代码里**（`core/src/packs.ts`）：id、版本、文件列表（下载地址、SHA-256、大小）、许可证。下载后逐个校验 SHA-256，不一致就删除整个版本目录并报错。
- **只能由用户触发下载**：界面显示大小，建议用 Wi-Fi。AI 和工作流都不能自己下载；执行到需要扩展包的步骤时暂停，弹窗请用户确认（`PackGate`），用户拒绝就取消本次运行。
- **存储**：`documentDirectory/packs/<id>/<version>/`，写完并校验后才写 `ready.json`，所以中断的下载不会被当成已安装。不进 revision，回滚不受影响；下载过就能离线使用。
- **管理**：「设置 → 扩展包」（`app/packs.tsx`）列出已下载的扩展包、占用空间、许可证和版本，可以删除（删除文字识别包时语言包一起删除）。
- **加载**：WebView 只加载我们随 App 发布的固定 HTML，库文件从本地扩展包目录读取，不访问网络（CSP `default-src 'none'`，见 T4 实验记录）。WebView 和 App 之间只有固定格式的消息（动作名 + 数据），不注入任何模型生成的字符串（open-tool-research N3）。
- **下载来源**：先用 jsDelivr 上固定版本的地址，以后换成自己的服务器（只改清单）。
- **App Store 2.5.2**：见 DECISIONS（待创始人确认）。
- **系统能做的就不要扩展包**（D-085–D-087）：执行器问 `packNotNeeded(动作, 参数, 输入)`，返回 true 就不确认扩展包——系统能识别这种语言（iOS 全部 12 种，Android 除俄文外 11 种），系统能找边（iOS），或者输入全是文档相机拉正过的页面。工作流页的「第一次运行时需要下载」也按这个算（`packsNeeded`）。扫描包和文字识别包留给 Android（相册照片找边、俄文、没有 Google Play 服务）和 Expo Go；PDF 预览包各平台都还需要。

**原生依赖**（Gradle / 系统框架，不在 `check:licenses` 里，新增时要更新这张表）：

| 依赖                                                                                          | 版本             | 平台    | 许可证 / 条款                     | 用途                                                          |
| --------------------------------------------------------------------------------------------- | ---------------- | ------- | --------------------------------- | ------------------------------------------------------------- |
| Vision、VisionKit、Core Image、ImageIO                                                        | 系统自带         | iOS     | Apple 系统框架                    | 文字识别、找边、拉正、文档相机                                |
| UIKit（`UIActivityViewController`、`UIDocumentPickerViewController`）、UniformTypeIdentifiers | 系统自带         | iOS     | Apple 系统框架                    | 一次分享多个文件、存到选定文件夹（morph-share，D-119、D-120） |
| `androidx.core`（FileProvider，随 React Native 已经在 App 里）、存储访问框架                  | 随 RN / 系统自带 | Android | Apache-2.0 / Android 系统接口     | 一次分享多个文件、存到选定文件夹（morph-share）               |
| `com.google.mlkit:text-recognition`（及 `-chinese`、`-japanese`、`-korean`）                  | 16.0.1           | Android | 闭源，Google ML Kit 条款（P-015） | 文字识别，模型打包进 App                                      |
| `com.google.android.gms:play-services-mlkit-document-scanner`                                 | 16.0.0           | Android | 闭源，Google APIs 条款（P-015）   | 文档扫描界面（需要 Google Play 服务）                         |
| `com.google.android.gms:play-services-base`                                                   | 18.11.1          | Android | 闭源，Google APIs 条款（P-015）   | 检查有没有 Google Play 服务                                   |
| `ExpoShareIntentModule`（CocoaPods，随 npm 包 expo-share-intent）                             | 9.0.0            | iOS     | MIT                               | 分享到 Morph：主 App 读共享目录（§11）                        |
| `expo-share-intent`（Gradle 模块，随 npm 包）                                                 | 9.0.0            | Android | MIT                               | 分享到 Morph：接收 `ACTION_SEND`（§11）                       |
| Social、UniformTypeIdentifiers、ImageIO（分享扩展 `MorphShare`）                              | 系统自带         | iOS     | Apple 系统框架                    | 分享扩展复制文件（§11）                                       |

## 7. 预设工作流和编辑

10 个预设写在 `core/src/workflows/presets.ts`，不随版本：用户在「工作流」页点「添加」（或对 AI 说「添加签证照片工作流」）时用 `presetWorkflow()` 复制进配置（一个可撤销的版本，带 `presetId` 和图标，没有 `toolId`），之后就和用户自己的工作流一样，可以改参数、改步骤、复制、放到页面上、删除。预设是用户工作流，**不要求先安装任何工具**；需要扩展包的预设在第一次运行到那一步时才请用户确认下载（§6）。

快捷操作页的「现成的」按生活场景分组（`PRESET_SCENARIOS`，D-130）：出国办证（签证 / 证件照、证件照打印）、交材料签文件（材料包、签回表格、扫描文档、多份材料合一）、报销记账（收据归档）、发照片（照片发邮件、截图打码分享、批量发照片）。

| id                   | 名称                | 步骤                                                                       | 扩展包  |
| -------------------- | ------------------- | -------------------------------------------------------------------------- | ------- |
| `visa-photo`         | 签证 / 证件照       | 选照片 → 证件照（美签 600×600，≤ 240 KB）→ 命名                            |         |
| `document-packet`    | 材料包              | 选照片 / 拍照 → 裁剪 → 排顺序（`file.order`）→ A4 PDF ≤ 4 MB → 命名 → 分享 |         |
| `email-photos`       | 照片发邮件 / 传网站 | 选照片 → 长边 1600 → 压到 500 KB → 分享                                    |         |
| `sign-return`        | 签回表格            | 选 PDF → 填表（没有字段时跳过）→ 签名 → 分享                               | pdfview |
| `scan-document`      | 扫描文档            | 文档相机扫描（或拍照后找边）→ 变清楚 → PDF → 命名 → 分享                   | scan    |
| `combine-documents`  | 多份材料合一        | 选 PDF 和图片 → 合并 → 选页 / 排序 / 旋转 → 命名 → 分享                    |         |
| `receipt-archive`    | 收据归档            | 扫描收据（或拍照后拉正）→ 压到 500 KB → 按日期命名 → 存到文件              | scan    |
| `redact-screenshots` | 截图打码分享        | 选截图 → 拼长图 → 打码 → 分享                                              |         |
| `send-photos`        | 批量发照片          | 选照片 → 转 JPG → 去掉定位 → 长边 2048 → ZIP → 分享                        |         |
| `print-id-photos`    | 证件照打印          | 选照片 → 证件照 → 排到 6 寸相纸（裁切线）→ 打印或保存                      |         |

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

- 证件照自动框脸 / 换底色（Vision 人脸和人像分割）、中文表单填写、「用 Morph 打开」（文件类型关联；「分享到 Morph」已经做了，见 §11）。
- 视频压缩和剪辑、桌面小组件、Android 相册清理。
- Android 上给已有照片找边（ML Kit 没有这个接口，目前用扫描包）。
- 压缩任意外来 PDF、PDF 加密解密（第二批）。

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
Android：别的 App ──ACTION_SEND / ACTION_SEND_MULTIPLE（image/*、application/*）──▶ MainActivity（singleTask）
主 App：ExpoShareIntentModule.getShareIntent → onChange（iOS 是 JSON，Android 是带 content:// 的对象）
```

- `ios/`、`android/` 仍由 prebuild 生成：`app.json` 里 `expo-share-intent` 的参数（激活规则：图片、文件各最多 50 个；Android 的 MIME 类型；扩展 target 名 `MorphShare`），加上本地插件 `plugins/with-share-extension.js`（显示名改成「Morph」，换上我们的控制器）。
- App 里的入口是 `share/useIncomingShare.ts`（根布局调用）：订阅原生模块的 `onChange` → `normalizeShare`（两种平台的数据 → 和选择器一样的 `PickedFile[]`，只收 `file://` / `content://`，文字和网址不收）→ 放进内存里的 `useIncoming` → 打开 `/share`。iOS 的唤起链接由 `app/+native-intent.tsx` 拦下（冷启动到首页，开着时留在当前页面）。Expo Go 和测试里没有原生模块时什么也不做；测试用假的原生模块（`__tests__/share-test.tsx`）。

**收件页面**（`/share`，D-117）：文件名和大小（只在本机显示）→「存到 Morph 文件」→「用工作流处理」：`shareFit(工作流, 文件)` 看第一步：

| 第一步                  | 收什么                                                                      | 值的类型              |
| ----------------------- | --------------------------------------------------------------------------- | --------------------- |
| `in.photos`             | 全是图片（来源是相册、相机还是扫描都行；没拉正的照片由后面的找边处理）      | `images`              |
| `in.files`              | 按 `accept`：`pdf` 全是 PDF、`images` 全是图片、`pdfOrImages`、`zip`、`any` | `FILE_ACCEPT[accept]` |
| `in.text`、`in.records` | 不收                                                                        |                       |

个数还要在第一步的 `min`–`max` 之间：类型对、个数不对的列出来但不能运行（「需要至少 2 个文件」「最多 1 个文件」）。超过大小上限（P-006，`sharedSizeProblem`）时只显示错误。点「运行」才运行，不会自动运行。

**运行**（D-115）：`/run/<id>?shared=<分享 ID>` → `startRun({ incoming })` → `RunServices.incoming`。`in.photos` / `in.files` 在第一步看到 `incoming` 就不打开选择器，再按 `shareFitsInput` 检查一次类型和个数、按 P-006 检查大小，然后和选择器选的文件一样复制进本次运行的临时目录；第一步的「每次运行时问」不问。运行页第一步显示「分享进来的文件（N 个）」。

**清理**（D-116）：运行页面关闭、存到 Morph 文件之后、关掉收件页面时 `releaseShare` 删掉共享目录里这一批；又分享一批时删掉上一批剩下的。只删分享扩展写的 UUID 文件名。

**AI 看不到**：分享的文件、文件名、个数都不进配置和版本；只有用户在收件页面点「让 AI 搭一个」时，planner 会收到文件的类型和个数（例如「2 photos, 1 PDF」，D-124、D-129），文件名、大小、内容仍然不发；工作流格式没有变，AI 相关部分（提示词、mock 句式、评测）都没改。

**收件页面现场搭一个**（D-129）：「用快捷操作处理」下面列出还没添加、第一步收得下这些文件的现成快捷操作（「添加并运行」），最下面「让 AI 搭一个」；AI 做好后回到收件页面，新的排在最前、标「刚做好」，仍由用户点「运行」。
