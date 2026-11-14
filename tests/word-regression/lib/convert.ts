// 用 App 里真正的转换动作 OCR_IMPLS['ocr.toWord'] 转一页：PDF 的页面图、原始绘图都走 App 的 pdfview 页面，
// 文件读写、剪图在 Node 里照 App 的服务做（canvaskit）。识别由调用方给（记录好的或现场识别）。
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';

import { readDocx, type Converted } from './checks';
import { CK, decode, pixelsOf, type Pixels } from './ocr';
import type { PdfClient } from './pdfjs';

// App 的代码在 Node 里跑：expo-localization 换成一个替身（语言由参数给定）。
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-localization') {
      return { url: new URL('./localization.cjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { OCR_IMPLS } = await import('../../../apps/mobile/src/runtime/actions/ocr');

export interface RenderedPage {
  index: number;
  width: number;
  height: number;
  data: string;
  paper?: { width: number; height: number };
}

/** PDF 画成页面图，和 App 的 pdf.toImages 一样（长边 2000、JPEG 0.88）。 */
export function renderPdf(client: PdfClient, pdf: string, pages?: number[]) {
  return client.call<RenderedPage[]>(
    'render',
    { file: 'input', maxSide: 2000, quality: 0.88, ...(pages ? { pages } : {}) },
    { input: pdf },
  );
}

export interface Recognizer {
  lines(px: Pixels): Promise<{ width: number; height: number; lines: { text: string }[] }>;
  regions(px: Pixels): Promise<unknown[]>;
}

/**
 * 转一页。image 是页面图（PDF 渲染出的或照片）；有 pdf 时带上 pdfSource / pageSize，和 App 里 PDF 转 Word 一样。
 * 结果写进 dir：page.jpg、out.docx、doc.json。
 */
export async function convertPage(opts: {
  client: PdfClient;
  dir: string;
  image: Uint8Array;
  pdf?: { path: string; page: RenderedPage };
  ocr: Recognizer;
  lang: string;
  locale: string;
  name: string;
}): Promise<Converted> {
  const { dir, client, ocr } = opts;
  mkdirSync(`${dir}/work`, { recursive: true });
  const uri = `${dir}/page.jpg`;
  writeFileSync(uri, opts.image);
  const ocrLines: string[] = [];
  const ocrBoxes: NonNullable<Converted['ocrBoxes']> = [];
  const work = (rel: string) => {
    const path = resolve(dir, 'work', rel);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  };
  const files = {
    vision: {
      supportsLanguage: () => true,
      tablePixels: async (u: string) => pixelsOf(readFileSync(u)),
      recognizeLines: async (u: string, _langs: unknown, px?: Pixels) => {
        const found = await ocr.lines(px ?? pixelsOf(readFileSync(u)));
        ocrLines.push(...found.lines.map((l) => l.text));
        const boxed = found.lines as unknown as {
          text: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }[];
        ocrBoxes.push(
          ...boxed.map(({ text, x, y, width, height }) => ({
            text,
            x,
            y,
            width,
            height,
            page: { width: found.width, height: found.height },
          })),
        );
        return found;
      },
      detectLayout: async (px: Pixels) => ocr.regions(px),
    },
    imageSize: async (u: string) => {
      const im = decode(readFileSync(u));
      const v = { width: im.width(), height: im.height() };
      im.delete();
      return v;
    },
    readUri: async (u: string) => new Uint8Array(readFileSync(u)),
    writeRunFile: async (_id: string, rel: string, bytes: Uint8Array) => {
      const path = work(rel);
      writeFileSync(path, bytes);
      return { uri: path, size: bytes.length };
    },
    transformImage: async (
      u: string,
      { crop }: { crop: { x: number; y: number; width: number; height: number } },
      _opts: unknown,
      _runId: string,
      rel: string,
    ) => {
      const im = decode(readFileSync(u));
      const s = CK.MakeSurface(crop.width, crop.height);
      s.getCanvas().clear(CK.WHITE);
      s.getCanvas().drawImageRectOptions(
        im,
        CK.XYWHRect(crop.x, crop.y, crop.width, crop.height),
        CK.XYWHRect(0, 0, crop.width, crop.height),
        CK.FilterMode.Linear,
        CK.MipmapMode.None,
        null,
      );
      s.flush();
      const snap = s.makeImageSnapshot();
      const path = work(rel);
      writeFileSync(path, snap.encodeToBytes(CK.ImageFormat.JPEG, 85));
      snap.delete();
      s.dispose();
      im.delete();
      return { uri: path, width: crop.width, height: crop.height };
    },
  };
  const im = decode(opts.image);
  const size = { width: im.width(), height: im.height() };
  im.delete();
  const item = {
    uri,
    name: opts.name,
    ext: 'jpg',
    mimeType: 'image/jpeg',
    size: opts.image.length,
    ...size,
    ...(opts.pdf
      ? {
          pdfSource: { for: uri, uri: opts.pdf.path, page: opts.pdf.page.index },
          ...(opts.pdf.page.paper ? { pageSize: { for: uri, ...opts.pdf.page.paper } } : {}),
        }
      : {}),
  };
  const ctx = {
    locale: opts.locale,
    now: () => new Date('2026-10-15T12:00:00Z'),
    throwIfCancelled: () => {},
    progress: () => {},
    services: {
      files,
      runId: opts.name,
      packs: {
        runtime: {
          call: (
            _pack: string,
            method: string,
            args: Record<string, unknown>,
            f: Record<string, string>,
          ) => client.call(method, args, f),
        },
      },
    },
  };
  try {
    const action = OCR_IMPLS['ocr.toWord']!;
    const out = await action(
      { type: 'images', items: [item] } as Parameters<typeof action>[0],
      { lang: opts.lang },
      ctx as unknown as Parameters<typeof action>[2],
    );
    const made = (out as unknown as { items: { uri: string; docDoc: { uri: string } }[] })
      .items[0]!;
    copyFileSync(made.uri, `${dir}/out.docx`);
    copyFileSync(made.docDoc.uri, `${dir}/doc.json`);
    return {
      doc: JSON.parse(readFileSync(made.docDoc.uri, 'utf8')),
      ...(await readDocx(new Uint8Array(readFileSync(made.uri)))),
      ocr: ocrLines,
      ocrBoxes,
    };
  } finally {
    rmSync(`${dir}/work`, { recursive: true, force: true });
  }
}
