import MorphTranslate from '../../modules/morph-translate';
import type { TranslatePlatform } from './platform';

// TranslatePlatform 的实现：本地 Expo 模块 MorphTranslate（D-170）。没有这个模块（Expo Go）时为 null。

/** 原生模块的错误码 → 平台错误码（动作实现按它决定怎么告诉用户）。 */
const CODES: Record<string, string> = {
  ERR_TRANSLATE_CANCELLED: 'cancelled',
  ERR_TRANSLATE_UNSUPPORTED: 'unsupported',
  ERR_TRANSLATE_DOWNLOAD: 'download',
};

function rethrow(e: unknown): never {
  const code = CODES[String((e as { code?: string }).code)];
  throw code ? Object.assign(new Error(String((e as Error).message)), { code }) : e;
}

export function expoTranslate(): TranslatePlatform | null {
  const native = MorphTranslate;
  if (!native) return null;
  const { download, downloadedLanguages, deleteLanguage } = native;
  return {
    supported: native.isSupported(),
    detectLanguages: (texts) => native.detectLanguages(texts),
    status: (from, to) => native.status(from, to),
    ...(download
      ? {
          downloadBytes: native.downloadBytes ?? 0,
          download: (language: string) => download(language).catch(rethrow),
        }
      : {}),
    translate: (texts, from, to) => native.translate(texts, from, to).catch(rethrow),
    ...(downloadedLanguages && deleteLanguage
      ? {
          downloadedLanguages: () => downloadedLanguages(),
          removeLanguage: (language: string) => deleteLanguage(language),
        }
      : {}),
  };
}
