import { RunError, tidyOcrText, type ActionImpl } from '@morph/core';

import { displayName, fileItems, imageForPage, type RunServices } from './helpers';

// 文字识别（T5）：每张图片送进文字识别包页面（tesseract.js），结果只留在本机（D-036）。

type Impl = ActionImpl<RunServices>;

/** 送进识别的图片长边：再大识别率不会更好，只会更慢。 */
const OCR_INPUT_SIDE = 3500;

export const OCR_IMPLS: Record<string, Impl> = {
  async 'ocr.recognize'(input, params, ctx) {
    const items = fileItems(input);
    const packs = ctx.services.packs;
    if (!packs) throw new RunError('packFailed', { detail: 'ocr' });
    const lang = String(params.lang);
    const texts: string[] = [];
    for (const [i, original] of items.entries()) {
      ctx.throwIfCancelled();
      const item = await imageForPage(ctx.services, original, OCR_INPUT_SIDE);
      let result: { text: string };
      try {
        result = await packs.runtime.call(
          'ocr',
          'recognize',
          { file: 'input', lang },
          { input: item.uri },
        );
      } catch (e) {
        throw new RunError('packFailed', { detail: String(e instanceof Error ? e.message : e) });
      }
      const text = tidyOcrText(result.text);
      if (text) texts.push(text);
      ctx.progress(i + 1, items.length);
    }
    if (texts.length === 0) throw new RunError('notFound', { name: displayName(items[0]!) });
    // 文字只留在本机：结果页可以复制，后面的步骤可以存成文件或生成 PDF，绝不发给 AI。
    return { type: 'text', text: texts.join('\n\n'), name: items[0]!.name };
  },
};
