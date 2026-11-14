// 识别结果（PP-OCR 的行 + 版面模型的区域）按「PDF 内容 + 页码 + 图的大小」存在 fixtures/ 里。
// 平时只读这些记录，不需要模型，几秒跑完；转换器改了不影响记录（记录是转换器的输入）。
// --record 时用和 App 相同的模型重新识别并写回（换了识别模型、加了新页时用）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { layoutInput, parseLayout, type LayoutRegion } from '../../../packages/tool-office/src';
import { detectionSize, recognizePage } from '../../../packages/tool-ocr/src';
import { ENV, need } from './env';

export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

interface Line {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  chars?: unknown;
}

export interface PageRecord {
  /** 这一页来源文件（pages/ 里）的 sha256：来源改了，记录作废。 */
  sourceSha256: string;
  recognize: { width: number; height: number; lines: Line[] }[];
  layout: { width: number; height: number; regions: LayoutRegion[] }[];
}

// canvaskit 解码、缩放和 App 的 tablePixels 一样：长边不超过 2000，再按识别要求取整。
const req = createRequire(import.meta.url);
const CK = await req('canvaskit-wasm/bin/full/canvaskit.js')();
export { CK };

export function decode(bytes: Uint8Array) {
  const im = CK.MakeImageFromEncoded(bytes);
  if (!im) throw new Error('cannot decode image');
  return im;
}

export function pixelsOf(bytes: Uint8Array): Pixels {
  const im = decode(bytes);
  const k = Math.min(1, 2000 / Math.max(im.width(), im.height()));
  const size = detectionSize(
    Math.max(1, Math.round(im.width() * k)),
    Math.max(1, Math.round(im.height() * k)),
  );
  const s = CK.MakeSurface(size.width, size.height);
  const c = s.getCanvas();
  c.clear(CK.WHITE);
  c.drawImageRectOptions(
    im,
    CK.XYWHRect(0, 0, im.width(), im.height()),
    CK.XYWHRect(0, 0, size.width, size.height),
    CK.FilterMode.Linear,
    CK.MipmapMode.Linear,
    null,
  );
  s.flush();
  const snap = s.makeImageSnapshot();
  const data = snap.readPixels(0, 0, {
    ...size,
    colorType: CK.ColorType.RGBA_8888,
    alphaType: CK.AlphaType.Unpremul,
    colorSpace: CK.ColorSpace.SRGB,
  });
  snap.delete();
  s.dispose();
  im.delete();
  return { ...size, data: new Uint8Array(data) };
}

type Models = {
  det: {
    run(feeds: object): Promise<Record<string, { data: Float32Array }>>;
    inputNames: string[];
    outputNames: string[];
  };
  rec: Models['det'];
  layout: Models['det'];
  dictionary: string[];
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
};
let models: Models | null = null;

async function loadModels(): Promise<Models> {
  if (models) return models;
  const ort = createRequire(`${need(ENV.onnxruntime, 'onnxruntime-node')}/package.json`)(
    'onnxruntime-node',
  );
  const options = { intraOpNumThreads: 2, interOpNumThreads: 1, logSeverityLevel: 3 };
  const open = (p: string) => ort.InferenceSession.create(need(p, 'model'), options);
  models = {
    det: await open(ENV.models.det),
    rec: await open(ENV.models.rec),
    layout: await open(ENV.models.layout),
    dictionary: JSON.parse(readFileSync(need(ENV.models.dict, 'dictionary'), 'utf8')).characters,
    Tensor: ort.Tensor,
  };
  return models;
}

async function liveLines(px: Pixels): Promise<Line[]> {
  const m = await loadModels();
  const raw = await recognizePage(
    px,
    {
      async detect(input: Float32Array, width: number, height: number) {
        const out = await m.det.run({
          [m.det.inputNames[0]!]: new m.Tensor('float32', input, [1, 3, height, width]),
        });
        return Uint8Array.from(out[m.det.outputNames[0]!]!.data, (x) =>
          Math.round(Math.min(1, Math.max(0, x)) * 255),
        );
      },
      async recognize(input: Float32Array, count: number, width: number) {
        const out = await m.rec.run({
          [m.rec.inputNames[0]!]: new m.Tensor('float32', input, [count, 3, 48, width]),
        });
        const t = out[m.rec.outputNames[0]!] as unknown as { dims: number[]; data: Float32Array };
        const [, steps, classes] = t.dims as [number, number, number];
        const d = t.data;
        const index = new Int32Array(count * steps);
        const prob = new Float32Array(count * steps);
        for (let i = 0; i < count * steps; i++) {
          let best = 0;
          for (let c = 1; c < classes; c++)
            if (d[i * classes + c]! > d[i * classes + best]!) best = c;
          index[i] = best;
          prob[i] = d[i * classes + best]!;
        }
        return { steps, index, prob };
      },
    },
    m.dictionary,
  );
  // 和 App 的 expo-vision 适配器一样：不带 score。
  return raw.map(({ text, x, y, width, height, chars }: Line) => ({
    text,
    x,
    y,
    width,
    height,
    ...(chars ? { chars } : {}),
  }));
}

async function liveLayout(px: Pixels): Promise<LayoutRegion[]> {
  const m = await loadModels();
  const res = await m.layout.run({
    [m.layout.inputNames[0]!]: new m.Tensor('float32', layoutInput(px, 480), [1, 3, 480, 480]),
  });
  return parseLayout(res[m.layout.outputNames[0]!]!.data, px, 480);
}

/** 一页的识别记录：读 fixtures，没有（或 --record）时现场识别。 */
export class OcrStore {
  private record: PageRecord;
  dirty = false;
  constructor(
    private file: string,
    sourceSha256: string,
    private live: boolean,
  ) {
    const old: PageRecord | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    this.record =
      old && old.sourceSha256 === sourceSha256 && !live
        ? old
        : { sourceSha256, recognize: [], layout: [] };
  }

  private missing(what: string): never {
    throw new Error(
      `no recorded ${what} for ${this.file}; run with --record (needs the OCR models, see README)`,
    );
  }

  async lines(px: Pixels) {
    const hit = this.record.recognize.find((r) => r.width === px.width && r.height === px.height);
    if (hit) return hit;
    if (!this.live) this.missing('OCR');
    const found = { width: px.width, height: px.height, lines: await liveLines(px) };
    this.record.recognize.push(found);
    this.dirty = true;
    return found;
  }

  async regions(px: Pixels) {
    const hit = this.record.layout.find((r) => r.width === px.width && r.height === px.height);
    if (hit) return hit.regions;
    if (!this.live) this.missing('layout');
    const regions = await liveLayout(px);
    this.record.layout.push({ width: px.width, height: px.height, regions });
    this.dirty = true;
    return regions;
  }

  save() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(this.record)}\n`);
  }
}

/** 不读不写记录，每次现场识别（转任意样本用）。 */
export const liveOcr = {
  lines: async (px: Pixels) => ({ width: px.width, height: px.height, lines: await liveLines(px) }),
  regions: liveLayout,
};
