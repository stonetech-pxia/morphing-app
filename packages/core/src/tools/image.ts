import { z } from 'zod';

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

/** 单功能工作流：选照片 + 这一个动作（D-061）。 */
function single(
  locale: Locale,
  action: string,
  name: [string, string],
  params: Record<string, unknown>,
  ask: string[],
): Workflow {
  const id = `image-${action.split('.')[1]!.toLowerCase()}`;
  return {
    id,
    toolId: IMAGE_TOOL_ID,
    name: t(locale, ...name),
    steps: [
      { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } },
      { id: 'run', action, params, ...(ask.length ? { ask } : {}) },
    ],
  };
}

export function imageWorkflows(locale: Locale): Workflow[] {
  return [
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
  ];
}

export const imageTool: ToolDefinition = {
  id: IMAGE_TOOL_ID,
  version: '1.0.0',
  name: { en: 'Images', zh: '图片' },
  description: {
    en: 'Compress, convert, resize, crop, rotate and clean photos on this device.',
    zh: '在本机压缩、转格式、改尺寸、裁剪、旋转照片，去掉定位。',
  },
  icon: 'photo',
  aliases: ['image', 'images', 'photo', 'photos', 'picture', '图片', '照片', '图片工具'],
  permissions: ['files.pick', 'files.write', 'photos.save', 'camera'],
  actions: IMAGE_ACTIONS,
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
