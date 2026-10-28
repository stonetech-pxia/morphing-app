import type { NativeDataMatch } from '../../modules/morph-vision';
import type { SystemDataMatch } from './platform';

// VisionPlatform.detectData 的 JS 部分：系统识别只做规则的补充（D-244），所以它出任何问题
// （没下载模型、没网、系统报错、结果不对）都不影响预填，直接返回空，让规则照常工作。不下载模型。

export async function detectDataWith(
  detect: (text: string, language: string, allowDownload: boolean) => Promise<NativeDataMatch[]>,
  text: string,
  language: string,
): Promise<SystemDataMatch[]> {
  let found: NativeDataMatch[];
  try {
    found = await detect(text, language, false);
  } catch {
    return [];
  }
  return found.filter(
    (m) =>
      (m.kind === 'amount' || m.kind === 'date') &&
      Number.isInteger(m.start) &&
      Number.isInteger(m.end) &&
      m.start >= 0 &&
      m.end > m.start &&
      m.end <= text.length &&
      (m.kind === 'amount' || /^\d{4}-\d{2}-\d{2}$/.test(m.value ?? '')),
  );
}

/** 用户说过「不下载」的语言记在 app_meta 里，下次不再问。 */
const declinedKey = (language: string) => `prefill:model-declined:${language}`;

/**
 * 用系统识别之前：系统说要先下载模型（Android ML Kit）时先问用户，同意了才下载（D-244）。
 * 用户不同意就记住、以后不再问，只用规则；状态查不到、下载失败也只用规则。返回能不能用系统识别。
 */
export async function prepareDataDetection(
  vision: {
    dataDetectionStatus?(language: string): Promise<'ready' | 'download' | 'unsupported'>;
    downloadDataModel?(language: string): Promise<void>;
  },
  language: string,
  ask: () => Promise<boolean>,
  meta: {
    getMeta(key: string): Promise<string | null>;
    setMeta(key: string, value: string): Promise<void>;
  },
): Promise<boolean> {
  if (!vision.dataDetectionStatus) return false;
  let status: 'ready' | 'download' | 'unsupported';
  try {
    status = await vision.dataDetectionStatus(language);
  } catch {
    return false;
  }
  if (status === 'ready') return true;
  if (status !== 'download' || !vision.downloadDataModel) return false;
  if ((await meta.getMeta(declinedKey(language))) === 'yes') return false;
  if (!(await ask())) {
    await meta.setMeta(declinedKey(language), 'yes');
    return false;
  }
  try {
    await vision.downloadDataModel(language);
    return true;
  } catch {
    return false;
  }
}
