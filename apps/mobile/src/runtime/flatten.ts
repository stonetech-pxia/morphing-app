import {
  FLATTEN_PAD_GRAY,
  UVDOC_GRID,
  UVDOC_INPUT,
  flattenMesh,
  grayOf,
  padMargin,
  paddedSize,
  planRefinement,
  ruleLines,
  textLinesFromProb,
  uvdocInput,
  type Refinement,
  type RgbaImage,
  type Size,
  type WarpMesh,
} from '@morph/tool-image';
import { detectionInput, detectionSize } from '@morph/tool-ocr';

// 扫描展平（D-274）：拉正后的页面 → 四周补深色边、缩到 488×712 → UVDoc 估计弯曲（45×31 的网格）
// → 装了文字识别模型时，按 UVDoc 画一张小图找文字行（PP-OCRv6 det）和表格线，算整页转正和逐行拉直
// → 三步合成一张三角网格，Skia 的 drawVertices 在原图上只画一次。几何计算在 @morph/tool-image（flatten.ts）。
// 模型的输入、输出走临时文件（和文字识别一样），用完不管成功失败都删掉。

/** 扩展包 ID（packages/core 的 PACKS）。 */
export const DEWARP_PACK = 'dewarp';

/** 找文字行用的小图长边：实验里 1280 和 2000 一样整齐，1280 快一倍多。 */
export const REFINE_DETECT_SIDE = 1280;

export interface FlattenNative {
  modelRun(model: string, input: string, shape: number[], output: string): Promise<number[]>;
  /** 找文字行（PP-OCRv6 det，和文字识别共用）；没有时只展平、不精修。 */
  ocrLoad?(det: string, rec: string): Promise<void>;
  ocrDetect?(input: string, width: number, height: number, output: string): Promise<void>;
}

/** 一张页面在 Skia 里打开以后能做的事（App 里是 skia.ts，测试里换成假的）。 */
export interface FlattenPage {
  width: number;
  height: number;
  /** 补边后缩到 488×712 的 RGBA。 */
  uvdocPixels(margin: number, padded: Size, gray: number): RgbaImage;
  /** 按网格画到 out 大小，读回 RGBA（找文字行用的小图）。 */
  render(mesh: WarpMesh, out: Size): RgbaImage;
  /** 按网格画到原大小，编码成 JPG。 */
  encode(mesh: WarpMesh, quality: number): Uint8Array;
  dispose(): void;
}

export interface FlattenIo {
  installed(pack: string): Promise<boolean>;
  /** 扩展包里文件的 file:// 地址。 */
  modelUri(pack: string, file: string): string;
  readFile(uri: string): Promise<Uint8Array>;
  /** 写输出图，返回字节数。 */
  writeFile(uri: string, bytes: Uint8Array): Promise<number>;
  /** 新建一个临时目录，返回它的 file:// 地址（结尾不带 /）和删除它的方法。 */
  tempDir(): { uri: string; remove(): void };
  open(bytes: Uint8Array): FlattenPage;
}

export interface FlattenOutcome {
  width: number;
  height: number;
  size: number;
  refined: boolean;
  timing: Record<string, number>;
}

const bytesOf = (array: Float32Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

export function createFlattener(
  native: FlattenNative,
  io: FlattenIo,
  options: { ocrPack: string; quality: number; now?: () => number },
) {
  const now = options.now ?? (() => Date.now());
  return {
    /** 展平一页，写到 output；展平模型没装时返回 null（调用方照常用原来的页面）。 */
    async flatten(uri: string, output: string): Promise<FlattenOutcome | null> {
      if (!(await io.installed(DEWARP_PACK))) return null;
      const timing: Record<string, number> = {};
      let t = now();
      const lap = (key: string) => {
        const n = now();
        timing[key] = n - t;
        t = n;
      };
      const page = io.open(await io.readFile(uri));
      const dir = io.tempDir();
      try {
        const size = { width: page.width, height: page.height };
        const input = uvdocInput(
          page.uvdocPixels(padMargin(size), paddedSize(size), FLATTEN_PAD_GRAY),
        );
        lap('uvdocInput');
        const inFile = `${dir.uri}/uvdoc-in.bin`;
        const outFile = `${dir.uri}/uvdoc-out.bin`;
        await io.writeFile(inFile, bytesOf(input));
        const shape = await native.modelRun(
          io.modelUri(DEWARP_PACK, 'uvdoc.onnx'),
          inFile,
          [1, 3, UVDOC_INPUT.height, UVDOC_INPUT.width],
          outFile,
        );
        if (shape.join() !== [1, 2, UVDOC_GRID.height, UVDOC_GRID.width].join()) {
          throw new Error(`unexpected UVDoc output ${shape.join('×')}`);
        }
        // 复制一份：读回来的字节不一定从 4 的倍数开始。
        const grid = new Float32Array((await io.readFile(outFile)).slice().buffer);
        const warp = { grid, page: size };
        lap('uvdoc');

        let refine: Refinement | null = null;
        if (native.ocrLoad && native.ocrDetect && (await io.installed(options.ocrPack))) {
          await native.ocrLoad(
            io.modelUri(options.ocrPack, 'det.onnx'),
            io.modelUri(options.ocrPack, 'rec.onnx'),
          );
          const k = Math.min(1, REFINE_DETECT_SIDE / Math.max(size.width, size.height));
          const det = detectionSize(Math.round(size.width * k), Math.round(size.height * k));
          const low = page.render(flattenMesh(size, warp, null, det), det);
          lap('lowRender');
          const tensor = detectionInput(low);
          const detIn = `${dir.uri}/det-in.bin`;
          const detOut = `${dir.uri}/det-out.bin`;
          await io.writeFile(detIn, bytesOf(tensor.tensor));
          await native.ocrDetect(detIn, tensor.width, tensor.height, detOut);
          const prob = await io.readFile(detOut);
          lap('detect');
          const text = textLinesFromProb(prob, tensor.width, tensor.height, size);
          const gray = grayOf(low);
          const rulesH = ruleLines(gray, low.width, low.height, size, false);
          const rulesV = ruleLines(gray, low.width, low.height, size, true);
          refine = planRefinement(size, text, rulesH, rulesV);
          lap('refine');
        }
        const mesh = flattenMesh(size, warp, refine);
        lap('mesh');
        const bytes = page.encode(mesh, options.quality);
        lap('render');
        const written = await io.writeFile(output, bytes);
        lap('write');
        return {
          ...size,
          size: written,
          refined: refine !== null && refine.lines > 0,
          timing,
        };
      } finally {
        page.dispose();
        dir.remove();
      }
    },
  };
}

export type Flattener = ReturnType<typeof createFlattener>;
