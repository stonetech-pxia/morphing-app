import type { Localized } from './schema';

// 语音转文字（D-150、D-151）里和平台无关的部分：语言、要用哪个下载内容、把识别结果整理成文字。
// iOS 用系统识别（BCP 47 语言代码），Android 用 whisper.cpp（whisper 的语言代码 + 下载的模型）。
// 识别出的文字只留在本机（D-036）：复制、存成文件、生成 PDF，绝不发给 AI。

/** 能选的语言（和文字识别一样 12 种）。zh 是普通话、输出简体；zh-TW 是台湾国语、输出繁体。 */
export const SPEECH_LANGUAGES = [
  'zh',
  'zh-TW',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'vi',
] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

export const SPEECH_LANGUAGE_NAMES: Record<SpeechLanguage, Localized> = {
  zh: { en: 'Mandarin (Simplified)', zh: '普通话（简体）' },
  'zh-TW': { en: 'Mandarin (Traditional)', zh: '国语（繁体）' },
  en: { en: 'English', zh: '英语' },
  ja: { en: 'Japanese', zh: '日语' },
  ko: { en: 'Korean', zh: '韩语' },
  fr: { en: 'French', zh: '法语' },
  de: { en: 'German', zh: '德语' },
  es: { en: 'Spanish', zh: '西班牙语' },
  pt: { en: 'Portuguese', zh: '葡萄牙语' },
  it: { en: 'Italian', zh: '意大利语' },
  ru: { en: 'Russian', zh: '俄语' },
  vi: { en: 'Vietnamese', zh: '越南语' },
};

/** iOS 系统识别用的语言（BCP 47）。 */
export const SYSTEM_SPEECH_LOCALES: Record<SpeechLanguage, string> = {
  zh: 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  pt: 'pt-BR',
  it: 'it-IT',
  ru: 'ru-RU',
  vi: 'vi-VN',
};

/** whisper 的语言代码：普通话和国语都是 zh，简繁靠提示词。 */
export const whisperLanguage = (lang: SpeechLanguage): string => (lang === 'zh-TW' ? 'zh' : lang);

/**
 * whisper 的提示词。不给提示词时 whisper 常把普通话写成繁体（Mac 上实测 base 模型整段繁体），
 * 用一句简体的话开头就会跟着用简体；国语反过来。
 */
export function whisperPrompt(lang: SpeechLanguage): string | undefined {
  if (lang === 'zh') return '以下是普通话的句子。';
  if (lang === 'zh-TW') return '以下是國語的句子。';
  return undefined;
}

/**
 * Android 的识别模型（下载内容，core/packs.ts）。standard 是 whisper small（约 190 MB，中文明显更准），
 * fast 是 whisper base（约 60 MB，快约 3 倍）。两个都要语音检测模型 speech-vad。
 */
export const SPEECH_MODELS = ['standard', 'fast'] as const;
export type SpeechModel = (typeof SPEECH_MODELS)[number];

export const SPEECH_MODEL_PACKS: Record<SpeechModel, string> = {
  standard: 'speech-whisper-small',
  fast: 'speech-whisper-base',
};
export const SPEECH_VAD_PACK = 'speech-vad';
/** 下载内容里的文件名。 */
export const SPEECH_MODEL_FILE = 'model.bin';
export const SPEECH_VAD_FILE = 'vad.bin';

export interface SpeechSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** 中日韩文字、全角标点。 */
const CJK = '\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef';
const FULL_WIDTH: Record<string, string> = {
  ',': '，',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
};
/** 中文、日文的词之间没有空格（韩文有）。 */
const noSpaces = (lang: SpeechLanguage) => lang === 'zh' || lang === 'zh-TW' || lang === 'ja';

/**
 * whisper 在静音、音乐里常「编」出来的句子（来自训练用的字幕）和非语音标记。
 * 只在一整段就是这些时才去掉，说话里提到的不动。
 */
const HALLUCINATIONS = [
  /^字幕(由|製作|制作|提供).*$/,
  /^.*amara\.org.*$/i,
  /^请不吝点赞.*$/,
  /^請不吝點贊.*$/,
  /^(謝謝|谢谢)(大家)?(收看|觀看|观看)[。！!]?$/,
  /^thanks? (you )?for watching[.!]?$/i,
  /^(please )?subscribe.*$/i,
  /^ご視聴ありがとうございました[。]?$/,
];
const NON_SPEECH = /^[[(（【♪].*[\])）】♪]$/;

/** 停顿多久算换一段（加一个空行）。 */
export const PARAGRAPH_PAUSE_MS = 3000;

function cleanSegment(text: string, lang: SpeechLanguage): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (noSpaces(lang)) {
    // whisper 在中文里用半角标点：换成全角；中文之间的空格去掉（iOS 偶尔在标点前留一个空格）。
    t = t
      .replace(
        new RegExp(`([${CJK}]) *([,?!:;])`, 'g'),
        (_, c: string, p: string) => c + FULL_WIDTH[p],
      )
      .replace(new RegExp(` *([,?!:;]) *(?=[${CJK}])`, 'g'), (_, p: string) => FULL_WIDTH[p]!)
      .replace(new RegExp(`([${CJK}]) *\\.(?![0-9])`, 'g'), '$1。')
      .replace(new RegExp(`([${CJK}]) +(?=[${CJK}])`, 'g'), '$1');
  }
  return t;
}

const isNoise = (text: string) =>
  text === '' ||
  /^[\s.。,，!！?？…-]*$/.test(text) ||
  NON_SPEECH.test(text) ||
  HALLUCINATIONS.some((re) => re.test(text));

/**
 * 把识别出的段落整理成一段文字（在本机做）：去掉 whisper 编出来的字幕句和 [音乐] 这类标记，
 * 中文换全角标点、去掉多余空格；中日文直接相连，其他语言用空格连；停顿超过 3 秒换一段。
 */
export function tidyTranscript(segments: readonly SpeechSegment[], lang: SpeechLanguage): string {
  const joiner = noSpaces(lang) ? '' : ' ';
  const paragraphs: string[][] = [];
  let lastEnd = -Infinity;
  for (const seg of segments) {
    const text = cleanSegment(seg.text, lang);
    if (isNoise(text)) continue;
    if (paragraphs.length === 0 || seg.startMs - lastEnd >= PARAGRAPH_PAUSE_MS) paragraphs.push([]);
    paragraphs[paragraphs.length - 1]!.push(text);
    lastEnd = seg.endMs;
  }
  return paragraphs
    .map((p) => p.join(joiner).trim())
    .filter(Boolean)
    .join('\n\n');
}
