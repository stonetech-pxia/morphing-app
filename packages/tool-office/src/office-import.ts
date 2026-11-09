import type { DocDoc } from './doc';
import { importDocx, type ImportedImage } from './docx-import';
import { OfficeImportFailure, type OfficeImportError } from './ooxml';
import type { TableDoc } from './types';
import { importXlsx } from './xlsx-import';

// 预览页和放上桌共用的入口（D-509）：按扩展名读外来的 docx / xlsx，读不了时说为什么，不抛错。

export type OfficeImport =
  | { ok: true; kind: 'doc'; doc: DocDoc; images: Map<string, ImportedImage> }
  | { ok: true; kind: 'table'; doc: TableDoc; formulas: number }
  | { ok: false; error: OfficeImportError };

/** 能读进来改的扩展名。 */
export const isImportableOffice = (ext: string) => /^(docx|xlsx)$/i.test(ext);

/** 读一份 docx / xlsx；别的扩展名返回 null。 */
export function importOffice(data: Uint8Array, ext: string): OfficeImport | null {
  if (!isImportableOffice(ext)) return null;
  try {
    if (/^docx$/i.test(ext)) {
      const { doc, images } = importDocx(data);
      return { ok: true, kind: 'doc', doc, images };
    }
    const { doc, formulas } = importXlsx(data);
    return { ok: true, kind: 'table', doc, formulas };
  } catch (e) {
    // 文件里有没想到的写法（解析出错）：当作坏了，不让预览页、桌面崩掉。
    return { ok: false, error: e instanceof OfficeImportFailure ? e.code : 'damaged' };
  }
}
