import { RunError, tidyOcrText, type ActionImpl, type OcrLanguage } from '@morph/core';

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
