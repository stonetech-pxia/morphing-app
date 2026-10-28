import type { Locale } from './schema';
import {
  TRANSLATE_LANGUAGES,
  TRANSLATE_LANGUAGE_NAMES,
  hasWords,
  normalizeDetected,
  splitForTranslation,
} from './tools/translate';

// 文字转语音（D-270）里和平台无关的部分：语言、分段、自动选语言、预计大小。
// 声音由系统合成（iOS 的 AVSpeechSynthesizer，Android 的 TextToSpeech），在本机生成音频文件，不上传。
// 这是用户自己运行的步骤；AI 只把它搭进快捷操作，看不到文字（D-036、D-113）。

/** 能选的语言：和翻译同样的 20 种（两边的系统声音都有，但不一定都装了）。 */
export const SPEAK_LANGUAGES = TRANSLATE_LANGUAGES;
export type SpeakLanguage = (typeof SPEAK_LANGUAGES)[number];
export const SPEAK_LANGUAGE_NAMES = TRANSLATE_LANGUAGE_NAMES;

/** 系统声音用的地区代码（BCP 47）：iOS 的 AVSpeechSynthesisVoice、Android 的 Locale 都认。 */
export const SPEAK_VOICE_LOCALES: Record<SpeakLanguage, string> = {
  'zh-Hans': 'zh-CN',
  en: 'en-US',
  'zh-Hant': 'zh-TW',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  pt: 'pt-BR',
  it: 'it-IT',
  ru: 'ru-RU',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  ar: 'ar-SA',
  tr: 'tr-TR',
  nl: 'nl-NL',
  pl: 'pl-PL',
  uk: 'uk-UA',
  hi: 'hi-IN',
};

/** 语速：1 是系统的正常语速。 */
export const SPEAK_RATE_MIN = 0.5;
export const SPEAK_RATE_MAX = 2;

/**
 * 一次最多读多少字：中文约 2 小时、英文约 40 分钟的声音。再长的 WAV 中间文件会有几百 MB，
 * 用户也很少需要一个这么长的音频文件。
 */
export const MAX_SPEAK_CHARS = 30_000;

/**
 * 一段最多多少字：Android 的 TextToSpeech 一次最多 4000 字（getMaxSpeechInputLength），
 * 段小一点进度走得匀、取消也快。
 */
export const SPEAK_SEGMENT_CHARS = 1000;

const CJK_CHAR = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/;
/** 一句话在这里结束（切太长的段时优先在这里切）。 */
const SENTENCE = /[^.!?。！？]+[.!?。！？]+["'”’）)]?\s*|[^.!?。！？]+$/g;
/** 没有句号的长句：退一步在逗号、空格处切。 */
const SOFT_BREAK = /[,，、;；:：\s]/;
/** 有字母或数字才读（只有符号的片段跳过）。 */
const READABLE = /[\p{L}\p{N}]/u;

/** 一行的几片接起来：中日韩文字直接接，其他用空格。 */
function joinParts(parts: readonly string[]): string {
  return parts.reduce((line, part) => {
    if (!line) return part;
    return CJK_CHAR.test(line.at(-1)!) || CJK_CHAR.test(part[0]!) ? line + part : `${line} ${part}`;
  }, '');
}

/** 太长的一段按句子切，句子还太长时在逗号、空格处切，实在没有就硬切。 */
function splitLong(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit];
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (const sentence of unit.match(SENTENCE) ?? [unit]) {
    if (current && current.length + sentence.length > max) flush();
    current += sentence;
    while (current.length > max) {
      let cut = max;
      for (let i = max; i > max / 2; i--) {
        if (SOFT_BREAK.test(current[i - 1]!)) {
          cut = i;
          break;
        }
      }
      out.push(current.slice(0, cut).trim());
      current = current.slice(cut);
    }
  }
  flush();
  return out.filter(Boolean);
}

/**
 * 把文字切成交给系统朗读的几段，每段不超过 max 字。断开的行先接回去（PDF 和文字识别每一行都断开，
 * 系统读到换行会停顿），段落之间换行；几个短段落合成一段，少调几次系统。只有符号的片段不读。
 */
export function splitForSpeech(text: string, max = SPEAK_SEGMENT_CHARS): string[] {
  const units = splitForTranslation(text).flatMap((paragraph, p) =>
    paragraph
      .map(joinParts)
      .filter((line) => READABLE.test(line))
      .flatMap((line) => splitLong(line, max))
      .map((line, i) => ({ line, newParagraph: p > 0 && i === 0 })),
  );
  const segments: string[] = [];
  let current = '';
  for (const { line, newParagraph } of units) {
    const sep = current ? (newParagraph ? '\n\n' : '\n') : '';
    if (current && current.length + sep.length + line.length > max) {
      segments.push(current);
      current = line;
    } else {
      current += sep + line;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** 界面语言对应的朗读语言。 */
export const speakLanguageFor = (locale: Locale): SpeakLanguage =>
  locale === 'zh' ? 'zh-Hans' : locale === 'fr' ? 'fr' : 'en';

/** 按文字本身的书写系统猜语言（系统认不出语言时的退路）；拉丁字母分不出是哪种，返回 null。 */
function scriptLanguage(text: string): SpeakLanguage | null {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const scripts: [SpeakLanguage, number][] = [
    ['ja', count(/[぀-ヿ]/g) * 3],
    ['ko', count(/[가-힯]/g)],
    ['zh-Hans', count(/[一-鿿]/g)],
    ['ru', count(/[Ѐ-ӿ]/g)],
    ['ar', count(/[؀-ۿ]/g)],
    ['th', count(/[฀-๿]/g)],
    ['hi', count(/[ऀ-ॿ]/g)],
  ];
  const [best, n] = scripts.sort((a, b) => b[1] - a[1])[0]!;
  return n > 0 ? best : null;
}

/**
 * 「自动识别」时用哪种语言：detected 是系统对每一段识别出的语言（拿不到时为 null），按字数取最多的；
 * 系统认不出时按书写系统猜，拉丁字母的文字用界面语言里的拉丁语言（英文 / 法文），都不行返回 null。
 * 一次运行只用一种声音：夹杂的外文按这种语言的声音读。
 */
export function chooseSpeakLanguage(
  segments: readonly string[],
  detected: readonly (string | null)[] | null,
  locale: Locale,
): SpeakLanguage | null {
  const known = new Set<string>(SPEAK_LANGUAGES);
  const chars = new Map<SpeakLanguage, number>();
  segments.forEach((segment, i) => {
    const code = normalizeDetected(detected?.[i]);
    if (code && known.has(code)) {
      const lang = code as SpeakLanguage;
      chars.set(lang, (chars.get(lang) ?? 0) + segment.length);
    }
  });
  const best = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best;
  const all = segments.join('\n');
  const byScript = scriptLanguage(all);
  if (byScript) return byScript;
  if (!hasWords(all)) return null;
  return /\p{Script=Latin}/u.test(all) ? (locale === 'fr' ? 'fr' : 'en') : null;
}

/**
 * 系统声音生成的 WAV 中间文件大概多大（字节，检查剩余空间用）：按 24 kHz、16 位单声道，
 * 中日韩文字每秒约 5 个字，其他文字每秒约 14 个字符，偏大估计。
 */
export function estimateSpeechBytes(text: string, rate = 1): number {
  const cjk = text.match(new RegExp(CJK_CHAR.source, 'g'))?.length ?? 0;
  const seconds = (cjk / 5 + (text.length - cjk) / 14) / Math.max(SPEAK_RATE_MIN, rate);
  return Math.ceil(seconds * 24000 * 2) + 44;
}
