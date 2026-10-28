import CanvasKitInit from 'canvaskit-wasm';
import { describe, expect, it } from 'vitest';

import { downscale, syntheticPage } from './__fixtures__/pages';
import {
  ENHANCE_SHADER_MODE,
  ENHANCE_SKSL,
  enhancePixels,
  paperBackground,
  PAPER_SIDE,
  type EnhanceLook,
} from './paper';

// App 里用 Skia 着色器在原尺寸上套用背景（D-266）。CanvasKit 是同一个 Skia（CPU 版），
// 在这里编译并运行 ENHANCE_SKSL，核对它和 enhancePixels 的结果一致。

describe('ENHANCE_SKSL', () => {
  it('compiles and gives the same pixels as enhancePixels', async () => {
    const ck = await CanvasKitInit();
    const effect = ck.RuntimeEffect.Make(ENHANCE_SKSL);
    expect(effect).toBeTruthy();
    const page = syntheticPage({ shadow: 0.45, stamp: true, photo: true, warm: true });
    const small = downscale(page.data, page.width, page.height, PAPER_SIDE);
    const bg = paperBackground(small.data, small.width, small.height);
    const info = (width: number, height: number) => ({
      width,
      height,
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB,
    });
    const image = ck.MakeImage(info(page.width, page.height), page.data, page.width * 4)!;
    const background = ck.MakeImage(info(bg.width, bg.height), bg.data, bg.width * 4)!;
    const paper = ck.MakeImage(info(bg.width, bg.height), bg.paper, bg.width * 4)!;
    const scaled = (img: typeof image) =>
      img.makeShaderOptions(
        ck.TileMode.Clamp,
        ck.TileMode.Clamp,
        ck.FilterMode.Linear,
        ck.MipmapMode.None,
        ck.Matrix.scaled(page.width / bg.width, page.height / bg.height),
      );
    for (const mode of ['auto', 'gray', 'bw'] as EnhanceLook[]) {
      const surface = ck.MakeSurface(page.width, page.height)!;
      const shader = effect!.makeShaderWithChildren(
        [ENHANCE_SHADER_MODE[mode]],
        [
          image.makeShaderOptions(
            ck.TileMode.Clamp,
            ck.TileMode.Clamp,
            ck.FilterMode.Nearest,
            ck.MipmapMode.None,
          ),
          scaled(background),
          scaled(paper),
        ],
      );
      const paint = new ck.Paint();
      paint.setShader(shader);
      surface.getCanvas().drawRect(ck.XYWHRect(0, 0, page.width, page.height), paint);
      const got = surface.getCanvas().readPixels(0, 0, info(page.width, page.height)) as Uint8Array;
      const want = enhancePixels(page.data, page.width, page.height, bg, mode);
      let worst = 0;
      let off = 0;
      for (let i = 0; i < want.length; i++) {
        const d = Math.abs(got[i]! - want[i]!);
        worst = Math.max(worst, d);
        if (d > 2) off++;
      }
      // 只有色阶边缘舍入不同：几乎每个像素差不超过 2/255。
      expect(off / want.length).toBeLessThan(0.002);
      expect(worst).toBeLessThan(24);
      surface.delete();
    }
  });
});
