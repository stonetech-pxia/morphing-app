import { z } from 'zod';

import { checkNameTemplate } from '../naming';
import type { ActionDefinition, ValueType } from '../workflow/contract';

// 内核的输入输出动作：不属于任何工具，所有工作流都可以使用（TOOLS_DESIGN §5）。

export const nameTemplateSchema = z
  .string()
  .refine((t) => checkNameTemplate(t).ok, { message: 'invalid name template' });

const countFields = (max: number) =>
  [
    {
      key: 'min',
      label: { en: 'At least', zh: '至少' },
      kind: 'number',
      min: 1,
      max,
      step: 1,
    },
    {
      key: 'max',
      label: { en: 'At most', zh: '最多' },
      kind: 'number',
      min: 1,
      max,
      step: 1,
    },
  ] as const;

/** in.files 选什么文件 → 输出类型。 */
export const FILE_ACCEPT: Record<string, ValueType> = {
  pdf: 'pdf',
  images: 'images',
  pdfOrImages: 'files',
  any: 'files',
};

export const MAX_PICK = 50;

export const IO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'in.photos',
    label: { en: 'Choose photos', zh: '选照片' },
    description: {
      en: 'Pick photos from the library or take them with the camera.',
      zh: '从相册选照片，或用相机拍照。',
    },
    input: [],
    output: 'images',
    params: z
      .strictObject({
        source: z.enum(['library', 'camera']),
        min: z.number().int().min(1).max(MAX_PICK),
        max: z.number().int().min(1).max(MAX_PICK),
      })
      .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
    fields: [
      {
        key: 'source',
        label: { en: 'From', zh: '来源' },
        kind: 'choice',
        options: [
          { value: 'library', label: { en: 'Photo library', zh: '相册' } },
          { value: 'camera', label: { en: 'Camera', zh: '拍照' } },
        ],
      },
      ...countFields(MAX_PICK),
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.files',
    label: { en: 'Choose files', zh: '选文件' },
    description: {
      en: 'Pick files from the Files app (PDFs, images or any file).',
      zh: '从「文件」App 选文件（PDF、图片或任意文件）。',
    },
    input: [],
    output: (p) => FILE_ACCEPT[String(p.accept)] ?? 'files',
    params: z
      .strictObject({
        accept: z.enum(['pdf', 'images', 'pdfOrImages', 'any']),
        min: z.number().int().min(1).max(MAX_PICK),
        max: z.number().int().min(1).max(MAX_PICK),
      })
      .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
    fields: [
      {
        key: 'accept',
        label: { en: 'File type', zh: '文件类型' },
        kind: 'choice',
        options: [
          { value: 'pdf', label: { en: 'PDF', zh: 'PDF' } },
          { value: 'images', label: { en: 'Images', zh: '图片' } },
          { value: 'pdfOrImages', label: { en: 'PDFs and images', zh: 'PDF 和图片' } },
          { value: 'any', label: { en: 'Any file', zh: '任意文件' } },
        ],
      },
      ...countFields(MAX_PICK),
    ],
    requires: ['files.pick'],
  },
  {
    id: 'file.rename',
    label: { en: 'Name the files', zh: '命名' },
    description: {
      en: 'Name the result with a template such as {sourceName}-{date}.',
      zh: '按模板命名结果，例如 {sourceName}-{date}。',
    },
    input: ['files', 'images', 'pdf', 'zip'],
    output: 'same',
    params: z.strictObject({ template: nameTemplateSchema }),
    fields: [{ key: 'template', label: { en: 'File name', zh: '文件名' }, kind: 'nameTemplate' }],
    requires: [],
  },
  {
    id: 'file.save',
    label: { en: 'Save to Morph files', zh: '存到文件' },
    description: {
      en: 'Save the result to the files in this app.',
      zh: '把结果存到这个 App 的文件里。',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: ['files.write'],
  },
  {
    id: 'out.share',
    label: { en: 'Share', zh: '分享' },
    description: {
      en: 'Open the share sheet (Mail, Messages, AirDrop, Files…).',
      zh: '打开系统分享面板（邮件、信息、隔空投送、存到文件…）。',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'out.saveToPhotos',
    label: { en: 'Save to Photos', zh: '存到相册' },
    description: { en: 'Save the images to the photo library.', zh: '把图片存到系统相册。' },
    input: ['images'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: ['photos.save'],
  },
  {
    id: 'out.print',
    label: { en: 'Print', zh: '打印' },
    description: {
      en: 'Print with AirPrint or a system printer.',
      zh: '用系统打印（AirPrint 等）。',
    },
    input: ['pdf', 'images'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
];
