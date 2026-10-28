import { RunError, tidyOcrText, type ActionImpl, type Locale, type OcrLanguage } from '@morph/core';

import type { VisionPlatform } from '../platform';
import { displayName, fileItems, imageForPage, type RunServices } from './helpers';

// 文字识别（T5）：系统能识别这种语言时用系统的（iOS 的 Vision，D-085；Android 的 ML Kit，D-087）；
// 否则每张图片送进文字识别包页面（tesseract.js）。
// 结果只留在本机（D-036）。

type Impl = ActionImpl<RunServices>;

/** 送进识别的图片长边：再大识别率不会更好，只会更慢。 */
const OCR_INPUT_SIDE = 3500;

/**
 * 识别语言 → Vision 的语言代码（BCP 47）。第一种是用户选的语言；
 * 中日韩等文字里常夹着英文（品牌、网址、型号），补上英文。
 */
export const VISION_LANGUAGES: Record<OcrLanguage, readonly string[]> = {
  eng: ['en-US'],
  chi_sim: ['zh-Hans', 'en-US'],
  chi_tra: ['zh-Hant', 'en-US'],
  jpn: ['ja-JP', 'en-US'],
  kor: ['ko-KR', 'en-US'],
  fra: ['fr-FR', 'en-US'],
  deu: ['de-DE', 'en-US'],
  spa: ['es-ES', 'en-US'],
  por: ['pt-BR', 'en-US'],
  ita: ['it-IT', 'en-US'],
  rus: ['ru-RU', 'en-US'],
  vie: ['vi', 'en-US'],
};

/** 系统语言（BCP 47）→ 识别语言；繁体看文字或地区。没有对应的（如乌克兰文）原样交给系统识别。 */
function ocrLanguageOf(tag: string): OcrLanguage | null {
  const [lang, ...rest] = tag.split('-');
  if (lang === 'zh') {
    return rest.some((p) => ['Hant', 'TW', 'HK', 'MO'].includes(p)) ? 'chi_tra' : 'chi_sim';
  }
  const byCode: Record<string, OcrLanguage> = {
    en: 'eng',
    ja: 'jpn',
    ko: 'kor',
    fr: 'fra',
    de: 'deu',
    es: 'spa',
    pt: 'por',
    it: 'ita',
    ru: 'rus',
    vi: 'vie',
  };
  return byCode[lang!] ?? null;
}

const UI_OCR_LANGUAGE: Record<Locale, OcrLanguage> = { zh: 'chi_sim', en: 'eng', fr: 'fra' };
const CJK_OCR: readonly OcrLanguage[] = ['chi_sim', 'chi_tra', 'jpn', 'kor'];

/**
 * 可搜索 PDF 文字层的识别语言（D-267）：用户读得懂的语言——系统里设的语言（按顺序，比界面语言细，
 * 分得出繁体）、界面语言，最后补英文；只留系统识别得了的。中日韩只取第一种，并放在最前面：
 * Android 的 ML Kit 按第一种选识别器，中日韩的识别器也认拉丁字母，反过来不行。iOS 另外让 Vision
 * 自己判断语言（expo-vision 的 recognizeLines），所以俄文、阿拉伯文等扫描件不在这张单子上也认得出来。
 * 一种都识别不了时返回空。
 */
export function textLayerLanguages(locale: Locale, vision: VisionPlatform): string[] {
  const tags = vision.preferredLanguages ?? [];
  const wanted: (OcrLanguage | string)[] = [
    ...tags.map((tag) => ocrLanguageOf(tag) ?? tag),
    UI_OCR_LANGUAGE[locale],
    'eng',
  ];
  const cjk = wanted.find((l) => CJK_OCR.includes(l as OcrLanguage));
  const ordered = [
    ...(cjk ? [cjk] : []),
    ...wanted.filter((l) => !CJK_OCR.includes(l as OcrLanguage)),
  ];
  const codes = ordered.map((l) =>
    l in VISION_LANGUAGES ? VISION_LANGUAGES[l as OcrLanguage][0]! : l,
  );
  return [...new Set(codes)].filter((code) => vision.supportsLanguage(code));
}

export const OCR_IMPLS: Record<string, Impl> = {
  async 'ocr.recognize'(input, params, ctx) {
    const items = fileItems(input);
    const lang = String(params.lang) as OcrLanguage;
    const { packs } = ctx.services;
    // 系统识别不了的语言（Android 的 ML Kit 不认俄文）退回文字识别包。
    const native = ctx.services.files.vision;
    const vision = native?.supportsLanguage(VISION_LANGUAGES[lang][0]!) ? native : null;
    if (!vision && !packs) throw new RunError('packFailed', { detail: 'ocr' });
    const texts: string[] = [];
    for (const [i, original] of items.entries()) {
      ctx.throwIfCancelled();
      const item = await imageForPage(ctx.services, original, OCR_INPUT_SIDE);
      let raw: string;
      try {
        raw = vision
          ? await vision.recognizeText(item.uri, VISION_LANGUAGES[lang])
          : (
              await packs!.runtime.call<{ text: string }>(
                'ocr',
                'recognize',
                { file: 'input', lang },
                { input: item.uri },
              )
            ).text;
      } catch (e) {
        const detail = String(e instanceof Error ? e.message : e);
        throw new RunError(vision ? 'unexpected' : 'packFailed', { detail });
      }
      const text = tidyOcrText(raw);
      if (text) texts.push(text);
      ctx.progress(i + 1, items.length);
    }
    if (texts.length === 0) throw new RunError('notFound', { name: displayName(items[0]!) });
    // 文字只留在本机：结果页可以复制，后面的步骤可以存成文件或生成 PDF，绝不发给 AI。
    return { type: 'text', text: texts.join('\n\n'), name: items[0]!.name };
  },
};
