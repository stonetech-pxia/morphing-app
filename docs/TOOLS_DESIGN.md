# Built-in Tools and Workflows Design

This document is the design for the built-in tools (images, PDF, video, scanning, text recognition, translation, packaging, QR codes, printing) and for cross-tool workflows.
For decision IDs see [DECISIONS.md](DECISIONS.md) (from D-060 on); for user data rules see [DATA_DESIGN.md](DATA_DESIGN.md).

## 0. Principles

1. **Everything runs locally on the phone**. Until T7 it had to work in Expo Go; from T8 the app uses a development build (D-084), which can include local native modules that call **system frameworks** (iOS: Vision / VisionKit / Core Image / AVFoundation, with no third-party native code). Android uses Google ML Kit (D-087) and Jetpack Media3 (video, D-141). Video cannot be processed in Expo Go (`needsFullApp`). Where the system cannot do the job (Expo Go, edge detection for photos on Android, languages ML Kit does not recognize), there must still be a fallback (pure JS or a WebView pack), and the workflow config is the same on every platform. What is not done yet is listed in §9.
2. **The AI never sees the user's file contents, file names, OCR text or record contents** (D-036 / D-042 / D-046; this means the cloud AI, for the on-device model see D-396). The AI sees only the action catalog, parameters and workflow structure. Specs the user states ("under 240 KB", "600×600") are rules and may be sent to the AI.
3. **A workflow is linear and not Turing complete**: a series of steps, each step one registered action, with no branches, loops or expressions (§7C).
4. **Using a single tool = a workflow containing only that one action (plus the input step)**. The tool page and workflows share the same executor.
5. **Pure logic lives in the `core` and `tool-*` packages and is tested in Node with real files**; platform capabilities (picking photos, encoding images, WebView, printing, system recognition) are injected by the app and replaced with fakes in tests.

6. **Containers hand data to tools** (D-428, D-442): opening a container runs nothing. When the user taps a button on a container, it hands over whatever the first step needs: a value (one field, `text`; text, numbers, dates and so on hand over the text they display), this record (`records`, one record), what the list selected (`records`, everything after filtering and search, not cut off at `limit`), or attachments (`files`, **copies** of the kind of file the first step takes from the attachment field, at most 20 at a time, originals untouched). Once handed over, the workflow does not know which record the values came from, and the result is not written back to the source (an external run); when it finishes, the navigation stack returns to the record page. Such a quick action has no input step (`handedInput` in `workflow/check.ts`) and is placed on a table's `recordRow`, on a record block's `{as: "list"}`, or on a single-record block. It cannot be placed on reminders, the phone home screen or ordinary buttons; tapping it from the quick action list only explains that it must be tapped from a record page or list, and does not run. A quick action that needs the user to pick files themselves still starts with `in.photos` / `in.files`.

## 1. Typed Values (replacing D-014's 4 fixed data slots)

Steps pass **one value** between them, and a value has a type:

| Type      | Content                                                          | Notes                                                                                              |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `images`  | Array of image files (JPEG / PNG / WebP / HEIC)                  | Each item has width and height, and optionally a capture time                                      |
| `pdf`     | Array of PDF files (usually 1, several after splitting)          | Each item has a page count                                                                         |
| `files`   | Array of any files                                               | Parent type of `images`, `pdf`, `zip`, `video` and `audio`                                         |
| `zip`     | One ZIP file                                                     |                                                                                                    |
| `video`   | Array of video files (MOV / MP4 etc.)                            | Each item has duration, width and height; native modules read and write in a stream (D-140, D-142) |
| `audio`   | Array of audio files (m4a / wav / mp3 etc.)                      | This batch has only the type and the input; the actions are provided by the audio tools (D-140)    |
| `text`    | A piece of text (OCR, QR recognition, text extracted from a PDF) | **Stays on the device only**: copy, save as a file, generate a PDF, never send to the AI           |
| `records` | Records (one or several)                                         | `in.records` reads a table, or a container hands them over (D-428)                                 |

Type compatibility: when an action declares that it accepts `files`, `images` / `pdf` / `zip` / `video` / `audio` can all connect to it; not the other way around. An action can use `rejects` to exclude subtypes it cannot handle (`pdf.merge` does not take video or audio, D-140).

Runtime value (app layer):

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

Intermediate results are temporary files in the cache directory `runs/<runId>/`, cleaned up when the run ends (success, cancel or failure); only the "Save" step, or the user tapping "Save" on the result page, turns them into user files (the `assets` table). `name` is the display name without the extension and travels with the value; the "Rename" step changes exactly this.

## 2. Action Contract

Each action declares its contract in `core` (`ActionDefinition`), and the implementation lives in a `tool-*` package or in the app runtime:

```ts
interface ActionDefinition {
  id: string; // 'image.compress', prefixed by domain
  label: Localized; // "Compress to size"
  input: ValueType[]; // accepted types; [] = input action (can only be the first step)
  rejects?: ValueType[]; // subtypes that are accepted via files but cannot be handled (D-140)
  output: ValueType | 'same' | ((params) => ValueType); // 'same' = type unchanged (rename, save, share)
  params: ZodType; // parameter schema, parsed once more before running (D-020)
  fields: ParamField[]; // UI metadata for each parameter; the editor builds its form from it
  local?: LocalStepKind; // a step that needs the user to act locally (§4)
  pack?: PackId; // required pack (§6)
  requires: Permission[];
  ai?: string; // hint for the AI (English): when to use it, how to set the parameters; sent to the model with the action catalog (D-259)
  aiRules?: { n: number; text: string }[]; // prompt rules about this action only, inserted into "## Rules" by number
  phrases?: { match: RegExp; step?: (m, locale) => { params; ask?; table? } }[]; // step phrasings recognized by the built-in rules (D-265)
}

interface ParamField {
  key: string; // one key of params
  label: Localized;
  kind: 'number' | 'choice' | 'toggle' | 'text' | 'nameTemplate' | 'color';
  unit?: 'px' | 'KB' | 'MB' | '%' | '°' | 'mm' | 'pt';
  min?;
  max?;
  step?;
  options?: { value; label: Localized }[]; // choice
  presets?: { label: Localized; values: Record<string, unknown> }[]; // "Passport 35×45", "4 MB"
  ask?: boolean; // default "ask on every run"
  private?: boolean; // text the user wrote themselves (watermark, text stamp): replaced with a placeholder before being sent to the AI
}
```

Tests guarantee that every action's `fields` match the keys of its `params` one to one, and that every `presets` entry passes `params` validation.

When adding an action, change only its own definition: its row in the action catalog (`label`, `description`, `ai`), the rules that concern only it (`aiRules`, numbered as the current last one plus 1) and the phrasings the built-in rules recognize (`phrases`; phrasings of different actions must not overlap, `ai/workflow-phrases.test.ts` checks this) are all generated from it. Quick action presets work the same way: the line in the prompt comes from `name`, `description` and the steps, the built-in rules look presets up by name, and other names go in `words`. The names of style presets are in `said` in `presets.ts` (prompt rule 11) and `aliases` (built-in rules).

### Workflow (schemaVersion 5)

```ts
Workflow = { id, name, icon?, toolId?, presetId?, steps: Step[1..12] }
Step     = { id, action, params, ask?: string[] }   // ask: these parameters are asked from the user on every run
```

- `toolId`: created when a tool is installed (the single-function workflows inside the tool and "Merge PDF") and removed together with it when the tool is uninstalled; the user can change the parameters and steps but cannot delete it separately.
- `presetId`: copied from a preset; the edit page offers "Restore preset".
- A workflow without `toolId` is the user's own workflow (added from a preset, duplicated or newly created).

### Validation (`validateWorkspace`)

1. Every step's action is registered, and its parameters pass `params`.
2. The first step must be an input action, and an input action can only be the first step.
3. **Adjacent steps must have types that connect**: starting from the first step's output, check step by step that the current type is accepted by the next step; `'same'` keeps the type.
4. A key in `ask` must be a key in that action's `fields`.
5. A tool's workflows use only the permissions that tool declared (continuing §7B); a user's cross-tool workflows no longer require every action to belong to the same tool.

## 3. Executor

`core/src/workflow/engine.ts` is the only place that runs actions in order (replacing the loop part of `runner.ts` in the app):

- **Progress**: the start and end of each step, and progress inside a step (for example image 3 of 10), are reported to the UI by callback.
- **Cancel**: the UI can cancel at any time; the check happens between steps and between images / pages. Temporary files are cleaned up after a cancel.
- **Errors**: `RunError(code, detail)`; every code has a Chinese and an English message, and detail contains only spec numbers and file display names (shown to the user, not written to the run record).
- **Parameters are parsed again before running** (D-020); parameters asked at run time are merged into this run and not written back to the config.
- **Results can be previewed**: image thumbnails, PDF page count and size, the full text (shown only on the device). The result page always offers "Save to files", "Share", "Save to Photos" (images), "Print" (PDF / images) and "Copy" (text).
- **`tool_runs` records metadata only**: workflow ID, status, error code, output file ID; no content and no file names.
- **Size limits** (P-006): 50 MB per file and 100 MB in total per run; images sent into the WebView are first scaled down to within 16.77 million pixels (the iOS canvas limit). Video and audio are counted separately: 4 GB per file and at most 10 per run, free space is checked before processing starts, and large files are not copied (D-142).
- **Asking a question mid-run**: `LocalUi.choose` asks only a fixed set of questions (the text is in the app), for example when compressing a PDF cannot reach the target: "Convert to images / Use the current one" (D-145).

The interface of an action implementation:

```ts
type ActionImpl = (input: RunValue | null, params, ctx: StepContext) => Promise<RunValue>;
interface StepContext {
  progress(done, total): void; // progress inside a step
  throwIfCancelled(): void;
  local: LocalUi; // opens a local-action UI (§4); returns null if the user cancels
  packs: PackGate; // pauses when a pack is needed and asks the user to confirm the download (§6)
  platform: ToolPlatform; // injected platform capabilities
}
```

## 4. Local Action Steps

Of the 10 researched scenarios, 8 need the user to act by hand. In a workflow such a step is only a placeholder (the AI decides only where it appears); when execution reaches it, the matching UI opens, and the result of the user's action is used only in this run:

| `local`     | UI                                                                                                                            | Used in                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `crop`      | Crop box (aspect ratio can be locked), confirmed one by one                                                                   | ID photo, crop                            |
| `reorder`   | List + move up / move down / delete                                                                                           | Document bundle, merge                    |
| `pages`     | Select, delete, reorder and rotate pages by page number (shows thumbnails when the PDF preview pack is installed)             | Select pages, organize pages              |
| `corners`   | Drag the four corners on the photo                                                                                            | Scan                                      |
| `redact`    | Draw boxes on the image, choose blur or black block                                                                           | Redact a screenshot                       |
| `sign`      | Signature pad (draw once and it can be saved) + choose page and position                                                      | Sign and return a form                    |
| `fillForm`  | Fill in the PDF form fields one by one                                                                                        | Sign and return a form                    |
| `trimMedia` | Video frame (a waveform for audio later) + two handles on a timeline, ±1 second, play only this segment, confirmed one by one | Cut a segment (video, later audio, D-143) |

Signatures are stored in `documentDirectory/signatures/`; they do not go into the config or into versions, and are not sent to the AI.

## 5. Action Catalog (first batch)

The prefix is the domain; implementation locations are in parentheses.

- **Input and output (core)**: `in.videos` (pick videos from the photo library, no transcoding at pick time, D-142), `in.photos` (`source`: multi-select from the photo library, take a photo, or `scanner`, the system document camera: VisionKit on iOS and ML Kit document scanning on Android, with live edge detection, auto capture, multiple pages, and pages already straightened when the shot is done, marked with `straightened`; devices without a document camera use the camera instead, D-086, D-087), `in.files` (PDF / image / video / audio / any file; as the first step these two also receive files shared in from other apps, §11), `file.rename` (naming template), `file.filter` (filter by fixed conditions, §14), `file.save` (save to Morph files), `out.share` (share all files at once, D-119), `out.saveToFolder` (copy into a folder in Files: the user picks it the first time and the same one is remembered afterward, and the result page can change it; cloud drives such as iCloud Drive and Google Drive are synced by their own apps, D-120, D-123), `out.saveToPhotos`, `out.print`; `in.text` (the user types a piece of text, private), `in.records` (read the records of one table, optionally by time period, using the first date field in the table). (App: expo-image-picker, expo-document-picker, local module morph-share (falls back to expo-sharing / expo-file-system in Expo Go), expo-media-library, expo-print)
- **Image**: `image.convert`, `image.resize`, `image.compress` (compress to ≤ N KB), `image.crop` (local box selection), `image.rotate`, `image.stripMetadata`, `image.idPhoto`, `image.stitch`, `image.grid`, `image.redact` (local), `image.watermark`, `image.printSheet` (lay out ID photos on 4×6 / 5×7 / A4 / Letter paper, with cut lines). (Algorithms: `packages/tool-image`; encoding: expo-image-manipulator; compositing: Skia offscreen drawing `composeImage`, canvas at most 8192 on a side and 16.77 million pixels in total, scaled down as a whole when exceeded, D-079)
- **Video** (tool `video`, D-143): `video.compress` (by size ≤ N MB or by quality 1080p / 720p / 480p), `video.convert` (convert to MP4, quality essentially unchanged), `video.trim` (local `trimMedia`, no re-encoding). Output is always MP4 (H.264 + AAC). Bitrate and resolution are computed in `core/media.ts`, and encoding is in the local module `morph-media` (iOS AVFoundation, Android Media3 Transformer, D-141); the input is `in.videos` (photo library, 1–10 items) or `in.files` (`accept: videos`).
- **PDF**: `pdf.fromImages` (A4 / Letter / follow the image, margins and ≤ X MB can be set), `pdf.compress` (compress an existing PDF to ≤ X MB: first compress only the images and keep the text; if that is not small enough, `whenTooBig` decides: ask the user / convert to images / keep text, D-145), `pdf.merge` (PDFs and images mixed), `pdf.pages` (local select / delete / reorder / rotate pages), `pdf.selectPages` (by page-number rule: all / odd / even / range), `pdf.rotate`, `pdf.split`, `pdf.pageNumbers`, `pdf.stamp` (text stamp / date stamp), `pdf.sign` (local), `pdf.fillForm` (local) + flatten, `pdf.toImages`, `pdf.extractText`. (`packages/tool-pdf`: pdf-lib; `toImages` / `extractText` / thumbnails need the PDF preview pack)
- **Scan** (tool `scan`): `scan.detect` (edge detection → adjust the four corners locally, confirmed for every page → perspective correction, long edge 2400; iOS uses Vision for edge detection and Core Image for correction, Android and Expo Go use the scan pack, D-086; pages shot with the document camera pass straight through and also do not need the scan pack; `flatten` is on by default: after straightening, the UVDoc model flattens curved pages, and when the text recognition model is installed it also deskews by text line and straightens line by line, resampling only once; the model is in the pack `dewarp`, and without the download scanning works as usual, D-274), `scan.enhance` (auto / grayscale / black and white / original: remove shadows, correct skew, auto picks color or grayscale per page, black and white uses a local threshold; Skia shader, no pack needed, D-266, D-275).
- **Text recognition** (tool `ocr`): `ocr.recognize` (images → text; parameter `lang` is `auto` (default, not asked; the engine and the way the text is tidied are chosen by the phone's language, D-278) or one of 12 languages. Chinese, Japanese, English, French, German, Spanish, Portuguese and Italian use PP-OCRv6 on both iOS and Android (D-269: the pack `ppocr` is about 31 MB, the model runs on ONNX Runtime, and pre- and post-processing are in `@morph/tool-ocr`); for the remaining languages such as Korean, iOS uses Vision's `VNRecognizeTextRequest` (D-085), and on Android only Korean is left on ML Kit (D-087); when the system cannot recognize it either, `packFor` ensures the language pack for the language, and the language pack is downloaded together with the recognition pack). Extra spaces between Chinese and Japanese characters are removed on the device (`tidyOcrText`). `ocr.toExcel` (images → files, D-272): a table with lines becomes one xlsx (one worksheet per page), with parameters `lang` (same as `ocr.recognize`, default `auto`) and `scope` (everything / table content only); finding lines, building the table and writing the xlsx are in `@morph/tool-office`, using only on-device recognition (it needs the position of each line, and does not use the text recognition pack), and the result page can view and edit it. `ocr.toWord` (images → files, D-328): a printed page becomes one docx (one page per image), with only the parameter `lang` (default `auto`); layout analysis uses the optional pack `layout` (PP-DocLayout-S, D-329; conversion works without the download, it just does not tell titles from images), shared with the tables with lines in the Excel conversion; paragraphs, lists, font size, bold, color, image cropping and writing the docx are in `@morph/tool-office`, and the result page can view and edit it (tables use the Excel conversion's edit page).
- **Translation** (tool `translate`, D-170–D-176): `translate.text` (text → text; parameter `from`: auto-detect or one of 20 languages; `to`: one of 20 languages; asked on every run by default). iOS uses the system Translation framework (from iOS 18; from iOS 26 a session is created directly for languages already downloaded, and when a download is needed or on an earlier system an invisible SwiftUI view with `.translationTask` is attached, with the system showing a dialog to download the language pack), and NaturalLanguage for language detection; Android uses ML Kit translation (each language model is about 30 MB; on first use the app first asks "First use needs a download of about X MB" and then downloads, after which it works offline) and ML Kit language identification (bundled in the app). Before translating, the text is split into paragraphs on the device (`splitForTranslation`: blank lines separate paragraphs, sentences wrapped within a paragraph are joined, and titles, short lines and list items start a new one); with auto-detection, the language of each paragraph is identified separately and they are translated grouped by source language, paragraphs that are already in the target language are kept as they are, and then they are joined back in the original paragraph order (`joinTranslation`). The output is plain text only (can be followed by `text.toPdf` to typeset a PDF) and does not keep the original file's layout; the result page says "Translated on this device — good for understanding the meaning. For official documents, use a professional translator." At most 100,000 characters at a time. Expo Go and iOS 17 and earlier report "This step is not supported" and explain why; ML Kit has no Traditional Chinese. The text is not uploaded and not sent to the AI.
- **Text** (tool `text`): `text.copy`, `text.toFile` (.txt), `text.toPdf` (expo-print, system fonts, Chinese, Japanese and Korean all display), `text.toDocx` (.docx, blank lines separate paragraphs, D-441; the file is written with `writeDocx` from `tool-office`); text processing `text.tidy`, `text.replace`, `text.extract`, `text.lines` (§14, D-245).
- **Packaging** (tool `zip`): `zip.create`, `zip.extract`. (`packages/tool-archive`: fflate, synchronous interface only)
- **QR code** (tool `qr`): `qr.generate` (text → PNG, with tool-qr's own PNG encoder), `qr.read` (image → text, Skia reads the pixels and then jsQR). (`packages/tool-qr`: lean-qr, jsQR)
- **Report** (tool `print`): `print.records` (`records` → PDF; templates: table / cards / list with totals; record values are escaped first and then filled in locally, and the AI only picks the template, title and field IDs, D-042, D-080). Templates are in `core/src/html.ts`. Optional parameter `attachments`: each record's photos and PDFs are appended in record order, stating which record each belongs to; those that cannot be read or exceed the limit are printed on the report (D-425, limits in `REPORT_ATTACHMENT_LIMITS`).
- **vCard** (core actions, not part of a tool): `records.toVCard` (`records` → one `.vcf`, no parameters, D-423), `records.toVCardText` (the same content, `records` → `text`, for connecting to `qr.generate`, D-428). The pure functions are in `core/src/vcard.ts`.
- **Open a value** (core actions, D-428): `out.call`, `out.message`, `out.email`, `out.website` (`text` → `text`, no parameters). Links are built only by `core/field-link.ts` (`tel:`, `sms:`, `mailto:`, `http(s)://`), websites ask first, and nothing is sent out by itself. Like `out.share`, it can only be a step of a quick action.
- **Excel** (core action, not part of a tool): `records.toExcel` (`records` → one `.xlsx`, named after the table, no parameters, D-427). The columns are the same as CSV; numbers, amounts and dates are real numbers and dates, text is always text, and the file has no formulas. The cells are in `core/src/records-sheet.ts`, and the file is written by `writeRowsXlsx` from `tool-office`.

File names are decided when the user picks the file; the AI can only give a naming **template**: `{date}` (= `{date:YYYY-MM-DD}`), `{date:FORMAT}`, `{index}`, `{seq}` (two-digit sequence number 01, 02…), `{sourceName}`, `{taken}` / `{taken:FORMAT}` (the photo's capture date, the current day if it cannot be read), `{ocr:rule}` / `{qr:rule}` (a piece taken by a fixed rule from the text / QR content recognized on the device from this photo, §14).

## 6. Packs (downloaded on demand)

Small libraries are bundled directly into the app: pdf-lib, fflate, lean-qr, jsQR, exifr, Skia. Large dependencies are made into packs:

| Pack         | Content                                                             | Size (download)                 |
| ------------ | ------------------------------------------------------------------- | ------------------------------- |
| `scan`       | opencv.js + jscanify                                                | about 9 MB                      |
| `ocr`        | tesseract.js, worker, core wasm                                     | about 4 MB                      |
| `ocr-<lang>` | one model per language (4.0.0_best_int): eng, chi_sim, etc.         | 1.7–3 MB each                   |
| `pdfview`    | pdf.js (legacy build)                                               | to be filled in after measuring |
| `speech-*`   | whisper model + voice detection for speech-to-text on Android (§12) | 61 / 191 MB                     |

Mechanism:

- **The manifest is in code** (`core/src/packs.ts`): id, version, file list (download URL, SHA-256, size), license. After the download, each file's SHA-256 is verified; on a mismatch the whole version directory is deleted and an error is reported.
- **Only the user can trigger a download**: the UI shows the size and recommends Wi-Fi. Neither the AI nor a workflow can download by itself; when execution reaches a step that needs a pack, it pauses and shows a dialog asking the user to confirm (`PackGate`), and if the user refuses, this run is canceled.
- **Storage**: `documentDirectory/packs/<id>/<version>/`; `ready.json` is written only after writing and verification are complete, so an interrupted download is not treated as installed. It does not go into a revision, so rollback is unaffected; once downloaded, it can be used offline.
- **Management**: "Settings → Downloads" (`app/packs.tsx`) lists the downloaded packs, the space they use, licenses and versions, and they can be deleted (deleting the text recognition pack also deletes the language packs). Translation languages already downloaded on Android (ML Kit models, which are not packs and are not in the `PACKS` manifest) are also listed on this page and can be deleted (D-175); on iOS, translation languages are managed by the system's Settings → Translate.
- **Loading**: the WebView loads only the fixed HTML we ship with the app, library files are read from the local pack directory, and the network is not accessed (CSP `default-src 'none'`, see the T4 experiment notes). Between the WebView and the app there are only messages in a fixed format (action name + data), and no model-generated string is injected (open-tool-research N3).
- **Download source**: first use pinned-version URLs on jsDelivr, later switch to our own server (only the manifest changes).
- **App Store 2.5.2**: see DECISIONS (awaiting the founder).
- **If the system can do it, no pack** (D-085–D-087): the executor asks `packNotNeeded(action, params, input)`, and if it returns true the pack is not confirmed: the system can recognize this language (all 12 on iOS, 11 on Android, all except Russian), the system can detect edges (iOS), or the input is entirely pages already straightened by the document camera. The workflow page's "Needs a download on first run" is computed the same way (`packsNeeded`). The scan pack and the text recognition pack are left for Android (photo-library edge detection, Russian, no Google Play services) and Expo Go; the PDF preview pack is still needed on every platform.

**Native dependencies** (Gradle / system frameworks, not in `check:licenses`; update this table when adding one):

| Dependency                                                                                     | Version                         | Platform | License / terms                            | Purpose                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------- | -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Vision, VisionKit, Core Image, ImageIO                                                         | built into the system           | iOS      | Apple system frameworks                    | Text recognition, edge detection, straightening, document camera                         |
| Translation (weak link, from iOS 18), NaturalLanguage, SwiftUI                                 | built into the system           | iOS      | Apple system frameworks                    | On-device translation, language detection (morph-translate, D-170)                       |
| `com.google.mlkit:translate`                                                                   | 17.0.3                          | Android  | Closed source, Google ML Kit terms (P-015) | On-device translation; language models are downloaded on first use (about 30 MB each)    |
| `com.google.mlkit:language-id`                                                                 | 17.0.6                          | Android  | Closed source, Google ML Kit terms (P-015) | Identifies the language of each piece of text; the model is bundled in the app           |
| UIKit (`UIActivityViewController`, `UIDocumentPickerViewController`), UniformTypeIdentifiers   | built into the system           | iOS      | Apple system frameworks                    | Share several files at once, save to a chosen folder (morph-share, D-119, D-120)         |
| `androidx.core` (FileProvider, already in the app with React Native), Storage Access Framework | with RN / built into the system | Android  | Apache-2.0 / Android system interface      | Share several files at once, save to a chosen folder (morph-share)                       |
| `com.google.mlkit:text-recognition-korean`                                                     | 16.0.1                          | Android  | Closed source, Google ML Kit terms (P-015) | Korean recognition; the model is bundled in the app (D-269)                              |
| `com.microsoft.onnxruntime:onnxruntime-android`                                                | 1.30.0                          | Android  | MIT                                        | Runs the PP-OCRv6 text recognition model (D-269)                                         |
| `onnxruntime-objc` (CocoaPods)                                                                 | 1.30.0                          | iOS      | MIT                                        | Runs the PP-OCRv6 text recognition model (D-269)                                         |
| `com.google.android.gms:play-services-mlkit-document-scanner`                                  | 16.0.0                          | Android  | Closed source, Google APIs terms (P-015)   | Document scanning UI (needs Google Play services)                                        |
| `com.google.android.gms:play-services-base`                                                    | 18.11.1                         | Android  | Closed source, Google APIs terms (P-015)   | Checks whether Google Play services are present                                          |
| AVFoundation, CoreMedia, VideoToolbox                                                          | built into the system           | iOS      | Apple system frameworks                    | Video compression, format conversion, trimming, frame extraction (morph-media, D-141)    |
| `androidx.media3:media3-transformer`, `media3-effect`, `media3-common`                         | 1.9.1                           | Android  | Apache-2.0                                 | Video compression, format conversion, trimming (morph-media; same version as expo-video) |
| `ExpoShareIntentModule` (CocoaPods, comes with the npm package expo-share-intent)              | 9.0.0                           | iOS      | MIT                                        | Share to Morph: the main app reads the shared directory (§11)                            |
| `expo-share-intent` (Gradle module, comes with the npm package)                                | 9.0.0                           | Android  | MIT                                        | Share to Morph: receives `ACTION_SEND` (§11)                                             |
| Social, UniformTypeIdentifiers, ImageIO (share extension `MorphShare`)                         | built into the system           | iOS      | Apple system frameworks                    | The share extension copies files (§11)                                                   |
| Speech, AVFoundation, CryptoKit                                                                | built into the system           | iOS      | Apple system frameworks                    | Speech-to-text (morph-speech, §12)                                                       |
| whisper.cpp (includes ggml; the CMake build downloads the source by SHA-256)                   | 1.9.5                           | Android  | MIT                                        | Speech-to-text (§12)                                                                     |
| MediaExtractor, MediaCodec                                                                     | built into the system           | Android  | Android system interface                   | Decodes audio for whisper (§12)                                                          |
| `com.google.mlkit:face-detection`                                                              | 16.1.7                          | Android  | Closed source, Google ML Kit terms (P-015) | Automatic face framing for ID photos; the model is bundled in the app (D-252)            |
| Vision (`VNDetectFaceRectanglesRequest`, `VNGeneratePersonSegmentationRequest`), Core Image    | built into the system           | iOS      | Apple system frameworks                    | Automatic face framing for ID photos, background color change (D-252)                    |
| `expo-notifications` (npm package, with iOS / Android native code)                             | 58.1.6                          | Both     | MIT                                        | Reminders: local notifications (D-251), no push registration                             |

## 7. Preset Workflows and Editing

Presets are written in `core/src/workflows/presets.ts`, are not part of versions, and are built-in quick actions (D-236): they need no Add, run directly on the quick actions page and in the inbox, and run records are filed under the preset ID (`builtInWorkflows()` / `findWorkflow()`). Only when the user saves a change, puts one on the home page, combines two quick actions, or tells the AI "add the visa photo workflow" is `presetWorkflow()` used to store it in the config under the preset ID (one undoable version, with `presetId` and an icon, without `toolId`); after that it is the same as the user's own workflow: its parameters and steps can be changed, it can be duplicated, put on a page and deleted, and once deleted it goes back to the built-in one. A preset is a user workflow and **does not require installing any tool first**; a preset that needs a pack asks the user to confirm the download only when the first run reaches that step (§6).

The "Ready-made" section of the quick actions page is grouped by everyday scenario (`PRESET_SCENARIOS`, D-130): getting papers for going abroad (visa / ID photo, print ID photos, translate Chinese documents into English), submitting documents and signing files (application packet, sign and send back, scan a document, combine documents, PDF too big to upload, translate a foreign-language PDF into Chinese, photograph foreign-language documents and translate them into Chinese), expenses and bookkeeping (receipt archive), sending photos and videos (photos for email, hide parts of screenshots and share, send many photos, video too big to send, translate screenshots) (D-146). Translation presets translate into the interface language (an English interface translates into English), and their names change with it.

| id                     | Name                                   | Steps                                                                                                                                    | Pack      |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `visa-photo`           | Visa / ID photo                        | pick photos → ID photo (US visa 600×600, ≤ 240 KB) → rename                                                                              |           |
| `document-packet`      | Application packet                     | pick photos / take photos → crop → reorder (`file.order`) → A4 PDF ≤ 4 MB → rename → share                                               |           |
| `email-photos`         | Photos for email or upload             | pick photos → long edge 1600 → compress to 500 KB → share                                                                                |           |
| `sign-return`          | Sign and send back                     | pick PDF → fill form (skip when there are no fields) → sign → share                                                                      | pdfview   |
| `scan-document`        | Scan a document                        | document camera scan (or take a photo and then detect edges) → clean up → PDF → rename → share                                           | scan      |
| `combine-documents`    | Combine documents                      | pick PDFs and images → merge → select pages / reorder / rotate → rename → share                                                          |           |
| `receipt-archive`      | Receipt archive                        | scan receipts (or take photos and then straighten) → compress to 500 KB → name by date → save to files                                   | scan      |
| `redact-screenshots`   | Hide parts of screenshots              | pick screenshots → stitch into a long image → redact → share                                                                             |           |
| `send-photos`          | Send many photos                       | pick photos → convert to JPG → remove location → long edge 2048 → ZIP → share                                                            |           |
| `print-id-photos`      | ID photos to print                     | pick photos → ID photo → lay out on 4×6 paper (cut lines) → print or save                                                                |           |
| `pdf-too-big`          | PDF too big to upload                  | pick PDF → compress PDF (default 2 MB, asked every time) → share                                                                         |           |
| `video-too-big`        | Video too big to send                  | pick videos → compress video (default 20 MB, asked every time) → share                                                                   |           |
| `foreign-pdf`          | Translate a PDF into English           | pick PDF → extract text → translate into Chinese → text to PDF → name "original name-Chinese" → share                                    | pdfview   |
| `foreign-paper`        | Translate paper documents into English | document camera scan → detect edges → recognize text (language asked every time) → translate into Chinese → text to PDF → rename → share | scan, ocr |
| `papers-to-english`    | Chinese documents into English         | document camera scan → detect edges → recognize Chinese → translate into English → text to PDF → rename → share                          | scan, ocr |
| `screenshot-translate` | Translate screenshots                  | pick screenshots → recognize text (language asked every time) → translate into Chinese → copy text                                       | ocr       |

**The "Workflows" page** (`app/workflows.tsx`, entered from the Settings page and the Tools page): My workflows (run / edit), the preset library (Add; already added ones show "Added" and can be added again as another copy), and the ones that come with tools (collapsed by default). This page is provided by the core, and the AI cannot change it.

**The edit page** (`app/workflow/[id].tsx`, `run/WorkflowEditor.tsx`):

- Name (1–40 characters); each step's form is generated automatically from `fields` (`ParamForm`, including the `presets` shortcut buttons), and "ask on every run" is ticked parameter by parameter.
- "Add a step here" lists only the actions whose types connect (`insertableActions`), and a new step's parameters use `initialParams(action)`; move up / move down / delete; steps that do not connect are marked red and cannot be saved.
- Changes go into a draft first; "Save" uses one `updateWorkflow` to produce one version (summary: Change workflow "X"), the banner can undo it, and it can be restored from the history. When the workflow is changed elsewhere (undo, the AI) and the draft has no unsaved changes, the draft updates with it.
- "Duplicate", "Put on Home" (`addComponent` of a `workflowRunner`), "Reset to the preset" (when there is a `presetId`), "Delete" (confirmed once, files are not affected; ones that come with a tool cannot be deleted). The editor can also be entered from the result area of the run page.

**New actions and parameters**:

- `file.order` (local `reorder`): the user sorts the order and can drop some items; `files` / `images` of any type can connect to it.
- `pdf.fillForm.whenNoFields`: `'stop'` (default, report an error) or `'skip'` (hand it to the next step as is; "Sign and send back" uses it to handle scans).
- `presets` were added to the input and common actions ("Photo library, up to 30 photos", "PDF, up to 10", "240 KB / 500 KB / 1 MB / 2 MB" and so on).

**Operations** (`core/src/ops.ts`, descriptions in `describe.ts`; the edit page and the AI use the same protocol):

| op                                               | Notes                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addWorkflow {workflow}`                         | Cannot carry `toolId`; at most 100 workflows                                                                                                                          |
| `removeWorkflow {workflowId}`                    | One that comes with a tool cannot be deleted; the `workflowRunner` that runs it is removed at the same time (the description says "also removes N cards")             |
| `renameWorkflow {workflowId, name}`              |                                                                                                                                                                       |
| `addWorkflowStep {workflowId, step, index?}`     | Without `index` it is added at the end                                                                                                                                |
| `moveWorkflowStep {workflowId, stepId, toIndex}` |                                                                                                                                                                       |
| `removeWorkflowStep`, `setStepParams`            | Existing (`setStepParams` includes `ask`)                                                                                                                             |
| `updateWorkflow {workflowId, name?, steps?}`     | One save from the edit page; the private parameters the AI sees are `<user text>` placeholders, and when they are passed back unchanged the old value is kept (D-082) |
| `setWorkflowHomeScreen {workflowId, homeScreen}` | Put on the phone home screen / remove (D-271); at most 4, and `addWorkflow` cannot carry this flag                                                                    |

After every operation `validateWorkspace` (§2) runs as usual, and a workflow whose steps do not connect is not committed. The planner's prompt contains the action catalog (id, input and output types, parameter structure with enums and ranges, required packs), the preset list, and rules 20 (build a workflow) and 21 (turn records into a report).

## 8. Migration (schemaVersion 4 → 5)

Only the workflow step format changed:

| v4                                                              | v5                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pdf.selectFiles {min, max}`                                    | `in.files {accept: 'pdf', min, max}`                                            |
| `pdf.merge {}`                                                  | `pdf.merge {}` (now also accepts images)                                        |
| `ui.askFileName {defaultTemplate}` + `file.save {nameTemplate}` | `file.rename {template: defaultTemplate}`, `ask: ['template']` + `file.save {}` |
| Only `file.save {nameTemplate}` (asking already removed)        | `file.rename {template: nameTemplate}` + `file.save {}`                         |

With v4 fixtures (default, steps simplified, asking removed) and tests. The tool page's components are untouched; features a tool gains later are added through the "Update" button in the tool catalog (`updateTool`: adds the missing workflows and the entries on the tool page, and keeps the user's changes).

## 9. Not Done Yet (needs native capabilities)

Since T8 there is a development build (D-084), so the following can be done with native modules, but are not scheduled:

- Filling in Chinese forms, "Open with Morph" (file type association; "Share to Morph" is done, see §11). Automatic face framing and background color change for ID photos are done (D-252).
- Home-screen widgets, Android photo library cleanup; audio (speech-to-text, shrink / convert format, cut a segment, record, join; done by the audio tools, from D-150).
- Video: continue processing in the background on iPhone (Android can already, D-160; from iOS 26 it can too, confirmed on a real device on 2026-10-31, D-163), record with Morph, HEVC output.
- Edge detection for existing photos on Android (ML Kit has no such interface, so the scan pack is used for now; none of the alternatives we looked at work, see D-253).
- PDF encryption and decryption (second batch); when compressing a PDF, use native rendering instead of the PDF preview download.

## 10. Milestones

| Milestone | Content                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| T0        | Merge branches; this document                                                                                                        |
| T1        | Typed actions and executor; migrate "Merge PDF"; core input and output actions                                                       |
| T2        | Images: convert format, resize, compress to N KB, crop UI, rotate, remove location; standalone tool pages                            |
| T3        | PDF: images to PDF, PDF ≤ X MB, mixed merge, select / delete / reorder / rotate / split by page number, page numbers and text stamps |
| T4        | Pack mechanism + PDF preview pack (thumbnails, signature placement) + signing + form filling                                         |
| T5        | Scan pack (edge detection, adjust corners, enhance) + text recognition pack (downloaded per language)                                |
| T6        | Skia: stitch into a long image, redact, watermark, ID photo layout; ZIP; QR code; generate PDF from records / print; text to PDF     |
| T7        | Preset workflows + editor + AI changing and creating workflows (operations, planner, mock, eval)                                     |
| T8        | Development build; iOS native text recognition and scanning (Vision, Core Image, document camera); packs kept as a fallback          |
| T9        | Android: ML Kit text recognition and document scanning (D-087)                                                                       |
| T10       | Share to Morph: iOS share extension + Android intent-filter, the inbox, shared files handed to workflows (§11)                       |

## 11. Share to Morph (D-114–D-118)

The user taps Share in an app such as Photos, Files, Mail or WeChat → picks Morph → the files enter Morph, and the user picks a workflow to run, or saves them as Morph files.

**Native part** (expo-share-intent 9.0.0, MIT, D-114):

```
iOS: other app ──share──▶ share extension MorphShare (our ShareViewController.swift, D-118)
        copies the files in order into the App Group shared directory (UUID.extension), writes UserDefaults[morphShareKey]
        ──morph://dataUrl=morphShareKey?nonce=…#media|file──▶ main app
Android: other app ──ACTION_SEND / ACTION_SEND_MULTIPLE (image/*, video/*, audio/*, application/*)──▶ MainActivity (singleTask)
Main app: ExpoShareIntentModule.getShareIntent → onChange (JSON on iOS, an object with content:// on Android)
```

- `ios/` and `android/` are still generated by prebuild: the `expo-share-intent` parameters in `app.json` (activation rules: at most 50 images and 50 files each; Android MIME types; extension target name `MorphShare`), plus the local plugin `plugins/with-share-extension.js` (changes the display name to "Morph" and swaps in our controller).
- The entry point in the app is `share/useIncomingShare.ts` (called by the root layout): it subscribes to the native module's `onChange` → `normalizeShare` (data from both platforms → the same `PickedFile[]` as the pickers, accepting only `file://` / `content://`, not text or URLs) → puts it in the in-memory `useIncoming` → opens `/share`. The wake-up link on iOS is intercepted by `app/+native-intent.tsx` (a cold start goes to the home page, and while the app is open it stays on the current page). In Expo Go and in tests, where there is no native module, it does nothing; tests use a fake native module (`__tests__/share-test.tsx`).

**The inbox** (`/share`, D-117): file names and sizes (shown only on the device) → "Save to Morph files" → "Process with a workflow": `shareFit(workflow, files)` looks at the first step:

| First step              | What it accepts                                                                                                                                          | Value type            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `in.photos`             | Images only (the source can be the photo library, the camera or a scan; photos that are not straightened are handled by the edge detection that follows) | `images`              |
| `in.videos`             | Videos only (D-144)                                                                                                                                      | `video`               |
| `in.files`              | By `accept`: `pdf` all PDFs, `images` all images, `pdfOrImages`, `zip`, `videos`, `audio`, `any`                                                         | `FILE_ACCEPT[accept]` |
| `in.text`, `in.records` | Not accepted                                                                                                                                             |                       |

The count must also be between the first step's `min` and `max`: ones with the right type but the wrong count are listed but cannot be run ("Needs at least 2 files", "Takes at most 1 file"). When the size limit (P-006, `sharedSizeProblem`) is exceeded, only an error is shown. It runs only when "Run" is tapped, never automatically.

**Running** (D-115): `/run/<id>?shared=<share ID>` → `startRun({ incoming })` → `RunServices.incoming`. When `in.photos` / `in.files` see `incoming` as the first step, they do not open the picker; they check the type and count again with `shareFitsInput` and the size per P-006, and then copy the files into this run's temporary directory just like files chosen from a picker; the first step's "ask on every run" is not asked. The first step on the run page shows "Shared files (N)".

**Cleanup** (D-116): when the run page is closed, after saving to Morph files, and when the inbox is closed, `releaseShare` deletes this batch from the shared directory; when another batch is shared, whatever is left of the previous batch is deleted. Only UUID file names written by the share extension are deleted.

**The AI cannot see them**: the shared files, file names and counts never go into the config or versions; only when the user taps "Have AI build one" in the inbox does the planner receive the types and counts of the files (for example "2 photos, 1 PDF", D-124, D-129), while file names, sizes and contents are still not sent; the workflow format has not changed, and the AI-related parts (prompt, mock phrasings, eval) were not changed.

**Building one on the spot in the inbox** (D-129): the user's own quick actions → "Have AI build one" → built-in quick actions whose first step can take these files (directly "Run", D-236) → single functions from tools; after the AI is done it returns to the inbox, the new one is listed first and marked "just made", and the user still taps "Run".

## 12. Speech-to-Text (D-150, D-151, audio session phase one)

Only the base layer is done: the local module `modules/morph-speech`, the downloads, and the app-side adapter (`runtime/speech.ts`). It is not yet connected to quick actions; phase two (the `audio` value type, the `speech.transcribe` action, recording, the result page, etc.) will be done after the video session's shared base layer (native media module, trim UI) is merged into main.

```
JS (runtime/speech.ts)
  need(language, model) → ready / systemDownload (iOS) / pack (Android) / unsupported
  prepare(language)         iOS has the system download the recognition model (after the user confirms)
  transcribe(address, …)  → paragraphs → tidyTranscript (core/speech.ts) → text
iOS (MorphSpeechModule.swift)
  iOS 26+: SpeechAnalyzer + SpeechTranscriber; DictationTranscriber when the device does not have it (isAvailable is false) or the language is unsupported
          the file is read in 1-second chunks, converted with AVAudioConverter to bestAvailableAudioFormat and fed in
  earlier: SFSpeechRecognizer + requiresOnDeviceRecognition (the first time shows the "Speech Recognition" permission prompt)
Android (MorphSpeechModule.kt + cpp/morph_whisper.cpp)
  MediaExtractor + MediaCodec decode → mix to mono → windowed sinc resampling to 16 kHz (Pcm.kt, has unit tests)
  → segments of 5 minutes (cut at the quietest point within the last 20 seconds of a segment) → whisper_full (beam search 5, voice detection, Mandarin Simplified Chinese prompt)
```

- **whisper.cpp patch** (`cpp/patch-whisper.cmake`, applied at build time): when a window ends with a single timestamp, the rest is no longer skipped, and recognition continues from the last timestamp (voice detection is on, so everything fed in is speech; on the Samsung real device a 5-minute meeting used to lose about 1 minute). When the whisper.cpp version is changed, if the patch cannot find that line the build fails.

- **Languages**: `SPEECH_LANGUAGES` (12, same as text recognition); iOS uses `SYSTEM_SPEECH_LOCALES` (BCP 47), and whisper uses `whisperLanguage` (Mandarin is also zh, and `whisperPrompt` makes it output Traditional characters).
- **Tidying** (`tidyTranscript`): Chinese gets full-width punctuation and the spaces between Chinese characters are removed; whole segments that whisper makes up in silence, such as subtitle-site credits, "thanks for watching" and [music], are dropped; Chinese and Japanese are joined directly and other languages with spaces; a pause of 3 seconds or more starts a new paragraph (on Android, with voice detection on, the times whisper gives are continuous, so starting new paragraphs has no effect; phase two will fill this in with the time ranges from voice detection).
- **Downloads**: `speech-whisper-small` (190 MB), `speech-whisper-base` (60 MB), both depending on `speech-vad` (0.9 MB). Files larger than 32 MB go through `PackFs.downloadLarge`: expo-file-system downloads to disk and reports progress by bytes, and the SHA-256 is computed by `MorphSpeech.sha256File` in native code while reading (MessageDigest on Android, CryptoKit on iOS), so that hundreds of MB are not read into JS.
- **CPU backends** (Android arm64): ggml is built in four variants, armv8.0 / 8.2 (dot product) / 8.2 (dot product + half precision) / 8.6 (plus i8mm), and at run time the newest one this phone supports is picked; the variants with SVE / SME are not bundled: the Android emulator on Apple silicon claims to support SVE2 / SME2, and with them a 22-second recording takes 562 seconds (42 seconds with the normal variant), while the same build on a Mac exits directly with an illegal instruction.
- **Cancel**: on the native side it is an atomic variable, whisper checks it in the gaps of the compute graph, and it takes effect within 10–20 seconds on the emulator; on iOS the Swift task is canceled and `cancelAndFinishNow` is called.
- **Error codes**: `ERR_SPEECH_UNSUPPORTED_LANGUAGE`, `_NEEDS_DOWNLOAD`, `_NOT_AUTHORIZED`, `_UNREADABLE_AUDIO`, `_MODEL`, `_CANCELLED`, `_UNAVAILABLE` (system recognition cannot be used on the device), which the app side converts to `SpeechError.code`.

**Measured** (2026-10-23; the test recordings are m4a / wav files generated from a Mac reading text aloud):

| Environment                                                        | Result                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android emulator morph_api35 (arm64, 2.5 GB memory), whisper small | 22 seconds of Chinese → recognized in 42 seconds, all correct; 108 seconds of Chinese (65 seconds of silence in total at the start, end and middle) → 78 seconds, both parts complete, no made-up sentences; 16 seconds of English → 30 seconds, all correct; cancel works; the 190 MB model downloaded and verified successfully |
| iOS simulator iPhone 18 Pro Max (iOS 27)                           | System recognition **cannot be used on the simulator**: SpeechTranscriber `isAvailable` is false, DictationTranscriber takes a slot and then shows installed but with no usable audio format, and the old API reports "Failed to initialize recognizer"; now all report `ERR_SPEECH_UNAVAILABLE` and do not crash                 |
| Mac (macOS 27, the same Swift code compiled separately)            | SpeechTranscriber: character error rate 2.3% / 22% for Chinese, and the recording with 65 seconds of silence is complete; DictationTranscriber: 4.7% / 36%, with more punctuation                                                                                                                                                 |
| Real device                                                        | Not tested (no iPhone; the Samsung real device is the founder's own phone, and phase one was not installed on it)                                                                                                                                                                                                                 |

## 13. Audio Tools (D-152–D-158, audio session phase two)

| Action             | Input → output         | Parameters                                                        | Implementation                                                                                            |
| ------------------ | ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `in.audio`         | → audio                | `source: files / record`, `min` / `max`                           | File picker `audio/*`; recording UI `run/local/RecordScreen.tsx` (local UI `record`)                      |
| `audio.transcribe` | audio → text           | `lang` (12), `model` (Android: more accurate / faster)            | morph-speech (§12); on iPhone, the first use of a language asks first and then has the system download it |
| `audio.compress`   | audio → audio          | `by: size / quality`, `maxMB`, `quality: high / standard / voice` | `planAudioSize` / `planAudioQuality` → morph-media `transcode` (`video: 'drop'`)                          |
| `audio.convert`    | audio → audio          | `format: m4a / wav`                                               | Not converted when it is already in this format                                                           |
| `audio.trim`       | audio → audio          | None (local action `trimMedia`, with a waveform)                  | Re-encoded to M4A, with `range`                                                                           |
| `audio.merge`      | audio → audio (1 item) | None                                                              | morph-media `concat`                                                                                      |
| `audio.fromVideo`  | video → audio          | `format`                                                          | A video without sound reports `noAudio`                                                                   |
| `audio.fromText`   | text → audio           | `lang` (auto / 20), `rate` (0.5–2), `format: m4a / wav`           | morph-tts reads it with the system voice into WAV, and M4A is then converted by morph-media (§15, D-270)  |

- What was added to morph-media: on iOS `writeAudio` (`AVAssetReaderAudioMixOutput` → AAC `.m4a` / LPCM `.wav`), `concat` (one composition track per segment, joined end to end), `waveform` (8 kHz mono peaks); Android M4A uses Media3 (picture removed, `ChannelMixingAudioProcessor` + `SonicAudioProcessor` unify the format; packaging uses the system MediaMuxer, because the default InAppMp4Muxer reserves about 400 KB at the start of the file), and WAV and the waveform are decoded by `AudioPcm.kt` itself.
- App: `runtime/actions/audio.ts`, `MediaPlatform.encodeAudio / concatAudio / waveform`, `FilePlatform.speech`, `packNotNeeded` (iPhone needs no downloads).
- Errors: `audioTooSmall`, `noAudio`, `noSpeech`; the wording of `needsFullApp` was changed to "video and audio".
- Tests: `core/audio.test.ts`, `audio-actions-test.ts` (fake media / speech), `audio-journeys-test.tsx` (UI journeys for recording, transcription, waveform trimming and shrinking).

## 14. Conditions, Grouping and Text Processing (from D-242)

Steps are still linear: conditions, grouping rules and extraction rules are **data** chosen from fixed sets, with no expressions, loops or branches, and the AI cannot see files or text.

**Filter by condition** (`file.filter`, D-242): files in, the same type out. Flat parameters, at most one per kind of condition; "any" is not checked, and a file is kept only if it meets all the others:

| Parameter                              | Condition                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                                 | Image / PDF / video / audio / office document (MIME first, the extension when that is unreliable)                                                             |
| `size` + `sizeMB`                      | Larger / smaller than N MB                                                                                                                                    |
| `orientation`                          | Landscape / portrait / square (a width-height difference within 2% counts as square); read with `imageSize` when the picker did not give the width and height |
| `date` + `days` / `period` / `from–to` | The last N days, a calendar period (same as the table's `PERIODS`), between two dates; capture time, the modified time when there is none                     |
| `duration` + `seconds`                 | Video or audio longer / shorter than N seconds; read with `media.probe` when there is no duration                                                             |

Information that cannot be read counts as not met. When nothing is left, `whenEmpty`: `stop` reports `noneMatched`, `skip` hands it to the next step as is. A file is only left out of this run and is never deleted. The pure logic is `core/file-filter.ts` (Node tests), and the app implementation is in `runtime/actions/io.ts`.

**One output per group** (D-243): instead of a "do for each group" loop, `group` is added to the three actions that "turn a batch of files into files": `pdf.fromImages`, `pdf.merge`, `zip.create`. `group`: `none` (default, one output), `count` + `groupSize` (one output per N files in the original order), `day` / `month` (by capture time, the modified time when there is none; groups are sorted by date, and files whose date cannot be read go last as "No date"). The output is still an ordinary array of files, named after the date or the first file of the group, and a following `file.rename {sourceName}`, share and save to folder work as usual. The pure logic is `core/grouping.ts`.

**Naming with recognized text** (D-244): `{ocr:rule}` / `{qr:rule}`, where the rule is `firstLine`, `invoiceNo`, `date`, `amount`, `phone`, `email`, `url`, `number` (`core/text-rules.ts`, regular expressions are not accepted). When `file.rename` sees these two placeholders, it first recognizes each image on the device: text uses system recognition (interface language + English; `needsRecognition` is reported when there is none), and QR codes use jsQR. The text is used only to build the name, is not kept, and is not sent to the AI. When nothing can be taken, that part is not written; if nothing is left, the original name is used.

**"Add an entry" prefill** (an extension of D-244, decided 2026-10-28, prototype in `core/prefill/`; since D-394 and D-397 both "Add an entry" and the record page's form use it): date, amount, tax amount and number rely mainly on the `text-rules` rules, and system recognition (iOS DataDetection / NSDataDetector, Android ML Kit entity extraction, asking the user before the model is downloaded) is only a supplement; layout memory is learned after a single save, and when anything in a later file does not match or is unreasonable it is left blank and does not fall back to the rules; this layout-memory path does not use a large model (the suggestions for a new record form can use the on-device model, D-396, D-401). Settings → Data can clear the prefill memory in one tap, export it (also a backup) and restore it from a file, and can also export the app config (D-273). For the eval see `side-session-notes/model-eval/PREFILL_REPORT.md` (not in the repository).

**"Add an entry" into an existing record** (D-443): `out.addRecord` with `into: "existing"` (when omitted it is `new`, which creates a new record). At run time the user picks one of the table's existing records (`recordPick`, showing only the title); the files are appended after the files already in its first attachment field (at most 20 in total, ones that do not fit are not saved; if it is already full it does not run, `recordFull`), and the text is written in when the field is empty, otherwise it starts a new line appended after the existing text (the rules are in `core/record-append.ts`); then the record's form opens, and only when the user checks it and saves is this record changed. It only appends: what was already there is not replaced or deleted; cancel, the record having been deleted, or a failed write all write nothing, and the file copies newly saved by this step are deleted. A quick action is still a straight chain: this step does not remember which record the file originally came from (an external run), and when it finishes it closes and returns to the page that started it.

**Suggested values for a new record form** (D-394, `core/prefill/rank.ts`, `concepts.ts`, `rows.ts`): the text in the attachments' photos (PP-OCRv6) and PDFs (the text layer; scans are rendered to images and then recognized) is read on the device, and "label → value" pairs are cut out by rows; each empty field gets at most 3 suggestions, which are filled in only when tapped and never automatically; the labels and positions that were tapped are remembered in `prefill:picks`. When the text recognition model is not installed, it asks before downloading. The text stays on the device and is not sent to the AI. Each field learns several tapped labels, and when a label in the file matches exactly, the value next to it ranks first (D-445).

**Text processing** (D-245, `core/text-ops.ts`): all are text → text, and the text is processed only on the device.

| Action         | Parameters                                                    | What it does                                                                                                                              |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `text.tidy`    | `blankLines`: remove / single / keep; `spaces`                | Removes extra spaces and blank lines                                                                                                      |
| `text.replace` | `find`, `replaceWith` (both private parameters), `ignoreCase` | Replaces all literally, not a regular expression; the AI sees only `<user text>` (D-082)                                                  |
| `text.extract` | `kind`: phone / email / url / number / date                   | One per line, with the same rules as `{ocr:rule}` (`core/text-rules.ts`)                                                                  |
| `text.lines`   | `mode`: split / join; `separator`                             | Splits into lines at commas (including the Chinese comma and enumeration comma), semicolons, spaces and tabs, or joins them into one line |

**ID photo background change + automatic face framing** (D-252): `background` of `image.idPhoto` (keep / white / blue / red / gray / custom + `color`) and `autoCenter`. The background change is applied to the whole photo before cropping: iOS person segmentation (`replacePersonBackground`), Android subject segmentation (same as background removal; the first time it needs confirmation to download the model). Automatic face framing: system face detection (`detectFaces`; iOS Vision, Android ML Kit) → `faceCrop` in `@morph/tool-image` (the head takes up a share of the photo height set by the spec's `HEAD_RATIO`) → used as the initial box of the crop UI, and the user still confirms.

## 15. Text to Speech (D-270)

`audio.fromText`: text → one audio file. It produces only a file (following it with `audio.convert`, `audio.compress`, `out.share` or `out.saveToFolder` all work); there is no reader, playback or highlighting, and no AI voice (D-113).

- Parameters: `lang` (`auto` or the same 20 languages as translation, `SPEAK_LANGUAGES` in `core/speak.ts`; the voice uses the region in `SPEAK_VOICE_LOCALES`: zh-Hans → zh-CN, en → en-US…), `rate` (0.5–2, 1 is the system's normal speaking rate), `format` (`m4a` / `wav`; for MP3, follow with "Convert audio").
- Splitting (`splitForSpeech`, a pure function): first use translation's `splitForTranslation` to join back the lines broken by PDFs and text recognition (the system pauses at a line break), then cut at sentences and commas, each segment at most 1000 characters (Android at most 4000 characters at a time), and short paragraphs are merged into one segment; lines with only symbols are not read. At most 30,000 characters at a time (`MAX_SPEAK_CHARS`, about 2 hours of Chinese).
- Auto-detection (`chooseSpeakLanguage`): the first 8 segments go to the system's language identification (`TranslatePlatform.detectLanguages`: iOS NaturalLanguage, Android ML Kit), and the language with the most characters wins; when it cannot be recognized, it guesses by writing system (kana → Japanese, Hangul → Korean, Han characters → Simplified Chinese, Cyrillic → Russian…), and Latin letters follow the interface language (a French interface reads French, others read English). Only one voice is used per run.
- Native module `modules/morph-tts` (`voiceStatus`, `synthesize(segments, {taskId, voice, rate, output})`, `cancel`, `onProgress`):
  - iOS: `AVSpeechSynthesizer.write(_:toBufferCallback:)`, one `AVSpeechUtterance` per segment, and the returned PCM is written in turn into the same 16-bit WAV (`AVAudioFile`); an empty buffer or `didFinish` means this segment has been read (only the segment being waited on is honored). The voice is the best-quality one for the language (enhanced / premium voices first), novelty voices and personal voices are not used, and Chinese does not fall back to zh-HK (Cantonese). Rate conversion: 1 → `AVSpeechUtteranceDefaultSpeechRate`, linear on both sides. 30 seconds without new sound counts as stuck and reports an error.
  - Android: the system `TextToSpeech` (mostly Google "Speech Services"; the manifest declares `<queries>` for `TTS_SERVICE`, because from Android 11 the engine cannot be reached without the declaration), one WAV per segment with `synthesizeToFile` (placed next to the output file and starting with `.tts-`), and after everything is read, `Wav.join` joins them into one (PCM only, an error when the segments have different formats), and the intermediate files are deleted in `finally`. When voice data is missing (`LANG_MISSING_DATA`), it does not download in secret and reports `notDownloaded`.
  - Error codes: `ERR_TTS_NO_VOICE`, `ERR_TTS_NOT_DOWNLOADED`, `ERR_TTS_UNAVAILABLE` (no speech engine), `ERR_TTS_CANCELLED`, `ERR_TTS_FAILED`. On failure and cancel the output file is deleted; for cancel, the app checks the run page's "Stop" every 0.3 seconds (same as speech-to-text), the native side stops the system speech and ends the segment being waited on, and the Promise always ends.
- App (`runtime/actions/audio.ts`, `runtime/expo-tts.ts`, `FilePlatform.speaker`): first check the voice (when there is no voice, it is not downloaded, or there is no engine, it explains where to add one in system settings: on iPhone Accessibility → Spoken Content → Voices, on Android "Text-to-speech output"), then check the free space with `estimateSpeechBytes`, read into WAV (progress 0–90%), and for M4A hand it to morph-media with `planAudioConvert` (mono, bitrate calculated for a 64 kbps human voice). The file name follows the source of the text (the PDF's name).
- Presets: "PDF to audio" (pick PDF → get text → read aloud → share) and "Read paper pages aloud" (scan → detect edges → recognize text → read aloud → share), under "Study and work"; the audio tool page adds "Text to speech" (type text, language and rate asked every time).
- Tests: `core/speak.test.ts` (parameters, splitting, language choice, presets connect, step phrasings), `tts-test.ts` (the Expo module wrapper: output address, progress, cancel, error codes), `speak-actions-test.ts` (executor: voice choice, rate, format, error messages, cancel, space, presets), `modules/morph-tts/android/src/test/…/WavTest.kt` (WAV reading and joining).
