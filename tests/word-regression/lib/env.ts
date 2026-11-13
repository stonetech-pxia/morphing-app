// 防倒退测试用到的仓库外资源。默认值是创始人这台 Mac 上的位置；别的机器用环境变量指过去。
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = resolve(HERE, '../..');
const NOTES = `${homedir()}/Library/Application Support/Claude/side-session-notes`;
const RUNTIME = `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies`;

export const ENV = {
  /** 无头 Chrome：跑 App 里同一个 pdfview 页面（PDF.js 渲染页面、读原始绘图）。 */
  chrome:
    process.env.WORD_REGRESSION_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  /** playwright 模块所在目录（只用它开 Chrome，不用它的浏览器下载）。 */
  playwright: process.env.WORD_REGRESSION_PLAYWRIGHT ?? `${RUNTIME}/node/node_modules`,
  /** pdfview 包的文件（pdf.js 的 build/、cmaps/ 等），和 App 下载的 pdfview 包相同。 */
  pdfjs: process.env.WORD_REGRESSION_PDFJS ?? `${NOTES}/word-graphics-pages-2026-11-12/pdfjs`,
  /** 只在 --record（重新识别）时用：PP-OCR、版面模型和 onnxruntime-node。 */
  models: {
    det: process.env.WORD_REGRESSION_DET ?? `${NOTES}/scan-to-office/dewarp-exp/models/det.onnx`,
    rec: process.env.WORD_REGRESSION_REC ?? `${NOTES}/scan-to-office/dewarp-exp/models/rec.onnx`,
    dict:
      process.env.WORD_REGRESSION_DICT ??
      `${NOTES}/scan-to-office/dewarp-exp/models/dictionary.json`,
    layout:
      process.env.WORD_REGRESSION_LAYOUT ??
      `${NOTES}/scan-to-office/word-exp/models/layout_S_fp16.onnx`,
  },
  onnxruntime: process.env.WORD_REGRESSION_ORT ?? `${NOTES}/prefill-real-ocr/scripts`,
  /** 只在 --render 时用：LibreOffice 把 docx 画成 PDF，pdftoppm 画成图。 */
  soffice: process.env.WORD_REGRESSION_SOFFICE ?? `${RUNTIME}/bin/override/soffice`,
  pdftoppm: process.env.WORD_REGRESSION_PDFTOPPM ?? `${RUNTIME}/bin/override/pdftoppm`,
};

export function need(path: string, what: string): string {
  if (!existsSync(path)) {
    throw new Error(`${what} not found at ${path} (see tests/word-regression/README.md)`);
  }
  return path;
}
