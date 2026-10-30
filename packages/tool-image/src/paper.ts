import type { Size } from './geometry';
import { defaultQuad, quadArea, type Point, type Quad } from './quad';

// 从找边的候选四边形里挑出纸张（D-326）。候选里常有纸上的大框（表格外框）：
// 纸占满画面时纸边不是闭合的轮廓，最大的闭合轮廓就成了表格框。
// 规则：沿每条边在里面和外面各量一窄条的亮度（中位数）。外面不比里面暗多少（≥ 80%），说明纸越过这条边还在继续。
// 能量的边（贴着照片边缘、外面量不到的不算）有一半以上是这样的，这个候选是纸上的框，不要。剩下的挑最大的。
// 候选全被当成纸上的框时，纸多半占满了画面，给整张照片；本来就没有候选时给 null（四角界面用内缩的默认框）。

/** 灰度图（每像素一个字节），可以比原图小：按 size 等比换算坐标。 */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 在边外面、里面多远的地方量亮度（照片短边的比例）：躲开边线本身。 */
const BAND = [0.015, 0.025, 0.035];
/**
 * 外面的亮度不低于里面的这个比例，就算纸还在继续。纸上的阴影一般在 80% 以上，
 * 20 张实测照片里桌面（深色、木纹、书的背景）都在 60% 以下。
 */
const SAME_PAPER = 0.8;

type Side = 'border' | 'edge' | 'continues';

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1]!;
}

/** 一条边：外面量不到（贴着照片边缘）、是纸边（外面明显更暗）、还是纸在继续。 */
function sideOf(a: Point, b: Point, center: Point, gray: GrayImage, k: number): Side {
  const { width, height, data } = gray;
  const at = (x: number, y: number) => {
    const px = Math.round(x * k);
    const py = Math.round(y * k);
    return px >= 0 && py >= 0 && px < width && py < height ? data[py * width + px]! : null;
  };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let nx = (b.y - a.y) / len;
  let ny = -(b.x - a.x) / len;
  // 法线朝外（背向中心）。
  if ((center.x - (a.x + b.x) / 2) * nx + (center.y - (a.y + b.y) / 2) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const short = Math.min(width, height) / k;
  const inside: number[] = [];
  const outside: number[] = [];
  let total = 0;
  // 只量中间 80%，避开角上。
  for (let t = 0.1; t <= 0.9; t += 0.02) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const band of BAND) {
      const d = band * short;
      total++;
      const i = at(x - nx * d, y - ny * d);
      const o = at(x + nx * d, y + ny * d);
      if (i !== null) inside.push(i);
      if (o !== null) outside.push(o);
    }
  }
  if (outside.length * 2 <= total || inside.length === 0) return 'border';
  return median(outside) >= SAME_PAPER * median(inside) ? 'continues' : 'edge';
}

/** 纸上的框：能量的边有一半以上，纸越过它还在继续。 */
export function isFrameOnPaper(q: Quad, size: Size, gray: GrayImage): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  const center = {
    x: pts.reduce((s, p) => s + p.x, 0) / 4,
    y: pts.reduce((s, p) => s + p.y, 0) / 4,
  };
  const k = gray.width / size.width;
  const sides = pts.map((p, i) => sideOf(p, pts[(i + 1) % 4]!, center, gray, k));
  const measured = sides.filter((s) => s !== 'border').length;
  const continues = sides.filter((s) => s === 'continues').length;
  return measured > 0 && continues * 2 > measured;
}

/** 从候选（已经是凸的、够大的四边形）里挑纸张，见文件开头的规则。 */
export function pickPaper(candidates: readonly Quad[], size: Size, gray: GrayImage): Quad | null {
  const papers = candidates.filter((q) => !isFrameOnPaper(q, size, gray));
  if (papers.length === 0) return candidates.length > 0 ? defaultQuad(size, 0) : null;
  return papers.reduce((best, q) => (quadArea(q) > quadArea(best) ? q : best));
}
