import { minAreaRect, rectCorners, unclipRect, type Point } from './geometry';

// PP-OCRv6 的文字识别流程（D-269），除了跑模型都在这里：找文字行的输入（缩放到 32 的倍数、BGR、归一化），
// 概率图 → 文字框（DB 后处理），把每个框拉正裁成 48 像素高的一条，认字结果按 CTC 规则解码。
// 跑模型由平台提供（iOS、Android 用 ONNX Runtime，Node 测试用 onnxruntime-node），所以这些步骤可以在 Node 里测。

/** RGBA 像素（每像素 4 字节）。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 两个模型：找文字行和认字。 */
export interface OcrModels {
  /** 输入 [1, 3, height, width]，输出每个像素是文字的概率 × 255（width × height 个字节）。 */
  detect(input: Float32Array, width: number, height: number): Promise<Uint8Array>;
  /**
   * 输入 [count, 3, 48, width]；输出每一条、每个时间步概率最大的类别（0 是空白）和它的概率，
   * 按 [count, steps] 排。整张概率表太大，平台只回传最大的那个。
   */
  recognize(
    input: Float32Array,
    count: number,
    width: number,
  ): Promise<{ steps: number; index: Int32Array; prob: Float32Array }>;
}

export interface OcrResultLine {
  text: string;
  /** 平均置信度（0–1）。 */
  score: number;
  /** 文字框的四个角（左上、右上、右下、左下），原图像素。 */
  quad: [Point, Point, Point, Point];
  /** 外接的正矩形，原图像素，原点在左上角。 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrOptions {
  /** 找文字行时短边至少这么大（小图放大），默认 736。 */
  limitSide?: number;
  /** 是文字的概率门槛，默认 0.3。 */
  threshold?: number;
  /** 框里平均概率低于它就丢掉，默认 0.6。 */
  boxThreshold?: number;
  /** 框往外扩的比例，默认 1.5。 */
  unclipRatio?: number;
  /** 认字的平均置信度低于它就丢掉，默认 0.5。 */
  textScore?: number;
  /** 一次送进认字模型的条数，默认 6。 */
  batch?: number;
}

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
const REC_MAX_WIDTH = 3200;
const MIN_BOX_SIDE = 3;

/** 双线性取一个通道（边缘外取边缘值）；c 是 RGBA 里的通道号。 */
function sample(image: RgbaImage, x: number, y: number, c: number): number {
  const { width, height, data } = image;
  const fx = Math.min(Math.max(x, 0), width - 1);
  const fy = Math.min(Math.max(y, 0), height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const top = data[(y0 * width + x0) * 4 + c]! * (1 - ax) + data[(y0 * width + x1) * 4 + c]! * ax;
  const bottom =
    data[(y1 * width + x0) * 4 + c]! * (1 - ax) + data[(y1 * width + x1) * 4 + c]! * ax;
  return top * (1 - ay) + bottom * ay;
}

/** 找文字行的输入大小：短边不到 limit 时放大，再四舍五入到 32 的倍数。 */
export function detectionSize(
  width: number,
  height: number,
  limit = 736,
): { width: number; height: number } {
  const ratio = Math.min(width, height) < limit ? limit / Math.min(width, height) : 1;
  return {
    width: Math.max(32, Math.round(Math.floor(width * ratio) / 32) * 32),
    height: Math.max(32, Math.round(Math.floor(height * ratio) / 32) * 32),
  };
}

/**
 * 找文字行的输入张量：BGR 通道，减均值除方差。图片已经是要的大小时（平台先用 Skia 缩好）直接换算，
 * 否则双线性缩放（像素中心对齐，和 OpenCV 一样）；手机上的 JS 没有 JIT，逐像素插值很慢，尽量走前一种。
 */
export function detectionInput(image: RgbaImage, limit = 736) {
  const size = detectionSize(image.width, image.height, limit);
  const plane = size.width * size.height;
  const tensor = new Float32Array(plane * 3);
  if (size.width === image.width && size.height === image.height) {
    const { data } = image;
    const k = [0, 1, 2].map((c) => 1 / 255 / DET_STD[c]!);
    const m = [0, 1, 2].map((c) => DET_MEAN[c]! / DET_STD[c]!);
    const [k0, k1, k2] = k as [number, number, number];
    const [m0, m1, m2] = m as [number, number, number];
    for (let o = 0, i = 0; o < plane; o++, i += 4) {
      tensor[o] = data[i + 2]! * k0 - m0;
      tensor[plane + o] = data[i + 1]! * k1 - m1;
      tensor[2 * plane + o] = data[i]! * k2 - m2;
    }
    return { tensor, ...size };
  }
  const sx = image.width / size.width;
  const sy = image.height / size.height;
  for (let y = 0; y < size.height; y++) {
    const srcY = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < size.width; x++) {
      const srcX = (x + 0.5) * sx - 0.5;
      const o = y * size.width + x;
      // 通道 0 是 B（RGBA 的 2），1 是 G，2 是 R。
      for (let c = 0; c < 3; c++) {
        tensor[c * plane + o] =
          (sample(image, srcX, srcY, 2 - c) / 255 - DET_MEAN[c]!) / DET_STD[c]!;
      }
    }
  }
  return { tensor, ...size };
}

/**
 * 概率图 → 文字框（DB 后处理）：超过门槛的像素按 8 连通分块，每块平均概率太低的丢掉，
 * 取最小外接矩形，往外扩一点，换算到原图大小，按从上到下、从左到右排。
 */
export function textBoxes(
  prob: Uint8Array,
  width: number,
  height: number,
  dest: { width: number; height: number },
  options: OcrOptions = {},
): { quad: [Point, Point, Point, Point]; score: number }[] {
  const threshold = Math.round((options.threshold ?? 0.3) * 255);
  const boxThreshold = options.boxThreshold ?? 0.6;
  const unclip = options.unclipRatio ?? 1.5;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  // 每行最左、最右的像素；用完一块就复原。
  const rowMin = new Int32Array(height).fill(width);
  const rowMax = new Int32Array(height).fill(-1);
  const boxes: { quad: [Point, Point, Point, Point]; score: number }[] = [];
  for (let start = 0; start < prob.length; start++) {
    if (seen[start] || prob[start]! <= threshold) continue;
    // 一块：每行只需要最左、最右的像素（凸包只看它们）。
    const firstRow = (start - (start % width)) / width;
    let lastRow = firstRow;
    let sum = 0;
    let count = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      if (x < rowMin[y]!) rowMin[y] = x;
      if (x > rowMax[y]!) rowMax[y] = x;
      if (y > lastRow) lastRow = y;
      sum += prob[p]!;
      count++;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (!seen[q] && prob[q]! > threshold) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    // 按行扫描找到的第一个像素在最上面一行，所以这一块的行号从 firstRow 到 lastRow。
    const points: Point[] = [];
    for (let y = firstRow; y <= lastRow; y++) {
      if (rowMax[y]! < 0) continue;
      points.push({ x: rowMin[y]!, y }, { x: rowMax[y]!, y });
      rowMin[y] = width;
      rowMax[y] = -1;
    }
    const rect = minAreaRect(points);
    if (Math.min(rect.w, rect.h) < MIN_BOX_SIDE) continue;
    // 用这一块自己的像素打分（PaddleOCR 的 score_mode=slow），不用外接矩形：拍屏幕、拍书页时文字行是弯的，
    // 矩形里一半是空白，平均概率会掉到门槛以下，整行就丢了。
    const score = sum / count / 255;
    if (score < boxThreshold) continue;
    const grown = unclipRect(rect, unclip);
    if (Math.min(grown.w, grown.h) < MIN_BOX_SIDE + 2) continue;
    const quad = rectCorners(grown).map((p) => ({
      x: Math.min(Math.max(Math.round((p.x / width) * dest.width), 0), dest.width),
      y: Math.min(Math.max(Math.round((p.y / height) * dest.height), 0), dest.height),
    })) as [Point, Point, Point, Point];
    boxes.push({ quad, score });
  }
  // 从上到下、从左到右；同一行（左上角高度差不到 10 像素）里左边的排前面。
  boxes.sort((a, b) => a.quad[0].y - b.quad[0].y || a.quad[0].x - b.quad[0].x);
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i]!.quad[0];
    const b = boxes[i + 1]!.quad[0];
    if (Math.abs(b.y - a.y) < 10 && b.x < a.x)
      [boxes[i], boxes[i + 1]] = [boxes[i + 1]!, boxes[i]!];
  }
  return boxes;
}

/** 一个框拉正后的大小；竖长的框（高 ≥ 宽的 1.5 倍）逆时针转 90°。 */
function cropShape(quad: readonly Point[]) {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const [p0, p1, p2, p3] = quad as [Point, Point, Point, Point];
  const w = Math.max(1, Math.floor(Math.max(d(p0, p1), d(p2, p3))));
  const h = Math.max(1, Math.floor(Math.max(d(p0, p3), d(p1, p2))));
  const turned = h / w >= 1.5;
  return { w, h, turned, outW: turned ? h : w, outH: turned ? w : h };
}

/** 一批框拉正、缩成 48 像素高，排成 [count, 3, 48, width] 的认字输入（BGR，归一化到 -1–1，右边补 0）。 */
export function recognitionInput(image: RgbaImage, quads: readonly (readonly Point[])[]) {
  const shapes = quads.map(cropShape);
  const ratio = Math.max(...shapes.map((s) => s.outW / s.outH));
  const width = Math.min(REC_MAX_WIDTH, Math.max(REC_MIN_WIDTH, Math.floor(REC_HEIGHT * ratio)));
  const plane = REC_HEIGHT * width;
  const tensor = new Float32Array(quads.length * 3 * plane);
  const { width: iw, height: ih, data: px } = image;
  for (const [n, quad] of quads.entries()) {
    const s = shapes[n]!;
    const [p0, p1, p2, p3] = quad as [Point, Point, Point, Point];
    const resized = Math.min(width, Math.ceil((REC_HEIGHT * s.outW) / s.outH));
    for (let dy = 0; dy < REC_HEIGHT; dy++) {
      const oy = Math.max(0, ((dy + 0.5) * s.outH) / REC_HEIGHT - 0.5);
      for (let dx = 0; dx < resized; dx++) {
        const ox = Math.max(0, ((dx + 0.5) * s.outW) / resized - 0.5);
        // 转过 90° 的：输出的 (ox, oy) 对应拉正后的 (w - 1 - oy, ox)。
        const cx = s.turned ? s.w - 1 - oy : ox;
        const cy = s.turned ? ox : oy;
        const u = cx / s.w;
        const v = cy / s.h;
        // 矩形框的透视变换就是四个角的双线性插值。
        const sx =
          (1 - u) * (1 - v) * p0.x + u * (1 - v) * p1.x + u * v * p2.x + (1 - u) * v * p3.x;
        const sy =
          (1 - u) * (1 - v) * p0.y + u * (1 - v) * p1.y + u * v * p2.y + (1 - u) * v * p3.y;
        // 双线性取样（内联：手机上的 JS 没有 JIT，函数调用很贵）。
        const fx = sx < 0 ? 0 : sx > iw - 1 ? iw - 1 : sx;
        const fy = sy < 0 ? 0 : sy > ih - 1 ? ih - 1 : sy;
        const x0 = fx | 0;
        const y0 = fy | 0;
        const x1 = x0 + 1 < iw ? x0 + 1 : x0;
        const y1 = y0 + 1 < ih ? y0 + 1 : y0;
        const ax = fx - x0;
        const ay = fy - y0;
        const i00 = (y0 * iw + x0) * 4;
        const i01 = (y0 * iw + x1) * 4;
        const i10 = (y1 * iw + x0) * 4;
        const i11 = (y1 * iw + x1) * 4;
        const w00 = (1 - ax) * (1 - ay);
        const w01 = ax * (1 - ay);
        const w10 = (1 - ax) * ay;
        const w11 = ax * ay;
        const o = n * 3 * plane + dy * width + dx;
        for (let c = 0; c < 3; c++) {
          const ch = 2 - c;
          const v =
            px[i00 + ch]! * w00 + px[i01 + ch]! * w01 + px[i10 + ch]! * w10 + px[i11 + ch]! * w11;
          tensor[o + c * plane] = v / 127.5 - 1;
        }
      }
    }
  }
  return { tensor, width };
}

/** CTC 解码：去掉空白（0）和连续重复，类别 i 对应字典第 i - 1 个字；置信度是留下的字的平均概率。 */
export function ctcDecode(
  index: ArrayLike<number>,
  prob: ArrayLike<number>,
  steps: number,
  row: number,
  dictionary: readonly string[],
): { text: string; score: number } {
  let text = '';
  let sum = 0;
  let count = 0;
  let previous = -1;
  for (let t = 0; t < steps; t++) {
    const k = index[row * steps + t]!;
    if (k !== 0 && k !== previous) {
      text += dictionary[k - 1] ?? '';
      sum += prob[row * steps + t]!;
      count++;
    }
    previous = k;
  }
  return { text, score: count > 0 ? sum / count : 0 };
}

/** 一页图片的识别：找文字行 → 每行拉正 → 认字（按宽度排序成批，宽度相近的放一批）。 */
export async function recognizePage(
  image: RgbaImage,
  models: OcrModels,
  dictionary: readonly string[],
  options: OcrOptions = {},
): Promise<OcrResultLine[]> {
  const det = detectionInput(image, options.limitSide ?? 736);
  const prob = await models.detect(det.tensor, det.width, det.height);
  const boxes = textBoxes(prob, det.width, det.height, image, options);
  const order = boxes
    .map((box, i) => ({ i, ratio: cropShape(box.quad).outW / cropShape(box.quad).outH }))
    .sort((a, b) => a.ratio - b.ratio)
    .map((e) => e.i);
  const texts: { text: string; score: number }[] = new Array(boxes.length);
  const batch = options.batch ?? 6;
  for (let start = 0; start < order.length; start += batch) {
    const ids = order.slice(start, start + batch);
    const input = recognitionInput(
      image,
      ids.map((i) => boxes[i]!.quad),
    );
    const out = await models.recognize(input.tensor, ids.length, input.width);
    for (const [row, i] of ids.entries()) {
      texts[i] = ctcDecode(out.index, out.prob, out.steps, row, dictionary);
    }
  }
  const minScore = options.textScore ?? 0.5;
  const lines: OcrResultLine[] = [];
  for (const [i, box] of boxes.entries()) {
    const { text, score } = texts[i]!;
    if (score < minScore || !text.trim()) continue;
    const xs = box.quad.map((p) => p.x);
    const ys = box.quad.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    lines.push({
      text,
      score,
      quad: box.quad,
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    });
  }
  return lines;
}
