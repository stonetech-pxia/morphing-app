import { lineShareIn, type LayoutRegion } from './layout';
import type { Box, OcrBox, RgbaImage } from './types';

// Word 的整图归属：图注或足够强的图形像素作证、没有正文/数据表冲突，再保护其中的文字和线条。
// 这是构建时的临时计划；不改版面模型阈值，也不写进文档或工作表格式。
const captionStart = /^(?:fig(?:ure)?\.?\s*\d+[\s:：.)]|[图圖]\s*\d+[\s:：.、])/iu;
const captionLabels = new Set(['figure_title', 'chart_title']);
const area = (b: Box) => b.width * b.height;
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

export interface WordFigure {
  region: LayoutRegion;
  box: Box;
  caption?: OcrBox;
}

/** 原始模型图框加像素/文字证据；弱图框和正文、表格冲突仍留在原有路径。 */
export function planWordFigures(
  image: RgbaImage,
  lines: readonly OcrBox[],
  regions: readonly LayoutRegion[],
  h: number,
): WordFigure[] {
  const captions = regions
    .filter((r) => captionLabels.has(r.label))
    .flatMap((r) =>
      lines.filter((l) => lineShareIn(l, r.box) >= 0.5 && captionStart.test(l.text.trim())),
    );
  const result: WordFigure[] = [];
  for (const r of regions) {
    const b = r.box;
    if (r.kind !== 'image' || r.label === 'seal' || (r.fused && r.score < 0.6)) continue;
    const caption = captions
      .filter(
        (l) =>
          l.y >= b.y + b.height - 0.3 * h &&
          l.y - b.y - b.height <= 3 * h &&
          l.x + l.width / 2 >= b.x - h &&
          l.x + l.width / 2 <= b.x + b.width + h &&
          overlap({ ...b, y: l.y, height: l.height }, l) >=
            0.6 * Math.min(b.width, l.width) * l.height,
      )
      .sort((a, c) => a.y - c.y)[0];
    // 图片/表格冲突需要另行判定上下文；不能凭图注就把数据表截图。
    if (
      regions.some(
        (t) => t.kind === 'table' && overlap(t.box, b) >= 0.5 * Math.min(area(t.box), area(b)),
      )
    )
      continue;
    const inside = lines.filter((l) => l !== caption && lineShareIn(l, b) >= 0.5);
    // 无图注的大色块也可能是多格表单；不能把大量短字段当成示意图标签。
    if (
      !caption &&
      (inside.length > 12 || inside.reduce((n, l) => n + [...l.text.trim()].length, 0) > 100)
    )
      continue;
    // 宽正文行是强冲突证据，即使模型声称是图片也不接管。
    if (inside.some((l) => l.width >= 0.6 * b.width && [...l.text.trim()].length >= 15)) continue;
    // 图形证据来自 OCR 框之外的原图像素；稀疏箭头可以很少，但只有文字的框仍不接管。
    const step = Math.max(1, Math.round(Math.max(b.width, b.height) / 180));
    let ink = 0,
      samples = 0;
    for (
      let y = Math.max(0, Math.floor(b.y));
      y < Math.min(image.height, b.y + b.height);
      y += step
    ) {
      for (
        let x = Math.max(0, Math.floor(b.x));
        x < Math.min(image.width, b.x + b.width);
        x += step
      ) {
        samples++;
        if (inside.some((l) => x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height))
          continue;
        const off = (y * image.width + x) * 4;
        const rr = image.data[off]!,
          g = image.data[off + 1]!,
          bb = image.data[off + 2]!;
        if (
          (rr * 299 + g * 587 + bb * 114) / 1000 < 200 ||
          Math.max(rr, g, bb) - Math.min(rr, g, bb) > 25
        )
          ink++;
      }
    }
    if (!samples || ink / samples < 0.02) continue;
    // 没有图注、弱类融合或大幅插图需要更强的像素证据；只有短字加细框线的表单不能接管。
    if ((!caption || r.fused || area(b) > 0.5 * image.width * image.height) && ink / samples < 0.12)
      continue;
    let box = { ...b };
    let conflict = false;
    for (const l of lines) {
      if (l === caption || !overlap(l, b)) continue;
      if (lineShareIn(l, b) < 0.2) continue;
      const within =
        l.x >= b.x - 0.75 * h &&
        l.y >= b.y - 0.75 * h &&
        l.x + l.width <= b.x + b.width + 0.75 * h &&
        l.y + l.height <= b.y + b.height + 0.75 * h;
      if (!within) {
        conflict = true;
        break;
      }
      box = union(box, l);
    }
    // 不扩进图注，也不允许两个图争同一块内容。
    if (
      conflict ||
      (caption && box.y + box.height + 0.3 * h > caption.y) ||
      result.some((f) => overlap(f.box, box) > 0)
    )
      continue;
    result.push({ region: r, box, ...(caption ? { caption } : {}) });
  }
  return result;
}

export const figureOwns = (line: Box, figures: readonly WordFigure[]): boolean =>
  figures.some((f) => lineShareIn(line, f.box) >= 0.5);

/** 找线、无框表、条形码只看工作副本；原图仍用于字体测量和最终裁图。 */
export function figureWorkingImage(
  image: RgbaImage,
  figures: readonly WordFigure[],
  h: number,
): RgbaImage {
  if (!figures.length) return image;
  const data = image.data.slice();
  for (const f of figures) {
    const pad = 0.15 * h,
      x0 = Math.max(0, Math.floor(f.box.x - pad)),
      x1 = Math.min(image.width, Math.ceil(f.box.x + f.box.width + pad)),
      y0 = Math.max(0, Math.floor(f.box.y - pad)),
      y1 = Math.min(image.height, Math.ceil(f.box.y + f.box.height + pad));
    for (let y = y0; y < y1; y++)
      data.fill(255, (y * image.width + x0) * 4, (y * image.width + x1) * 4);
  }
  return { ...image, data };
}
