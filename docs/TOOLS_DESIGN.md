# 内置工具与工作流设计

本文是内置工具（图片、PDF、扫描、文字识别、打包、二维码、打印）和跨工具工作流的设计。
决策编号见 [DECISIONS.md](DECISIONS.md)（D-060 起）；用户数据规则见 [DATA_DESIGN.md](DATA_DESIGN.md)。

## 0. 原则

1. **全部在手机本地运行，并且能在 Expo Go 里用**：纯 JS、WebView 里的 JS/WASM、Expo Go 自带的原生模块。做不到的（§9）不做。
2. **AI 永远看不到用户的文件内容、文件名、OCR 出来的文字和记录内容**（D-036 / D-042 / D-046）。AI 只能看到动作目录、参数和工作流结构。用户说出的规格（「240 KB 以内」「600×600」）是规则，可以发给 AI。
3. **工作流是线性的、非图灵完备的**：一串步骤，每步一个登记过的动作，没有分支、循环和表达式（§7C）。
4. **单独使用一个工具 = 只含这一个动作（加上输入步骤）的工作流**。工具页和工作流共用同一个执行器。
5. **纯逻辑放在 `core` 和 `tool-*` 包里，用 Node 加真实文件测试**；平台能力（选照片、编码图片、WebView、打印）由 App 注入。

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

- **输入输出（内核）**：`in.photos`（相册多选或拍照）、`in.files`（PDF / 图片 / 任意文件）、`file.rename`（命名模板）、`file.save`（存到 Morph 文件）、`out.share`、`out.saveToPhotos`、`out.print`；`in.text`（用户输入一段文字，private）、`in.records`（读取一张数据表的记录，可按时间段，按表里第一个日期字段）。（App：expo-image-picker、expo-document-picker、expo-sharing、expo-media-library、expo-print）
- **图片**：`image.convert`、`image.resize`、`image.compress`（压到 ≤ N KB）、`image.crop`（本地框选）、`image.rotate`、`image.stripMetadata`、`image.idPhoto`、`image.stitch`、`image.grid`、`image.redact`（本地）、`image.watermark`、`image.printSheet`（证件照排到 4×6 / 5×7 / A4 / Letter 相纸，带裁切线）。（算法：`packages/tool-image`；编码：expo-image-manipulator；合成：Skia 离屏绘制 `composeImage`，画布单边不超过 8192、总像素不超过 1677 万，超出整体缩小，D-079）
- **PDF**：`pdf.fromImages`（A4 / Letter / 跟随图片，可设边距和 ≤ X MB）、`pdf.merge`（PDF 和图片混合）、`pdf.pages`（本地选页 / 删页 / 排序 / 旋转）、`pdf.selectPages`（按页码规则：全部 / 奇数 / 偶数 / 范围）、`pdf.rotate`、`pdf.split`、`pdf.pageNumbers`、`pdf.stamp`（文字戳 / 日期戳）、`pdf.sign`（本地）、`pdf.fillForm`（本地）+ 拍平、`pdf.toImages`、`pdf.extractText`。（`packages/tool-pdf`：pdf-lib；`toImages` / `extractText` / 缩略图需要 PDF 预览包）
- **扫描**（工具 `scan`）：`scan.detect`（扫描包找边 → 本地调四角，每张都要确认 → 扫描包透视矫正，长边 2400）、`scan.enhance`（提亮 / 灰度 / 黑白 / 原样；Skia 颜色矩阵，不需要扩展包）。
- **文字识别**（工具 `ocr`）：`ocr.recognize`（images → text，参数 `lang` 选 12 种语言之一；`packFor` 按语言确保语言包，语言包连同识别包一起下载）。中日文字之间多出来的空格在本机去掉（`tidyOcrText`）。
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

## 7. 预设工作流和编辑

10 个预设写在 `core/src/workflows/presets.ts`，不随版本：用户在「工作流」页点「添加」（或对 AI 说「添加签证照片工作流」）时用 `presetWorkflow()` 复制进配置（一个可撤销的版本，带 `presetId` 和图标，没有 `toolId`），之后就和用户自己的工作流一样，可以改参数、改步骤、复制、放到页面上、删除。预设是用户工作流，**不要求先安装任何工具**；需要扩展包的预设在第一次运行到那一步时才请用户确认下载（§6）。

| id                   | 名称                | 步骤                                                                       | 扩展包  |
| -------------------- | ------------------- | -------------------------------------------------------------------------- | ------- |
| `visa-photo`         | 签证 / 证件照       | 选照片 → 证件照（美签 600×600，≤ 240 KB）→ 命名                            |         |
| `document-packet`    | 材料包              | 选照片 / 拍照 → 裁剪 → 排顺序（`file.order`）→ A4 PDF ≤ 4 MB → 命名 → 分享 |         |
| `email-photos`       | 照片发邮件 / 传网站 | 选照片 → 长边 1600 → 压到 500 KB → 分享                                    |         |
| `sign-return`        | 签回表格            | 选 PDF → 填表（没有字段时跳过）→ 签名 → 分享                               | pdfview |
| `scan-document`      | 扫描文档            | 拍照 → 找边 → 变清楚 → PDF → 命名 → 分享                                   | scan    |
| `combine-documents`  | 多份材料合一        | 选 PDF 和图片 → 合并 → 选页 / 排序 / 旋转 → 命名 → 分享                    |         |
| `receipt-archive`    | 收据归档            | 拍收据 → 拉正 → 压到 500 KB → 按日期命名 → 存到文件                        | scan    |
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

## 9. Expo Go 里做不了（不做）

- 分享扩展 / 「用 Morph 打开」：用户先把邮件里的文件存到「文件」，再回 Morph 里选。
- 视频压缩和剪辑、智能抠图 / 换底色、桌面小组件、Android 相册清理。
- 基于 ML Kit 或 VisionKit 的原生扫描和 OCR。
- 压缩任意外来 PDF、PDF 加密解密（第二批）。

这些等以后有开发版构建再说。

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
