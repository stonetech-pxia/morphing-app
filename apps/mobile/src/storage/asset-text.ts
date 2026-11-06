import type { FilePlatform } from '../runtime/platform';

/** 存下来的文字最多这么长（一份很长的 PDF 也只留前面这些，够搜索用）。 */
const MAX_TEXT = 200_000;

/**
 * 文件里的文字（D-455，底线 14 的例外）：用户扫描、分享、打开、保存文件、文件存进文档库时，
 * PDF 读文字层，图片在本机识别，存在这个文件旁边，跟着文件一起删。只在本机，不进配置、不发给 AI。
 * 读不出、识别包没装（不为这个下载）就没有文字，不报错。
 */
export async function indexAssetText(
  files: FilePlatform,
  asset: { path: string; mimeType: string },
): Promise<void> {
  if (!files.saveAssetText || !files.vision) return;
  const uri = files.fileUri(asset.path);
  let text: string | null = null;
  try {
    if (asset.mimeType === 'application/pdf') text = (await files.vision.pdfText?.(uri)) ?? null;
    // PP-OCRv6 一个模型就认中日英法德西葡意（D-269）：语言只用来选引擎。
    else if (asset.mimeType.startsWith('image/'))
      text = await files.vision.recognizeText(uri, ['en']);
  } catch {
    text = null;
  }
  const clean = text?.trim();
  if (clean) await files.saveAssetText(asset.path, clean.slice(0, MAX_TEXT)).catch(() => undefined);
}
