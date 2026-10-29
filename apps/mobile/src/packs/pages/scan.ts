import { packPage } from './common';

// 扫描包页面（T5）：OpenCV.js 4.7.0 + jscanify 1.4.3，都是经典 UMD 脚本，从 blob: 地址插入 <script>。
// OpenCV 的配置对象要在加载前放到 window.Module；不能 await cv（它是会无限循环的 thenable）。
// 找边在缩到 1000 像素的副本上做，候选的角坐标换算回原图，连同一张小灰度图交给 App 挑（D-300）；透视矫正在原图上做（App 已把原图缩到 1677 万像素以内）。

const SCRIPT = String.raw`
let scanner = null;
async function ready() {
  if (scanner) return scanner;
  const cvReady = new Promise((resolve) => { window.Module = { onRuntimeInitialized: resolve }; });
  await loadClassic(blobUrl(await need({ pack: 'scan', path: 'src/opencv.js' }, 'text')));
  await withTimeout(cvReady, 60000, 'OpenCV');
  await loadClassic(blobUrl(await need({ pack: 'scan', path: 'src/jscanify.js' }, 'text')));
  scanner = new jscanify();
  return scanner;
}
function canvasOf(img, maxSide) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, k };
}
// 找边的候选四边形（D-300）：jscanify 找到的最大轮廓，加上最大的亮区域（纸通常比背景亮：Otsu 二值、
// 闭运算后最大的外轮廓，凸包近似成四边形）。挑哪个由 App 决定（@morph/tool-image 的 pickPaper），
// 每个候选是四个点（顺序不定），坐标在 mat 上。
function paperCandidates(s, mat) {
  const out = [];
  const contour = s.findPaperContour(mat);
  const p = contour ? s.getCornerPoints(contour, mat) : null;
  if (contour) contour.delete();
  if (p && p.topLeftCorner && p.topRightCorner && p.bottomRightCorner && p.bottomLeftCorner) {
    out.push([p.topLeftCorner, p.topRightCorner, p.bottomRightCorner, p.bottomLeftCorner]);
  }
  const gray = new cv.Mat();
  const mask = new cv.Mat();
  const kernel = cv.Mat.ones(15, 15, cv.CV_8U);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const hull = new cv.Mat();
  const approx = new cv.Mat();
  try {
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.threshold(gray, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = null;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area > bestArea) {
        if (best) best.delete();
        best = c;
        bestArea = area;
      } else c.delete();
    }
    if (best) {
      cv.convexHull(best, hull);
      best.delete();
      const length = cv.arcLength(hull, true);
      for (const eps of [0.02, 0.03, 0.05]) {
        cv.approxPolyDP(hull, approx, eps * length, true);
        if (approx.rows === 4) {
          const d = approx.data32S;
          out.push([0, 1, 2, 3].map((j) => ({ x: d[2 * j], y: d[2 * j + 1] })));
          break;
        }
      }
    }
  } finally {
    for (const m of [gray, mask, kernel, contours, hierarchy, hull, approx]) m.delete();
  }
  return out;
}
// 给 App 判断候选用的小灰度图（长边 maxSide）。
function grayThumb(mat, maxSide) {
  const g = new cv.Mat();
  try {
    cv.cvtColor(mat, g, cv.COLOR_RGBA2GRAY);
    const k = Math.min(1, maxSide / Math.max(g.cols, g.rows));
    cv.resize(g, g, new cv.Size(Math.max(1, Math.round(g.cols * k)), Math.max(1, Math.round(g.rows * k))), 0, 0, cv.INTER_AREA);
    return { width: g.cols, height: g.rows, data: bytesToB64(g.data) };
  } finally {
    g.delete();
  }
}
handlers.detect = async ({ file, maxSide }) => {
  const s = await ready();
  const img = await loadImage(await need({ file }, 'bytes'));
  const { canvas, k } = canvasOf(img, maxSide || 1000);
  const mat = cv.imread(canvas);
  try {
    const back = (pt) => ({ x: pt.x / k, y: pt.y / k });
    const candidates = paperCandidates(s, mat).map((pts) => pts.map(back));
    return { width: img.naturalWidth, height: img.naturalHeight, candidates, gray: grayThumb(mat, 500) };
  } finally {
    mat.delete();
    canvas.width = canvas.height = 0;
  }
};
handlers.warp = async ({ file, quad, width, height, quality }) => {
  await ready();
  const img = await loadImage(await need({ file }, 'bytes'));
  const { canvas } = canvasOf(img, Math.max(img.naturalWidth, img.naturalHeight));
  const src = cv.imread(canvas);
  canvas.width = canvas.height = 0;
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [
    quad.tl.x, quad.tl.y, quad.tr.x, quad.tr.y, quad.br.x, quad.br.y, quad.bl.x, quad.bl.y,
  ]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  const m = cv.getPerspectiveTransform(from, to);
  const out = document.createElement('canvas');
  try {
    cv.warpPerspective(src, dst, m, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    cv.imshow(out, dst);
    return { width: out.width, height: out.height, data: out.toDataURL('image/jpeg', quality).split(',')[1] };
  } finally {
    for (const x of [src, dst, from, to, m]) x.delete();
    out.width = out.height = 0;
  }
};
handlers.ping = async () => ({ ok: true });
`;

export const SCAN_PAGE = packPage(SCRIPT);
