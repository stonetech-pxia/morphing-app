import { Directory, Paths } from 'expo-file-system';

import MorphVision from '../../modules/morph-vision';
import type { VisionPlatform } from './platform';

// VisionPlatform 的实现：本地 Expo 模块 MorphVision（iOS：Vision，D-084；Android：ML Kit，D-087）。
// 没有这个模块（Expo Go）时为 null。

/** 拉正后和文档相机页面的 JPG 质量。 */
const QUALITY = 0.9;

export function expoVision(
  runFileUri: (runId: string, relPath: string) => string,
): VisionPlatform | null {
  const native = MorphVision;
  if (!native) return null;
  return {
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

    supportsLanguage: (code) => native.supportsLanguage(code),

    async recognizeText(uri, languages) {
      return (await native.recognizeText(uri, languages)).text;
    },

    async recognizeLines(uri, languages) {
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
