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
