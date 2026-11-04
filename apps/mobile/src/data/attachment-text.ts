import type { PackNeed, TextPage } from '@morph/core';
import { decodeQr, downscaleRgba } from '@morph/tool-qr';

import type { PackRuntime } from '../packs/bridge';
import type { AssetRecord } from '../storage/types';
import type { FilePlatform } from '../runtime/platform';

// 新记录表单的候选值（D-394）：读附件里的文字（带位置），只在本机，只给候选值打分用，
// 不存、不进记录、不发给 AI（D-036）。照片用本机的文字识别（PP-OCRv6，D-269）；PDF 先读文字层，
// 没有文字层（扫描件）时把前两页画成图再识别。只读前 3 个附件、每个前 2 页。
// 中间文件放在一次临时运行的目录里（cache/runs/<runId>/），成功、失败、取消都删掉。
// 用户相册和「文件」里的原件不碰：附件是 Morph 自己的副本，这里也只读不改。

/** 最多读几个附件、每个读几页。 */
export const MAX_READ_FILES = 3;
export const MAX_READ_PAGES = 2;
/** 送进识别的图片长边（和 PP-OCRv6 的输入一样大，D-269）。 */
const OCR_SIDE = 2000;
/** 解二维码前缩到的长边（和「识别二维码」一样）。 */
const QR_SIDE = 1600;

export type ReadableKind = 'image' | 'pdf';

/** 这个附件能不能读出文字：照片（不含视频、GIF 动图）和 PDF。 */
export function readableKind(asset: Pick<AssetRecord, 'mimeType' | 'name'>): ReadableKind | null {
  const mime = asset.mimeType.toLowerCase();
  if (mime === 'application/pdf' || /\.pdf$/i.test(asset.name)) return 'pdf';
  if (mime.startsWith('image/') && mime !== 'image/gif') return 'image';
  return null;
}

export interface AttachmentTextDeps {
  files: FilePlatform;
  packs: { runtime: PackRuntime; isInstalled(id: string): Promise<boolean> } | null;
  /** 识别用的语言（BCP 47，第一种是主要的）。 */
  languages: readonly string[];
  newRunId: () => string;
}

/** 这台设备上读这些附件还缺哪些要下载的东西（都要先问用户，D-064）。 */
export async function missingPacks(
  kinds: readonly ReadableKind[],
  deps: AttachmentTextDeps,
): Promise<PackNeed[]> {
  const out: PackNeed[] = [];
  const pack = ocrPack(deps);
  if (pack && kinds.includes('image') && !(await deps.packs?.isInstalled(pack)))
    out.push({ pack, optional: false });
  if (kinds.includes('pdf') && deps.packs && !(await deps.packs.isInstalled('pdfview')))
    out.push({ pack: 'pdfview', optional: false });
  return out;
}

/** 认这种语言要下载的文字识别模型（PP-OCRv6）；系统自带就能认时为 null。 */
function ocrPack(deps: AttachmentTextDeps): string | null {
  const model = deps.files.vision?.ocrModel;
  const code = deps.languages[0]?.split('-')[0];
  return model && code && model.languages.includes(code) ? model.pack : null;
}

async function canRecognize(deps: AttachmentTextDeps): Promise<boolean> {
  const vision = deps.files.vision;
  if (!vision) return false;
  const pack = ocrPack(deps);
  if (pack) return (await deps.packs?.isInstalled(pack)) === true;
  return vision.supportsLanguage(deps.languages[0] ?? 'en');
}

/**
 * 读出前几张照片里的二维码（D-423，只有名片表的表单调）：和「识别二维码」一样先缩小再解，纯 JS，不用下载。
 * 读不了、没有码都是安静地没有，文字识别照常。内容只给候选用，不存、不发给 AI。
 */
export async function readAttachmentCodes(
  assets: readonly AssetRecord[],
  deps: Pick<AttachmentTextDeps, 'files'>,
  signal: AbortSignal,
): Promise<string[]> {
  const found: string[] = [];
  const images = assets.filter((a) => readableKind(a) === 'image').slice(0, MAX_READ_FILES);
  for (const asset of images) {
    if (signal.aborted) throw new ReadCancelled();
    try {
      const pixels = await deps.files.imagePixels(deps.files.fileUri(asset.path), QR_SIDE);
      const text = decodeQr(downscaleRgba(pixels, QR_SIDE));
      if (text) found.push(text);
    } catch {
      // 这张读不了：跳过。
    }
  }
  if (signal.aborted) throw new ReadCancelled();
  return found;
}

export class ReadCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/**
 * 读出前几个附件的文字（每页一组带框的行）。读不了的附件跳过，不报错；还没下载识别模型时照片跳过，
 * PDF 预览没装时 PDF 跳过。signal 取消时在当前这一步结束后马上以 ReadCancelled 结束。
 */
export async function readAttachmentPages(
  assets: readonly AssetRecord[],
  deps: AttachmentTextDeps,
  signal: AbortSignal,
): Promise<TextPage[]> {
  const { files } = deps;
  const vision = files.vision;
  const check = () => {
    if (signal.aborted) throw new ReadCancelled();
  };
  const ocr = await canRecognize(deps);
  const pdf = deps.packs !== null && (await deps.packs.isInstalled('pdfview'));
  check();
  const runId = deps.newRunId();
  const pages: TextPage[] = [];
  try {
    const recognize = async (uri: string) => {
      const layer = await vision!.recognizeLines(uri, deps.languages);
      check();
      pages.push({ width: layer.width, height: layer.height, lines: layer.lines });
    };
    let n = 0;
    for (const asset of assets) {
      const kind = readableKind(asset);
      if (!kind || n >= MAX_READ_FILES) continue;
      n++;
      const uri = files.fileUri(asset.path);
      try {
        if (kind === 'image') {
          if (!ocr) continue;
          // 先转成 JPG（HEIC 等格式识别时不一定能解码），太大的缩小。
          const size = await files.imageSize(uri);
          check();
          const k = Math.min(1, OCR_SIDE / Math.max(size.width, size.height));
          const resize = {
            width: Math.max(1, Math.round(size.width * k)),
            height: Math.max(1, Math.round(size.height * k)),
          };
          const jpg = await files.transformImage(
            uri,
            k < 1 ? { resize } : {},
            { format: 'jpeg', quality: 0.92 },
            runId,
            `page-${n}.jpg`,
          );
          check();
          await recognize(jpg.uri);
          continue;
        }
        if (!pdf) continue;
        const layer = await deps.packs!.runtime.call<{ count: number; pages: TextPage[] }>(
          'pdfview',
          'lines',
          { file: 'input', pages: MAX_READ_PAGES },
          { input: uri },
        );
        check();
        const withText = layer.pages.filter((p) => p.lines.length > 0);
        if (withText.length > 0) {
          pages.push(...withText);
          continue;
        }
        // 扫描件：没有文字层，把前两页画成图再识别。
        if (!ocr) continue;
        const count = Math.min(layer.count, MAX_READ_PAGES);
        const images = await deps.packs!.runtime.call<{ index: number; data: string }[]>(
          'pdfview',
          'render',
          {
            file: 'input',
            pages: Array.from({ length: count }, (_, i) => i),
            maxSide: OCR_SIDE,
            quality: 0.9,
          },
          { input: uri },
        );
        check();
        for (const image of images) {
          const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
          const out = await files.writeRunFile(runId, `pdf-${n}-${image.index + 1}.jpg`, bytes);
          check();
          await recognize(out.uri);
        }
      } catch (e) {
        if (e instanceof ReadCancelled) throw e;
        // 这一个读不了：跳过，不影响别的附件。
      }
    }
    return pages;
  } finally {
    await files.removeRun(runId).catch(() => undefined);
  }
}
