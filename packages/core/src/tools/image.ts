import { t, pairText } from '../messages';
import { z } from 'zod';

import { GIF_MAX_FRAMES } from '../media';
import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition, ParamField } from '../workflow/contract';

// 内置图片工具的清单。像素处理在 App 里由 expo-image-manipulator 完成，
// 纯算法（压到目标大小的搜索、尺寸计算、EXIF）在 packages/tool-image。

export const IMAGE_TOOL_ID = 'image';
export const IMAGE_PAGE_ID = 'tool-image';

export const IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;

const formatField: ParamField = {
  key: 'format',
  label: { en: 'Format', zh: '格式', fr: 'Format' },
  kind: 'choice',
  options: [
    { value: 'jpeg', label: { en: 'JPG', zh: 'JPG', fr: 'JPG' } },
    { value: 'png', label: { en: 'PNG', zh: 'PNG', fr: 'PNG' } },
    { value: 'webp', label: { en: 'WebP', zh: 'WebP', fr: 'WebP' } },
  ],
};

const qualityField: ParamField = {
  key: 'quality',
  label: { en: 'Quality', zh: '质量', fr: 'Qualité' },
  kind: 'number',
  unit: '%',
  min: 10,
  max: 100,
  step: 5,
  showIf: { key: 'format', equals: ['jpeg', 'webp'] },
};

const px = z.number().int().min(16).max(12000);

export const CROP_ASPECTS = [
  'free',
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
  '35:45',
  '33:48',
] as const;

/** 「35:45」→ 35/45；free → null。 */
export function aspectRatio(aspect: string): number | null {
  const m = /^(\d+):(\d+)$/.exec(aspect);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

const resizeModes = ['longEdge', 'width', 'height', 'percent', 'fit'] as const;

export const IMAGE_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'image.annotate',
    label: { en: 'Mark up photo', zh: '标注图片', fr: 'Annoter la photo' },
    description: {
      en: 'A local editor lets the user place text, arrows, outline boxes and freehand strokes on each photo, choose colors and undo. The user types text while running; annotation content never goes to AI. Saves flattened PNG copies; very large images may be reduced to fit the drawing limit. Original photos are kept.',
      zh: '运行时逐张在本机添加文字、箭头、方框和自由画笔，可选颜色、撤销。文字由用户运行时填写，标注内容不发给 AI。生成合成后的 PNG 副本；超大图片可能缩小以适应绘图上限。保留原图。',
      fr: 'Un éditeur en local permet d’ajouter du texte, des flèches, des cadres et des tracés libres sur chaque photo, de choisir les couleurs et d’annuler. Le texte est saisi par l’utilisateur pendant l’utilisation ; le contenu des annotations n’est jamais envoyé à l’IA. Enregistre des copies PNG aplaties ; les images très grandes peuvent être réduites pour respecter la limite de dessin. Les photos originales sont conservées.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({}),
    fields: [],
    presets: [{ id: 'mark', label: { en: 'Mark up', zh: '标注', fr: 'Annoter' }, values: {} }],
    local: 'annotate',
    requires: [],
  },

  {
    id: 'image.adjust',
    label: { en: 'Adjust photo', zh: '调整图片', fr: 'Ajuster la photo' },
    description: {
      en: 'Improve photos locally with automatic color adjustment or manual brightness (-100 to 100, neutral 0), contrast and saturation (0 to 200, neutral 100). Automatic results differ across iOS and Android. Keeps dimensions; PNG/WebP inputs become PNG to preserve transparency, other photos become JPG. No face retouching or generative edits.',
      zh: '在本机自动优化颜色，或手动调整亮度（-100 到 100，0 不变）、对比度和饱和度（0 到 200，100 不变）。两端自动效果有所不同。尺寸不变；PNG/WebP 输出 PNG 保留透明度，其他照片输出 JPG。不美颜或生成新内容。',
      fr: 'Améliorez les photos en local, par réglage automatique des couleurs ou réglage manuel : luminosité (-100 à 100, neutre 0), contraste et saturation (0 à 200, neutre 100). Les résultats automatiques diffèrent entre iOS et Android. Les dimensions sont conservées ; les fichiers PNG/WebP deviennent des PNG pour préserver la transparence, les autres photos deviennent des JPG. Pas de retouche du visage ni de modification générative.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      mode: z.enum(['auto', 'manual']),
      brightness: z.number().min(-100).max(100),
      contrast: z.number().min(0).max(200),
      saturation: z.number().min(0).max(200),
    }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Adjustment', zh: '调整方式', fr: 'Réglage' },
        kind: 'choice',
        options: [
          { value: 'auto', label: { en: 'Automatic', zh: '自动优化', fr: 'Automatique' } },
          { value: 'manual', label: { en: 'Manual', zh: '手动调整', fr: 'Manuel' } },
        ],
      },
      {
        key: 'brightness',
        label: { en: 'Brightness', zh: '亮度', fr: 'Luminosité' },
        kind: 'number',
        min: -100,
        max: 100,
        unit: '%',
        showIf: { key: 'mode', equals: ['manual'] },
      },
      {
        key: 'contrast',
        label: { en: 'Contrast', zh: '对比度', fr: 'Contraste' },
        kind: 'number',
        min: 0,
        max: 200,
        unit: '%',
        showIf: { key: 'mode', equals: ['manual'] },
      },
      {
        key: 'saturation',
        label: { en: 'Saturation', zh: '饱和度', fr: 'Saturation' },
        kind: 'number',
        min: 0,
        max: 200,
        unit: '%',
        showIf: { key: 'mode', equals: ['manual'] },
      },
    ],
    presets: [
      {
        id: 'auto',
        label: { en: 'Automatic', zh: '自动优化', fr: 'Automatique' },
        values: { mode: 'auto', brightness: 0, contrast: 100, saturation: 100 },
      },
      {
        id: 'brighten',
        label: { en: 'Brighter', zh: '调亮', fr: 'Plus clair' },
        values: { mode: 'manual', brightness: 15, contrast: 100, saturation: 100 },
      },
    ],
    requires: [],
  },

  {
    id: 'image.removeBackground',
    label: { en: 'Remove background', zh: '去背景', fr: 'Supprimer le fond' },
    description: {
      en: 'Keep the main subjects and remove the background locally, producing PNG with transparency or a solid color. Requires iOS 17+ or Android Google Play services (first use downloads a model). Fine hair, transparent objects and unclear subjects may need another editor. Does not guarantee an official ID photo.',
      zh: '在本机保留主要主体、去掉背景，输出透明或纯色背景 PNG。需要 iOS 17+ 或 Android Google Play 服务（首次下载模型）。发丝、透明物体或主体不清晰时可能需要其他编辑器；不保证符合证件照要求。',
      fr: 'Garde les sujets principaux et supprime le fond en local ; sortie en PNG transparent ou sur couleur unie. Nécessite iOS 17+ ou les services Google Play sur Android (le premier usage télécharge un modèle). Les cheveux fins, les objets transparents ou les sujets peu nets peuvent nécessiter un autre éditeur. Ne garantit pas une photo d’identité officielle.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      background: z.enum(['transparent', 'color']),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    fields: [
      {
        key: 'background',
        label: { en: 'Background', zh: '背景', fr: 'Fond' },
        kind: 'choice',
        options: [
          { value: 'transparent', label: { en: 'Transparent', zh: '透明', fr: 'Transparent' } },
          { value: 'color', label: { en: 'Solid color', zh: '纯色', fr: 'Couleur unie' } },
        ],
      },
      {
        key: 'color',
        label: { en: 'Color', zh: '颜色', fr: 'Couleur' },
        kind: 'color',
        showIf: { key: 'background', equals: ['color'] },
      },
    ],
    presets: [
      {
        id: 'transparent',
        label: { en: 'Transparent', zh: '透明', fr: 'Transparent' },
        values: { background: 'transparent', color: '#FFFFFF' },
      },
      {
        id: 'white',
        label: { en: 'White', zh: '白底', fr: 'Blanc' },
        values: { background: 'color', color: '#FFFFFF' },
      },
    ],
    requires: [],
  },
  {
    id: 'image.convert',
    label: { en: 'Convert format', zh: '转格式', fr: 'Convertir le format' },
    description: {
      en: 'Convert HEIC, PNG or WebP photos to JPG, PNG or WebP. Never outputs HEIC. Removes location and other photo info.',
      zh: '把 HEIC、PNG、WebP 转成 JPG、PNG 或 WebP，不会输出 HEIC。会去掉位置等照片信息。',
      fr: 'Convertit les photos HEIC, PNG ou WebP en JPG, PNG ou WebP. Ne produit jamais de HEIC. Supprime la localisation et les autres informations de la photo.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      format: z.enum(IMAGE_FORMATS),
      quality: z.number().int().min(10).max(100),
    }),
    fields: [formatField, qualityField],
    presets: [
      {
        id: 'jpg',
        label: { en: 'JPG', zh: 'JPG', fr: 'JPG' },
        values: { format: 'jpeg', quality: 85 },
      },
      {
        id: 'png',
        label: { en: 'PNG', zh: 'PNG', fr: 'PNG' },
        values: { format: 'png', quality: 100 },
      },
      {
        id: 'webp',
        label: { en: 'WebP', zh: 'WebP', fr: 'WebP' },
        values: { format: 'webp', quality: 80 },
      },
    ],
    requires: [],
  },
  {
    id: 'image.resize',
    label: { en: 'Resize', zh: '改尺寸', fr: 'Redimensionner' },
    description: {
      en: 'Make images smaller by long edge, width, height, percent or to fit a box. Never crops and never enlarges.',
      zh: '按长边、宽、高、百分比或「放进一个框」缩小图片。不裁剪，也不放大。',
      fr: 'Réduit les images selon le grand côté, la largeur, la hauteur, un pourcentage ou pour les faire tenir dans un cadre. Ne recadre pas et n’agrandit jamais.',
    },
    input: ['images'],
    output: 'images',
    params: z
      .strictObject({
        mode: z.enum(resizeModes),
        px: px.optional(),
        width: px.optional(),
        height: px.optional(),
        percent: z.number().int().min(1).max(100).optional(),
      })
      .refine(
        (p) =>
          p.mode === 'percent'
            ? p.percent !== undefined
            : p.mode === 'fit'
              ? p.width !== undefined && p.height !== undefined
              : p.px !== undefined,
        { message: 'the size for this mode is missing' },
      ),
    fields: [
      {
        key: 'mode',
        label: { en: 'By', zh: '方式', fr: 'Méthode' },
        kind: 'choice',
        options: [
          { value: 'longEdge', label: { en: 'Long edge', zh: '长边', fr: 'Grand côté' } },
          { value: 'width', label: { en: 'Width', zh: '宽度', fr: 'Largeur' } },
          { value: 'height', label: { en: 'Height', zh: '高度', fr: 'Hauteur' } },
          { value: 'percent', label: { en: 'Percent', zh: '百分比', fr: 'Pourcentage' } },
          { value: 'fit', label: { en: 'Fit in box', zh: '放进框里', fr: 'Dans un cadre' } },
        ],
      },
      {
        key: 'px',
        label: { en: 'Pixels', zh: '像素', fr: 'Pixels' },
        kind: 'number',
        unit: 'px',
        min: 16,
        max: 12000,
        showIf: { key: 'mode', equals: ['longEdge', 'width', 'height'] },
      },
      {
        key: 'width',
        label: { en: 'Max width', zh: '最大宽度', fr: 'Largeur max.' },
        kind: 'number',
        unit: 'px',
        min: 16,
        max: 12000,
        showIf: { key: 'mode', equals: ['fit'] },
      },
      {
        key: 'height',
        label: { en: 'Max height', zh: '最大高度', fr: 'Hauteur max.' },
        kind: 'number',
        unit: 'px',
        min: 16,
        max: 12000,
        showIf: { key: 'mode', equals: ['fit'] },
      },
      {
        key: 'percent',
        label: { en: 'Percent', zh: '百分比', fr: 'Pourcentage' },
        kind: 'number',
        unit: '%',
        min: 1,
        max: 100,
        showIf: { key: 'mode', equals: ['percent'] },
      },
    ],
    presets: [
      {
        id: 'long-2048',
        label: { en: 'Long edge 2048', zh: '长边 2048', fr: 'Grand côté 2048' },
        values: { mode: 'longEdge', px: 2048 },
      },
      {
        id: 'long-1600',
        label: { en: 'Long edge 1600', zh: '长边 1600', fr: 'Grand côté 1600' },
        values: { mode: 'longEdge', px: 1600 },
      },
      {
        id: 'width-1080',
        label: { en: 'Width 1080', zh: '宽 1080', fr: 'Largeur 1080' },
        values: { mode: 'width', px: 1080 },
      },
      {
        id: 'half',
        label: { en: '50%', zh: '50%', fr: '50%' },
        values: { mode: 'percent', percent: 50 },
      },
      {
        id: 'box-600',
        label: { en: 'Fit 600×600', zh: '600×600 以内', fr: 'Dans 600×600' },
        values: { mode: 'fit', width: 600, height: 600 },
      },
    ],
    requires: [],
  },
  {
    id: 'image.compress',
    label: { en: 'Compress to size', zh: '压到指定大小', fr: 'Compresser à une taille' },
    description: {
      en: 'Make each image at most the given size (KB) by lowering quality first, then size. Output is JPG or WebP.',
      zh: '让每张图片不超过指定大小（KB）：先降质量，不够再缩小尺寸。输出 JPG 或 WebP。',
      fr: 'Limite chaque image à la taille indiquée (Ko) : baisse d’abord la qualité, puis réduit les dimensions si nécessaire. Format de sortie : JPG ou WebP.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      maxKB: z.number().int().min(10).max(50000),
      format: z.enum(['jpeg', 'webp']),
    }),
    fields: [
      {
        key: 'maxKB',
        label: { en: 'At most', zh: '不超过', fr: 'Au plus' },
        kind: 'number',
        unit: 'KB',
        min: 10,
        max: 50000,
        step: 10,
      },
      {
        key: 'format',
        label: { en: 'Format', zh: '格式', fr: 'Format' },
        kind: 'choice',
        options: [
          { value: 'jpeg', label: { en: 'JPG', zh: 'JPG', fr: 'JPG' } },
          { value: 'webp', label: { en: 'WebP', zh: 'WebP', fr: 'WebP' } },
        ],
      },
    ],
    presets: [
      {
        id: 'kb-240',
        label: { en: '240 KB', zh: '240 KB', fr: '240 KB' },
        values: { maxKB: 240, format: 'jpeg' },
      },
      {
        id: 'kb-500',
        label: { en: '500 KB', zh: '500 KB', fr: '500 KB' },
        values: { maxKB: 500, format: 'jpeg' },
      },
      {
        id: 'mb-1',
        label: { en: '1 MB', zh: '1 MB', fr: '1 MB' },
        values: { maxKB: 1024, format: 'jpeg' },
      },
      {
        id: 'mb-2',
        label: { en: '2 MB', zh: '2 MB', fr: '2 MB' },
        values: { maxKB: 2048, format: 'jpeg' },
      },
    ],
    requires: [],
  },
  {
    id: 'image.crop',
    label: { en: 'Crop', zh: '裁剪', fr: 'Recadrer' },
    description: {
      en: 'The user frames each image on the device; the ratio can be locked (1:1, 4:3, 35:45 passport…).',
      zh: '用户在手机上逐张框选，可以锁定比例（1:1、4:3、35:45 证件照…）。',
      fr: 'L’utilisateur cadre chaque image sur l’appareil ; le ratio peut être verrouillé (1:1, 4:3, 35:45 pour photo d’identité…).',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ aspect: z.enum(CROP_ASPECTS) }),
    fields: [
      {
        key: 'aspect',
        label: { en: 'Ratio', zh: '比例', fr: 'Ratio' },
        kind: 'choice',
        options: CROP_ASPECTS.map((a) => ({
          value: a,
          label: a === 'free' ? { en: 'Free', zh: '自由', fr: 'Libre' } : { en: a, zh: a, fr: a },
        })),
      },
    ],
    local: 'crop',
    requires: [],
  },
  {
    id: 'image.rotate',
    label: { en: 'Rotate or flip', zh: '旋转 / 翻转', fr: 'Rotation / miroir' },
    description: {
      en: 'Rotate clockwise and/or flip every image.',
      zh: '把每张图片顺时针旋转和 / 或翻转。',
      fr: 'Faire pivoter chaque image dans le sens horaire et/ou la retourner.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      angle: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      flip: z.enum(['none', 'horizontal', 'vertical']),
    }),
    fields: [
      {
        key: 'angle',
        label: { en: 'Rotate', zh: '旋转', fr: 'Rotation' },
        kind: 'choice',
        options: [
          { value: 0, label: { en: 'No', zh: '不转', fr: 'Non' } },
          { value: 90, label: { en: '90° right', zh: '右转 90°', fr: '90° à droite' } },
          { value: 180, label: { en: '180°', zh: '180°', fr: '180°' } },
          { value: 270, label: { en: '90° left', zh: '左转 90°', fr: '90° à gauche' } },
        ],
      },
      {
        key: 'flip',
        label: { en: 'Flip', zh: '翻转', fr: 'Retourner' },
        kind: 'choice',
        options: [
          { value: 'none', label: { en: 'No', zh: '不翻转', fr: 'Non' } },
          { value: 'horizontal', label: { en: 'Mirror', zh: '左右翻转', fr: 'Gauche-droite' } },
          { value: 'vertical', label: { en: 'Upside down', zh: '上下翻转', fr: 'Haut-bas' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'image.stripMetadata',
    label: {
      en: 'Remove location & info',
      zh: '去掉定位等信息',
      fr: 'Supprimer position et infos',
    },
    description: {
      en: 'Remove location, camera and other hidden info. JPGs keep their exact pixels; other formats become JPG.',
      zh: '去掉位置、相机型号等隐藏信息。JPG 画质不变；其他格式转成 JPG。',
      fr: 'Supprimer la position, l’appareil photo et les autres informations cachées. Les JPG gardent exactement leurs pixels ; les autres formats sont convertis en JPG.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
];

/** 证件照规格（像素和备注在 packages/tool-image 的 ID_PHOTO_SPECS，App 测试检查两边一致）。 */
export const ID_PHOTO_CHOICES = [
  {
    id: 'us-passport',
    label: {
      en: 'US passport / visa 2×2 in',
      zh: '美国护照/签证 2×2 英寸',
      fr: 'Passeport / visa américain 2×2 po',
    },
    maxKB: 240,
  },
  {
    id: 'cn-visa',
    label: { en: 'China visa 33×48 mm', zh: '中国签证 33×48 毫米', fr: 'Visa chinois 33×48 mm' },
  },
  {
    id: 'schengen',
    label: {
      en: 'Schengen / EU visa 35×45 mm',
      zh: '申根/欧盟签证 35×45 毫米',
      fr: 'Visa Schengen / UE 35×45 mm',
    },
  },
  {
    id: 'uk-passport',
    label: {
      en: 'UK passport 35×45 mm',
      zh: '英国护照 35×45 毫米',
      fr: 'Passeport britannique 35×45 mm',
    },
  },
  {
    id: 'ca-passport',
    label: {
      en: 'Canada passport 50×70 mm',
      zh: '加拿大护照 50×70 毫米',
      fr: 'Passeport canadien 50×70 mm',
    },
  },
  {
    id: 'jp-passport',
    label: {
      en: 'Japan passport / visa 35×45 mm',
      zh: '日本护照/签证 35×45 毫米',
      fr: 'Passeport / visa japonais 35×45 mm',
    },
  },
  {
    id: 'in-visa',
    label: { en: 'India visa 2×2 in', zh: '印度签证 2×2 英寸', fr: 'Visa indien 2×2 po' },
  },
  {
    id: 'cn-1inch',
    label: { en: '1-inch 25×35 mm', zh: '一寸 25×35 毫米', fr: '1 pouce 25×35 mm' },
  },
  {
    id: 'cn-2inch',
    label: { en: '2-inch 35×49 mm', zh: '二寸 35×49 毫米', fr: '2 pouces 35×49 mm' },
  },
] as const;
const ID_PHOTO_IDS = ID_PHOTO_CHOICES.map((c) => c.id) as [string, ...string[]];

/** 冲印相纸（英寸）。 */
export const PRINT_SHEETS = ['4x6', '5x7', 'a4', 'letter'] as const;

const backgroundField: ParamField = {
  key: 'background',
  label: { en: 'Background', zh: '底色', fr: 'Fond' },
  kind: 'choice',
  options: [
    { value: '#FFFFFF', label: { en: 'White', zh: '白', fr: 'Blanc' } },
    { value: '#000000', label: { en: 'Black', zh: '黑', fr: 'Noir' } },
  ],
};

const gapField: ParamField = {
  key: 'gapPx',
  label: { en: 'Gap', zh: '间距', fr: 'Espace' },
  kind: 'number',
  unit: 'px',
  min: 0,
  max: 80,
};

export const WATERMARK_COLORS = ['#FFFFFF', '#000000', '#868E96', '#C92A2A'] as const;
const WATERMARK_CORNERS = ['bottomRight', 'bottomLeft', 'topRight', 'topLeft', 'center'] as const;

/** T6：拼图、打码、水印、证件照（Skia 在 App 里绘制，排版计算在 packages/tool-image）。 */
export const IMAGE_COMPOSE_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'image.stitch',
    label: { en: 'Stitch into a long image', zh: '拼长图', fr: 'Assembler en image longue' },
    description: {
      en: 'Join the images top to bottom (or side by side) into one long image, e.g. several screenshots. Very long results are split into parts.',
      zh: '把图片从上到下（或从左到右）拼成一张长图，例如几张截图。太长时分成几张。',
      fr: 'Assembler les images de haut en bas (ou côte à côte) en une seule image longue, par exemple plusieurs captures d’écran. Les résultats très longs sont découpés en plusieurs parties.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      direction: z.enum(['vertical', 'horizontal']),
      gapPx: z.number().int().min(0).max(80),
      background: z.enum(['#FFFFFF', '#000000']),
    }),
    fields: [
      {
        key: 'direction',
        label: { en: 'Direction', zh: '方向', fr: 'Sens' },
        kind: 'choice',
        options: [
          {
            value: 'vertical',
            label: { en: 'Top to bottom', zh: '从上到下', fr: 'De haut en bas' },
          },
          { value: 'horizontal', label: { en: 'Side by side', zh: '从左到右', fr: 'Côte à côte' } },
        ],
      },
      gapField,
      backgroundField,
    ],
    presets: [
      {
        id: 'vertical',
        label: { en: 'Top to bottom', zh: '从上到下', fr: 'De haut en bas' },
        values: { direction: 'vertical', gapPx: 0, background: '#FFFFFF' },
      },
    ],
    requires: [],
  },
  {
    // D-184：iOS 用系统 ImageIO 写 GIF，Android 用 morph-media 里自己写的编码器（GifEncoder.kt）。
    id: 'image.toGif',
    label: { en: 'Make an animated GIF', zh: '做成动图', fr: 'Créer un GIF animé' },
    description: {
      en: `Turn the images (at most ${GIF_MAX_FRAMES}, in their current order) into one animated GIF that loops, each image shown for the chosen time. Images are fitted into the size of the first one.`,
      fr: `Assemblez les images (au maximum ${GIF_MAX_FRAMES}, dans leur ordre actuel) en un GIF animé en boucle. Chaque image reste affichée pendant la durée choisie. Les images sont ajustées aux dimensions de la première.`,
      zh: `把这些图片（最多 ${GIF_MAX_FRAMES} 张，按现在的顺序）做成一张循环播放的动图 GIF，每张停留选定的时间。图片按第一张的尺寸摆放。`,
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      delayMs: z.number().int().min(100).max(5000),
      maxSide: z.number().int().min(160).max(1200),
    }),
    fields: [
      {
        key: 'delayMs',
        label: { en: 'Each image', zh: '每张停留', fr: 'Durée par image' },
        kind: 'choice',
        options: [
          { value: 200, label: { en: '0.2 s (fast)', zh: '0.2 秒（快）', fr: '0,2 s (rapide)' } },
          { value: 500, label: { en: '0.5 s', zh: '0.5 秒', fr: '0,5 s' } },
          { value: 1000, label: { en: '1 s', zh: '1 秒', fr: '1 s' } },
          { value: 2000, label: { en: '2 s (slow)', zh: '2 秒（慢）', fr: '2 s (lent)' } },
        ],
      },
      {
        key: 'maxSide',
        label: { en: 'Size', zh: '尺寸', fr: 'Taille' },
        kind: 'choice',
        options: [
          {
            value: 320,
            label: { en: '320 px (small)', zh: '320 像素（小）', fr: '320 px (petit)' },
          },
          { value: 480, label: { en: '480 px', zh: '480 像素', fr: '480 px' } },
          {
            value: 800,
            label: { en: '800 px (sharp)', zh: '800 像素（清楚）', fr: '800 px (net)' },
          },
        ],
      },
    ],
    presets: [
      {
        id: 'half',
        label: { en: '0.5 s', zh: '0.5 秒', fr: '0,5 s' },
        values: { delayMs: 500, maxSide: 480 },
      },
      {
        id: 'one',
        label: { en: '1 s', zh: '1 秒', fr: '1 s' },
        values: { delayMs: 1000, maxSide: 480 },
      },
    ],
    requires: [],
  },
  {
    id: 'image.grid',
    label: { en: 'Photo grid', zh: '拼宫格', fr: 'Collage en grille' },
    description: {
      en: 'Arrange the images in a grid (2–4 columns, same-size cells, centered crop) as one image.',
      zh: '把图片排成宫格（2–4 列，格子一样大，居中裁切），拼成一张图。',
      fr: 'Disposer les images en grille (2 à 4 colonnes, cellules de même taille, recadrage centré) en une seule image.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      columns: z.number().int().min(2).max(4),
      cell: z.enum(['1:1', '3:4', '4:3']),
      gapPx: z.number().int().min(0).max(80),
      background: z.enum(['#FFFFFF', '#000000']),
    }),
    fields: [
      {
        key: 'columns',
        label: { en: 'Columns', zh: '列数', fr: 'Colonnes' },
        kind: 'choice',
        options: [
          { value: 2, label: { en: '2', zh: '2', fr: '2' } },
          { value: 3, label: { en: '3', zh: '3', fr: '3' } },
          { value: 4, label: { en: '4', zh: '4', fr: '4' } },
        ],
      },
      {
        key: 'cell',
        label: { en: 'Cell shape', zh: '格子形状', fr: 'Forme des cellules' },
        kind: 'choice',
        options: [
          { value: '1:1', label: { en: 'Square', zh: '正方形', fr: 'Carré' } },
          { value: '3:4', label: { en: 'Portrait 3:4', zh: '竖 3:4', fr: 'Portrait 3:4' } },
          { value: '4:3', label: { en: 'Landscape 4:3', zh: '横 4:3', fr: 'Paysage 4:3' } },
        ],
      },
      gapField,
      backgroundField,
    ],
    presets: [
      {
        id: 'nine',
        label: { en: '3 columns', zh: '九宫格', fr: '3 colonnes' },
        values: { columns: 3, cell: '1:1', gapPx: 8, background: '#FFFFFF' },
      },
      {
        id: 'two',
        label: { en: '2 columns', zh: '两列', fr: '2 colonnes' },
        values: { columns: 2, cell: '1:1', gapPx: 8, background: '#FFFFFF' },
      },
    ],
    requires: [],
  },
  {
    id: 'image.redact',
    label: { en: 'Hide parts', zh: '打码', fr: 'Masquer des zones' },
    description: {
      en: 'The user draws boxes over private parts (names, numbers, faces); they are blurred or blacked out.',
      zh: '用户在图片上框出隐私部分（姓名、号码、人脸），把它们模糊或涂黑。',
      fr: 'L’utilisateur trace des cadres sur les éléments privés (noms, numéros, visages) ; ils sont floutés ou masqués en noir.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ style: z.enum(['blur', 'black']) }),
    fields: [
      {
        key: 'style',
        label: { en: 'Style', zh: '方式', fr: 'Style' },
        kind: 'choice',
        options: [
          { value: 'blur', label: { en: 'Blur', zh: '模糊', fr: 'Flou' } },
          { value: 'black', label: { en: 'Black box', zh: '黑块', fr: 'Bloc noir' } },
        ],
      },
    ],
    presets: [
      {
        id: 'black',
        label: { en: 'Black box', zh: '黑块', fr: 'Bloc noir' },
        values: { style: 'black' },
      },
    ],
    local: 'redact',
    requires: [],
  },
  {
    id: 'image.watermark',
    label: { en: 'Text watermark', zh: '文字水印', fr: 'Filigrane texte' },
    description: {
      en: 'Put a line of text on the images, in a corner or repeated across (e.g. "For visa application only").',
      zh: '在图片上加一行字，放在角落或铺满整张（例如「仅供签证使用」）。',
      fr: 'Ajouter une ligne de texte sur les images, dans un coin ou répétée sur toute la surface (par exemple « Usage réservé à la demande de visa »).',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      text: z.string().trim().min(1).max(60),
      mode: z.enum(['corner', 'tile']),
      corner: z.enum(WATERMARK_CORNERS),
      sizePercent: z.number().int().min(5).max(80),
      opacity: z.number().int().min(10).max(100),
      color: z.enum(WATERMARK_COLORS),
    }),
    fields: [
      { key: 'text', label: { en: 'Text', zh: '文字', fr: 'Texte' }, kind: 'text', private: true },
      {
        key: 'mode',
        label: { en: 'Placement', zh: '摆放', fr: 'Placement' },
        kind: 'choice',
        options: [
          { value: 'tile', label: { en: 'Across the image', zh: '铺满', fr: 'Sur toute l’image' } },
          { value: 'corner', label: { en: 'One corner', zh: '角落', fr: 'Un coin' } },
        ],
      },
      {
        key: 'corner',
        label: { en: 'Where', zh: '位置', fr: 'Position' },
        kind: 'choice',
        options: [
          { value: 'bottomRight', label: { en: 'Bottom right', zh: '右下', fr: 'Bas droite' } },
          { value: 'bottomLeft', label: { en: 'Bottom left', zh: '左下', fr: 'Bas gauche' } },
          { value: 'topRight', label: { en: 'Top right', zh: '右上', fr: 'Haut droite' } },
          { value: 'topLeft', label: { en: 'Top left', zh: '左上', fr: 'Haut gauche' } },
          { value: 'center', label: { en: 'Center', zh: '正中', fr: 'Centre' } },
        ],
        showIf: { key: 'mode', equals: ['corner'] },
      },
      {
        key: 'sizePercent',
        label: {
          en: 'Width (share of the short side)',
          zh: '宽度（占短边）',
          fr: 'Largeur (part du petit côté)',
        },
        kind: 'number',
        unit: '%',
        min: 5,
        max: 80,
      },
      {
        key: 'opacity',
        label: { en: 'Opacity', zh: '不透明度', fr: 'Opacité' },
        kind: 'number',
        unit: '%',
        min: 10,
        max: 100,
      },
      {
        key: 'color',
        label: { en: 'Color', zh: '颜色', fr: 'Couleur' },
        kind: 'choice',
        options: [
          { value: '#FFFFFF', label: { en: 'White', zh: '白', fr: 'Blanc' } },
          { value: '#000000', label: { en: 'Black', zh: '黑', fr: 'Noir' } },
          { value: '#868E96', label: { en: 'Gray', zh: '灰', fr: 'Gris' } },
          { value: '#C92A2A', label: { en: 'Red', zh: '红', fr: 'Rouge' } },
        ],
      },
    ],
    presets: [
      {
        id: 'tile',
        label: { en: 'Across the image', zh: '铺满', fr: 'Sur toute l’image' },
        values: {
          text: 'COPY',
          mode: 'tile',
          corner: 'bottomRight',
          sizePercent: 30,
          opacity: 35,
          color: '#868E96',
        },
      },
    ],
    requires: [],
  },
  {
    id: 'image.idPhoto',
    label: { en: 'ID photo', zh: '证件照', fr: 'Photo d’identité' },
    description: {
      en: 'The user frames the face at the required shape; the photo is cut to the official size in pixels (300 dpi) as a JPG, and kept under the size limit if the spec has one. Check the background and head size yourself.',
      zh: '用户按规格比例框选，照片裁成官方像素尺寸（300 dpi）的 JPG；规格有大小上限时压到上限以内。背景和头部比例需要自己检查。',
      fr: 'L’utilisateur cadre le visage selon la forme requise ; la photo est recadrée à la taille officielle en pixels (300 dpi) au format JPG, et réduite sous la limite de taille si la norme en impose une. Vérifiez vous-même le fond et la taille de la tête.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      spec: z.enum(ID_PHOTO_IDS),
      maxKB: z.number().int().min(0).max(5000),
    }),
    fields: [
      {
        key: 'spec',
        label: { en: 'Size', zh: '规格', fr: 'Taille' },
        kind: 'choice',
        options: ID_PHOTO_CHOICES.map((c) => ({ value: c.id, label: c.label })),
      },
      {
        key: 'maxKB',
        label: {
          en: 'At most (0 = no limit)',
          zh: '不超过（0 表示不限）',
          fr: 'Au maximum (0 = illimité)',
        },
        kind: 'number',
        unit: 'KB',
        min: 0,
        max: 5000,
      },
    ],
    presets: ID_PHOTO_CHOICES.map((c) => ({
      id: c.id,
      label: c.label,
      values: { spec: c.id, maxKB: 'maxKB' in c ? c.maxKB : 0 },
    })),
    local: 'crop',
    requires: [],
  },
  {
    id: 'image.printSheet',
    label: { en: 'Arrange on photo paper', zh: '排到相纸上', fr: 'Disposer sur papier photo' },
    description: {
      en: 'Repeat each ID photo on a sheet of photo paper (4×6 in etc.) with cut lines, ready to print at a photo shop. Photos are measured at 300 dpi, so use the ID photo step first.',
      zh: '把证件照重复排到一张相纸上（4×6 英寸等），带裁切线，可以拿去冲印。照片按 300 dpi 计算尺寸，所以先用「证件照」步骤。',
      fr: 'Répétez chaque photo d’identité sur une feuille de papier photo (4×6 po, etc.) avec des lignes de coupe, prête à être imprimée en laboratoire photo. Les photos sont mesurées à 300 dpi, utilisez donc d’abord l’étape « Photo d’identité ».',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ sheet: z.enum(PRINT_SHEETS), guides: z.boolean() }),
    fields: [
      {
        key: 'sheet',
        label: { en: 'Paper', zh: '相纸', fr: 'Papier' },
        kind: 'choice',
        options: [
          { value: '4x6', label: { en: '4×6 in', zh: '4×6 英寸（6 寸）', fr: '4×6 po' } },
          { value: '5x7', label: { en: '5×7 in', zh: '5×7 英寸（7 寸）', fr: '5×7 po' } },
          { value: 'a4', label: { en: 'A4', zh: 'A4', fr: 'A4' } },
          { value: 'letter', label: { en: 'Letter', zh: 'Letter', fr: 'Letter' } },
        ],
      },
      {
        key: 'guides',
        label: { en: 'Cut lines', zh: '裁切线', fr: 'Lignes de coupe' },
        kind: 'toggle',
      },
    ],
    presets: [
      {
        id: '4x6',
        label: { en: '4×6 in', zh: '6 寸', fr: '4×6 po' },
        values: { sheet: '4x6', guides: true },
      },
    ],
    requires: [],
  },
];

/** 单功能工作流：选照片 + 这一个动作（D-061）。 */
function single(
  locale: Locale,
  action: string,
  name: [string, string],
  params: Record<string, unknown>,
  ask: string[],
  pick: { min: number; max: number } = { min: 1, max: 30 },
): Workflow {
  const id = `image-${action.split('.')[1]!.toLowerCase()}`;
  return {
    id,
    toolId: IMAGE_TOOL_ID,
    name: pairText(locale, name),
    steps: [
      { id: 'pick', action: 'in.photos', params: { source: 'library', ...pick } },
      { id: 'run', action, params, ...(ask.length ? { ask } : {}) },
    ],
  };
}

export function imageWorkflows(locale: Locale): Workflow[] {
  return [
    single(locale, 'image.annotate', ['Mark up photo', '标注图片'], {}, []),
    single(
      locale,
      'image.adjust',
      ['Adjust photo', '调整图片'],
      { mode: 'auto', brightness: 0, contrast: 100, saturation: 100 },
      ['mode', 'brightness', 'contrast', 'saturation'],
    ),
    single(
      locale,
      'image.removeBackground',
      ['Remove background', '去背景'],
      { background: 'transparent', color: '#FFFFFF' },
      ['background', 'color'],
    ),
    single(
      locale,
      'image.compress',
      ['Compress photos', '压缩图片'],
      { maxKB: 500, format: 'jpeg' },
      ['maxKB'],
    ),
    single(locale, 'image.convert', ['Convert format', '转格式'], { format: 'jpeg', quality: 85 }, [
      'format',
    ]),
    // D-184：iPhone 照片（HEIC）转 JPG。功能和「转格式」一样，单独一个名字好找；每次问从相册还是「文件」选。
    {
      id: 'image-heic',
      toolId: IMAGE_TOOL_ID,
      name: t(locale, 'image_HEIC_to_JPG_64d8f'),
      steps: [
        {
          id: 'pick',
          action: 'in.photos',
          params: { source: 'library', min: 1, max: 30 },
          ask: ['source'],
        },
        { id: 'run', action: 'image.convert', params: { format: 'jpeg', quality: 90 } },
      ],
    },
    single(locale, 'image.resize', ['Resize', '改尺寸'], { mode: 'longEdge', px: 2048 }, [
      'mode',
      'px',
      'width',
      'height',
      'percent',
    ]),
    single(locale, 'image.crop', ['Crop', '裁剪'], { aspect: 'free' }, ['aspect']),
    single(locale, 'image.rotate', ['Rotate or flip', '旋转 / 翻转'], { angle: 90, flip: 'none' }, [
      'angle',
      'flip',
    ]),
    single(locale, 'image.stripMetadata', ['Remove location', '去掉定位'], {}, []),
    single(
      locale,
      'image.stitch',
      ['Long image', '拼长图'],
      { direction: 'vertical', gapPx: 0, background: '#FFFFFF' },
      ['direction'],
      { min: 2, max: 20 },
    ),
    single(
      locale,
      'image.grid',
      ['Photo grid', '拼宫格'],
      { columns: 3, cell: '1:1', gapPx: 8, background: '#FFFFFF' },
      ['columns'],
      { min: 2, max: 16 },
    ),
    single(
      locale,
      'image.toGif',
      ['Animated GIF', '做成动图'],
      { delayMs: 500, maxSide: 480 },
      ['delayMs'],
      { min: 2, max: GIF_MAX_FRAMES },
    ),
    single(locale, 'image.redact', ['Hide parts', '打码'], { style: 'black' }, ['style'], {
      min: 1,
      max: 10,
    }),
    single(
      locale,
      'image.watermark',
      ['Watermark', '加水印'],
      {
        text: t(locale, 'image_Copy_49a2a'),
        mode: 'tile',
        corner: 'bottomRight',
        sizePercent: 30,
        opacity: 35,
        color: '#868E96',
      },
      ['text', 'mode'],
    ),
    single(
      locale,
      'image.idPhoto',
      ['ID photo', '证件照'],
      { spec: 'us-passport', maxKB: 240 },
      ['spec', 'maxKB'],
      { min: 1, max: 1 },
    ),
    {
      id: 'image-printsheet',
      toolId: IMAGE_TOOL_ID,
      name: t(locale, 'image_ID_photos_to_print_5dd87'),
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 1 } },
        {
          id: 'frame',
          action: 'image.idPhoto',
          params: { spec: 'us-passport', maxKB: 0 },
          ask: ['spec'],
        },
        {
          id: 'sheet',
          action: 'image.printSheet',
          params: { sheet: '4x6', guides: true },
          ask: ['sheet'],
        },
      ],
    },
  ];
}

export const imageTool: ToolDefinition = {
  id: IMAGE_TOOL_ID,
  version: '1.5.0',
  name: { en: 'Images', zh: '图片', fr: 'Images' },
  description: {
    en: 'Compress, convert (HEIC to JPG too), resize, crop, rotate and clean photos; stitch, grid, animated GIFs, hide parts, watermark and make ID photos, on this device.',
    zh: '在本机压缩、转格式（包括 HEIC 转 JPG）、改尺寸、裁剪、旋转照片，去掉定位；拼长图、拼宫格、做动图、打码、加水印、做证件照。',
    fr: 'Compressez, convertissez (HEIC en JPG aussi), redimensionnez, recadrez, faites pivoter et nettoyez les photos ; supprimez la localisation ; assemblez en long ou en grille, créez des GIF animés, masquez des parties, ajoutez un filigrane et créez des photos d’identité, sur cet appareil.',
  },
  icon: 'photo',
  aliases: [
    'image',
    'images',
    'photo',
    'photos',
    'picture',
    'heic',
    'heic to jpg',
    '图片',
    '照片',
    '图片工具',
    'heic 转 jpg',
  ],
  permissions: ['files.pick', 'files.write', 'photos.save', 'camera'],
  actions: [...IMAGE_ACTIONS, ...IMAGE_COMPOSE_ACTIONS],
  createPage: (locale) => ({
    id: IMAGE_PAGE_ID,
    title: t(locale, 'image_Images_edfbd'),
    icon: 'photo',
    toolId: IMAGE_TOOL_ID,
    components: [
      {
        id: 'image-header',
        type: 'header',
        props: { title: t(locale, 'image_Image_tools_2d55f') },
      },
      {
        id: 'image-intro',
        type: 'text',
        props: {
          text: t(locale, 'image_Everything_runs_on_this_device_Results_3f5b4'),
        },
      },
      ...imageWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
    ],
  }),
  createWorkflows: imageWorkflows,
};
