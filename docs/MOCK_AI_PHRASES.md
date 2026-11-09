# Mock AI phrase list (draft, awaiting the founder)

The mock AI is a **rule-based parser**, not a language model (AGENTS.md "Product background" §7F).

- This list is the acceptance bar for the mock AI: every sentence in the list must have an automated test and must produce the expected operations in the table below.
- Input that is not in the list must get the reply "Can't understand that yet" with example phrasings, and **must not produce a guessed change**.
- Once M3 connects a real model, this list continues to serve as the eval set.

Implementation: [packages/core/src/ai/mock.ts](../packages/core/src/ai/mock.ts) (step phrases live in each action definition's `phrases`; preset names live in the preset's `words`; style names live in `aliases` in `presets.ts`). Tests: [mock.test.ts](../packages/core/src/ai/mock.test.ts), one case per ID.

D-265 (2026-10-27) removed the phrasings that have no entry point in the UI and that users are unlikely to say: goal sentences (GW8–GW10), look options (LK1–LK5), "add what Morph can do to the home page" (QAC1–QAC2), the separate step phrasings for the various video / audio / image editing actions (extract frame, mute, background music, rotate, crop to ratio, change speed, volume, denoise, remove background, color adjustment, annotate, subtitles, join videos), and preset aliases (except 「签证」 ("visa") and 「发邮件」 ("send email"), which the refusal examples use, and 「证件照打印」 ("ID photo printing"), which sits before visa). These presets can still be added by name (「添加视频去掉声音快捷操作」, "add the remove-sound-from-videos quick action"). What remains in the sections below is what the built-in rules still understand.

Additional rules: a clause that is already in the target state produces no change (for example the PDF is already at the top); mentioning a tool that is not installed prompts the user to install it first.

## Big projects get a plan first (D-415)

「搭建一个记账 App」 ("build a bookkeeping app") and "Build a budget app" reply with a build plan (3 steps, each one a sentence the built-in rules can carry out). When the sentence contains 「失败」 ("fail") or "fail", the second step throws an error the first time and succeeds on retry, to exercise the failure path. The plan for 「搭建一个记账 App，缺页面」 ("build a bookkeeping app, missing page") or "…with no page" leaves the table with nowhere to view it once it is done, to exercise "Fix these".

The `Fix these so the app can be used:` sent by tapping "Fix these" (D-418) does not rely on reading the sentence: the built-in rules look at the config, and if a table has nowhere to view it or nowhere to add to it, they put a list and an add button on the home page; any other problem is refused, with no guessing.

## Feature changes and look changes are done separately (D-191)

A clause whose operations include quick actions, tools, or table structure is a feature clause (the home entry for a new quick action goes with it). When a sentence has a feature clause, only the feature clause is done; the remaining clauses are joined back as the plan's `next` (Chinese joins with 「，」, English with ". ", with the quotes turned back into 「」), and the app turns that into a "Continue" item.

| ID     | Phrase (句式)                                                    | Expected change                                                                                |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| FL1    | 主题换成绿色，添加签证照片快捷操作                               | Only adds the visa photo quick action; `next` = 「主题换成绿色」 ("change the theme to green") |
| FL1-en | Add the visa photo quick action. Change the theme color to green | Only adds the visa photo quick action; `next` = “Change the theme color to green”              |

The built-in rules split these by themselves. To exercise the path where the model puts both in one plan (D-419), use this sentence (MX1): 「做个月历（混合计划）」 / “Make a month calendar (mixed plan)”: it builds the "Calendar" table (feature, takes effect directly), and the button and the calendar block go into the draft; after confirming, both are there.

## Journey A: rework the home page

| ID  | Phrase (句式)                                                         | Expected change                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | 把首页改成文件工作台，把 PDF 放到最上面，导航栏只保留首页、工具、设置 | Home title becomes "File workbench"; the PDF tool card moves to first place; navigation becomes Home / Tools / Settings (AI changes and history are still inside the Settings page) |
| A2  | PDF 放第一个                                                          | The PDF tool card moves to first place                                                                                                                                              |
| A3  | 导航只要首页、工具和设置                                              | Same as the navigation part of A1                                                                                                                                                   |
| A4  | 首页改成文件工作台                                                    | Same as the title part of A1                                                                                                                                                        |
| A5  | Put PDF at the top                                                    | Same as A2                                                                                                                                                                          |
| A6  | Only keep Home, Tools and Settings in the navigation                  | Same as A3                                                                                                                                                                          |

## Basic single changes

| ID  | Phrase (句式)                 | Expected change                                                                                                                       |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | 主题换成绿色 / 主题色改成绿色 | Theme primary color becomes green                                                                                                     |
| B2  | 切换到深色模式                | Theme mode becomes dark                                                                                                               |
| B3  | 隐藏欢迎卡片 / 显示欢迎卡片   | Toggles the visibility of the matching component                                                                                      |
| B4  | 把最近文件放到 PDF 前面       | "Recent files" moves before the PDF tool entry (the first version has only one tool, so the file list is used for the relative order) |

## Styles (schemaVersion 2)

| ID   | Phrase (句式)                                                                                           | Expected change                                                               |
| ---- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B5   | 字体大一点 / 字大一些 / Bigger text                                                                     | Font scale +0.15 (cap 1.3; no change when already at the cap)                 |
| B6   | 字体小一点                                                                                              | Font scale −0.1 (floor 0.85)                                                  |
| B7   | 圆角小一点 / 圆角大一点 / 去掉圆角                                                                      | Corner radius −8 / +6 (0–28) / 0                                              |
| B8   | 紧凑一点 / 宽松一点                                                                                     | Density becomes compact / spacious                                            |
| B9   | 去掉阴影 / 卡片加边框 / 卡片改成新粗野（新拟物、黏土、毛玻璃、霓虹发光、金属）风格                      | Card style becomes flat / outline / brutal (soft, puffy, glass, glow, chrome) |
| B9d  | 背景改成渐变 / 背景改成极光 / 背景改成纯色                                                              | Page background becomes gradient / aurora / plain                             |
| B10  | 导航栏只显示图标 / 导航栏只显示文字                                                                     | Navigation bar style becomes icon / label                                     |
| B11  | 字体换成系统字体 / 字体改成衬线                                                                         | Font becomes system / serif                                                   |
| B12b | 换成杂志风 / 换成 iOS 风格 / 用赛博朋克风格 / 换成毛玻璃风格 / 换成 Y2K 风格 / Switch to terminal style | Applies the whole matching style preset                                       |
| B12  | 恢复默认样式                                                                                            | Theme returns to the default style, Clay                                      |

## Navigation and pages (schemaVersion 2)

| ID  | Phrase (句式)                                   | Expected change                                                                                                                                                        |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B13 | 把 AI 入口删掉 / 把历史（改动记录）从导航栏移除 | Removed from the navigation bar and the floating button (the Settings page still has an entry)                                                                         |
| B14 | 把 AI 做成浮动按钮                              | Becomes a floating button and is also moved out of the navigation bar                                                                                                  |
| E1  | 新建一个叫「记账」的页面                        | Creates a page with that title; if the navigation bar has room it goes into the navigation bar (before Settings), otherwise a shortcut entry is added to the home page |
| E2  | 删除记账页面                                    | Deletes that page and the entries pointing to it; the home and tools pages cannot be deleted                                                                           |

## Data pages (schemaVersion 3, structure only)

| ID  | Phrase (句式)                                                                         | Expected change                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | 新建一个记账页面 / 新建待办清单 / 做一个读书清单 / 新建笔记页面 / Create a to-do list | First creates only the table from the template (feature, D-191), and `next` is 「增加记账页面」 ("add a bookkeeping page") / "Add a budget page"; when this template's table is already built and no page uses it yet, this sentence (and the `next` sentence) only creates the page and gives it an entry |
| F2  | 给账目加一个「支付方式」字段                                                          | Adds a text field to the table                                                                                                                                                                                                                                                                             |

## Images and icons (schemaVersion 4)

| ID  | Phrase (句式)                                                          | Expected change                                                                                  |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| G1  | 在首页顶部加一张横幅 / 在首页加一张图片 / Add a photo to the home page | Adds an empty image slot (the user taps to choose the photo); at the top it goes after the title |
| G2  | 把记账页面的图标换成💰                                                 | Page icon becomes this emoji; refused when it is neither an emoji nor a built-in icon name       |

## Journey C: change the PDF tool (M2)

| ID  | Phrase (句式)                                                          | Expected change                                                                                                                                                     |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | 把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照“合并-日期”命名 | Removes the "enter file name" step and keeps only "choose file" and "merge" (saving is automatic); the `file.save` naming template becomes `合并-{date:YYYY-MM-DD}` |
| C2  | 合并后的文件按日期命名                                                 | The `file.save` naming template and the default value of "enter file name" become `{date:YYYY-MM-DD}`; steps unchanged                                              |

## Journey D: undo and restore

| ID  | Phrase (句式)          | Expected change                                          |
| --- | ---------------------- | -------------------------------------------------------- |
| D1  | 恢复上一次修改前的界面 | Commits the previous revision's config as a new revision |
| D2  | 撤销刚才的修改         | Same as D1                                               |
| D3  | Undo the last change   | Same as D1                                               |

AI changes go into the draft first (D-190): with no draft, these sentences go straight back to the previous version (not through the draft); said inside a draft, they undo the draft's most recent step, and when only one step is left they explain that the user should go to "Edit this app" and delete the draft.

## Quick actions (T7, D-083; called "quick action" in the UI, D-112)

Every phrasing that recognizes 「工作流 / 流程 / workflow」 ("workflow / process / workflow") also recognizes 「快捷操作 / quick action」 (the new term), for example 「添加签证照片快捷操作」, 「新建一个快捷操作：选照片，压到 500KB，分享」, 「把签证照片快捷操作放到首页」, 「Add the visa photo quick action」. The nav item 「历史」 ("History") can also be called 「改动记录 / change history」. The eval cases for old and new terms are QA1–QA4 (pass with the offline rules) and QA5, QA6 ("add / remove tool", real model only). The toolbox phrasings (D-181), such as moving a tool to another group, adding a group, renaming the toolbox, putting the toolbox in the bottom bar, and adding a tool when a toolbox exists, are not recognized by the built-in rules; evals TB1–TB5 require the real model only.

A workflow name can be part of a preset name (「签证照片」 ("visa photo") finds 「签证 / 证件照」 ("visa / ID photo")). Step phrasings: choose photos / choose videos / take a photo / scan documents (document camera, D-086; saying just 「扫描」 ("scan") means edge detection and straightening) / choose files, long edge N, compress to N KB / MB, convert to JPG, remove location, zip, name, save (also "save to Tinkrum"), share (one share), save to a folder (also "save to phone", the button's words), and so on, separated with 「，」, 「、」 or 「然后」 ("then"). The Chinese forms are 「选照片」 / 「选视频」 / 「拍照」 / 「扫描文档」 / 「选文件」, 「长边 N」, 「压到 N KB / MB」, 「转 JPG」, 「去掉定位」, 「打包」, 「命名」, 「存起来」 / 「存到 Tinkrum」, 「分享」, 「存到文件夹」 / 「存到手机」.

| ID  | Phrase (句式)                                                                                                                                                                         | Expected change                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | 添加签证照片工作流 / Add the visa photo workflow                                                                                                                                      | Adds from the preset (with `presetId`); if already added, replies "already like that"                                                                                                                                                                                                                                                                                                                                                                                |
| W2  | 新建一个工作流：选照片，长边 1600，压到 500KB，分享 / Create a workflow: choose photos, convert to JPG, remove location, zip, share                                                   | Builds the steps in order (default name "My workflow", or 「新建一个叫「X」的工作流：…」 "create a workflow called X: …"); when the types do not connect, validation fails                                                                                                                                                                                                                                                                                           |
| W3  | 把签证照片改名为美签照片                                                                                                                                                              | `renameWorkflow`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| W4  | 删除签证照片工作流                                                                                                                                                                    | `removeWorkflow`, and also removes the card that runs it (except the same-ID copy of a built-in quick action, where the card goes back to the built-in one, D-259); a tool's own (for example "Merge PDF") is refused                                                                                                                                                                                                                                                |
| W5  | 把签证照片放到首页 / Put the visa photo workflow on the home page                                                                                                                     | Adds a run card to the home page (after the title); a preset that is not added yet is added first                                                                                                                                                                                                                                                                                                                                                                    |
| W6  | 在签证照片里加一步去掉定位                                                                                                                                                            | Adds a step; processing steps are inserted before the trailing name / save / share                                                                                                                                                                                                                                                                                                                                                                                   |
| W7  | 把签证照片的大小改成 200KB                                                                                                                                                            | Changes the KB parameter of "compress to a given size" or "ID photo"; refused with a hint to add a step first when there is no such step                                                                                                                                                                                                                                                                                                                             |
| W8  | 把签证照片的命名这一步去掉                                                                                                                                                            | `removeWorkflowStep`; refused if the remaining steps would not connect                                                                                                                                                                                                                                                                                                                                                                                               |
| W9  | 把本月的账目做成 PDF 报表                                                                                                                                                             | Creates the workflow "Expense report": read records (this month) → records to PDF; the AI does not read records, the records are filled into the template on the device                                                                                                                                                                                                                                                                                              |
| W10 | 新建一个工作流：扫描文档，压到 300KB，存到文件 / Create a workflow: scan documents, make a PDF, share                                                                                 | The first step is `in.photos` (`source: scanner`, document camera; devices without a document camera use the camera)                                                                                                                                                                                                                                                                                                                                                 |
| W11 | 新建工作流：选照片，压到 500KB，存到 iCloud 的某个文件夹 / Create a workflow: choose photos, compress to 500 KB, save to a folder；在签证照片最后加一步存到 Google Drive；…，一次分享 | 「存到（iCloud / Google Drive / Dropbox / 网盘的某个）文件夹」 ("save to a folder in iCloud / Google Drive / Dropbox / a cloud drive") and "save to a folder" → `out.saveToFolder` (D-120); 「一次分享 / 全部分享 / 发到微信」 ("share all at once / share all / send to WeChat") and "share them all" → `out.share` (all files in one go, D-119); 「自动发给某人」 ("send automatically to someone") is refused                                                     |
| W12 | 新建一个快捷操作：选视频，压到 20MB，分享 / Create a quick action: choose videos, compress to 25 MB, then share；…选视频，剪一段，压缩视频，分享                                      | 「选视频 / choose videos」 → `in.videos`; 「压缩视频」 ("compress video") → `video.compress` (by size, default 20 MB); 「压到 N MB」 ("compress to N MB") after a video is also `video.compress` (`maxMB`); 「转成 MP4」 ("convert to MP4") → `video.convert`; 「剪一段 / trim」 ("trim a clip / trim") → `video.trim` (D-147, evals V1–V3)                                                                                                                          |
| W13 | 新建一个快捷操作：选 PDF，压到 2MB，分享 / Create a quick action: choose PDFs, compress to 1 MB                                                                                       | 「压缩 PDF」 ("compress PDF") or 「压到 N MB / KB」 ("compress to N MB / KB") after a PDF → `pdf.compress` (`maxMB`, asks the user when it cannot get that small); after photos it is still `image.compress`; when adding 「压到 N MB」 to an existing quick action, the action is chosen by whether it handles photos, videos or PDFs; 「把 X 的大小改成 N MB」 ("change the size of X to N MB") also changes `video.compress` and `pdf.compress` (evals V4, V4-en) |
| W14 | 添加视频太大发不出去快捷操作 / Add the PDF too big to upload quick action                                                                                                             | Adds a ready-made quick action `video-too-big` / `pdf-too-big` by name (or by 「视频太大」 "video too big" / 「PDF 太大」 "PDF too big") (D-146, evals V5, V6-en)                                                                                                                                                                                                                                                                                                    |

### Opening from a quick action (D-124)

The AI change opened by "Let the AI change this" carries this quick action: 「这个 / 它 / this / it」 ("this / it / this / it") in the sentence refers to it, and phrasings such as W3, W5 and W7 all work, for example 「把这个的大小改成 200KB」 ("change this one's size to 200KB"), 「把它改名为美签照片」 ("rename it to US visa photo"), 「把这个放到首页」 ("put this on the home page") (eval AB1). With no context, 「这个」 is refused as usual.

## Phone home screen (D-271)

「放到桌面 / 手机桌面 / 主屏幕」 ("put on the desktop / phone home screen / main screen") and "home screen" mean the phone home screen (the menu from long-pressing the Morph icon); 「放到首页 / 主页」 ("put on the home page / main page") and "home page" still mean the home page of W5 (D-109). The built-in rules do not understand French (P-037); the French HS1-fr and HS2-fr require the real model only.

| ID  | Phrase (句式)                                                     | Expected change                                                                                                                                             |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HS1 | 把签证照片放到桌面 / Put the visa photo on the home screen        | `setWorkflowHomeScreen` true; no card on the home page; a preset that is not added yet is added first (HS3: 放到手机主屏幕, "put on the phone main screen") |
| HS2 | 把签证照片放到首页 / Put the visa photo on the home page          | Adds a run card to the home page (same as W5), not on the phone home screen                                                                                 |
| HS4 | 把签证照片从桌面拿掉 / Remove the visa photo from the home screen | `setWorkflowHomeScreen` false; the quick action stays                                                                                                       |
| —   | 桌面上已经有 4 个时再放一个                                       | Refused (`unknown`), lists the 4 existing ones, with the example of removing one first                                                                      |

## Translation (D-171, D-174)

Translating a **file** is a job on files and is done as a translation quick action; a sentence the user writes asking for a translation is an errand, so it is refused (`errand`) and no translation is given; the examples are all translation quick actions that work when tapped. Step phrasings: 「翻译成 / 翻成 / 译成 X」 ("translate into X"), "translate into X" (X: Chinese, Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Portuguese, Italian, Russian, Vietnamese, Thai, written in Chinese as 中文、简体中文、繁体中文、英文、日文、韩文、法文、德文、西班牙文、葡萄牙文、意大利文、俄文、越南文、泰文; 「英语」, 「日语」 and so on are also recognized, as are the English names) → `translate.text` (`from: auto`); saying just 「翻译」 ("translate") translates into the UI language and asks each run; 「输入文字 / 粘贴文字」 ("enter text / paste text") → `in.text` (asks for the text each time); 「提取 PDF 文字」 ("extract PDF text") → `pdf.extractText`; 「复制文字」 ("copy text") → `text.copy`; 「存成文字文件」 ("save as a text file") → `text.toFile`. The action is swapped for one that connects to the previous step: 「提取文字」 ("extract text") after choosing a PDF is extract PDF text, and 「转成 PDF」 ("convert to PDF") after text is text to PDF.

| ID  | Phrase (句式)                                                                                            | Expected result                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ER2 | 把这份合同翻译成英文 / 翻译这份合同 / 帮我把截图翻译成中文 / Translate this PDF                          | Creates a translation quick action: file → choose PDF → extract PDF text → translate → text to PDF → share; screenshot or photo → choose photos → recognize text (asks the language each time) → translate → copy text; when no language is given, translates into the UI language and asks each time; the name is like 「合同翻成英文」 ("contract to English") |
| TR1 | 帮我翻译一下这句话：… / 「下班了」用英语怎么说 / Translate “good morning” into Japanese                  | Refused (`errand`): Morph does not give the translation directly, it only changes this app; examples: 「新建一个快捷操作：输入文字，翻译成英文，复制文字」, 「添加截图翻译快捷操作」, 「新建一个快捷操作：选 PDF，提取 PDF 文字，翻译成中文，转成 PDF，分享」                                                                                                    |
| TR3 | 新建一个快捷操作：选截图，识别文字，翻译成中文，复制文字 / …选 PDF，提取文字，翻译成日文，转成 PDF，分享 | Builds the steps in order (see the phrasings above)                                                                                                                                                                                                                                                                                                              |
| TR5 | 添加截图翻译快捷操作 / 添加外文 PDF 翻成中文快捷操作 / Add the translate screenshots quick action        | Adds from the preset (`screenshot-translate`, `foreign-pdf`, `foreign-paper`, `papers-to-english`)                                                                                                                                                                                                                                                               |

Evals: TR1, TR2-en, TR3, TR4-en, TR5 and TR8 pass with the built-in rules; TR6 (「日文邮件截图看不懂，想一键翻成中文」, "can't read a Japanese email screenshot, want one-tap translation into Chinese"), TR7 (opened from the inbox, 1 PDF shared: 「翻译成中文」, "translate into Chinese") and TR9-en (「西班牙文的 PDF，想看英文」, "a PDF in Spanish, want to read it in English") require the real model only.

## Audio (D-157, audio session)

| ID  | Phrase (句式)                                                                                                                | Result                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| AU1 | 新建一个快捷操作：录音，转成文字，转成 PDF，分享 / Create a quick action: choose recordings, transcribe, save as a text file | `in.audio` (record / choose from files) → `audio.transcribe` (language follows the UI, asked each time) → `text.toPdf` / `text.toFile` |
| AU2 | 新建一个快捷操作：选录音，压到 2MB，分享                                                                                     | 「压到 N MB」 ("compress to N MB") after choosing audio is `audio.compress`                                                            |
| AU3 | 新建一个快捷操作：选几段录音，排序，合成一段，分享                                                                           | `file.order` → `audio.merge` (「合并」 "merge" after audio also means combine into one)                                                |
| AU4 | 新建一个快捷操作：选视频，提取声音，存到文件夹                                                                               | `in.videos` → `audio.fromVideo`                                                                                                        |
| AU5 | 新建一个快捷操作：选音频，剪一段，存到文件夹                                                                                 | 「剪一段」 ("trim a clip") after audio is `audio.trim`                                                                                 |
| AU6 | 添加录音转文字快捷操作 / Add the recording too big to send quick action                                                      | Adds from the preset (recording to text, voice too big, combine several recordings, voice memo, trim an audio clip, sound from video)  |

Evals: AU1–AU7 pass with the built-in rules; PAU1–PAU6 and SH4 require the real model only (lecture recording to text notes, voice memo over 10 MB, several interviews joined into one, background music of a video, summarize a recording → refuse as errand, trim 30 seconds for a ringtone, a shared-in recording with 「转成文字」 "convert to text").

## Text to speech (D-270)

Step phrasings: 「转成语音 / 变成语音 / 做成有声书 / 朗读 / 读出来 / 文字转语音」 ("convert to speech / turn into speech / make an audiobook / read aloud / read it out / text to speech"), 「read it aloud / text to speech / turn it into speech / convert to speech」 → `audio.fromText` (`lang: auto`, `rate: 1`, `format: m4a`); a following 「转成 MP3」 ("convert to MP3") is `audio.convert`.

| ID   | Phrase (句式)                                                                          | Result                                                                |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| TTS1 | 新建一个快捷操作：选 PDF，提取文字，转成语音，分享                                     | `in.files` (pdf) → `pdf.extractText` → `audio.fromText` → `out.share` |
| TTS2 | Create a quick action: scan documents, recognize text, read it aloud, save to a folder | `in.photos` (scanner) → `ocr.recognize` → `audio.fromText`            |
| TTS3 | 添加 PDF 转成音频快捷操作 / Add the read paper pages aloud quick action                | Adds from the preset (`pdf-to-audio`, `paper-to-audio`)               |
| TTS5 | 新建一个快捷操作：输入文字，朗读，转成 MP3，分享                                       | `in.text` → `audio.fromText` → `audio.convert` (mp3)                  |

Evals: TTS1, TTS2-en, TTS3, TTS4-en and TTS5 pass with the built-in rules; PTTS1 (「做一个把 PDF 变成音频的快捷操作」, "make a quick action that turns a PDF into audio", a goal sentence, not recognized by the built-in rules since D-265), PTTS2-en (handouts from class that you want to listen to on the way), PTTS3 (a Japanese PDF, read slower), PTTS4 (「把这句话读给我听：…」, "read this sentence to me: …" → refuse as errand) and PTTS5 (opened from the inbox, 1 PDF shared: 「转成音频」, "convert to audio") require the real model only.

## Scans to Excel (D-272)

Step phrasings: 「转 Excel / 转成 Excel / 表格转 Excel / 做成 Excel」 ("to Excel / convert to Excel / table to Excel / make an Excel"), 「convert to Excel / turn it into an Excel file」 → `ocr.toExcel` (`lang: auto`, `scope: all`).

| ID   | Phrase (句式)                              | Result                                              |
| ---- | ------------------------------------------ | --------------------------------------------------- |
| XLS1 | 新建一个快捷操作：扫描文档，转 Excel，分享 | `in.photos` (scanner) → `ocr.toExcel` → `out.share` |
| XLS2 | Add the scan a table to Excel quick action | Adds from the preset (`scan-table-excel`)           |

## Scans to Word (D-328)

Step phrasings: 「转 Word / 转成 Word / 文档转 Word / 图片转 Word / 做成 Word 文档」 ("to Word / convert to Word / document to Word / image to Word / make a Word document"), 「convert to Word / turn it into a Word document」 → `ocr.toWord` (`lang: auto`).

| ID   | Phrase (句式)                             | Result                                             |
| ---- | ----------------------------------------- | -------------------------------------------------- |
| DOC1 | 新建一个快捷操作：扫描文档，转 Word，分享 | `in.photos` (scanner) → `ocr.toWord` → `out.share` |

Evals: XLS1 and XLS2-en pass with the built-in rules; PXLS1 (photograph a paper bank statement into Excel) and PXLS2-en (a price list screenshot into an editable table) require the real model only.

## Format conversion (D-183–D-186)

Step phrasings: 「转成 / 存成 MP3」 ("convert / save as MP3"), 「convert to MP3」 → `audio.convert` (`format: mp3`), and after a video it is `audio.fromVideo` (`format: mp3`); 「转成 GIF / 做成动图」 ("convert to GIF / make an animated picture"), 「make an animated GIF」 → `image.toGif`, and after a video it is `video.toGif`; 「从文件选视频 / 照片」 ("choose videos / photos from Files"), 「choose videos from Files」 → `in.videos` / `in.photos` (`source: files`); 「选 Word 文档 / 选文档 / 选 Excel 表格 / 选 Word 或 PPT」 ("choose Word documents / choose documents / choose Excel sheets / choose Word or PPT"), 「choose Word documents」 → `in.files` (`accept: documents`), and a following 「转成 PDF」 ("convert to PDF") is `pdf.fromDocument`.

| ID  | Phrase (句式)                                                                                                        | Result                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| FG1 | 新建一个快捷操作：选音频，转成 MP3，存到文件夹                                                                       | `in.audio` → `audio.convert` (mp3) → `out.saveToFolder`        |
| FG2 | 新建一个快捷操作：选视频，转成 MP3，分享                                                                             | `in.videos` → `audio.fromVideo` (mp3) → `out.share`            |
| FG3 | 新建一个快捷操作：选视频，剪一段，转成 GIF，分享 / Create a quick action: choose photos, make an animated GIF, share | `video.trim` → `video.toGif`; after photos it is `image.toGif` |
| FG4 | 新建一个快捷操作：从文件选视频，转成 MP4，存到文件夹                                                                 | `in.videos` (`source: files`) → `video.convert`                |
| FG5 | 新建一个快捷操作：选 Word 文档，转成 PDF，分享 / Create a quick action: choose Word documents, make a PDF            | `in.files` (`accept: documents`) → `pdf.fromDocument`          |

Evals: FG1–FG5, FG3-en and FG5-en pass with the built-in rules; PFG1 (the car can only play MP3), PFG2-en (turn a short cat video into a GIF), PFG3 (an MKV downloaded on a computer that the phone cannot play) and PFG4 (a Word assignment that must be handed in as PDF) require the real model only. PSP1-en (scan to a searchable-text PDF: `textLayer` of `pdf.fromImages`, D-195), PPW1 (remove the password from a statement and then merge: `pdf.unlock` → `pdf.merge`, D-194), PPW2-en (add a password before sending a contract: `pdf.protect` at the end), PFA1 (append a receipt to last time's expense report: `file.addExisting` → `pdf.merge`, D-197) and PWF1 (a QR code for guests to join Wi-Fi: `in.wifi` → `qr.generate`, or add the QR tool, D-199) also require the real model only.

## Goal sentences (D-149, no longer recognized since D-265)

Three sentences such as 「我有一堆旅行照片，想发给朋友」 ("I have a pile of travel photos and want to send them to friends") (GW8–GW10) no longer have an entry point in the UI. Since D-265 the built-in rules no longer recognize them, and the whole sentence is refused as "Can't understand that yet"; the eval cases stay as they were and require the real model only.

## Log an entry (D-187)

Step phrasings: 「记一笔 / 记一条 / 记账（到 X）」 ("log one / log one entry / bookkeeping (to X)"), 「记到 / 记进 / 写进 / 加到 X（表）」 ("log to / log into / write into / add to X (table)"), 「add a record (to X)」, 「log it in X」 → `out.addRecord`. X is looked up among the current table names; when no table is named and there is only one table, it is used; when nothing is found the whole sentence is refused (saying 「新建一个记账页面」 "create a bookkeeping page" first). When files come in and the table has no attachment field, an "Attachments" field is added first.

| ID  | Phrase (句式)                                                                                   | Result                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| RE1 | 新建一个快捷操作：拍照，记到账目 / Create a quick action: take photos, add a record to Expenses | Adds an attachment field to "Expenses" → creates a quick action: take photos → log an entry (Expenses) |
| RE2 | 新建一个快捷操作：输入文字，记一笔                                                              | Logs to the only table if there is one; the text goes into the first long-text / text field            |
| RE3 | 新建一个快捷操作：拍照，记到不存在的表                                                          | Refused: no such table                                                                                 |

Evals: RE1, RE1-en and RE2 pass with the built-in rules; RE3 is run by the real model only (when the named table does not exist and the purpose is clear, it creates it, D-407; the built-in rules do not guess and still refuse, see `eval-cases.test.ts`); PRE1 (photograph a receipt and log it, keeping the photo; since D-263 only adding an attachment field to Expenses also counts as correct), PRE2-en (scan a receipt into Expenses), PRE3 (add a "tax included" = amount × 1.06 formula field) and PRE4 (「记一笔午饭 35」, "log lunch 35" → userData refused) require the real model only.

### Photos and files in records (D-263)

Phrasings: 「给 X 加照片 / 加附件 / 加上图片」 ("add photos / attachments / pictures to X"), 「X 里存发票 / 存收据 / 放文件」 ("keep invoices / receipts / files in X"), 「附上照片」 ("attach photos"), 「add / attach / save / keep photos, pictures, attachments, files, receipts, invoices to / in / with X」 → adds an attachment field to table X (`addField` type file, named "Attachments"), without building a separate "log an entry" quick action; the user takes photos and picks photos and files in the form themselves. When X already has an attachment field it is refused (noChange), explaining that they can be attached when adding or editing a record.

| ID  | Phrase (句式)                              | Result                                                      |
| --- | ------------------------------------------ | ----------------------------------------------------------- |
| AT1 | 给账目加照片 / Attach receipts to Expenses | Adds an attachment field to "Expenses", no new quick action |
| AT2 | 账目里存发票                               | Same as above                                               |

Evals: AT1, AT1-en and AT2 pass with the built-in rules; PAT1 (attach an invoice photo when logging), PAT2-en and PAT3-fr require the real model only.

## Inputs that must be refused (examples)

| ID  | Phrase (句式)                                                                                                                  | Expected result                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | 帮我订一张机票                                                                                                                 | "Can't understand that yet", with example phrasings                                                                                                                                                                   |
| X2  | 把设置删掉                                                                                                                     | Refused: Settings holds the AI change and Change history entries; it can only be moved, not deleted                                                                                                                   |
| X3  | 删除我所有的 PDF 文件                                                                                                          | Refused: the change flow does not delete files; do it by hand in file management                                                                                                                                      |
| X4  | 记一笔午饭 35 / 把上个月的账都删掉 / 把待办都标成完成 / 我这个月花了多少                                                       | Refused (`userData`): the AI only changes the interface and does not read or write record data                                                                                                                        |
| X5  | 帮我写一封请假邮件 / 帮我翻译一下这句话 / 总结一下这个 PDF / 这份合同讲了什么 / 帮我查一下… / Write… / Translate… / What does… | Refused (`errand`, D-128): Morph does not write things for you, answer questions or summarize file contents, it only changes this app; gives three examples that can become quick actions (tap to fill the input box) |
| X6  | 现在帮我运行签证照片 / Run …                                                                                                   | Refused (`errand`): the AI does not run things for you; tap the quick action to start it                                                                                                                              |

### Home page file entries (FE1–FE2)

- 「首页加上打开相册」 / `Add a photo picker to home`: adds the photo and video picker entry.
- 「首页加上打开文件」 / `Add a file picker to home`: adds the file picker entry. After choosing, the user goes to the inbox and picks a quick action.

### Join videos (VM1–VM2)

- 「添加把几段视频拼成一段快捷操作」 / `Add the join video clips quick action`: choose 2–10 videos → adjust the order → join into an MP4.

### Video frame capture (VF1–VF2)

- 「添加从视频里截一张照片快捷操作」 / `Add the photo from a video quick action`: choose a video → pick the time on the device → save a JPEG to the photo library.

### Video mute (VMU1–VMU2)

- 「添加视频去掉声音快捷操作」 / `Add the remove sound from videos quick action`: choose a video → remove all audio tracks → silent MP4.

### Video background music (VMA1–VMA2)

- 「添加给视频换背景音乐快捷操作」 / `Add the add background music quick action`: choose a video → choose music at run time; by default only the music is kept and short music loops.

### Video rotation (VR1–VR2)

- 「添加把视频转正快捷操作」 / `Add the fix video rotation quick action`: choose a video → rotate clockwise 90/180/270 degrees.

### Video crop to ratio (VC1–VC2)

- 「添加裁成竖屏视频快捷操作」 / `Add the portrait posts quick action`: choose a video → center-crop to the given ratio.

### Video speed (VS1–VS2)

- 「添加视频加速或慢放快捷操作」 / `Add the speed up or slow down video quick action`: choose a video → change to 0.5×–4× speed.

### Volume (AVL1–AVL3)

- 「添加把录音调到正常音量快捷操作」 / `Add the quiet audio easier quick action`.
- 「添加把视频调到正常音量快捷操作」 / `Add the quiet video easier quick action`.

### Voice noise reduction

- 添加录音人声降噪快捷操作
- 添加视频人声降噪快捷操作
- Suited to speech recordings; music may be weakened; video keeps its picture.

### Image background removal

- 添加把照片背景去掉快捷操作
- Transparent or solid-color PNG; needs iOS 17+ or Android with Google Play services.

### Image color adjustment

- 添加把太暗的照片调亮快捷操作
- Auto enhance or manual brightness, contrast and saturation; keeps the size; transparent images output PNG.

### Image annotation

- 添加在图片上画箭头和文字快捷操作
- At run time, add text, arrows, boxes and freehand strokes on the device, six colors, undoable. The text and strokes are not sent to the AI.

### Video subtitles (first version SRT)

- 添加导出视频 SRT 字幕快捷操作
- Choose the spoken language, recognize on the device and export a separate .srt file; subtitles are not burned into the video. The text and timing need checking.

### Onboarding guide step 1 (D-231, GD1)

- 「加入「打开相册」和「打开文件」按钮」 / `Add the “Open photo library” and “Open files” buttons`: adds two file entries side by side on the home page; when file entries already exist it replies 「已经是这样了」 ("already like that") and the guide still goes on to step 2.

### French UI (D-224 / P-037)

The built-in mock does not parse French; under the French UI, English examples and phrasings are used. The real model creates French names, descriptions and follow-up requests according to the UI language. The French default currency is EUR; evals FR1 / FR2 / FR3 cover creating an image compression action, refusing to send an email directly, and a bookkeeping table respectively.
