# 任务 124：本地分类、无法判断、对上用户的表和快捷操作、无文字照片的图像分类

日期：2026-10-28。分支 `claude/local-classify-124`，从 `codex/local-model-eval-20261028`（`2f9a685`）出发。环境是 Linux 云容器（4 核 CPU、15 GB 内存），**没有 Mac、iOS 模拟器、Android SDK 和创始人的手机**。

## 先说结论

1. **模型下载不了，所以所有要用 Qwen3-Embedding 的成绩都没有跑出来。** 云容器的网络策略拒绝了 `huggingface.co`（以及 `hf-mirror.com`、`modelscope.cn`、`ollama.com`；代理对 CONNECT 返回 403）。按要求停在这里，没有换成没测过的模型充数。llama.cpp 源码能用 git 拉下来（`github.com` 的 git 通，`api.github.com` 的发布接口 403），但没有权重，编译它没有意义，所以没编。
   - 结果是：没有复现桌面成绩（形式 49/57、主题 45/57），没有校准出「无法判断」的阈值，任务 ② 也没有模型那一栏。
   - 已经写好的是：独立样本、评测脚本、阈值校准逻辑和它的单元测试。在一台能访问 Hugging Face 的电脑上，按下文「怎么补跑」的命令一次就能跑完。
   - 要让这个容器能下载，需要在环境设置的「Network access」里放行 `huggingface.co`（以及它跳转到的 CDN 域名），步骤见 <https://code.claude.com/docs/en/cloud-environments#network-access>。
2. **代码判空白和乱码（不用模型）在新的测试集上：9/9 拒判对了，44 条有类别的样本 0 条误拒判。** 校准集上发现过一个误拒判（空白表格的下划线和勾选框被当成乱码），已经按校准集改了规则。改完以后只在测试集上跑了一次，没有再改。
3. **任务 ② 不用模型的基准几乎没用。** 要求推荐里错的不超过 5% 时，测试集 282 对（文件, 用户）里只推荐对了 1 对。不设阈值时错误推荐率是 78%。所以这件事要么靠模型，要么就不做；模型能不能比它好，还要等补跑。
4. **任务 ④ 的原生代码写好了，但两边都没有编译过**：iOS 在 Linux 上编译不了；Android SDK 的下载地址 `dl.google.com` 被拒（`maven.google.com` 会 301 跳到那里）。ML Kit Image Labeling 加多少体积也因为同样的原因**没量到**。JS 部分有单元测试。

## 任务 ①：形式 / 主题加「无法判断」

### 方法

- **新的独立样本** `classification/holdout/cases.jsonl`，共 114 条，中英法各 38 条。由一个没读过原来 60 条（`cases.jsonl`、`files/`、`images/`）、也没看过任何结果的子代理从头写成。我自己也没看测试集的文字。每种语言包括：
  - standard 19 条：每种形式 1 条；
  - untitled 5 条：没有标题的单据；
  - same_merchant 4 条：同一个虚构商家的 4 种单据；
  - out_of_scope 4 条：19 种形式之外的东西，例如诗、说明书、数学题、停车场指示牌、软件报错框、歌词，形式标 `none`；
  - damaged 4 条：截断、丢字、0/O 和 1/l 混淆、行序打乱；
  - garbled 2 条：空白和乱码。
- **划分**：校准集 61 条（zh 22 / en 17 / fr 22），测试集 53 条（zh 16 / en 21 / fr 16）。同一商家（`group`）只在一边，每种形式在两边都有，只是语言不同。
- **流程**（`evaluate_holdout.py`，和 App 里的原型一致）：
  1. 用 `textReadability` 判空白和乱码：这是 App 里那份 TS 代码，经 `ts_features.ts` 调用，判出来的直接拒判，不交给模型。
  2. 其余样本按维度编码查询，用和 `evaluate_embedding_gguf.py` 同一条英文任务指令，和同语言的 19 个形式、11 个主题说明比余弦相似度。
  3. 在校准集上，对形式和主题分别定 `min_score`（最高分）和 `min_margin`（第一名比第二名高多少）。规则是：给出类别的样本里错的不超过 5%，在这个前提下正确的越多越好；做不到就全部拒判。
  4. 只在测试集上报**正确 / 误分（其中范围外却给了类别的单列）/ 拒判 / 误拒判**，按语言和样本类型分开。
- **App 里的原型** `packages/core/src/text-classify.ts`：先 `textReadability`，再 `rankLabels`（余弦）和 `pickLabel`（按阈值给出类别，或者「无法判断」，原因是 lowScore 或 tooClose），合起来是 `guessFacets`，空白和乱码不调用模型。阈值由调用方传入，**代码里没有写任何默认阈值**，因为还没校准出来。没有从 `index.ts` 导出，也没接界面。

### 成绩

| 项目                                          | 结果                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 复现桌面 Q8（形式 49/57、主题 45/57）         | **没跑**：权重下载不了                                                                                                              |
| 阈值（形式、主题各一对）                      | **没定**：要在校准集上跑模型                                                                                                        |
| 测试集：正确 / 误分 / 拒判 / 误拒判（按语言） | **没跑**                                                                                                                            |
| 代码判空白和乱码（不用模型），测试集          | 空白和乱码 9 条全部拒判（zh 3 / en 3 / fr 3）；44 条有类别的样本 0 条误拒判；6 条范围外的样本都放给了模型（它们能读，该由分数去拒） |
| 代码判空白和乱码，校准集（改规则之后）        | 空白和乱码 9 条全部拒判；52 条有类别的样本 0 条误拒判；范围外的数学题被当成乱码（真值本来就是 `none`，结果没错，但理由不对）        |

### 校准集上发现的问题（这一条改了代码，所以写清楚）

第一版 `textReadability` 在校准集上把一张中文空白申请表（`h-zh-017`：「申请人姓名: ________ □男 □女」）判成了乱码，这是误拒判。原因是填写横线和勾选框占了大部分字符。改法是把 `_`、`□`、`☐` 当作版面，不计入总数，并加了一个单元测试。改完以后在测试集上只跑了一次，就是上表的数字。

数学题（`h-zh-031`）里的 `f(x)`、`x²` 不算能读的字，所以被判成乱码。这件事没有改：真值是「范围外」，拒判本来就对；如果要改，也该等真实 OCR 的样本。

### 怎么补跑（有网络的 Mac 或 Windows）

```bash
cd tests/local-model-eval
python classification/download.py qwen3-embedding-q8   # 按 models.json 的 revision 和 SHA-256 校验
MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_embedding_gguf.py --model q8   # 应为 49/57、45/57
MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_holdout.py --model q8
```

`evaluate_holdout.py` 会打印阈值和分语言、分样本类型的表。原始分数写进被忽略的 `results/classification/holdout-*.jsonl`。

## 任务 ②：新用户没有历史时，把文件对上用户的表和快捷操作

### 评测设计

- `match/profiles.json` 有 6 个虚构用户（中英法各 2 个），表是 `CollectionSchema` 格式，已用真实 schema 校验过；快捷操作只有名字，和真实配置一样。故意放了没有文件能对上的表，例如健身记录、阅读记录、植物养护、Entraînements。

  | 用户   | 表                                                                              | 自己的快捷操作                                                 |
  | ------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
  | p-zh-1 | 家庭开支、孩子学校事项、猫咪看病                                                | 名片存通讯录、缴费单存档                                       |
  | p-zh-2 | 出差报销、车辆保养、保修卡与发票、健身记录                                      | 合同签字回传                                                   |
  | p-en-1 | Expenses、Reading log、Packages to pick up、Recipes                             | Scan warranty card、Save business card to contacts             |
  | p-en-2 | Bills to pay、Medical records、Plant care                                       | Forward prescription to pharmacy、Sign contract and email back |
  | p-fr-1 | Dépenses du foyer、Santé de la famille、École des enfants                       | Envoyer l'ordonnance à la mutuelle                             |
  | p-fr-2 | Cartes de visite、Entretien de la voiture、Factures de la maison、Entraînements | Signer et renvoyer un devis、Masquer mon RIB                   |

- `match/presets.json` 由 `export_presets.ts` 从 `workflows/presets.ts` 导出，只取和内容有关的 4 个内设快捷操作：收据归档、报销单、签回表格、截图打码。按文件类型和个数排的那些（发邮件、批量发照片……）D-237 已经在做，不在这里比，否则「把收据发邮件」也会被算成推荐错了。
- `match/docs.jsonl` 有 90 份文件文字（每种语言 30 份，其中照片 56、截图 15、PDF 19），对每个用户都标了可接受的推荐，空表示不该推荐。共 540 对（文件, 用户），其中 41.7% 不该推荐。校准集 258 对，测试集 282 对，同一商家只在一边。这一批也由一个没看过任务 ① 样本的子代理写成。
- 快捷操作先按文件类型过滤（代码做）：截图算图片，签回表格只接 PDF。
- **四种结果**：推荐对了 / 推荐错了 / 该推荐没推荐 / 不该推荐却推荐（另外还有「正确地不推荐」）。**错误推荐率** = （推荐错了 + 不该推荐却推荐）÷ 推荐出去的。阈值的定法和任务 ① 一样：校准集上错误推荐率不超过 5%。

### 基准（不用模型）：文件类型 + `text-rules` 命中 + 关键词

- 分数 = 候选的词和文件文字重合的个数，再加上规则命中的分。
  - 候选的词：表名、字段名、选项名，或者快捷操作的名字。英法文取 3 个字母以上的词，中文取相邻两个字。
  - 规则命中：文字里取到金额，并且表里有 money 字段，加 1；取到日期，并且表里有 date 字段，加 1；取到电话或邮箱，并且表里有名字像电话、邮箱的字段，加 1。规则用的是 `text-rules.ts`，经 `ts_features.ts` 调用。
- 词表和规则都是通用写法，不是照着测试样本挑的。

| 测试集（282 对）                            | 推荐对了 | 推荐错了 | 该推荐没推荐 | 不该推荐却推荐 | 正确地不推荐 | 错误推荐率               |
| ------------------------------------------- | -------- | -------- | ------------ | -------------- | ------------ | ------------------------ |
| 阈值按 ≤5% 定（min_score 6、min_margin 3）  | 1        | 0        | 166          | 0              | 115          | 0%                       |
| 阈值按 ≤20% 定（min_score 5、min_margin 2） | 2        | 1        | 164          | 0              | 115          | 33%（3 次推荐里错 1 次） |
| 不设阈值，总推荐最高分                      | 42       | 82       | —            | 69             | —            | **78.2%**                |

按文件语言（≤5% 那一行）：zh 推荐对了 1/96、en 0/90、fr 0/96。

**典型失败**：

- 中文超市小票（`m-zh-003`）同时命中金额和日期，于是任何有金额、日期字段的表都加 2 分，结果推荐成了「猫咪看病」「车辆保养」「Bills to pay」。正确的是收据归档或报销单，但小票上没有「收据」这个词。
- 关键词跨不了语言：法文用户收到中文小票，一个词也对不上。
- 唯一推荐对的是中文保修卡对上「保修卡与发票」表：表名和文件里都有「保修」。

结论：只靠关键词和规则，要守住低错误率，几乎就只能不推荐。能不能用 Embedding 做到「错误推荐率低，同时推荐得出东西」，是这次最想回答、却因为下载不了模型而没回答的问题。

### 怎么补跑

```bash
MORPH_LLAMA_SERVER_BIN=/abs/llama-server python classification/evaluate_match.py --backend embedding --model q8
python classification/evaluate_match.py --backend baseline   # 基准，不用模型，几秒钟
```

两边出的是同一张表。**要求**：模型在测试集上错误推荐率不超过 5%，并且推荐对的明显多于基准，才值得继续；否则就如实写「不比基准好」。

## 任务 ④：没有文字的照片做图像分类（系统自带）

### 代码

- **JS 接口**：`modules/morph-vision/index.ts` 新增：
  - `classifyImage?(taskId, uri, { maxResults, minConfidence })`，返回 `{ labels: { id, confidence }[], width, height }`；
  - `cancelClassify?(taskId)`；
  - `VISION_ERRORS.cancelled = 'ERR_VISION_CANCELLED'`。

  这两个方法都是可选的，旧的开发版没有它们也不会报错。

- **平台层**：
  - `runtime/platform.ts` 的 `VisionPlatform` 加了可选的 `classifyImage(uri, { maxResults, minConfidence, signal })`。
  - `runtime/classify-image.ts`：每次分类给一个 taskId；signal 取消时 Promise **马上**以 code 为 `cancelled` 的错误结束（不等原生那边回来），同时调用 `cancelClassify`。原生晚到的结果或错误会被吞掉，不会变成未处理的 Promise 错误。两个平台的结果统一整理：去掉不是数字的置信度，限制在 0–1，同一个标签留最高分，从高到低排，过滤门槛，截个数。
  - `runtime/expo-vision.ts` 接上这一层，测试用的 `FakeVision` 也加了 `classifyImage`。
- **iOS**（`MorphVisionModule.swift`）：
  - 用 `VNClassifyImageRequest`，系统自带，不下载模型。
  - 用 ImageIO 的缩略图按 EXIF 摆正，解码时就缩到长边 1024，不整张解码原图。
  - 不写中间文件。
  - `cancelClassify` 调 `VNRequest.cancel()`，这一次以 `ERR_VISION_CANCELLED` 结束。
- **Android**（新文件 `ImageClassifier.kt`）：
  - 用 ML Kit Image Labeling 的基础模型（`com.google.mlkit:image-labeling:17.0.9`，打包进 App）。
  - 用已有的 `ImageLoading.decodeUpright` 在解码时就缩到长边 1024。
  - 在后台线程跑，每 100 ms 看一次是否取消，取消时以 `ERR_VISION_CANCELLED` 结束 Promise。
  - 位图和标注器在成功、失败、取消时都释放。取消时如果 ML Kit 还在读这张位图，就等它读完再回收。
  - 不写中间文件。
  - R8 的保留规则原来就覆盖 `com.google.mlkit.**`。
- **标签**是平台自己的英文标识。iOS Vision 和 Android ML Kit 是两套不同的词表，所以没有在原生层硬对齐。

### 体积

**没量到。** ML Kit 的 AAR 在 Google Maven 上，`maven.google.com` 会跳转到 `dl.google.com`，而这个域名被网络策略拒绝。版本号 17.0.9 也**没在 Google Maven 上核对过**，同步时如果报找不到，要换成 Google Maven 上最新的 17.x。

在 Mac 上量的方法：同一个提交，加这一行和不加这一行各打一个 release 包（`-PreactNativeArchitectures=arm64-v8a`，命令同 AGENTS.md），用 `ls -l` 和 `apkanalyzer apk compare` 比两个 APK。iOS 用的是系统框架，App 体积不变。

### 「标签 → 推荐方向」映射草案（只是草案，没有接进推荐）

| 照片里像是                                                   | 推荐方向（内设快捷操作）                   | 说明                                       |
| ------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| 人像、自拍、单人脸部特写                                     | 签证 / 证件照、证件照打印                  | 只当提示；多人合影不推荐                   |
| 文档、纸张、收据、白板                                       | 扫描文档、材料包、收据归档                 | 但有文字时应走文字那条路，图像标签只做补充 |
| 截图（iOS 可从标签判断；Android 更可靠的是看文件来源和尺寸） | 截图打码分享、截图翻译                     | 截图更适合用元数据判断，不靠图像分类       |
| 食物、菜品                                                   | 不推荐                                     | 没有对应的内设快捷操作                     |
| 风景、建筑、宠物、物品                                       | 发邮件、批量发照片（D-237 已经按类型排了） | 内容标签不改变排序                         |
| 老照片（黑白、相纸边框）                                     | 扫老照片                                   | 标签不一定有这一类，要实测                 |

**注意**：上表左栏是概念，不是平台的真实标识。两边的词表要用下面的探针导出后再对。只有某个标签在两个平台上都有稳定的对应词，而且置信度在真实照片上校准过，才可以变成推荐。

### 交给创始人在 Mac 上跑的验证步骤（按 AGENTS.md「探针路由」的写法）

1. `git checkout claude/local-classify-124`。因为改了原生代码，要重新打 iOS 开发版：`cd apps/mobile && npx expo run:ios --device <UDID>`（用模拟器）。
2. 临时加一个探针路由 `apps/mobile/src/app/probe-classify.tsx`，**不要提交**。页面加载时：
   - 用 `MorphVision.classifyImage('probe-1', <uri>, { maxResults: 10, minConfidence: 0 })` 分类 4 张图：一张自拍或人像、一张收据照片、一张截图、一张风景。图可以用 `xcrun simctl addmedia <UDID> <文件>` 放进相册，再用 expo-image-picker 选出来，或者直接放到 App 的 cache 目录。
   - 把每张图的前 10 个标签和置信度显示在屏幕上。
   - 再调一次 `classifyImage('probe-2', <一张 50 MP 以上的大图>, …)`，紧接着 `cancelClassify('probe-2')`，屏幕上显示这个 Promise 是不是以 `ERR_VISION_CANCELLED` 结束了，以及用了多少毫秒。
   - 在 iOS 上另外显示 `VNClassifyImageRequest` 支持的标识个数（需要在探针里临时加一个原生调用，或者用 Xcode 的调试器执行 `try VNClassifyImageRequest().supportedIdentifiers()`），用来核对映射草案。
3. 新加路由文件要重启 Metro：`npx expo start --clear`。打开 `/probe-classify` 后，用 `xcrun simctl io <UDID> screenshot probe.png` 读结果。
4. Android：先跑 `cd apps/mobile && npx expo prebuild --platform android --no-install`，再在 `android/` 下跑 `LANG=en_US.UTF-8 ./gradlew :morph-vision:compileDebugKotlin`。然后在模拟器上用同一个探针看一遍，记下 APK 体积的增量（见上面「体积」）。
5. 用完 `git checkout` 恢复，删掉探针文件。**测试结果不要进 git**，放到 `side-session-notes/`。
6. 要确认的事：
   - 两边都能返回标签；
   - 取消真的让 Promise 结束（JS 层一定会结束，要看的是原生层是不是也停了，没有继续占 CPU）；
   - 大图不会内存不足；
   - Android 上 `content://` 的图也能分类；
   - 没有留下中间文件（这次的代码不写文件，但要确认 `cache/` 里没有多出东西）。

## 三类结论

### 单元测试或桌面 CPU 验证过的

- `packages/core/src/text-classify.ts`：可读性判断、余弦排序、按阈值给出类别或「无法判断」、空白和乱码不调用模型。共 15 个 vitest 测试。
- 代码判空白和乱码在独立测试集上的结果：9/9 拒判对了，0/44 误拒判。这是桌面 Node 上的结果；文字是虚构的模拟 OCR，**不是**真实 ML Kit / Vision 的识别结果。
- `apps/mobile/src/runtime/classify-image.ts`：取消一定结束 Promise、已经取消的不启动原生任务、原生的取消码换成 `cancelled`、其他错误照原样抛出、每次分类有独立的 taskId、结果统一整理。共 6 个 jest 测试，用的是假的原生模块。
- `calibrate.py` 的五种结果、错误率、阈值选择，以及两条评测管线用假向量走通。共 8 个 Python 单元测试。
- 任务 ② 的基准在桌面上跑出了上面的数字。
- `npm run check` 的结果见文末。

### 只写了代码，没有编译或没有跑

- Qwen3-Embedding 的一切：复现桌面成绩、任务 ① 的阈值和测试集成绩、任务 ② 的模型那一栏。原因是权重下载不了。
- iOS 的 `classifyImage` / `cancelClassify`（Swift）：Linux 上编译不了。
- Android 的 `ImageClassifier.kt`、`MorphVisionModule.kt` 的改动和 `build.gradle` 新加的依赖：**没有编译**（没有 Android SDK，Google Maven 也下载不了）；依赖版本没有核对；APK 增加多少没量。
- `evaluate_holdout.py` 和 `evaluate_match.py --backend embedding` 只用假向量走通过，没接过真的 llama-server。

### 只有模拟器或真机能测的

- 两个平台图像分类的真实标签、速度、内存，大图和 HEIC，Android `content://`，取消时原生层是否真的停下（步骤见上文）。
- Embedding 在手机上的冷启动、p95、内存压力（原交接文档已经列出，这次没有推进）。
- 文字判空白和乱码在真实 ML Kit / Vision 输出上的误拒判率（真实 OCR 的错误样子和模拟的不一样）。

## 待决定

1. **网络放行**：要不要在这个云环境里放行 `huggingface.co`（以及 `dl.google.com`，为了 Android SDK 和 ML Kit）？不放行的话，模型评测只能在 Mac 或 Windows 上补跑。
2. **存不存从文字算出的向量**：如果以后要按「这类文件以前去了哪张表」来推荐，可能要在本机存文件文字的向量。向量能部分还原文字的内容，算不算「识别出的文字」，要不要和文字一样不留下？这次的原型不存任何东西，只在内存里比，候选说明的向量可以缓存，那些是用户配置，不是文件内容。
3. **D-244 要不要扩展**：D-244 现在规定识别出的文字「只用来取名，不留下」。如果推荐要用 `text-rules` 预填「记一笔」的金额和日期，D-244（以及 D-263 附件、D-187 记一笔）要怎么改，由创始人定。这次没有改任何 DECISIONS。
4. **依赖体积**：Android 加 ML Kit Image Labeling（打包模型）要不要做？体积还没量。也可以改用 Google Play 服务版（`play-services-mlkit-image-labeling`，模型不打包，体积小，但要 Google Play 服务，第一次用要下载），和现在的去背景一样。Qwen3-Embedding Q8 的 GGUF 是 639 MB，要不要作为「第一次用时下载」的内容，也要创始人定。
5. **任务 ② 的标准**：这次把「错误推荐率不超过 5%」作为校准目标。要不要更严（例如 2%），和「推荐对的至少要有多少才值得上」，需要创始人给个数。
6. **任务 ② 的标注口径**：子代理标注时有几处取舍，例如药店小票算不算「家庭健康」表、外语处方能不能用转发处方的快捷操作、银行截图都能用「Masquer mon RIB」。真值会影响成绩，建议创始人抽查 `match/docs.jsonl` 里的 `accept`。

## `npm run check`

- lint、typecheck、test（core 1189、mobile 693 等，全部通过）、test:native-dsp、check:licenses、check:locales 都通过。
- **`format:check` 不通过，但不是这次的改动造成的**：出发的分支 `codex/local-model-eval-20261028` 本来就有 310 个文件格式不合格，包括 `tests/local-model-eval/data/*/meta.json`、两个 `models.json`、`rules_baseline.mjs` 和两份交接文档。这次新增和修改的文件都已用 prettier 格式化。那批旧文件没有动，因为重排夹具会改变已提交的测试数据。
- 这次没有新增或修改界面文案，所以不涉及 en/zh/fr 三份文案。
