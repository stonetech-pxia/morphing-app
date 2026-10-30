import {
  LAYOUT_INPUT,
  layoutInput,
  parseLayout,
  type LayoutRegion,
  type RgbaImage,
} from '@morph/tool-office';

// 转 Word 的版面分析（D-310）：PP-DocLayout-S 在扩展包 layout 里，用展平同一个原生方法 modelRun 跑
// （一个 float32 输入、一个 float32 输出，D-274），前后处理在 @morph/tool-office。
// 输入、输出走临时文件，用完不管成功失败都删掉。

/** 扩展包 ID（packages/core 的 PACKS）。 */
export const LAYOUT_PACK = 'layout';

export interface LayoutNative {
  modelRun(model: string, input: string, shape: number[], output: string): Promise<number[]>;
}

export interface LayoutIo {
  installed(pack: string): Promise<boolean>;
  /** 扩展包里文件的 file:// 地址。 */
  modelUri(pack: string, file: string): string;
  readFile(uri: string): Promise<Uint8Array>;
  writeFile(uri: string, bytes: Uint8Array): Promise<unknown>;
  /** 新建一个临时目录，返回它的 file:// 地址（结尾不带 /）和删除它的方法。 */
  tempDir(): { uri: string; remove(): void };
}

const bytesOf = (array: Float32Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

export function createLayoutDetector(native: LayoutNative, io: LayoutIo) {
  return {
    /** 一页的版面区域（坐标和 pixels 一样）；模型没装时返回 null（只按位置分段）。 */
    async detect(pixels: RgbaImage): Promise<LayoutRegion[] | null> {
      if (!(await io.installed(LAYOUT_PACK))) return null;
      const dir = io.tempDir();
      try {
        const inFile = `${dir.uri}/layout-in.bin`;
        const outFile = `${dir.uri}/layout-out.bin`;
        await io.writeFile(inFile, bytesOf(layoutInput(pixels)));
        const shape = await native.modelRun(
          io.modelUri(LAYOUT_PACK, 'layout.onnx'),
          inFile,
          [1, 3, LAYOUT_INPUT, LAYOUT_INPUT],
          outFile,
        );
        if (shape.length !== 2 || shape[1] !== 6) {
          throw new Error(`unexpected layout output ${shape.join('×')}`);
        }
        // 复制一份：读回来的字节不一定从 4 的倍数开始。
        const out = new Float32Array((await io.readFile(outFile)).slice().buffer);
        return parseLayout(out.subarray(0, shape[0]! * 6), pixels);
      } finally {
        dir.remove();
      }
    },
  };
}
