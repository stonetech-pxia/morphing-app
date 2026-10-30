import {
  OFFICE_MIME_BY_EXT,
  RunError,
  layoutOcrLines,
  polishOcrText,
  renderNameTemplate,
  t,
  tidyOcrText,
  type ActionImpl,
  type OcrLanguage,
  type RunItem,
} from '@morph/core';
import { boxesToEnhanced } from '@morph/tool-image';
import {
  buildDocPage,
  buildTablePage,
  leafBlocks,
  pagesWithoutTables,
  writeDocx,
  writeXlsx,
  type DocDoc,
  type DocPage,
  type DocxImage,
  type LayoutRegion,
  type OcrBox,
  type TableDoc,
  type TablePage,
} from '@morph/tool-office';

import type { Pixels, RecognizedLine, VisionPlatform } from '../platform';
import {
  displayName,
  fileItems,
  freshName,
  imageForPage,
  ocrSourceItem,
  ocrSourceOf,
  writeItem,
  type RunServices,
} from './helpers';
import { resolveOcrLanguage } from '../ocr-language';

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

/** 识别结果按语言整理（D-268）：简体中文把混进来的繁体字换回简体，中文用全角标点。 */
function polish(text: string, lang: OcrLanguage): string {
  const kind = lang === 'chi_sim' ? 'zh-Hans' : lang === 'chi_tra' ? 'zh-Hant' : 'other';
  return polishOcrText(tidyOcrText(text), kind);
}

/** 识别框按比例换到另一张图的大小上（字的位置是这一行里的比例，不用换）。 */
function scaleLines(
  lines: readonly RecognizedLine[],
  from: { width: number; height: number },
  to: { width: number; height: number },
): OcrBox[] {
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  return lines.map((l) => ({
    ...l,
    x: l.x * kx,
    y: l.y * ky,
    width: l.width * kx,
    height: l.height * ky,
  }));
}

/**
 * 转 Excel 一页的识别结果，坐标是找线那张图（pixels）的：有增强前的图时在它上面认（D-267，更准），
 * 框换算到增强后的图上；读不了或宽高比对不上时在这张图上认，直接用找线时解码的像素。
 */
async function tableLines(
  vision: VisionPlatform,
  item: RunItem,
  pixels: Pixels,
  languages: readonly string[],
): Promise<{ lines: OcrBox[]; enhanced: boolean }> {
  const source = ocrSourceOf(item);
  if (source && item.width && item.height) {
    try {
      const layer = await vision.recognizeLines(source.uri, languages);
      const ratio = layer.width / layer.height / (source.width / source.height);
      if (Math.abs(ratio - 1) < 0.02) {
        const canvas = { width: item.width, height: item.height };
        const lines = boxesToEnhanced(layer.lines, layer, source, source.skew, canvas);
        return { lines: scaleLines(lines, canvas, pixels), enhanced: true };
      }
    } catch {
      // 用这张图认。
    }
  }
  const layer = await vision.recognizeLines(item.uri, languages, pixels);
  return { lines: scaleLines(layer.lines, layer, pixels), enhanced: source !== null };
}

/** 机器起的名字：UUID 或一长串十六进制。 */
const MACHINE_NAME = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16}/i;

export const OCR_IMPLS: Record<string, Impl> = {
  // 扫描件转 Excel（D-272）：每张图找表格线、认字、组表，做成一个 xlsx（每页一张工作表），
  // 旁边存一份 TableDoc 给结果页的「查看和编辑」用。识别出的文字只在本机。
  async 'ocr.toExcel'(input, params, ctx) {
    const items = fileItems(input);
    // 「自动」按手机语言选（D-278）。
    const lang = resolveOcrLanguage(params.lang, ctx.locale);
    const scope = params.scope === 'tables' ? 'tables' : 'all';
    const languages = VISION_LANGUAGES[lang];
    const vision = ctx.services.files.vision;
    // 要每一行的位置：文字识别包（tesseract）只给文字，不能用。
    if (!vision?.tablePixels || !vision.supportsLanguage(languages[0]!)) {
      throw new RunError('tableUnsupported');
    }
    const pages: TablePage[] = [];
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      let pixels: Pixels;
      try {
        pixels = await vision.tablePixels(item.uri);
      } catch {
        throw new RunError('unreadable', { name: displayName(item) });
      }
      let found: Awaited<ReturnType<typeof tableLines>>;
      try {
        found = await tableLines(vision, item, pixels, languages);
      } catch (e) {
        throw new RunError('unexpected', { detail: String(e instanceof Error ? e.message : e) });
      }
      ctx.throwIfCancelled();
      pages.push(
        buildTablePage(
          {
            image: pixels,
            lines: found.lines,
            name: t(ctx.locale, 'tableSheetName', { n: i + 1 }),
            source: item.uri,
            // 增强过的图已经按 findSkew 转正；没增强过的照片在这里估倾斜。
            ...(found.enhanced ? { skew: 0 } : {}),
          },
          { joinLines: (lines) => polish(layoutOcrLines(lines), lang) },
        ),
      );
      ctx.progress(i + 1, items.length);
    }
    if (pages.every((p) => p.blocks.length === 0)) {
      throw new RunError('notFound', { name: displayName(items[0]!) });
    }
    const doc: TableDoc = { version: 2, scope, pages };
    // 一张照片、名字是人起的就用它；名字是一串编号（分享进来的照片常这样）或几页合成一个文件时
    // 用「表格-日期」，和扫描的「扫描-日期」一样。
    const name =
      items.length === 1 && !MACHINE_NAME.test(items[0]!.name)
        ? items[0]!.name
        : renderNameTemplate(t(ctx.locale, 'tableFileName'), { now: ctx.now() });
    const xlsx = await writeItem(ctx.services, writeXlsx(doc), {
      name,
      ext: 'xlsx',
      mimeType: OFFICE_MIME_BY_EXT.xlsx!,
    });
    const stored = await ctx.services.files.writeRunFile(
      ctx.services.runId,
      freshName(name, 'json'),
      new TextEncoder().encode(JSON.stringify(doc)),
    );
    const missing = pagesWithoutTables(doc);
    return {
      type: 'files',
      items: [
        {
          ...xlsx,
          tableDoc: {
            uri: stored.uri,
            for: xlsx.uri,
            ...(missing.length ? { pagesWithoutTables: missing } : {}),
          },
        },
      ],
    };
  },

  // 扫描件转 Word（D-310）：每张图认字、版面分析（模型没装时只按位置分段）、找带线的表格，
  // 图片区域从原图剪下来，做成一个 docx（每张图一页），旁边存一份 DocDoc 给结果页的「查看和编辑」用。
  // 识别出的文字只在本机。
  async 'ocr.toWord'(input, params, ctx) {
    const items = fileItems(input);
    // 「自动」按手机语言选（D-278）。
    const lang = resolveOcrLanguage(params.lang, ctx.locale);
    const languages = VISION_LANGUAGES[lang];
    const { files } = ctx.services;
    const vision = files.vision;
    // 要每一行的位置：文字识别包（tesseract）只给文字，不能用。
    if (!vision?.tablePixels || !vision.supportsLanguage(languages[0]!)) {
      throw new RunError('wordUnsupported');
    }
    const pages: DocPage[] = [];
    const images = new Map<string, DocxImage>();
    for (const [i, item] of items.entries()) {
      ctx.throwIfCancelled();
      let pixels: Pixels;
      try {
        pixels = await vision.tablePixels(item.uri);
      } catch {
        throw new RunError('unreadable', { name: displayName(item) });
      }
      let found: Awaited<ReturnType<typeof tableLines>>;
      try {
        found = await tableLines(vision, item, pixels, languages);
      } catch (e) {
        throw new RunError('unexpected', { detail: String(e instanceof Error ? e.message : e) });
      }
      ctx.throwIfCancelled();
      // 版面分析出错时不让整个运行失败：只按位置分段。
      let regions: LayoutRegion[] | null = null;
      try {
        regions = (await vision.detectLayout?.(pixels)) ?? null;
      } catch {
        regions = null;
      }
      ctx.throwIfCancelled();
      const page = buildDocPage(
        {
          image: pixels,
          lines: found.lines,
          ...(regions ? { regions } : {}),
          source: item.uri,
          // 增强过的图已经按 findSkew 转正；没增强过的照片在这里估倾斜。
          ...(found.enhanced ? { skew: 0 } : {}),
        },
        { joinLines: (lines) => polish(layoutOcrLines(lines), lang) },
      );
      // 图片区域：按比例换到原图上剪下来（JPG，本次运行的文件）。
      // 并排行（D-313）里的图片也要剪。
      const pictures = leafBlocks(page).filter((b) => b.kind === 'image');
      if (pictures.length) {
        const size =
          item.width && item.height
            ? { width: item.width, height: item.height }
            : await files.imageSize(item.uri);
        const kx = size.width / page.width;
        const ky = size.height / page.height;
        for (const [k, block] of pictures.entries()) {
          const x = Math.max(0, Math.round(block.box.x * kx));
          const y = Math.max(0, Math.round(block.box.y * ky));
          const crop = {
            x,
            y,
            width: Math.max(1, Math.min(size.width - x, Math.round(block.box.width * kx))),
            height: Math.max(1, Math.min(size.height - y, Math.round(block.box.height * ky))),
          };
          try {
            const out = await files.transformImage(
              item.uri,
              { crop },
              { format: 'jpeg', quality: 0.85 },
              ctx.services.runId,
              `word/${i + 1}-${k + 1}.jpg`,
            );
            block.src = out.uri;
            images.set(out.uri, {
              bytes: await files.readUri(out.uri),
              width: out.width,
              height: out.height,
            });
          } catch {
            // 剪不出来的图片不写进文件（块留着，编辑页能看到原图里的位置）。
          }
        }
      }
      pages.push(page);
      ctx.progress(i + 1, items.length);
    }
    if (pages.every((p) => p.blocks.length === 0)) {
      throw new RunError('notFound', { name: displayName(items[0]!) });
    }
    const doc: DocDoc = { version: 1, pages };
    // 文件名和转 Excel 一样（D-298）：一张照片、名字是人起的就用它，否则「文档-日期」。
    const name =
      items.length === 1 && !MACHINE_NAME.test(items[0]!.name)
        ? items[0]!.name
        : renderNameTemplate(t(ctx.locale, 'wordFileName'), { now: ctx.now() });
    const docx = await writeItem(ctx.services, writeDocx(doc, images), {
      name,
      ext: 'docx',
      mimeType: OFFICE_MIME_BY_EXT.docx!,
    });
    const stored = await files.writeRunFile(
      ctx.services.runId,
      freshName(name, 'json'),
      new TextEncoder().encode(JSON.stringify(doc)),
    );
    return { type: 'files', items: [{ ...docx, docDoc: { uri: stored.uri, for: docx.uri } }] };
  },

  async 'ocr.recognize'(input, params, ctx) {
    const items = fileItems(input);
    // 「自动」按手机语言选（D-278）。
    const lang = resolveOcrLanguage(params.lang, ctx.locale);
    const { packs } = ctx.services;
    // 系统识别不了的语言（Android 的 ML Kit 不认俄文）退回文字识别包。
    const native = ctx.services.files.vision;
    const vision = native?.supportsLanguage(VISION_LANGUAGES[lang][0]!) ? native : null;
    if (!vision && !packs) throw new RunError('packFailed', { detail: 'ocr' });
    const texts: string[] = [];
    for (const [i, original] of items.entries()) {
      ctx.throwIfCancelled();
      // 系统识别用增强前的图（D-267：增强对它没有帮助，黑白还会抹掉淡字）；读不了时用这张。
      // 文字识别包（Tesseract）反而在增强后的图上认得更准，照旧。
      const source = vision ? ocrSourceOf(original) : null;
      if (source) {
        try {
          const page = await imageForPage(
            ctx.services,
            ocrSourceItem(original, source),
            OCR_INPUT_SIDE,
          );
          const text = polish(await vision!.recognizeText(page.uri, VISION_LANGUAGES[lang]), lang);
          if (text) texts.push(text);
          ctx.progress(i + 1, items.length);
          continue;
        } catch {
          // 退回用增强后的图。
        }
      }
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
      const text = polish(raw, lang);
      if (text) texts.push(text);
      ctx.progress(i + 1, items.length);
    }
    if (texts.length === 0) throw new RunError('notFound', { name: displayName(items[0]!) });
    // 文字只留在本机：结果页可以复制，后面的步骤可以存成文件或生成 PDF，绝不发给 AI。
    return { type: 'text', text: texts.join('\n\n'), name: items[0]!.name };
  },
};
