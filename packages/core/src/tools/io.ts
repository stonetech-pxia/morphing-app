import { z } from 'zod';

import { checkNameTemplate } from '../naming';
import { MEDIA_LIMITS } from '../limits';
import { IdSchema, PERIODS } from '../schema';
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

/** in.files 选什么文件 → 输出类型。documents：Word、Excel、PowerPoint 等办公文档（D-186）。 */
export const FILE_ACCEPT: Record<string, ValueType> = {
  pdf: 'pdf',
  images: 'images',
  pdfOrImages: 'files',
  zip: 'zip',
  videos: 'video',
  audio: 'audio',
  documents: 'files',
  any: 'files',
};

/** 用户自己输入的文字最长多少字（文字转 PDF、二维码）。 */
export const MAX_INPUT_TEXT = 5000;

/** 读取记录的时间范围：表里第一个日期字段（没有就用创建时间）落在这段时间里。 */
export const RECORD_PERIODS = ['all', ...PERIODS] as const;

export const MAX_PICK = 50;

export const IO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'in.photos',
    label: { en: 'Choose photos', zh: '选照片' },
    description: {
      en: 'Pick photos from the library or from the Files app (pictures downloaded or sent from a computer), take them with the camera, or scan paper with the document camera (finds the edges, captures automatically, several pages, already straightened; where it is not available, the camera is used).',
      zh: '从相册或「文件」App 选照片（下载的、电脑传来的图片），用相机拍照，或用文档相机扫描纸张（自动找边、自动拍、可以多页、拍完已经拉正；没有文档相机的设备改用相机）。',
    },
    input: [],
    output: 'images',
    params: z
      .strictObject({
        source: z.enum(['library', 'files', 'camera', 'scanner']),
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
          { value: 'files', label: { en: 'Files', zh: '从文件选' } },
          { value: 'camera', label: { en: 'Camera', zh: '拍照' } },
          { value: 'scanner', label: { en: 'Scan documents', zh: '扫描文档' } },
        ],
      },
      ...countFields(MAX_PICK),
    ],
    presets: [
      {
        id: 'library',
        label: { en: 'Library, up to 30', zh: '相册，最多 30 张' },
        values: { source: 'library', min: 1, max: 30 },
      },
      {
        id: 'camera',
        label: { en: 'Camera, up to 10', zh: '拍照，最多 10 张' },
        values: { source: 'camera', min: 1, max: 10 },
      },
      {
        id: 'scanner',
        label: { en: 'Scan documents, up to 30 pages', zh: '扫描文档，最多 30 页' },
        values: { source: 'scanner', min: 1, max: 30 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.files',
    label: { en: 'Choose files', zh: '选文件' },
    description: {
      en: 'Pick files from the Files app (PDFs, images, videos, audio, Word / Excel / PowerPoint documents, or any file).',
      zh: '从「文件」App 选文件（PDF、图片、视频、音频、Word / Excel / PowerPoint 文档或任意文件）。',
    },
    input: [],
    output: (p) => FILE_ACCEPT[String(p.accept)] ?? 'files',
    params: z
      .strictObject({
        accept: z.enum([
          'pdf',
          'images',
          'pdfOrImages',
          'zip',
          'videos',
          'audio',
          'documents',
          'any',
        ]),
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
          { value: 'zip', label: { en: 'ZIP archive', zh: 'ZIP 压缩包' } },
          { value: 'videos', label: { en: 'Videos', zh: '视频' } },
          { value: 'audio', label: { en: 'Audio', zh: '音频' } },
          {
            value: 'documents',
            label: { en: 'Word, Excel, PowerPoint', zh: 'Word、Excel、PowerPoint' },
          },
          { value: 'any', label: { en: 'Any file', zh: '任意文件' } },
        ],
      },
      ...countFields(MAX_PICK),
    ],
    presets: [
      {
        id: 'pdf',
        label: { en: 'PDFs, up to 10', zh: 'PDF，最多 10 个' },
        values: { accept: 'pdf', min: 1, max: 10 },
      },
      {
        id: 'mixed',
        label: { en: 'PDFs and images, up to 30', zh: 'PDF 和图片，最多 30 个' },
        values: { accept: 'pdfOrImages', min: 1, max: 30 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.videos',
    label: { en: 'Choose videos', zh: '选视频' },
    description: {
      en: 'Pick videos from the photo library, or from the Files app (downloaded or copied from a computer: MP4, MOV, and on Android also MKV, WEBM, AVI); up to 10, each up to 4 GB.',
      zh: '从相册选视频，或从「文件」App 选（下载的、电脑拷来的：MP4、MOV，Android 还能选 MKV、WEBM、AVI）；最多 10 个，每个不超过 4 GB。',
    },
    input: [],
    output: 'video',
    params: z
      .strictObject({
        // D-185：以前没有这一项（只从相册选），所以可以不写，不写就是相册。
        source: z.enum(['library', 'files']).optional(),
        min: z.number().int().min(1).max(MEDIA_LIMITS.maxCount),
        max: z.number().int().min(1).max(MEDIA_LIMITS.maxCount),
      })
      .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
    fields: [
      {
        key: 'source',
        label: { en: 'From', zh: '来源' },
        kind: 'choice',
        options: [
          { value: 'library', label: { en: 'Photo library', zh: '相册' } },
          { value: 'files', label: { en: 'Files', zh: '从文件选' } },
        ],
      },
      ...countFields(MEDIA_LIMITS.maxCount),
    ],
    presets: [
      {
        id: 'several',
        label: { en: 'Up to 10 videos', zh: '最多 10 个视频' },
        values: { source: 'library', min: 1, max: 10 },
      },
      {
        id: 'one',
        label: { en: 'One video', zh: '1 个视频' },
        values: { source: 'library', min: 1, max: 1 },
      },
      {
        id: 'files',
        label: { en: 'From Files, up to 10', zh: '从文件选，最多 10 个' },
        values: { source: 'files', min: 1, max: 10 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    // 音频（D-154）：从「文件」选录音或音乐（语音备忘录分享出来的、微信下载的），或者现在录一段。
    id: 'in.audio',
    label: { en: 'Choose or record audio', zh: '选音频 / 录音' },
    description: {
      en: 'Pick recordings or music from the Files app (up to 10, each up to 4 GB), or record one now with the microphone (it keeps recording when the screen locks).',
      zh: '从「文件」选录音或音乐（最多 10 个，每个不超过 4 GB），或者现在用麦克风录一段（锁屏后继续录）。',
    },
    input: [],
    output: 'audio',
    params: z
      .strictObject({
        source: z.enum(['files', 'record']),
        min: z.number().int().min(1).max(MEDIA_LIMITS.maxCount),
        max: z.number().int().min(1).max(MEDIA_LIMITS.maxCount),
      })
      .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
    fields: [
      {
        key: 'source',
        label: { en: 'From', zh: '来源' },
        kind: 'choice',
        options: [
          { value: 'files', label: { en: 'Files', zh: '从文件选' } },
          { value: 'record', label: { en: 'Record now', zh: '现在录音' } },
        ],
      },
      ...countFields(MEDIA_LIMITS.maxCount).map((f) => ({
        ...f,
        showIf: { key: 'source', equals: ['files'] },
      })),
    ],
    presets: [
      {
        id: 'files',
        label: { en: 'Files, up to 10', zh: '从文件选，最多 10 个' },
        values: { source: 'files', min: 1, max: 10 },
      },
      {
        id: 'record',
        label: { en: 'Record now', zh: '现在录音' },
        values: { source: 'record', min: 1, max: 1 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.text',
    label: { en: 'Type or paste text', zh: '输入文字' },
    description: {
      en: 'The user types or pastes text (for a QR code or a text PDF). The text stays on this device.',
      zh: '用户输入或粘贴一段文字（用来生成二维码或文字 PDF）。文字只留在本机。',
    },
    input: [],
    output: 'text',
    params: z.strictObject({ text: z.string().max(MAX_INPUT_TEXT) }),
    fields: [
      {
        key: 'text',
        label: { en: 'Text', zh: '文字' },
        kind: 'text',
        multiline: true,
        private: true,
      },
    ],
    requires: [],
  },
  {
    id: 'in.records',
    label: { en: 'Use records', zh: '读取记录' },
    description: {
      en: 'Take the records of one data table (optionally only a time period, by its first date field). Records stay on this device.',
      zh: '读取一张数据表的记录（可以只取某段时间，按表里第一个日期字段）。记录只留在本机。',
    },
    input: [],
    output: 'records',
    params: z.strictObject({ collectionId: IdSchema, period: z.enum(RECORD_PERIODS) }),
    fields: [
      { key: 'collectionId', label: { en: 'Data table', zh: '数据表' }, kind: 'collection' },
      {
        key: 'period',
        label: { en: 'Time', zh: '时间' },
        kind: 'choice',
        options: [
          { value: 'all', label: { en: 'All', zh: '全部' } },
          { value: 'today', label: { en: 'Today', zh: '今天' } },
          { value: 'thisWeek', label: { en: 'This week', zh: '本周' } },
          { value: 'thisMonth', label: { en: 'This month', zh: '本月' } },
          { value: 'thisYear', label: { en: 'This year', zh: '今年' } },
          { value: 'last7days', label: { en: 'Last 7 days', zh: '最近 7 天' } },
          { value: 'last30days', label: { en: 'Last 30 days', zh: '最近 30 天' } },
        ],
      },
    ],
    requires: [],
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
    presets: [
      {
        id: 'source-date',
        label: { en: 'Name + date', zh: '原名 + 日期' },
        values: { template: '{sourceName}-{date}' },
      },
      {
        id: 'source',
        label: { en: 'Original name', zh: '原文件名' },
        values: { template: '{sourceName}' },
      },
    ],
    requires: [],
  },
  {
    id: 'file.order',
    label: { en: 'Put in order', zh: '排序' },
    description: {
      en: 'The user puts the files in order and can drop some, on the device.',
      zh: '用户在手机上调整文件顺序，也可以去掉几个。',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    local: 'reorder',
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
      en: 'Open the share sheet once with all the files (WeChat, WhatsApp, Mail, Messages, AirDrop, Files…).',
      zh: '打开一次系统分享面板，带上全部文件（微信、WhatsApp、邮件、信息、隔空投送、存到文件…）。',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'out.saveToFolder',
    label: { en: 'Save to a folder', zh: '存到文件夹' },
    description: {
      en: 'Copy the files into a folder in Files (on this device, iCloud Drive, Google Drive, Dropbox…). The user picks the folder the first time; after that the same folder is used (it can be changed on the result page). Morph does not upload anything; the cloud app syncs the folder.',
      zh: '把文件复制进「文件」里的一个文件夹（本机、iCloud 云盘、Google Drive、Dropbox…）。第一次由用户选，之后存到同一个文件夹（可以在结果页换）。Morph 不上传，网盘由它自己的 App 同步。',
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
    description: {
      en: 'Save the images or videos to the photo library.',
      zh: '把图片或视频存到系统相册。',
    },
    input: ['images', 'video'],
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
