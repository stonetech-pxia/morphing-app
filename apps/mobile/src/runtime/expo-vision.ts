import { layoutOcrLines } from '@morph/core';
import { Directory, File, Paths } from 'expo-file-system';

import MorphVision from '../../modules/morph-vision';
import { expoPackFs, expoSha256 } from '../packs/expo-pack-fs';
import { PackStore } from '../packs/store';
import { classifyImageWith } from './classify-image';
import { detectDataWith } from './detect-data';
import type { VisionPlatform } from './platform';
import { PPOCR_LANGUAGES, PPOCR_PACK, coversLanguage, createPpocr } from './ppocr';
import { ocrPixels } from './skia';

// VisionPlatform 的实现：本地 Expo 模块 MorphVision（iOS：Vision，D-084；Android：ML Kit，D-087）。
// 文字识别用 PP-OCRv6（D-269）：中文、日文、英法德西葡意；其余语言用系统自带的（iOS Vision、Android 只剩韩文用 ML Kit）。
// 没有这个模块（Expo Go）时为 null。

/** 只用来找文字识别模型的文件（下载由 App 根布局的 PackStore 负责，D-064）。 */
const ocrPacks = new PackStore(expoPackFs, expoSha256);

/** 拉正后和文档相机页面的 JPG 质量。 */
const QUALITY = 0.9;

export function expoVision(
  runFileUri: (runId: string, relPath: string) => string,
): VisionPlatform | null {
  const native = MorphVision;
  if (!native) return null;
  const { ocrLoad, ocrDetect, ocrRecognize } = native;
  const ppocr =
    ocrLoad && ocrDetect && ocrRecognize
      ? createPpocr(
          { ocrLoad, ocrDetect, ocrRecognize },
          {
            installed: () => ocrPacks.isInstalled(PPOCR_PACK),
            modelUri: (file) => expoPackFs.uri(ocrPacks.path(PPOCR_PACK, file)),
            readText: (uri) => new File(uri).text(),
            tempDir() {
              const dir = new Directory(Paths.cache, 'ocr', `${Date.now()}-${Math.random()}`);
              dir.create({ idempotent: true, intermediates: true });
              return {
                uri: dir.uri.replace(/\/$/, ''),
                remove: () => {
                  try {
                    dir.delete();
                  } catch {
                    // 已经删掉了。
                  }
                },
              };
            },
            async write(uri, bytes) {
              const file = new File(uri);
              file.create({ overwrite: true });
              await file.write(bytes);
            },
            read: (uri) => new File(uri).bytes(),
            pixels: async (uri, maxSide) => ocrPixels(await new File(uri).bytes(), maxSide),
          },
        )
      : null;
  /** 这组语言用 PP-OCRv6 识别（第一种是用户选的语言）。 */
  const viaPpocr = (languages: readonly string[]) =>
    ppocr !== null && languages[0] !== undefined && coversLanguage(languages[0]);
  return {
    async adjustImage(uri, settings, format, runId, relPath) {
      if (!native.adjustImage) throw new Error('Image adjustment unavailable');
      const output = runFileUri(runId, relPath);
      return { uri: output, ...(await native.adjustImage(uri, settings, format, output)) };
    },

    backgroundRemovalSupported: native.backgroundRemovalSupported?.() ?? false,
    backgroundStatus: () => native.backgroundStatus?.() ?? Promise.resolve('unsupported'),
    async downloadBackgroundModel() {
      if (native.downloadBackgroundModel) await native.downloadBackgroundModel();
    },
    async removeBackground(uri, background, runId, relPath) {
      if (!native.removeBackground) throw new Error('Background removal unavailable');
      const output = runFileUri(runId, relPath);
      return { uri: output, ...(await native.removeBackground(uri, background, output)) };
    },

    ...(native.detectFaces
      ? {
          detectFaces: (uri: string) => native.detectFaces!(uri),
        }
      : {}),
    ...(native.classifyImage
      ? {
          classifyImage: (uri: string, options?: Parameters<typeof classifyImageWith>[2]) =>
            classifyImageWith(
              { classifyImage: native.classifyImage!, cancelClassify: native.cancelClassify },
              uri,
              options,
            ),
        }
      : {}),
    ...(native.detectData
      ? {
          detectData: (text: string, language: string) =>
            detectDataWith(native.detectData!.bind(native), text, language),
          dataDetectionStatus: async (language: string) =>
            (await native.dataDetectionStatus?.(language)) ?? 'unsupported',
          downloadDataModel: async (language: string) => {
            await native.downloadDataModel?.(language);
          },
        }
      : {}),
    personSegmentation: Boolean(native.replacePersonBackground),
    ...(native.replacePersonBackground || native.removeBackground
      ? {
          async replaceBackground(uri: string, color: string, runId: string, relPath: string) {
            const output = runFileUri(runId, relPath);
            const done = native.replacePersonBackground
              ? await native.replacePersonBackground(uri, color, output)
              : await native.removeBackground!(uri, color, output);
            return { uri: output, ...done };
          },
        }
      : {}),

    supportsLanguage: (code) =>
      (ppocr !== null && coversLanguage(code)) || native.supportsLanguage(code),
    ...(ppocr ? { ocrModel: { pack: PPOCR_PACK, languages: PPOCR_LANGUAGES } } : {}),

    async recognizeText(uri, languages) {
      // 按每行的位置排版，同一段里折行的行接回去（D-268）；没有位置时用原生排好的文字。
      if (viaPpocr(languages)) return layoutOcrLines((await ppocr!.recognize(uri)).lines);
      const { text, items } = await native.recognizeText(uri, languages);
      return items.length > 0 ? layoutOcrLines(items) : text;
    },

    async recognizeLines(uri, languages) {
      if (viaPpocr(languages)) {
        const { width, height, lines } = await ppocr!.recognize(uri);
        return {
          width,
          height,
          lines: lines.map(({ text, x, y, width: w, height: h }) => ({
            text,
            x,
            y,
            width: w,
            height: h,
          })),
        };
      }
      const { width, height, items } = await native.recognizeText(uri, languages);
      return { width, height, lines: items };
    },

    canFindPaper: native.canFindPaper(),

    async findPaper(uri) {
      return (await native.detectDocument(uri)).quad;
    },

    async straighten(uri, quad, size, runId, relPath) {
      const output = runFileUri(runId, relPath);
      const out = await native.straighten(uri, quad, size.width, size.height, QUALITY, output);
      return { uri: output, ...out };
    },

    documentCamera: native.isDocumentCameraSupported(),

    async scanDocuments(runId, maxSide) {
      const dir = new Directory(Paths.cache, 'runs', runId, 'scanner');
      dir.create({ idempotent: true, intermediates: true });
      const pages = await native.scanDocuments(dir.uri, maxSide, QUALITY);
      if (!pages) return null;
      const now = Date.now();
      return pages.map((p, i) => ({
        uri: p.uri,
        name: `scan-${i + 1}.jpg`,
        size: p.size,
        mimeType: 'image/jpeg',
        width: p.width,
        height: p.height,
        takenAt: now,
        straightened: true,
      }));
    },
  };
}
