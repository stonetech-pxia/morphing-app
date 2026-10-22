import { packPage } from './common';

// 扫描包页面（T5）：OpenCV.js 4.7.0 + jscanify 1.4.3，都是经典 UMD 脚本，从 blob: 地址插入 <script>。
// OpenCV 的配置对象要在加载前放到 window.Module；不能 await cv（它是会无限循环的 thenable）。
// 找边在缩到 1000 像素的副本上做，角坐标换算回原图；透视矫正在原图上做（App 已把原图缩到 1677 万像素以内）。

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
handlers.detect = async ({ file, maxSide }) => {
  const s = await ready();
  const img = await loadImage(await need({ file }, 'bytes'));
  const { canvas, k } = canvasOf(img, maxSide || 1000);
  const mat = cv.imread(canvas);
  let quad = null;
  try {
    const contour = s.findPaperContour(mat);
    const p = contour ? s.getCornerPoints(contour, mat) : null;
    if (contour) contour.delete();
    if (p && p.topLeftCorner && p.topRightCorner && p.bottomRightCorner && p.bottomLeftCorner) {
      const back = (pt) => ({ x: pt.x / k, y: pt.y / k });
      quad = {
        tl: back(p.topLeftCorner),
        tr: back(p.topRightCorner),
        br: back(p.bottomRightCorner),
        bl: back(p.bottomLeftCorner),
      };
    }
  } finally {
    mat.delete();
    canvas.width = canvas.height = 0;
  }
  return { width: img.naturalWidth, height: img.naturalHeight, quad };
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
