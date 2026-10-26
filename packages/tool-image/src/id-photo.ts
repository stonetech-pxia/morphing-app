// 证件照规格与冲印排版。规格只是默认值，用户可以在界面里修改；
// 各国要求会变，备注里写明了需要以官方最新要求为准的地方。

import type { Rect } from './geometry';

export interface LocalizedText {
  en: string;
  zh: string;
  fr: string;
}

export interface IdPhotoSpec {
  id: string;
  label: LocalizedText;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  /** 电子版上传的体积上限（KB）。 */
  maxKB?: number;
  note: LocalizedText;
}

const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

/** 常见证件照规格。像素按 300 dpi 换算，官方电子版规格另有规定的以官方为准。 */
export const ID_PHOTO_SPECS: readonly IdPhotoSpec[] = [
  {
    id: 'us-passport',
    label: {
      en: 'US passport / visa (2×2 in)',
      zh: '美国护照/签证（2×2 英寸）',
      fr: 'Passeport / visa américain (2×2 po)',
    },
    widthMm: 50.8,
    heightMm: 50.8,
    widthPx: 600,
    heightPx: 600,
    maxKB: 240,
    note: {
      en: 'White background; head 1–1⅜ in (25–35 mm) chin to crown. DS-160 upload: square JPEG, 600×600 to 1200×1200 px, ≤ 240 KB.',
      zh: '白色背景；下巴到头顶 25–35 毫米。DS-160 上传：正方形 JPEG，600×600 至 1200×1200 像素，不超过 240 KB。',
      fr: 'Fond blanc ; tête de 1 à 1⅜ po (25 à 35 mm), du menton au sommet du crâne. Téléversement DS-160 : JPEG carré, de 600×600 à 1200×1200 px, ≤ 240 Ko.',
    },
  },
  {
    id: 'cn-visa',
    label: {
      en: 'China visa (33×48 mm)',
      zh: '中国签证（33×48 毫米）',
      fr: 'Visa chinois (33×48 mm)',
    },
    widthMm: 33,
    heightMm: 48,
    widthPx: 390,
    heightPx: 567,
    note: {
      en: 'Printed photo, white background. Online applications use a different digital size (about 354×472 to 420×560 px, 40–120 KB); check the current official requirement.',
      zh: '纸质照片，白色背景。网上申请的电子照片尺寸不同（约 354×472 至 420×560 像素，40–120 KB），请以官方最新要求为准。',
      fr: 'Photo imprimée, fond blanc. Les demandes en ligne utilisent un format numérique différent (environ 354×472 à 420×560 px, 40 à 120 Ko) ; vérifiez l’exigence officielle actuelle.',
    },
  },
  {
    id: 'schengen',
    label: {
      en: 'Schengen / EU visa (35×45 mm)',
      zh: '申根/欧盟签证（35×45 毫米）',
      fr: 'Visa Schengen / UE (35×45 mm)',
    },
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    note: {
      en: 'Light plain background; face about 70–80% of the photo height. Some countries differ slightly.',
      zh: '浅色纯色背景；面部约占照片高度 70–80%。各国细则略有差异。',
      fr: 'Fond clair uni ; visage d’environ 70 à 80 % de la hauteur de la photo. Certains pays ont de légères différences.',
    },
  },
  {
    id: 'uk-passport',
    label: {
      en: 'UK passport (35×45 mm)',
      zh: '英国护照（35×45 毫米）',
      fr: 'Passeport britannique (35×45 mm)',
    },
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    note: {
      en: 'Printed photo, plain light grey or cream background. Online applications need a digital photo of at least 600×750 px.',
      zh: '纸质照片，浅灰或米色纯色背景。网上申请需要至少 600×750 像素的电子照片。',
      fr: 'Photo imprimée, fond gris clair ou crème uni. Les demandes en ligne nécessitent une photo numérique d’au moins 600×750 px.',
    },
  },
  {
    id: 'ca-passport',
    label: {
      en: 'Canada passport (50×70 mm)',
      zh: '加拿大护照（50×70 毫米）',
      fr: 'Passeport canadien (50×70 mm)',
    },
    widthMm: 50,
    heightMm: 70,
    widthPx: 591,
    heightPx: 827,
    note: {
      en: 'White or light background; head 31–36 mm chin to crown.',
      zh: '白色或浅色背景；下巴到头顶 31–36 毫米。',
      fr: 'Fond blanc ou clair ; tête de 31 à 36 mm, du menton au sommet du crâne.',
    },
  },
  {
    id: 'jp-passport',
    label: {
      en: 'Japan passport / visa (35×45 mm)',
      zh: '日本护照/签证（35×45 毫米）',
      fr: 'Passeport / visa japonais (35×45 mm)',
    },
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    note: {
      en: 'Plain background. Visa requirements vary by consulate; check before printing.',
      zh: '纯色背景。签证要求因领事馆而异，冲印前请确认。',
      fr: 'Fond uni. Les exigences des visas varient selon le consulat ; vérifiez avant l’impression.',
    },
  },
  {
    id: 'in-visa',
    label: { en: 'India visa (2×2 in)', zh: '印度签证（2×2 英寸）', fr: 'Visa indien (2×2 po)' },
    widthMm: 50.8,
    heightMm: 50.8,
    widthPx: 600,
    heightPx: 600,
    note: {
      en: 'White background. e-Visa upload: square JPEG; the file size limit has changed over time, check the official site.',
      zh: '白色背景。电子签证上传：正方形 JPEG；体积上限曾有调整，请以官网为准。',
      fr: 'Fond blanc. Téléversement e-Visa : JPEG carré ; la limite de taille du fichier a changé au fil du temps, consultez le site officiel.',
    },
  },
  {
    id: 'cn-1inch',
    label: { en: '1-inch (25×35 mm)', zh: '一寸（25×35 毫米）', fr: 'Format 1 pouce (25×35 mm)' },
    widthMm: 25,
    heightMm: 35,
    widthPx: 295,
    heightPx: 413,
    note: {
      en: 'Common in China for IDs, forms and resumes. Background colour depends on the use.',
      zh: '国内常用于证件、报名表、简历。背景颜色按用途要求。',
      fr: 'Courant en Chine pour les pièces d’identité, formulaires et CV. La couleur de fond dépend de l’usage.',
    },
  },
  {
    id: 'cn-2inch',
    label: { en: '2-inch (35×49 mm)', zh: '二寸（35×49 毫米）', fr: 'Format 2 pouces (35×49 mm)' },
    widthMm: 35,
    heightMm: 49,
    widthPx: 413,
    heightPx: 579,
    note: {
      en: 'Standard Chinese 2-inch. Some uses ask for "small 2-inch" (33×48 mm) or 35×53 mm instead.',
      zh: '标准二寸。部分用途要求小二寸（33×48 毫米）或 35×53 毫米。',
      fr: 'Format chinois standard de 2 pouces. Certains usages demandent le « petit 2 pouces » (33×48 mm) ou 35×53 mm.',
    },
  },
];

export interface PrintSheetOptions {
  sheet: { widthIn: number; heightIn: number };
  dpi: number;
  photo: { widthMm: number; heightMm: number };
  gapMm: number;
  marginMm: number;
  /** 输出贯穿整张相纸的裁切线，方便用裁纸刀。 */
  guides: boolean;
}

export interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PrintSheetLayout {
  width: number;
  height: number;
  /** 照片在相纸上的位置；rotated 时照片需旋转 90° 放入。 */
  placements: Rect[];
  rotated: boolean;
  guides: GuideLine[];
}

function fitCount(space: number, item: number, gap: number): number {
  return Math.max(0, Math.floor((space + gap) / (item + gap)));
}

/** 在相纸上排尽可能多的照片；照片横竖两种方向都试，取张数多的，整体居中。 */
export function layoutPrintSheet(options: PrintSheetOptions): PrintSheetLayout {
  const { sheet, dpi, photo, guides } = options;
  const width = Math.round(sheet.widthIn * dpi);
  const height = Math.round(sheet.heightIn * dpi);
  const gap = mmToPx(options.gapMm, dpi);
  const margin = mmToPx(options.marginMm, dpi);
  const pw = mmToPx(photo.widthMm, dpi);
  const ph = mmToPx(photo.heightMm, dpi);
  const grid = (w: number, h: number) => ({
    w,
    h,
    cols: fitCount(width - 2 * margin, w, gap),
    rows: fitCount(height - 2 * margin, h, gap),
  });
  const upright = grid(pw, ph);
  const turned = grid(ph, pw);
  const rotated = turned.cols * turned.rows > upright.cols * upright.rows;
  const { w, h, cols, rows } = rotated ? turned : upright;

  const blockW = cols * w + Math.max(0, cols - 1) * gap;
  const blockH = rows * h + Math.max(0, rows - 1) * gap;
  const left = Math.floor((width - blockW) / 2);
  const top = Math.floor((height - blockH) / 2);
  const placements: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      placements.push({ x: left + c * (w + gap), y: top + r * (h + gap), width: w, height: h });
    }
  }

  const lines: GuideLine[] = [];
  if (guides && placements.length > 0) {
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let c = 0; c < cols; c++) {
      xs.add(left + c * (w + gap));
      xs.add(left + c * (w + gap) + w);
    }
    for (let r = 0; r < rows; r++) {
      ys.add(top + r * (h + gap));
      ys.add(top + r * (h + gap) + h);
    }
    for (const x of xs) lines.push({ x1: x, y1: 0, x2: x, y2: height });
    for (const y of ys) lines.push({ x1: 0, y1: y, x2: width, y2: y });
  }
  return { width, height, placements, rotated, guides: lines };
}

// ---- 自动框脸（D-252）----

/** 头（下巴到头顶）占照片高度的比例：各规格要求的中间值；没写的规格用 DEFAULT_HEAD_RATIO。 */
export const HEAD_RATIO: Record<string, number> = {
  'us-passport': 0.6, // 25–35 mm / 50.8 mm
  'in-visa': 0.6,
  'cn-visa': 0.63, // 28–33 mm / 48 mm
  schengen: 0.75, // 32–36 mm / 45 mm
  'uk-passport': 0.7, // 29–34 mm / 45 mm
  'jp-passport': 0.75,
  'ca-passport': 0.48, // 31–36 mm / 70 mm
};
export const DEFAULT_HEAD_RATIO = 0.65;

/**
 * 人脸检测给的框（iOS Vision、ML Kit 都是）大约从眉毛到下巴，不含额头上方和头发：
 * 下巴到头顶约是框高的 1.45 倍。头顶上方留出的空白是上下空白合计的 40%。
 */
const HEAD_PER_FACE = 1.45;
const TOP_SHARE = 0.4;

/**
 * 按人脸框算出证件照的裁剪框（原图像素，宽高比 = 规格的宽高比）：头的高度占规格要求的比例，
 * 脸左右居中。照片不够大时整体缩小裁剪框（头会显得大一点），绝不超出原图。
 */
export function faceCrop(
  image: { width: number; height: number },
  face: Rect,
  aspect: number,
  headRatio: number,
): Rect {
  const head = face.height * HEAD_PER_FACE;
  const chin = face.y + face.height;
  let height = head / headRatio;
  let width = height * aspect;
  // 放不下时缩小，宽和高都不超过原图。
  const shrink = Math.min(1, image.width / width, image.height / height);
  width *= shrink;
  height *= shrink;
  const crown = chin - head;
  const spare = Math.max(0, height - head);
  let y = crown - spare * TOP_SHARE;
  let x = face.x + face.width / 2 - width / 2;
  x = Math.min(Math.max(0, x), image.width - width);
  y = Math.min(Math.max(0, y), image.height - height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** 几张脸时用最大的那张（证件照只有一个人；背景里的人脸通常小）。 */
export function mainFace(faces: readonly Rect[]): Rect | null {
  return faces.reduce<Rect | null>(
    (best, f) => (!best || f.width * f.height > best.width * best.height ? f : best),
    null,
  );
}
