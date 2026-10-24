import { countPages } from '@morph/tool-pdf';
import { File } from 'expo-file-system';

import MorphDocs from '../../modules/morph-docs';
import type { DocumentPlatform, FilePlatform } from './platform';

// 办公文档转 PDF（D-186）。iOS 开发版：系统的文档预览排版（modules/morph-docs）。
// Android 和 Expo Go：mammoth（BSD-2）把 Word 转成网页，再用系统打印排版（expo-print）变成 PDF。
// 文档只在本机处理；网页里只有文档自己的文字和内嵌图片，打印时不联网。

/** iOS 系统预览能显示的格式。 */
const SYSTEM_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf'];
/** iOS 打印排版的边距（点）。 */
const MARGIN = 36;

const unreadable = (detail: string) =>
  Object.assign(new Error(`unreadable: ${detail}`), { code: 'ERR_DOC_UNREADABLE' });

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** mammoth 只给正文结构，排版自己定：系统字体、表格加边框、图片不超过页宽。 */
export function wordPage(body: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font-family:-apple-system,Roboto,"Noto Sans CJK SC","PingFang SC",sans-serif;font-size:11pt;line-height:1.45;color:#111}
h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}
table{border-collapse:collapse;width:100%;margin:8pt 0}td,th{border:1px solid #999;padding:4pt 6pt;vertical-align:top}
img{max-width:100%;height:auto}p{margin:0 0 6pt}
</style></head><body>${body}</body></html>`;
}

export function expoDocuments(
  runFileUri: (runId: string, relPath: string) => string,
  htmlToPdf: FilePlatform['htmlToPdf'],
): DocumentPlatform {
  const native = MorphDocs;
  if (native) {
    return {
      extensions: SYSTEM_EXTENSIONS,
      passwords: {
        lockState: (uri) => native.pdfLockState(uri),
        unlock: (uri, password, runId, relPath) =>
          native.unlockPdf(uri, password, runFileUri(runId, relPath)),
        protect: (uri, password, runId, relPath) =>
          native.protectPdf(uri, password, runFileUri(runId, relPath)),
      },
      async toPdf(uri, _ext, page, runId, relPath) {
        return native.toPdf(uri, runFileUri(runId, relPath), { ...page, margin: MARGIN });
      },
    };
  }
  return {
    extensions: ['docx'],
    passwords: null,
    async toPdf(uri, _ext, page, runId, relPath) {
      // 浏览器版是打包好的一个文件（不依赖 Node 的 fs、path），只在用到时加载（约 400 KB）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth/mammoth.browser.min.js') as {
        convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
      };
      const bytes = await new File(uri).bytes();
      let body: string;
      try {
        const result = await mammoth.convertToHtml({
          arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        });
        body = result.value;
      } catch (e) {
        throw unreadable(String(e));
      }
      if (!body.trim()) throw unreadable('empty');
      const name = relPath.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
      const pdf = await htmlToPdf(wordPage(body, name), page, runId, relPath);
      // Android 的 expo-print 报的页数总是 1（模拟器实测 6 页的文档也是 1）：从 PDF 本身数。
      return { ...pdf, pageCount: await countPages(await new File(pdf.uri).bytes()) };
    },
  };
}
