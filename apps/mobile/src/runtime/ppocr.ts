import { recognizePage, type OcrModels, type OcrResultLine, type RgbaImage } from '@morph/tool-ocr';

// 用 PP-OCRv6 识别一张图（D-269）：前后处理在 @morph/tool-ocr（JS），模型由原生模块跑。
// 张量和结果走临时文件（几 MB 到几十 MB，不经过 JS 和原生之间的参数转换），识别完不管成功失败都删掉。

/** PP-OCRv6 用得上的语言（BCP 47 的语言部分）：中文（简繁）、日文、英法德西葡意。韩文、俄文、越南文不认。 */
export const PPOCR_LANGUAGES = ['zh', 'ja', 'en', 'fr', 'de', 'es', 'pt', 'it'] as const;

/** 扩展包 ID（packages/core 的 PACKS）。 */
export const PPOCR_PACK = 'ppocr';

/** 送去识别的图片长边：在评测里这么大最准（字高约 25–35 像素），再大更慢也不更准。 */
export const PPOCR_INPUT_SIDE = 2000;

export interface PpocrNative {
  ocrLoad(det: string, rec: string): Promise<void>;
  ocrDetect(input: string, width: number, height: number, output: string): Promise<void>;
  ocrRecognize(input: string, count: number, width: number, output: string): Promise<number>;
}

export interface PpocrIo {
  /** 扩展包装好了没有。 */
  installed(): Promise<boolean>;
  /** 扩展包里文件的 file:// 地址。 */
  modelUri(file: 'det.onnx' | 'rec.onnx' | 'dictionary.json'): string;
  readText(uri: string): Promise<string>;
  /** 新建一个临时目录，返回它的 file:// 地址（结尾不带 /）和删除它的方法。 */
  tempDir(): { uri: string; remove(): void };
  write(uri: string, bytes: Uint8Array): Promise<void>;
  read(uri: string): Promise<Uint8Array>;
  /** 图片解码成识别要的大小（ocrPixels）。 */
  pixels(uri: string, maxSide: number): Promise<RgbaImage>;
}

export const coversLanguage = (code: string) =>
  (PPOCR_LANGUAGES as readonly string[]).includes(code.split('-')[0]!.toLowerCase());

const bytesOf = (array: Float32Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

export function createPpocr(native: PpocrNative, io: PpocrIo) {
  let dictionary: readonly string[] | null = null;
  return {
    /**
     * 识别一张图：返回识别时图片的大小和每一行（像素，原点在左上角）。
     * pixels 是这张图已经按 io.pixels 解码好的像素（转 Excel 找线时解码过，D-272），给了就不再解码。
     */
    async recognize(
      uri: string,
      pixels?: RgbaImage,
    ): Promise<{ width: number; height: number; lines: OcrResultLine[] }> {
      if (!(await io.installed())) throw new Error('text recognition model is not installed');
      dictionary ??= JSON.parse(await io.readText(io.modelUri('dictionary.json'))).characters;
      await native.ocrLoad(io.modelUri('det.onnx'), io.modelUri('rec.onnx'));
      const image = pixels ?? (await io.pixels(uri, PPOCR_INPUT_SIDE));
      const dir = io.tempDir();
      try {
        let n = 0;
        const models: OcrModels = {
          async detect(input, width, height) {
            const inFile = `${dir.uri}/det-in.bin`;
            const outFile = `${dir.uri}/det-out.bin`;
            await io.write(inFile, bytesOf(input));
            await native.ocrDetect(inFile, width, height, outFile);
            return io.read(outFile);
          },
          async recognize(input, count, width) {
            const inFile = `${dir.uri}/rec-${n}-in.bin`;
            const outFile = `${dir.uri}/rec-${n++}-out.bin`;
            await io.write(inFile, bytesOf(input));
            const steps = await native.ocrRecognize(inFile, count, width, outFile);
            // 复制一份：读回来的字节不一定从 4 的倍数开始。
            const bytes = (await io.read(outFile)).slice();
            const cells = count * steps;
            return {
              steps,
              index: new Int32Array(bytes.buffer, 0, cells),
              prob: new Float32Array(bytes.buffer, cells * 4, cells),
            };
          },
        };
        const lines = await recognizePage(image, models, dictionary!);
        return { width: image.width, height: image.height, lines };
      } finally {
        dir.remove();
      }
    },
  };
}

export type Ppocr = ReturnType<typeof createPpocr>;
