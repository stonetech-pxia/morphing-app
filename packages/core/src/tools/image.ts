import { z } from 'zod';

import { GIF_MAX_FRAMES } from '../media';
import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition, ParamField } from '../workflow/contract';

// 内置图片工具的清单。像素处理在 App 里由 expo-image-manipulator 完成，
// 纯算法（压到目标大小的搜索、尺寸计算、EXIF）在 packages/tool-image。

export const IMAGE_TOOL_ID = 'image';
export const IMAGE_PAGE_ID = 'tool-image';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

export const IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;

const formatField: ParamField = {
  key: 'format',
  label: { en: 'Format', zh: '格式' },
  kind: 'choice',
  options: [
    { value: 'jpeg', label: { en: 'JPG', zh: 'JPG' } },
    { value: 'png', label: { en: 'PNG', zh: 'PNG' } },
    { value: 'webp', label: { en: 'WebP', zh: 'WebP' } },
  ],
};

const qualityField: ParamField = {
  key: 'quality',
  label: { en: 'Quality', zh: '质量' },
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
    id: 'image.adjust',
    label: { en: 'Adjust photo', zh: '调整图片' },
    description: {
      en: 'Improve photos locally with automatic color adjustment or manual brightness (-100 to 100, neutral 0), contrast and saturation (0 to 200, neutral 100). Automatic results differ across iOS and Android. Keeps dimensions; PNG/WebP inputs become PNG to preserve transparency, other photos become JPG. No face retouching or generative edits.',
      zh: '在本机自动优化颜色，或手动调整亮度（-100 到 100，0 不变）、对比度和饱和度（0 到 200，100 不变）。两端自动效果有所不同。尺寸不变；PNG/WebP 输出 PNG 保留透明度，其他照片输出 JPG。不美颜或生成新内容。',
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
        label: { en: 'Adjustment', zh: '调整方式' },
        kind: 'choice',
        options: [
          { value: 'auto', label: { en: 'Automatic', zh: '自动优化' } },
          { value: 'manual', label: { en: 'Manual', zh: '手动调整' } },
        ],
      },
      {
        key: 'brightness',
        label: { en: 'Brightness', zh: '亮度' },
        kind: 'number',
        min: -100,
        max: 100,
        unit: '%',
        showIf: { key: 'mode', equals: ['manual'] },
      },
      {
        key: 'contrast',
        label: { en: 'Contrast', zh: '对比度' },
        kind: 'number',
        min: 0,
        max: 200,
        unit: '%',
        showIf: { key: 'mode', equals: ['manual'] },
      },
      {
        key: 'saturation',
        label: { en: 'Saturation', zh: '饱和度' },
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
        label: { en: 'Automatic', zh: '自动优化' },
        values: { mode: 'auto', brightness: 0, contrast: 100, saturation: 100 },
      },
      {
        id: 'brighten',
        label: { en: 'Brighter', zh: '调亮' },
        values: { mode: 'manual', brightness: 15, contrast: 100, saturation: 100 },
      },
    ],
    requires: [],
  },

  {
    id: 'image.removeBackground',
    label: { en: 'Remove background', zh: '去背景' },
    description: {
      en: 'Keep the main subjects and remove the background locally, producing PNG with transparency or a solid color. Requires iOS 17+ or Android Google Play services (first use downloads a model). Fine hair, transparent objects and unclear subjects may need another editor. Does not guarantee an official ID photo.',
      zh: '在本机保留主要主体、去掉背景，输出透明或纯色背景 PNG。需要 iOS 17+ 或 Android Google Play 服务（首次下载模型）。发丝、透明物体或主体不清晰时可能需要其他编辑器；不保证符合证件照要求。',
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
        label: { en: 'Background', zh: '背景' },
        kind: 'choice',
        options: [
          { value: 'transparent', label: { en: 'Transparent', zh: '透明' } },
          { value: 'color', label: { en: 'Solid color', zh: '纯色' } },
        ],
      },
      {
        key: 'color',
        label: { en: 'Color', zh: '颜色' },
        kind: 'color',
        showIf: { key: 'background', equals: ['color'] },
      },
    ],
    presets: [
      {
        id: 'transparent',
        label: { en: 'Transparent', zh: '透明' },
        values: { background: 'transparent', color: '#FFFFFF' },
      },
      {
        id: 'white',
        label: { en: 'White', zh: '白底' },
        values: { background: 'color', color: '#FFFFFF' },
      },
    ],
    requires: [],
  },
  {
    id: 'image.convert',
    label: { en: 'Convert format', zh: '转格式' },
    description: {
      en: 'Convert HEIC, PNG or WebP photos to JPG, PNG or WebP. Never outputs HEIC. Removes location and other photo info.',
      zh: '把 HEIC、PNG、WebP 转成 JPG、PNG 或 WebP，不会输出 HEIC。会去掉位置等照片信息。',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({
      format: z.enum(IMAGE_FORMATS),
      quality: z.number().int().min(10).max(100),
    }),
    fields: [formatField, qualityField],
    presets: [
      { id: 'jpg', label: { en: 'JPG', zh: 'JPG' }, values: { format: 'jpeg', quality: 85 } },
      { id: 'png', label: { en: 'PNG', zh: 'PNG' }, values: { format: 'png', quality: 100 } },
      { id: 'webp', label: { en: 'WebP', zh: 'WebP' }, values: { format: 'webp', quality: 80 } },
    ],
    requires: [],
  },
  {
    id: 'image.resize',
    label: { en: 'Resize', zh: '改尺寸' },
    description: {
      en: 'Make images smaller by long edge, width, height, percent or to fit a box. Never crops and never enlarges.',
      zh: '按长边、宽、高、百分比或「放进一个框」缩小图片。不裁剪，也不放大。',
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
        label: { en: 'By', zh: '方式' },
        kind: 'choice',
        options: [
          { value: 'longEdge', label: { en: 'Long edge', zh: '长边' } },
          { value: 'width', label: { en: 'Width', zh: '宽度' } },
          { value: 'height', label: { en: 'Height', zh: '高度' } },
          { value: 'percent', label: { en: 'Percent', zh: '百分比' } },
          { value: 'fit', label: { en: 'Fit in box', zh: '放进框里' } },
        ],
      },
      {
        key: 'px',
        label: { en: 'Pixels', zh: '像素' },
        kind: 'number',
        unit: 'px',
        min: 16,
        max: 12000,
        showIf: { key: 'mode', equals: ['longEdge', 'width', 'height'] },
      },
      {
        key: 'width',
        label: { en: 'Max width', zh: '最大宽度' },
        kind: 'number',
        unit: 'px',
        min: 16,
        max: 12000,
        showIf: { key: 'mode', equals: ['fit'] },
      },
      {
        key: 'height',
        label: { en: 'Max height', zh: '最大高度' },
        kind: 'number',
        unit: 'px',
        min: 16,
        max: 12000,
        showIf: { key: 'mode', equals: ['fit'] },
      },
      {
        key: 'percent',
        label: { en: 'Percent', zh: '百分比' },
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
        label: { en: 'Long edge 2048', zh: '长边 2048' },
        values: { mode: 'longEdge', px: 2048 },
      },
      {
        id: 'long-1600',
        label: { en: 'Long edge 1600', zh: '长边 1600' },
        values: { mode: 'longEdge', px: 1600 },
      },
      {
        id: 'width-1080',
        label: { en: 'Width 1080', zh: '宽 1080' },
        values: { mode: 'width', px: 1080 },
      },
      { id: 'half', label: { en: '50%', zh: '50%' }, values: { mode: 'percent', percent: 50 } },
      {
        id: 'box-600',
        label: { en: 'Fit 600×600', zh: '600×600 以内' },
        values: { mode: 'fit', width: 600, height: 600 },
      },
    ],
    requires: [],
  },
  {
    id: 'image.compress',
    label: { en: 'Compress to size', zh: '压到指定大小' },
    description: {
      en: 'Make each image at most the given size (KB) by lowering quality first, then size. Output is JPG or WebP.',
      zh: '让每张图片不超过指定大小（KB）：先降质量，不够再缩小尺寸。输出 JPG 或 WebP。',
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
        label: { en: 'At most', zh: '不超过' },
        kind: 'number',
        unit: 'KB',
        min: 10,
        max: 50000,
        step: 10,
      },
      {
        key: 'format',
        label: { en: 'Format', zh: '格式' },
        kind: 'choice',
        options: [
          { value: 'jpeg', label: { en: 'JPG', zh: 'JPG' } },
          { value: 'webp', label: { en: 'WebP', zh: 'WebP' } },
        ],
      },
    ],
    presets: [
      {
        id: 'kb-240',
        label: { en: '240 KB', zh: '240 KB' },
        values: { maxKB: 240, format: 'jpeg' },
      },
      {
        id: 'kb-500',
        label: { en: '500 KB', zh: '500 KB' },
        values: { maxKB: 500, format: 'jpeg' },
      },
      { id: 'mb-1', label: { en: '1 MB', zh: '1 MB' }, values: { maxKB: 1024, format: 'jpeg' } },
      { id: 'mb-2', label: { en: '2 MB', zh: '2 MB' }, values: { maxKB: 2048, format: 'jpeg' } },
    ],
    requires: [],
  },
  {
    id: 'image.crop',
    label: { en: 'Crop', zh: '裁剪' },
    description: {
      en: 'The user frames each image on the device; the ratio can be locked (1:1, 4:3, 35:45 passport…).',
      zh: '用户在手机上逐张框选，可以锁定比例（1:1、4:3、35:45 证件照…）。',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ aspect: z.enum(CROP_ASPECTS) }),
    fields: [
      {
        key: 'aspect',
        label: { en: 'Ratio', zh: '比例' },
        kind: 'choice',
        options: CROP_ASPECTS.map((a) => ({
          value: a,
          label: a === 'free' ? { en: 'Free', zh: '自由' } : { en: a, zh: a },
        })),
      },
    ],
    local: 'crop',
    requires: [],
  },
  {
    id: 'image.rotate',
    label: { en: 'Rotate or flip', zh: '旋转 / 翻转' },
    description: {
      en: 'Rotate clockwise and/or flip every image.',
      zh: '把每张图片顺时针旋转和 / 或翻转。',
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
        label: { en: 'Rotate', zh: '旋转' },
        kind: 'choice',
        options: [
          { value: 0, label: { en: 'No', zh: '不转' } },
          { value: 90, label: { en: '90° right', zh: '右转 90°' } },
          { value: 180, label: { en: '180°', zh: '180°' } },
          { value: 270, label: { en: '90° left', zh: '左转 90°' } },
        ],
      },
      {
        key: 'flip',
        label: { en: 'Flip', zh: '翻转' },
        kind: 'choice',
        options: [
          { value: 'none', label: { en: 'No', zh: '不翻转' } },
          { value: 'horizontal', label: { en: 'Mirror', zh: '左右翻转' } },
          { value: 'vertical', label: { en: 'Upside down', zh: '上下翻转' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'image.stripMetadata',
    label: { en: 'Remove location & info', zh: '去掉定位等信息' },
    description: {
      en: 'Remove location, camera and other hidden info. JPGs keep their exact pixels; other formats become JPG.',
      zh: '去掉位置、相机型号等隐藏信息。JPG 画质不变；其他格式转成 JPG。',
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
    label: { en: 'US passport / visa 2×2 in', zh: '美国护照/签证 2×2 英寸' },
    maxKB: 240,
  },
  { id: 'cn-visa', label: { en: 'China visa 33×48 mm', zh: '中国签证 33×48 毫米' } },
  { id: 'schengen', label: { en: 'Schengen / EU visa 35×45 mm', zh: '申根/欧盟签证 35×45 毫米' } },
  { id: 'uk-passport', label: { en: 'UK passport 35×45 mm', zh: '英国护照 35×45 毫米' } },
  { id: 'ca-passport', label: { en: 'Canada passport 50×70 mm', zh: '加拿大护照 50×70 毫米' } },
  {
    id: 'jp-passport',
    label: { en: 'Japan passport / visa 35×45 mm', zh: '日本护照/签证 35×45 毫米' },
  },
  { id: 'in-visa', label: { en: 'India visa 2×2 in', zh: '印度签证 2×2 英寸' } },
  { id: 'cn-1inch', label: { en: '1-inch 25×35 mm', zh: '一寸 25×35 毫米' } },
  { id: 'cn-2inch', label: { en: '2-inch 35×49 mm', zh: '二寸 35×49 毫米' } },
] as const;
const ID_PHOTO_IDS = ID_PHOTO_CHOICES.map((c) => c.id) as [string, ...string[]];

/** 冲印相纸（英寸）。 */
export const PRINT_SHEETS = ['4x6', '5x7', 'a4', 'letter'] as const;

const backgroundField: ParamField = {
  key: 'background',
  label: { en: 'Background', zh: '底色' },
  kind: 'choice',
  options: [
    { value: '#FFFFFF', label: { en: 'White', zh: '白' } },
    { value: '#000000', label: { en: 'Black', zh: '黑' } },
  ],
};

const gapField: ParamField = {
  key: 'gapPx',
  label: { en: 'Gap', zh: '间距' },
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
    label: { en: 'Stitch into a long image', zh: '拼长图' },
    description: {
      en: 'Join the images top to bottom (or side by side) into one long image, e.g. several screenshots. Very long results are split into parts.',
      zh: '把图片从上到下（或从左到右）拼成一张长图，例如几张截图。太长时分成几张。',
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
        label: { en: 'Direction', zh: '方向' },
        kind: 'choice',
        options: [
          { value: 'vertical', label: { en: 'Top to bottom', zh: '从上到下' } },
          { value: 'horizontal', label: { en: 'Side by side', zh: '从左到右' } },
        ],
      },
      gapField,
      backgroundField,
    ],
    presets: [
      {
        id: 'vertical',
        label: { en: 'Top to bottom', zh: '从上到下' },
        values: { direction: 'vertical', gapPx: 0, background: '#FFFFFF' },
      },
    ],
    requires: [],
  },
  {
    // D-184：iOS 用系统 ImageIO 写 GIF，Android 用 morph-media 里自己写的编码器（GifEncoder.kt）。
    id: 'image.toGif',
    label: { en: 'Make an animated GIF', zh: '做成动图' },
    description: {
      en: `Turn the images (at most ${GIF_MAX_FRAMES}, in their current order) into one animated GIF that loops, each image shown for the chosen time. Images are fitted into the size of the first one.`,
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
        label: { en: 'Each image', zh: '每张停留' },
        kind: 'choice',
        options: [
          { value: 200, label: { en: '0.2 s (fast)', zh: '0.2 秒（快）' } },
          { value: 500, label: { en: '0.5 s', zh: '0.5 秒' } },
          { value: 1000, label: { en: '1 s', zh: '1 秒' } },
          { value: 2000, label: { en: '2 s (slow)', zh: '2 秒（慢）' } },
        ],
      },
      {
        key: 'maxSide',
        label: { en: 'Size', zh: '尺寸' },
        kind: 'choice',
        options: [
          { value: 320, label: { en: '320 px (small)', zh: '320 像素（小）' } },
          { value: 480, label: { en: '480 px', zh: '480 像素' } },
          { value: 800, label: { en: '800 px (sharp)', zh: '800 像素（清楚）' } },
        ],
      },
    ],
    presets: [
      { id: 'half', label: { en: '0.5 s', zh: '0.5 秒' }, values: { delayMs: 500, maxSide: 480 } },
      { id: 'one', label: { en: '1 s', zh: '1 秒' }, values: { delayMs: 1000, maxSide: 480 } },
    ],
    requires: [],
  },
  {
    id: 'image.grid',
    label: { en: 'Photo grid', zh: '拼宫格' },
    description: {
      en: 'Arrange the images in a grid (2–4 columns, same-size cells, centered crop) as one image.',
      zh: '把图片排成宫格（2–4 列，格子一样大，居中裁切），拼成一张图。',
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
        label: { en: 'Columns', zh: '列数' },
        kind: 'choice',
        options: [
          { value: 2, label: { en: '2', zh: '2' } },
          { value: 3, label: { en: '3', zh: '3' } },
          { value: 4, label: { en: '4', zh: '4' } },
        ],
      },
      {
        key: 'cell',
        label: { en: 'Cell shape', zh: '格子形状' },
        kind: 'choice',
        options: [
          { value: '1:1', label: { en: 'Square', zh: '正方形' } },
          { value: '3:4', label: { en: 'Portrait 3:4', zh: '竖 3:4' } },
          { value: '4:3', label: { en: 'Landscape 4:3', zh: '横 4:3' } },
        ],
      },
      gapField,
      backgroundField,
    ],
    presets: [
      {
        id: 'nine',
        label: { en: '3 columns', zh: '九宫格' },
        values: { columns: 3, cell: '1:1', gapPx: 8, background: '#FFFFFF' },
      },
      {
        id: 'two',
        label: { en: '2 columns', zh: '两列' },
        values: { columns: 2, cell: '1:1', gapPx: 8, background: '#FFFFFF' },
      },
    ],
    requires: [],
  },
  {
    id: 'image.redact',
    label: { en: 'Hide parts', zh: '打码' },
    description: {
      en: 'The user draws boxes over private parts (names, numbers, faces); they are blurred or blacked out.',
      zh: '用户在图片上框出隐私部分（姓名、号码、人脸），把它们模糊或涂黑。',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ style: z.enum(['blur', 'black']) }),
    fields: [
      {
        key: 'style',
        label: { en: 'Style', zh: '方式' },
        kind: 'choice',
        options: [
          { value: 'blur', label: { en: 'Blur', zh: '模糊' } },
          { value: 'black', label: { en: 'Black box', zh: '黑块' } },
        ],
      },
    ],
    presets: [{ id: 'black', label: { en: 'Black box', zh: '黑块' }, values: { style: 'black' } }],
    local: 'redact',
    requires: [],
  },
  {
    id: 'image.watermark',
    label: { en: 'Text watermark', zh: '文字水印' },
    description: {
      en: 'Put a line of text on the images, in a corner or repeated across (e.g. "For visa application only").',
      zh: '在图片上加一行字，放在角落或铺满整张（例如「仅供签证使用」）。',
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
      { key: 'text', label: { en: 'Text', zh: '文字' }, kind: 'text', private: true },
      {
        key: 'mode',
        label: { en: 'Placement', zh: '摆放' },
        kind: 'choice',
        options: [
          { value: 'tile', label: { en: 'Across the image', zh: '铺满' } },
          { value: 'corner', label: { en: 'One corner', zh: '角落' } },
        ],
      },
      {
        key: 'corner',
        label: { en: 'Where', zh: '位置' },
        kind: 'choice',
        options: [
          { value: 'bottomRight', label: { en: 'Bottom right', zh: '右下' } },
          { value: 'bottomLeft', label: { en: 'Bottom left', zh: '左下' } },
          { value: 'topRight', label: { en: 'Top right', zh: '右上' } },
          { value: 'topLeft', label: { en: 'Top left', zh: '左上' } },
          { value: 'center', label: { en: 'Center', zh: '正中' } },
        ],
        showIf: { key: 'mode', equals: ['corner'] },
      },
      {
        key: 'sizePercent',
        label: { en: 'Width (share of the short side)', zh: '宽度（占短边）' },
        kind: 'number',
        unit: '%',
        min: 5,
        max: 80,
      },
      {
        key: 'opacity',
        label: { en: 'Opacity', zh: '不透明度' },
        kind: 'number',
        unit: '%',
        min: 10,
        max: 100,
      },
      {
        key: 'color',
        label: { en: 'Color', zh: '颜色' },
        kind: 'choice',
        options: [
          { value: '#FFFFFF', label: { en: 'White', zh: '白' } },
          { value: '#000000', label: { en: 'Black', zh: '黑' } },
          { value: '#868E96', label: { en: 'Gray', zh: '灰' } },
          { value: '#C92A2A', label: { en: 'Red', zh: '红' } },
        ],
      },
    ],
    presets: [
      {
        id: 'tile',
        label: { en: 'Across the image', zh: '铺满' },
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
    label: { en: 'ID photo', zh: '证件照' },
    description: {
      en: 'The user frames the face at the required shape; the photo is cut to the official size in pixels (300 dpi) as a JPG, and kept under the size limit if the spec has one. Check the background and head size yourself.',
      zh: '用户按规格比例框选，照片裁成官方像素尺寸（300 dpi）的 JPG；规格有大小上限时压到上限以内。背景和头部比例需要自己检查。',
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
        label: { en: 'Size', zh: '规格' },
        kind: 'choice',
        options: ID_PHOTO_CHOICES.map((c) => ({ value: c.id, label: c.label })),
      },
      {
        key: 'maxKB',
        label: { en: 'At most (0 = no limit)', zh: '不超过（0 表示不限）' },
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
    label: { en: 'Arrange on photo paper', zh: '排到相纸上' },
    description: {
      en: 'Repeat each ID photo on a sheet of photo paper (4×6 in etc.) with cut lines, ready to print at a photo shop. Photos are measured at 300 dpi, so use the ID photo step first.',
      zh: '把证件照重复排到一张相纸上（4×6 英寸等），带裁切线，可以拿去冲印。照片按 300 dpi 计算尺寸，所以先用「证件照」步骤。',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ sheet: z.enum(PRINT_SHEETS), guides: z.boolean() }),
    fields: [
      {
        key: 'sheet',
        label: { en: 'Paper', zh: '相纸' },
        kind: 'choice',
        options: [
          { value: '4x6', label: { en: '4×6 in', zh: '4×6 英寸（6 寸）' } },
          { value: '5x7', label: { en: '5×7 in', zh: '5×7 英寸（7 寸）' } },
          { value: 'a4', label: { en: 'A4', zh: 'A4' } },
          { value: 'letter', label: { en: 'Letter', zh: 'Letter' } },
        ],
      },
      { key: 'guides', label: { en: 'Cut lines', zh: '裁切线' }, kind: 'toggle' },
    ],
    presets: [
      { id: '4x6', label: { en: '4×6 in', zh: '6 寸' }, values: { sheet: '4x6', guides: true } },
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
    name: t(locale, ...name),
    steps: [
      { id: 'pick', action: 'in.photos', params: { source: 'library', ...pick } },
      { id: 'run', action, params, ...(ask.length ? { ask } : {}) },
    ],
  };
}

export function imageWorkflows(locale: Locale): Workflow[] {
  return [
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
      name: t(locale, 'HEIC to JPG', 'HEIC 转 JPG'),
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
        text: t(locale, 'Copy', '仅供办理使用'),
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
      name: t(locale, 'ID photos to print', '证件照冲印排版'),
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
  version: '1.4.0',
  name: { en: 'Images', zh: '图片' },
  description: {
    en: 'Compress, convert (HEIC to JPG too), resize, crop, rotate and clean photos; stitch, grid, animated GIFs, hide parts, watermark and make ID photos, on this device.',
    zh: '在本机压缩、转格式（包括 HEIC 转 JPG）、改尺寸、裁剪、旋转照片，去掉定位；拼长图、拼宫格、做动图、打码、加水印、做证件照。',
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
    title: t(locale, 'Images', '图片'),
    icon: 'photo',
    toolId: IMAGE_TOOL_ID,
    components: [
      {
        id: 'image-header',
        type: 'header',
        props: { title: t(locale, 'Image tools', '图片工具') },
      },
      {
        id: 'image-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Everything runs on this device. Results are saved only when you tap Save.',
            '全部在本机处理，不会上传。点「存到文件」才会保存结果。',
          ),
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
