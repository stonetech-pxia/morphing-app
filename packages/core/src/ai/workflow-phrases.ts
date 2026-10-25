import type { Locale, Workflow, WorkflowStep, WorkspaceConfig } from '../schema';
import { WORKFLOW_PRESETS, type WorkflowPreset } from '../workflows/presets';

// mock AI 的工作流句式（docs/MOCK_AI_PHRASES.md W1–W7）：把「选照片、压到 500KB、分享」这类短语
// 翻译成步骤。只认识固定的说法；认不出的短语返回 null，由调用方整句拒绝。

/** 一个步骤短语 → 动作和参数。 */
export interface StepPhrase {
  action: string;
  params: Record<string, unknown>;
  /** 每次运行时问的参数（「输入文字」要问文字）。 */
  ask?: string[] | undefined;
  /** 记一笔（D-187）：句子里说的表名，由调用方按当前配置换成 collectionId；空字符串表示没说。 */
  table?: string;
}

const num = (s: string) => Number(s.replace(/,/g, ''));

/** 「500KB」「2 MB」「1.5MB」→ KB。 */
function sizeKB(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(kb|mb|k|m|兆)/i.exec(text);
  if (!m) return null;
  const n = num(m[1]!);
  return /^(mb|m|兆)$/i.test(m[2]!) ? Math.round(n * 1024) : Math.round(n);
}

type Matcher = [RegExp, (m: RegExpMatchArray, locale: Locale) => StepPhrase];

// ---- 翻译（D-174，MOCK_AI_PHRASES TR）----

/** 「中文」「英语」「Japanese」→ 翻译的语言代码。 */
const LANGUAGE_WORDS: [RegExp, string][] = [
  [/^(?:繁体中文|繁体|繁體中文|traditional chinese)$/i, 'zh-Hant'],
  [/^(?:中文|简体中文|汉语|chinese|simplified chinese)$/i, 'zh-Hans'],
  [/^(?:英文|英语|english)$/i, 'en'],
  [/^(?:日文|日语|japanese)$/i, 'ja'],
  [/^(?:韩文|韩语|korean)$/i, 'ko'],
  [/^(?:法文|法语|french)$/i, 'fr'],
  [/^(?:德文|德语|german)$/i, 'de'],
  [/^(?:西班牙文|西班牙语|spanish)$/i, 'es'],
  [/^(?:葡萄牙文|葡萄牙语|portuguese)$/i, 'pt'],
  [/^(?:意大利文|意大利语|italian)$/i, 'it'],
  [/^(?:俄文|俄语|russian)$/i, 'ru'],
  [/^(?:越南文|越南语|vietnamese)$/i, 'vi'],
  [/^(?:泰文|泰语|thai)$/i, 'th'],
];
export const LANGUAGE_WORD =
  '(繁体中文|繁體中文|简体中文|中文|汉语|英文|英语|日文|日语|韩文|韩语|法文|法语|德文|德语|西班牙文|西班牙语|葡萄牙文|葡萄牙语|意大利文|意大利语|俄文|俄语|越南文|越南语|泰文|泰语|traditional chinese|simplified chinese|chinese|english|japanese|korean|french|german|spanish|portuguese|italian|russian|vietnamese|thai)';

/** 语言说法 → 代码；不认识返回 null。 */
export function languageOf(word: string): string | null {
  return LANGUAGE_WORDS.find(([re]) => re.test(word.trim()))?.[1] ?? null;
}

const TRANSLATE_PHRASES: Matcher[] = [
  [
    new RegExp(
      `^(?:翻译|翻|译)成\\s*${LANGUAGE_WORD}$|^translate (?:it |them |the text )?(?:in)?to ${LANGUAGE_WORD}$`,
      'i',
    ),
    (m) => ({
      action: 'translate.text',
      params: { from: 'auto', to: languageOf(m[1] ?? m[2]!)! },
    }),
  ],
  [
    // 只说「翻译」：翻成界面语言，每次运行时可以换。
    /^翻译(?:一下)?$|^translate(?: it| them)?$/i,
    (_m, locale) => ({
      action: 'translate.text',
      params: { from: 'auto', to: locale === 'zh' ? 'zh-Hans' : locale === 'fr' ? 'fr' : 'en' },
      ask: ['to'],
    }),
  ],
  [
    /^(?:输入|粘贴|输入或粘贴)(?:一段)?文字$|^(?:type|paste|type or paste) (?:some |the )?text$/i,
    () => ({ action: 'in.text', params: { text: '' }, ask: ['text'] }),
  ],
  [
    /^提取\s*pdf\s*(?:里的|的)?文字$|^(?:get|extract) (?:the )?text (?:from|of) (?:the )?pdfs?$/i,
    () => ({ action: 'pdf.extractText', params: {} }),
  ],
  [
    /^复制(?:文字|译文|结果|下来)?$|^copy(?: the)? (?:text|translation)$/i,
    () => ({ action: 'text.copy', params: {} }),
  ],
  [
    /^(?:存成|保存成|存为)(?:文字|文本|txt)(?:文件)?$|^save (?:it )?as (?:a )?(?:text|txt)(?: file)?$/i,
    () => ({ action: 'text.toFile', params: {} }),
  ],
];

// ---- 音频（D-157，MOCK_AI_PHRASES AU）----

const AUDIO_PHRASES: Matcher[] = [
  [
    /^(?:现在)?录(?:音|一段|一段音|一段录音)$|^record(?: audio| a voice memo| now)?$/i,
    () => ({ action: 'in.audio', params: { source: 'record', min: 1, max: 1 } }),
  ],
  [
    /^(?:选|选择|挑)(?:几段|一段|几个|一个)?(?:音频|录音|语音|歌|歌曲|音乐)$|^(?:choose|pick|select) (?:some |a )?(?:audio(?: files?)?|recordings?|voice memos?|songs?|music)$/i,
    () => ({ action: 'in.audio', params: { source: 'files', min: 1, max: 10 } }),
  ],
  [
    /^(?:语音转文字|录音转文字|转成文字|转文字|变成文字|识别语音|听写)$|^(?:transcribe(?: it| them)?|speech to text|turn (?:it|them) into text)$/i,
    (_m, locale) => ({
      action: 'audio.transcribe',
      params: { lang: locale === 'zh' ? 'zh' : locale === 'fr' ? 'fr' : 'en', model: 'standard' },
      ask: ['lang'],
    }),
  ],
  [
    /^(?:压缩|压小)(?:音频|录音|语音)$|^(?:把)?(?:音频|录音|语音)压小(?:一点)?$|^compress (?:the )?(?:audio|recordings?)$|^make (?:the )?(?:audio|recordings?) smaller$/i,
    () => ({ action: 'audio.compress', params: { by: 'size', maxMB: 2, quality: 'standard' } }),
  ],
  [
    // MP3 输出（D-183）；跟在视频后面时换成「提取视频里的声音」（fitToPrevious）。
    /^(?:转|转成|转换成|改成|存成)\s*(m4a|wav|mp3)(?:\s*格式)?$|^(?:convert (?:it |them )?to|save (?:it |them )?as) (m4a|wav|mp3)$/i,
    (m) => ({ action: 'audio.convert', params: { format: (m[1] ?? m[2]!).toLowerCase() } }),
  ],
  [
    /^(?:合成|接成|拼成|合并成)(?:一段|一个)(?:录音|音频)?$|^合并录音$|^join (?:them |the recordings )?(?:into one)?$/i,
    () => ({ action: 'audio.merge', params: {} }),
  ],
  [
    /^(?:提取|取出|只要|存下)(?:视频(?:里|的|里的)?)?(?:声音|音频|背景音乐)$|^(?:extract|keep|get) (?:the )?(?:audio|sound|music)(?: of the video| from the video)?$/i,
    () => ({ action: 'audio.fromVideo', params: { format: 'm4a' } }),
  ],
];

// ---- 格式转换的缺口（D-183–D-186，MOCK_AI_PHRASES FG）----

const FORMAT_PHRASES: Matcher[] = [
  [
    // 动图（D-184）：默认是几张图片做成动图；跟在视频后面时换成视频转 GIF（fitToPrevious）。
    /^(?:转成|做成|变成|生成|转)\s*(?:gif|动图)(?:\s*动图)?$|^(?:make|turn (?:it |them )?into|convert (?:it |them )?to) (?:an? )?(?:animated )?gif$/i,
    () => ({ action: 'image.toGif', params: { delayMs: 500, maxSide: 480 } }),
  ],
  [
    // 从「文件」选（D-184、D-185）：电脑传来的、下载的照片和视频。
    /^从文件(?:里|app 里)?(?:选|选择|挑)(?:几个|一个|一段)?视频$|^(?:choose|pick|select) (?:some |a )?videos? from (?:the )?files(?: app)?$/i,
    () => ({ action: 'in.videos', params: { source: 'files', min: 1, max: 10 } }),
  ],
  [
    /^从文件(?:里|app 里)?(?:选|选择|挑)(?:几张|一张)?(?:照片|图片)$|^(?:choose|pick|select) (?:some |a )?(?:photos?|pictures?|images?) from (?:the )?files(?: app)?$/i,
    () => ({ action: 'in.photos', params: { source: 'files', min: 1, max: 30 } }),
  ],
  [
    // 办公文档（D-186）。
    /^(?:选|选择)\s*(?:一个|几个)?\s*(?:(?:word|excel|ppt|powerpoint|office)(?:\s*或\s*(?:word|excel|ppt|powerpoint))?\s*(?:文档|文件|表格|幻灯片)?|文档)$|^(?:choose|pick|select) (?:a |some )?(?:word|excel|powerpoint|office) (?:documents?|files?)$|^(?:choose|pick|select) (?:a |some )?documents?$/i,
    () => ({ action: 'in.files', params: { accept: 'documents', min: 1, max: 10 } }),
  ],
];

// ---- 记一笔（D-187，MOCK_AI_PHRASES RE）----

const tableName = (raw: string | undefined) =>
  (raw ?? '')
    .replace(/["「」“”]/g, '')
    .replace(/(?:这张表|数据表|表格|表|里)$/, '')
    .trim();

const RECORD_PHRASES: Matcher[] = [
  [
    /^(?:记一笔|记一条|记下来|记账)(?:到|进)?(.*)$|^(?:记到|记进|写进|写到|加到)(.+?)(?:表|数据表|里)?$/,
    (m) => ({ action: 'out.addRecord', params: {}, table: tableName(m[1] ?? m[2]) }),
  ],
  [
    /^(?:add|log) (?:a |one )?(?:record|entry)(?: (?:to|in) (?:the )?(.+?))?(?: table)?$|^(?:log|record) (?:it|them) (?:in|to) (?:the )?(.+?)(?: table)?$/i,
    (m) => ({ action: 'out.addRecord', params: {}, table: tableName(m[1] ?? m[2]) }),
  ],
];

const STEP_PHRASES: Matcher[] = [
  [
    /^(?:导出字幕|导出SRT字幕|export SRT captions)$/i,
    () => ({ action: 'video.subtitles', params: { lang: 'zh', model: 'standard' } }),
  ],
  [
    /^(?:标注图片|画箭头|mark up photos|annotate photos)$/i,
    () => ({ action: 'image.annotate', params: {} }),
  ],
  [
    /^(?:图片自动优化|自动优化照片|auto adjust photos)$/i,
    () => ({
      action: 'image.adjust',
      params: { mode: 'auto', brightness: 0, contrast: 100, saturation: 100 },
    }),
  ],
  [
    /^(?:调亮照片|brighten photos)$/i,
    () => ({
      action: 'image.adjust',
      params: { mode: 'manual', brightness: 15, contrast: 100, saturation: 100 },
    }),
  ],
  [
    /^(?:抠图|去背景|去掉背景|remove background)$/i,
    () => ({
      action: 'image.removeBackground',
      params: { background: 'transparent', color: '#FFFFFF' },
    }),
  ],
  [
    /^(?:换成白底|白色背景|white background)$/i,
    () => ({ action: 'image.removeBackground', params: { background: 'color', color: '#FFFFFF' } }),
  ],
  [
    /人声降噪|去除?杂音|reduce (?:speech|background) noise|denoise/i,
    () => ({ action: 'audio.denoise', params: {} }),
  ],
  [
    /^调到正常音量$|^normalize volume$/i,
    () => ({ action: 'audio.volume', params: { mode: 'normal', db: 0 } }),
  ],
  [
    /^音量\s*([+-]?\d+)\s*dB$|^volume ([+-]?\d+) dB$/i,
    (m) => ({ action: 'audio.volume', params: { mode: 'db', db: Number(m[1] ?? m[2]) } }),
  ],
  [
    /^(?:视频)?(?:速度|变速|加速到)\s*(0\.5|0\.75|1|1\.25|1\.5|2|3|4)\s*(?:倍|×)$|^video speed (0\.5|0\.75|1|1\.25|1\.5|2|3|4)x$/i,
    (m) => ({ action: 'video.speed', params: { factor: Number(m[1] ?? m[2]) } }),
  ],
  [
    /^(?:视频)?裁成\s*(9:16|1:1|4:5|16:9)$|^crop video to (9:16|1:1|4:5|16:9)$/i,
    (m) => ({ action: 'video.crop', params: { ratio: m[1] ?? m[2] } }),
  ],
  [
    /^(?:顺时针)?旋转(?:视频)?\s*(90|180|270)\s*度$|^rotate (?:the )?video (90|180|270) degrees$/i,
    (m) => ({ action: 'video.rotate', params: { degrees: Number(m[1] ?? m[2]) } }),
  ],
  [
    /^(?:换背景音乐|给视频配乐)$|^add background music$/i,
    () => ({ action: 'video.audio', params: { originalVolume: 0, loop: true } }),
  ],
  [
    /^(?:去掉视频声音|去掉声音|视频静音)$|^mute (?:the )?videos?$/i,
    () => ({ action: 'video.mute', params: {} }),
  ],
  [
    /^(?:截一帧|截一帧存成照片|视频截帧)$|^save a video frame$/i,
    () => ({ action: 'video.frame', params: {} }),
  ],
  [
    /^(?:拼接视频|合并视频|拼成一段视频)$|^join (?:the )?videos?$/i,
    () => ({ action: 'video.merge', params: {} }),
  ],
  ...RECORD_PHRASES,
  ...TRANSLATE_PHRASES,
  ...AUDIO_PHRASES,
  ...FORMAT_PHRASES,
  [
    /^(?:从相册)?(?:选|选择|挑)(?:几张|多张|一张)?(?:照片|图片|截图)$|^(?:choose|pick|select) (?:some |a )?(?:photos?|pictures?|images?|screenshots?)$/i,
    () => ({ action: 'in.photos', params: { source: 'library', min: 1, max: 30 } }),
  ],
  [
    // 文档相机（D-084）：实时找边、自动拍、多页；单说「扫描」仍是找边拉正（scan.detect）。
    /^(?:用文档相机)?扫描(?:文档|纸张|收据|几页纸?)$|^scan (?:documents?|paper|pages|receipts?)$/i,
    () => ({ action: 'in.photos', params: { source: 'scanner', min: 1, max: 30 } }),
  ],
  [
    // 视频（D-147）：从相册选；压缩、转成 MP4、剪一段。
    /^(?:从相册)?(?:选|选择|挑)(?:几个|一个|一段)?视频$|^(?:choose|pick|select) (?:some |a )?videos?$/i,
    () => ({ action: 'in.videos', params: { min: 1, max: 10 } }),
  ],
  [
    /^压缩视频$|^(?:把)?视频压小(?:一点)?$|^compress (?:the )?videos?$|^make (?:the )?videos? smaller$/i,
    () => ({ action: 'video.compress', params: { by: 'size', maxMB: 20, quality: '720p' } }),
  ],
  [
    /^(?:转|转成|转换成|改成)\s*mp4(?:\s*格式)?$|^convert (?:it |them )?to mp4$/i,
    () => ({ action: 'video.convert', params: { format: 'mp4' } }),
  ],
  [
    /^(?:剪一段|剪视频|剪辑|截取一段)$|^trim(?: it| the video)?$/i,
    () => ({ action: 'video.trim', params: {} }),
  ],
  [
    /^压缩\s*pdf$|^(?:把)?\s*pdf\s*压小(?:一点)?$|^compress (?:the )?pdfs?$|^make (?:the )?pdfs? smaller$/i,
    () => ({ action: 'pdf.compress', params: { maxMB: 2, whenTooBig: 'ask' } }),
  ],
  [
    /^拍(?:照|照片|一张|几张)?$|^take (?:a )?(?:photos?|pictures?)$/i,
    () => ({ action: 'in.photos', params: { source: 'camera', min: 1, max: 10 } }),
  ],
  [
    /^(?:选|选择)\s*pdf\s*(?:和|或)\s*(?:图片|照片)$|^(?:choose|pick) pdfs? and (?:images|photos)$/i,
    () => ({ action: 'in.files', params: { accept: 'pdfOrImages', min: 1, max: 30 } }),
  ],
  [
    /^(?:选|选择)\s*(?:一个|几个)?\s*pdf$|^(?:choose|pick|select) (?:a |some )?pdfs?$/i,
    () => ({ action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } }),
  ],
  [
    /^(?:选|选择)(?:文件|几个文件)$|^(?:choose|pick|select) (?:some )?files$/i,
    () => ({ action: 'in.files', params: { accept: 'any', min: 1, max: 30 } }),
  ],
  [
    /^(?:压缩)?(?:压到|压缩到|小于|不超过)\s*(\d+(?:\.\d+)?\s*(?:kb|k|mb|m|兆))\s*(?:以内|以下)?$|^compress (?:it |them |each )?(?:to|under|below) (\d+(?:\.\d+)?\s*(?:kb|mb))$/i,
    (m) => ({
      action: 'image.compress',
      params: { maxKB: sizeKB(m[1] ?? m[2]!)!, format: 'jpeg' },
    }),
  ],
  [
    /^(?:长边|缩到|改成长边)\s*(\d+)\s*(?:像素|px)?$|^(?:resize to|long side) (\d+)\s*(?:px)?$/i,
    (m) => ({ action: 'image.resize', params: { mode: 'longEdge', px: num(m[1] ?? m[2]!) } }),
  ],
  [
    /^(?:转|转成|转换成|改成)\s*(jpg|jpeg|png|webp)(?:\s*格式)?$|^convert to (jpg|jpeg|png|webp)$/i,
    (m) => {
      const f = (m[1] ?? m[2]!).toLowerCase();
      const format = f === 'jpg' ? 'jpeg' : f;
      return {
        action: 'image.convert',
        params: { format, quality: format === 'png' ? 100 : format === 'webp' ? 80 : 85 },
      };
    },
  ],
  [
    /^(?:去掉|去除|删除)(?:定位|位置|位置信息|地理位置)$|^remove (?:the )?(?:location|gps)(?: info)?$/i,
    () => ({ action: 'image.stripMetadata', params: {} }),
  ],
  [/^(?:裁剪|裁切)$|^crop$/i, () => ({ action: 'image.crop', params: { aspect: 'free' } })],
  [
    /^(?:排序|排好顺序|调整顺序)$|^(?:put (?:them )?in order|reorder)$/i,
    () => ({ action: 'file.order', params: {} }),
  ],
  [
    /^拼(?:成)?长图$|^stitch(?: into a long image)?$/i,
    () => ({
      action: 'image.stitch',
      params: { direction: 'vertical', gapPx: 0, background: '#FFFFFF' },
    }),
  ],
  [
    /^打码$|^(?:redact|hide (?:private )?parts)$/i,
    () => ({ action: 'image.redact', params: { style: 'black' } }),
  ],
  [/^(?:扫描|找边|拉正)$|^(?:scan|straighten)$/i, () => ({ action: 'scan.detect', params: {} })],
  [
    /^(?:识别文字|文字识别|提取文字)$|^(?:recognize|read|extract) (?:the )?text$/i,
    (_m, locale) => ({
      action: 'ocr.recognize',
      params: { lang: locale === 'zh' ? 'chi_sim' : locale === 'fr' ? 'fra' : 'eng' },
    }),
  ],
  [
    /^(?:合成|转成|生成|做成)\s*(?:一个)?\s*pdf$|^(?:make|create) (?:a |one )?pdf$/i,
    () => ({
      action: 'pdf.fromImages',
      params: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
    }),
  ],
  [
    /^(?:合并|合并成一个)\s*(?:pdf)?$|^merge(?: into one pdf)?$/i,
    () => ({ action: 'pdf.merge', params: { imagePage: 'a4' } }),
  ],
  [/^(?:签名|签字)$|^sign(?: it)?$/i, () => ({ action: 'pdf.sign', params: {} })],
  [
    /^(?:打包|打包成|压缩成)\s*zip$|^(?:zip(?: them)?|make a zip)$/i,
    () => ({ action: 'zip.create', params: {} }),
  ],
  [
    /^(?:按|用)?\s*"?(.+?)"?\s*命名$|^name (?:it|them) "?(.+?)"?$/i,
    (m) => ({ action: 'file.rename', params: { template: (m[1] ?? m[2]!).trim() } }),
  ],
  [
    // 一次分享全部文件（D-119）；发到哪个 App 由用户在分享面板里选，不会自动发给某个人。
    /^(?:一次|一起|全部|一次性)?分享(?:全部|所有文件|出去)?$|^(?:发|分享)到(?:微信|WhatsApp|QQ|邮件|邮箱)$|^share(?: it| them| them all| all(?: at once)?| all the files)?(?: at once)?$/i,
    () => ({ action: 'out.share', params: {} }),
  ],
  [
    // 存到用户在「文件」里选的文件夹（D-120）：本机、iCloud 云盘、Google Drive、Dropbox 都走系统选择器。
    /^(?:存到|保存到|存进|放到)\s*(?:icloud\s*(?:云盘|drive)?|google\s*drive|dropbox|onedrive|网盘|云盘)?\s*(?:的|里的)?\s*(?:某个|一个|指定的?|选定的?)?\s*文件夹(?:里)?$|^(?:存到|保存到|存进)\s*(?:icloud\s*(?:云盘|drive)?|google\s*drive|dropbox|onedrive|网盘|云盘)$|^save (?:it |them )?(?:to|into|in) (?:a |the |my )?(?:chosen )?(?:folder|icloud(?: drive)?(?: folder)?|google drive(?: folder)?|dropbox(?: folder)?)$/i,
    () => ({ action: 'out.saveToFolder', params: {} }),
  ],
  [
    /^(?:保存|存到文件|存起来)$|^save(?: to files| it)?$/i,
    () => ({ action: 'file.save', params: {} }),
  ],
  [/^存到相册$|^save to photos$/i, () => ({ action: 'out.saveToPhotos', params: {} })],
  [/^打印$|^print(?: it)?$/i, () => ({ action: 'out.print', params: {} })],
];

/** 把命名短语里的「日期」换成模板。 */
export function nameTemplateOf(words: string): string {
  return words
    .replace(/日期|\bdate\b/gi, '{date:YYYY-MM-DD}')
    .replace(/原文件名|source name/gi, '{sourceName}');
}

export function parseStepPhrase(text: string, locale: Locale): StepPhrase | null {
  const clean = text.replace(/^(?:再|然后|最后|先|接着|and then|then|and)\s*/i, '').trim();
  for (const [re, make] of STEP_PHRASES) {
    const m = clean.match(re);
    if (!m) continue;
    const step = make(m, locale);
    if (step.action === 'file.rename') {
      step.params = { template: nameTemplateOf(String(step.params.template)) };
    }
    return step;
  }
  return null;
}

/** 「选照片、压到 500KB、分享」/「choose photos, compress to 500 KB, then share」→ 步骤短语。 */
export function splitStepPhrases(text: string): string[] {
  return text
    .split(/、|→|->|,|，|然后|\bthen\b|\band\b(?! (?:images|photos))/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 新步骤的 ID：动作名的后半段，重复时加序号。 */
export function stepIdFor(action: string, taken: readonly { id: string }[]): string {
  const base = action
    .split('.')[1]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const used = new Set(taken.map((s) => s.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** 输出文字的动作：后面的「转成 PDF」是文字转 PDF（D-174）。 */
const TEXT_OUTPUT = new Set([
  'in.text',
  'audio.transcribe',
  'ocr.recognize',
  'pdf.extractText',
  'translate.text',
  'qr.read',
  'text.copy',
]);

/**
 * 同一句话按前一步换成接得上的动作：选 PDF 之后的「提取文字」是提取 PDF 文字；
 * 文字之后的「转成 PDF」是文字转 PDF。
 */
function fitToPrevious(p: StepPhrase, previous: WorkflowStep | undefined): StepPhrase {
  if (
    p.action === 'ocr.recognize' &&
    previous?.action === 'in.files' &&
    previous.params.accept === 'pdf'
  ) {
    return { action: 'pdf.extractText', params: {} };
  }
  if (p.action === 'pdf.fromImages' && previous && TEXT_OUTPUT.has(previous.action)) {
    return { action: 'text.toPdf', params: { pageSize: 'a4', fontSize: 12 } };
  }
  // 格式转换（D-183–D-186）：Word 之后的「转成 PDF」是文档转 PDF；视频之后的「转成 GIF」是视频转 GIF，
  // 「转成 MP3」是提取视频里的声音。
  if (
    p.action === 'pdf.fromImages' &&
    previous?.action === 'in.files' &&
    previous.params.accept === 'documents'
  ) {
    return { action: 'pdf.fromDocument', params: { pageSize: 'a4' } };
  }
  if (previous && makesVideo(previous)) {
    if (p.action === 'image.toGif')
      return { action: 'video.toGif', params: { width: 480, fps: 12 } };
    if (p.action === 'audio.convert') return { action: 'audio.fromVideo', params: p.params };
  }
  return p;
}

/** 这一步的结果是视频。 */
const makesVideo = (step: WorkflowStep) =>
  step.action === 'in.videos' ||
  (step.action !== 'video.subtitles' &&
    step.action.startsWith('video.') &&
    !['video.toGif', 'video.frame'].includes(step.action)) ||
  (step.action === 'in.files' && step.params.accept === 'videos');

/** 这一步之后的值大致是什么（只用来给「压到 N MB」选动作）。 */
export type PhraseKind = 'images' | 'video' | 'audio' | 'pdf' | 'other';

function kindAfter(step: StepPhrase, before: PhraseKind | null): PhraseKind | null {
  if (step.action === 'in.photos' || step.action.startsWith('image.')) return 'images';
  if (step.action === 'audio.volume' || step.action === 'audio.denoise') return before;
  if (step.action === 'audio.transcribe') return 'other';
  if (step.action === 'in.audio' || step.action.startsWith('audio.')) return 'audio';
  if (step.action === 'video.subtitles') return 'other';
  if (step.action === 'video.frame') return 'images';
  if (step.action === 'video.toGif') return 'images';
  if (step.action === 'in.videos' || step.action.startsWith('video.')) return 'video';
  if (step.action === 'in.files') {
    const accept = step.params.accept;
    return accept === 'pdf'
      ? 'pdf'
      : accept === 'videos'
        ? 'video'
        : accept === 'audio'
          ? 'audio'
          : 'other';
  }
  if (step.action === 'pdf.toImages') return 'images';
  if (step.action.startsWith('pdf.')) return 'pdf';
  if (step.action === 'zip.create') return 'other';
  return before;
}

/**
 * 「压到 N MB」默认是压图片；前面是视频时换成压缩视频，是 PDF 时换成压缩 PDF（D-147）。
 * before：这些步骤之前的值（往已有快捷操作里加步骤时）。
 */
export function fitSizePhrases(
  phrases: readonly StepPhrase[],
  before: PhraseKind | null = null,
): StepPhrase[] {
  let kind = before;
  return phrases.map((p) => {
    let step = p;
    // 音频（D-157）：「压到 N MB」是压音频，「剪一段」是剪音频，「合并」是合成一段。
    if (kind === 'audio') {
      if (p.action === 'image.compress') {
        const mb = Number(p.params.maxKB) / 1024;
        step = {
          action: 'audio.compress',
          params: {
            by: 'size',
            maxMB: Math.max(0.1, Math.round(mb * 10) / 10),
            quality: 'standard',
          },
        };
      } else if (p.action === 'video.trim') {
        step = { action: 'audio.trim', params: {} };
      } else if (p.action === 'pdf.merge') {
        step = { action: 'audio.merge', params: {} };
      }
    }
    if (p.action === 'image.compress' && (kind === 'video' || kind === 'pdf')) {
      const mb = Number(p.params.maxKB) / 1024;
      step =
        kind === 'video'
          ? {
              action: 'video.compress',
              params: { by: 'size', maxMB: Math.max(1, Math.round(mb)), quality: '720p' },
            }
          : {
              action: 'pdf.compress',
              params: { maxMB: Math.max(0.1, Math.round(mb * 10) / 10), whenTooBig: 'ask' },
            };
    }
    kind = kindAfter(step, kind);
    return step;
  });
}

/** 一串已有步骤之后的值大致是什么。 */
export function kindOfSteps(steps: readonly StepPhrase[]): PhraseKind | null {
  return steps.reduce<PhraseKind | null>((kind, step) => kindAfter(step, kind), null);
}

export function stepsFrom(phrases: readonly StepPhrase[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  for (const phrase of phrases) {
    const p = fitToPrevious(phrase, steps.at(-1));
    steps.push({
      id: stepIdFor(p.action, steps),
      action: p.action,
      params: p.params,
      ...(p.ask ? { ask: p.ask } : {}),
    });
  }
  return steps;
}

const PRESET_WORDS: [RegExp, string][] = [
  [/把几段视频拼成一段|join video clips|merge videos/i, 'join-videos'],
  [/从视频里截一张照片|photo from a video/i, 'video-frame'],
  [/视频去掉声音|remove sound from videos/i, 'mute-video'],
  [/给视频换背景音乐|add background music/i, 'video-background-music'],
  [/把视频转正|fix video rotation/i, 'fix-video-rotation'],
  [/裁成竖屏视频|portrait posts/i, 'vertical-video'],
  [/视频加速或慢放|speed up or slow down video/i, 'video-speed'],
  [/导出视频\s*SRT\s*字幕|export video captions as SRT/i, 'video-srt-captions'],
  [/在图片上画箭头和文字|add arrows and notes/i, 'mark-up-photos'],
  [/把太暗的照片调亮|brighten dark photos/i, 'brighten-photos'],
  [/把照片背景去掉|remove a photo background/i, 'remove-photo-background'],
  [/录音人声降噪|noise in a voice recording/i, 'denoise-audio'],
  [/视频人声降噪|noise in video speech/i, 'denoise-video'],
  [/把录音调到正常音量|quiet audio easier/i, 'normal-audio-volume'],
  [/把视频调到正常音量|quiet video easier/i, 'normal-video-volume'],
  // 音频预设（D-156）放在「合一」「发照片」前面。
  [/录音转文字|录音变成文字|recordings? (?:in)?to text/i, 'audio-to-text'],
  [/语音太大|录音太大|recording (?:is )?too big/i, 'audio-too-big'],
  [/几段录音合成|录音合成一个|join recordings/i, 'merge-recordings'],
  [/语音备忘|voice memos?/i, 'voice-memo-archive'],
  [/剪一段音频|剪铃声|ringtone|part of a recording/i, 'cut-audio'],
  [/视频的声音|视频里的声音|sound of a video/i, 'video-sound'],
  // 翻译预设（D-173）放在「扫描」「打码」前面。
  [/截图翻译|翻译截图|translate screenshots?/i, 'screenshot-translate'],
  [/外文\s*pdf|translate a pdf/i, 'foreign-pdf'],
  [/外文材料|纸质材料翻|paper documents into/i, 'foreign-paper'],
  [/中文材料翻成英文|chinese documents into english/i, 'papers-to-english'],
  [/视频太大|视频发不出去|video (?:is )?too big/i, 'video-too-big'],
  [/pdf\s*太大|pdf\s*传不上去|pdf (?:is )?too big/i, 'pdf-too-big'],
  [
    /证件照打印|打印证件照|证件照冲印|print(?:ing)? id photos?|id photos? to print/i,
    'print-id-photos',
  ],
  [/签证|证件照|visa|id photo|passport photo/i, 'visa-photo'],
  [/材料包|申请材料|application packet|document packet/i, 'document-packet'],
  [/发邮件|传网站|email|upload/i, 'email-photos'],
  [/签回|签名表格|sign and (?:send|return)/i, 'sign-return'],
  [/扫描文档|扫描|scan/i, 'scan-document'],
  [/合一|多份材料|combine/i, 'combine-documents'],
  [/收据|发票|receipt/i, 'receipt-archive'],
  [/截图打码|打码|redact|hide parts/i, 'redact-screenshots'],
  [/批量发照片|发照片|send (?:many )?photos/i, 'send-photos'],
];

export function findPreset(text: string): WorkflowPreset | undefined {
  const lower = text.toLowerCase();
  const byName = WORKFLOW_PRESETS.find(
    (p) => lower.includes(p.name.zh.toLowerCase()) || lower.includes(p.name.en.toLowerCase()),
  );
  if (byName) return byName;
  const hit = PRESET_WORDS.find(([re]) => re.test(text));
  return hit ? WORKFLOW_PRESETS.find((p) => p.id === hit[1]) : undefined;
}

/** 按名字找工作流（完全相同优先，其次包含）。 */
export function findWorkflowByName(rawName: string, config: WorkspaceConfig): Workflow | undefined {
  const name = rawName
    .replace(/"/g, '')
    .replace(/(?:快捷操作|工作流|流程|workflow|quick action)$/i, '')
    .trim()
    .toLowerCase();
  if (!name) return undefined;
  const all = config.workflows;
  return (
    all.find((w) => w.name.toLowerCase() === name) ??
    all.find((w) => w.name.toLowerCase().includes(name) || name.includes(w.name.toLowerCase()))
  );
}
