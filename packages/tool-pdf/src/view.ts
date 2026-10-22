import { type Degrees, type PDFPage, degrees } from 'pdf-lib';

// 页面的“用户视角”几何：PDF 页面可带 /Rotate，阅读器按顺时针旋转后显示。
// 这里统一用视图坐标（左下角为原点、y 向上，即用户看到的方向）排版，
// 再换算回 PDF 用户空间，使文字和图片在旋转过的页面上依然正着显示。

export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(angle: number): Rotation {
  return ((((Math.round(angle / 90) * 90) % 360) + 360) % 360) as Rotation;
}

export interface PageView {
  /** 用户看到的宽高（90° / 270° 时与 CropBox 宽高互换）。 */
  width: number;
  height: number;
  rotation: Rotation;
  /** 可见区域（CropBox，缺省为 MediaBox）。 */
  box: { x: number; y: number; width: number; height: number };
}

export function pageView(page: PDFPage): PageView {
  const box = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const swap = rotation === 90 || rotation === 270;
  return {
    width: swap ? box.height : box.width,
    height: swap ? box.width : box.height,
    rotation,
    box,
  };
}

/** 视图坐标 → PDF 用户空间坐标（即绕页面逆时针旋转 rotation 度再平移）。 */
export function toPdfPoint(view: PageView, p: number, q: number): { x: number; y: number } {
  const { x, y, width: w, height: h } = view.box;
  switch (view.rotation) {
    case 0:
      return { x: x + p, y: y + q };
    case 90:
      return { x: x + w - q, y: y + p };
    case 180:
      return { x: x + w - p, y: y + h - q };
    case 270:
      return { x: x + q, y: y + h - p };
  }
}

/**
 * 视图中的矩形（左下角 p, q，宽 w、高 h，绕中心逆时针转 angle 度）
 * → pdf-lib drawText / drawImage 需要的原点和旋转角。
 */
export function placeBox(
  view: PageView,
  rect: { p: number; q: number; w: number; h: number },
  angle = 0,
): { x: number; y: number; rotate: Degrees } {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  const origin = toPdfPoint(
    view,
    rect.p + hw - (cos * hw - sin * hh),
    rect.q + hh - (sin * hw + cos * hh),
  );
  return { ...origin, rotate: degrees(view.rotation + angle) };
}
