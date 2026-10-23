import type { IconName, Locale, Localized, Workflow } from '../schema';

// 内置的预设工作流（TOOLS_DESIGN §7，D-081）：不随版本，用户在「工作流」页点「添加」时复制进配置，
// 之后就和用户自己的工作流一样，可以改参数、改步骤、复制、放到页面上、删除；编辑页可以「恢复预设」。
// 预设只用登记过的动作，不要求先安装对应的工具（跨工具的用户工作流，§2）。

/**
 * 预设按生活场景分组（D-130）：普通人说不清要什么，但看到「出国办证」「报销」就知道。
 * 顺序就是快捷操作页上的顺序。
 */
export const PRESET_SCENARIOS = [
  { id: 'ids', name: { en: 'Visas and IDs', zh: '出国办证' } },
  { id: 'paperwork', name: { en: 'Forms and documents', zh: '交材料、签文件' } },
  { id: 'receipts', name: { en: 'Receipts and expenses', zh: '报销记账' } },
  { id: 'photos', name: { en: 'Sending photos and videos', zh: '发照片和视频' } },
] as const satisfies readonly { id: string; name: Localized }[];

export type PresetScenario = (typeof PRESET_SCENARIOS)[number]['id'];

export interface WorkflowPreset {
  id: string;
  scenario: PresetScenario;
  name: Localized;
  /** 一句话说明，显示在预设库里，也发给 AI。 */
  description: Localized;
  icon: IconName;
  /** 需要下载的扩展包（第一次运行时会请用户确认），只用于在预设库里提示。 */
  packs?: readonly string[];
  steps(locale: Locale): Workflow['steps'];
}

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

const photos = (
  min: number,
  max: number,
  source: 'library' | 'camera' | 'scanner' = 'library',
) => ({
  id: 'pick',
  action: 'in.photos',
  params: { source, min, max },
});
const share = { id: 'share', action: 'out.share', params: {} };
const rename = (template: string, ask = true) => ({
  id: 'name',
  action: 'file.rename',
  params: { template },
  ...(ask ? { ask: ['template'] } : {}),
});

export const WORKFLOW_PRESETS: readonly WorkflowPreset[] = [
  {
    id: 'visa-photo',
    scenario: 'ids',
    name: { en: 'Visa / ID photo', zh: '签证 / 证件照' },
    description: {
      en: 'Choose a photo, frame your face, get the official size as a JPG under the size limit (US visa: 600×600, ≤ 240 KB).',
      zh: '选一张照片，框好脸部，得到官方尺寸、不超过大小上限的 JPG（美国签证：600×600，≤ 240 KB）。',
    },
    icon: 'person',
    steps: (locale) => [
      photos(1, 1),
      {
        id: 'photo',
        action: 'image.idPhoto',
        params: { spec: 'us-passport', maxKB: 240 },
        ask: ['spec', 'maxKB'],
      },
      rename(t(locale, 'ID photo {date}', '证件照-{date}'), false),
    ],
  },
  {
    id: 'document-packet',
    scenario: 'paperwork',
    name: { en: 'Application packet', zh: '材料包' },
    description: {
      en: 'Photos of documents → crop and order them → one A4 PDF under 4 MB → name it → share.',
      zh: '拍下或选好材料照片 → 裁剪、排好顺序 → 合成一个不超过 4 MB 的 A4 PDF → 命名 → 分享。',
    },
    icon: 'folder',
    steps: (locale) => [
      photos(1, 30),
      { id: 'crop', action: 'image.crop', params: { aspect: 'free' } },
      { id: 'order', action: 'file.order', params: {} },
      {
        id: 'pdf',
        action: 'pdf.fromImages',
        params: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 4 },
      },
      rename(t(locale, 'Documents {date}', '材料-{date}')),
      share,
    ],
  },
  {
    id: 'email-photos',
    scenario: 'photos',
    name: { en: 'Photos for email or upload', zh: '照片发邮件 / 传网站' },
    description: {
      en: 'Choose photos → long side 1600 px → each under 500 KB as JPG → share.',
      zh: '选照片 → 长边 1600 像素 → 每张压到 500 KB 以内的 JPG → 分享。',
    },
    icon: 'photo',
    steps: () => [
      photos(1, 30),
      { id: 'size', action: 'image.resize', params: { mode: 'longEdge', px: 1600 } },
      {
        id: 'compress',
        action: 'image.compress',
        params: { maxKB: 500, format: 'jpeg' },
        ask: ['maxKB'],
      },
      share,
    ],
  },
  {
    id: 'sign-return',
    scenario: 'paperwork',
    name: { en: 'Sign and send back', zh: '签回表格' },
    description: {
      en: 'Choose a PDF → fill in its form fields (skipped when there are none) → sign → share.',
      zh: '选一个 PDF → 填写表单（没有表单字段时跳过）→ 签名 → 分享。',
    },
    icon: 'signature',
    packs: ['pdfview'],
    steps: () => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
      {
        id: 'fill',
        action: 'pdf.fillForm',
        params: { flatten: true, whenNoFields: 'skip' },
      },
      { id: 'sign', action: 'pdf.sign', params: {} },
      share,
    ],
  },
  {
    id: 'scan-document',
    scenario: 'paperwork',
    name: { en: 'Scan a document', zh: '扫描文档' },
    description: {
      en: 'Scan pages with the document camera (or take photos and check the corners) → clean up → PDF → name it → share.',
      zh: '用文档相机扫描（或拍照后确认四个角）→ 变清楚 → 合成 PDF → 命名 → 分享。',
    },
    icon: 'scan',
    packs: ['scan'],
    steps: (locale) => [
      photos(1, 30, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      { id: 'look', action: 'scan.enhance', params: { mode: 'auto' } },
      {
        id: 'pdf',
        action: 'pdf.fromImages',
        params: { pageSize: 'a4', orientation: 'auto', marginMm: 0, fit: 'contain', maxMB: 0 },
      },
      rename(t(locale, 'Scan {date}', '扫描-{date}')),
      share,
    ],
  },
  {
    id: 'combine-documents',
    scenario: 'paperwork',
    name: { en: 'Combine documents', zh: '多份材料合一' },
    description: {
      en: 'Choose PDFs and images → merge into one PDF → pick, order and rotate pages → name it → share.',
      zh: '选 PDF 和图片 → 合成一个 PDF → 选页、排序、旋转 → 命名 → 分享。',
    },
    icon: 'merge',
    steps: (locale) => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdfOrImages', min: 1, max: 30 } },
      { id: 'merge', action: 'pdf.merge', params: { imagePage: 'a4' } },
      { id: 'pages', action: 'pdf.pages', params: {} },
      rename(t(locale, '{sourceName}-combined', '{sourceName}-合并')),
      share,
    ],
  },
  {
    id: 'pdf-too-big',
    scenario: 'paperwork',
    name: { en: 'PDF too big to upload', zh: 'PDF 太大传不上去' },
    description: {
      en: 'Choose PDFs → make each one smaller than the size you need (2 MB unless you change it; text stays selectable when possible) → share.',
      zh: '选 PDF → 压到要求的大小以内（默认 2 MB，可以每次改；能保留文字时文字仍可选中）→ 分享。',
    },
    icon: 'document',
    steps: () => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 10 } },
      {
        id: 'compress',
        action: 'pdf.compress',
        params: { maxMB: 2, whenTooBig: 'ask' },
        ask: ['maxMB'],
      },
      share,
    ],
  },
  {
    id: 'receipt-archive',
    scenario: 'receipts',
    name: { en: 'Receipt archive', zh: '收据归档' },
    description: {
      en: 'Scan a receipt (straightened automatically, or check the corners) → under 500 KB → name it by date → save to files.',
      zh: '扫描收据（自动拉正，或确认四个角）→ 压到 500 KB 以内 → 按日期命名 → 存到文件。',
    },
    icon: 'inbox',
    packs: ['scan'],
    steps: (locale) => [
      photos(1, 10, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      { id: 'compress', action: 'image.compress', params: { maxKB: 500, format: 'jpeg' } },
      rename(t(locale, 'Receipt {date}', '收据-{date}'), false),
      { id: 'save', action: 'file.save', params: {} },
    ],
  },
  {
    id: 'redact-screenshots',
    scenario: 'photos',
    name: { en: 'Hide parts of screenshots', zh: '截图打码分享' },
    description: {
      en: 'Choose screenshots → stitch into one long image → cover private parts → share.',
      zh: '选截图 → 拼成一张长图 → 盖住隐私部分 → 分享。',
    },
    icon: 'photo',
    steps: () => [
      photos(1, 10),
      {
        id: 'stitch',
        action: 'image.stitch',
        params: { direction: 'vertical', gapPx: 0, background: '#FFFFFF' },
      },
      { id: 'redact', action: 'image.redact', params: { style: 'black' } },
      share,
    ],
  },
  {
    id: 'send-photos',
    scenario: 'photos',
    name: { en: 'Send many photos', zh: '批量发照片' },
    description: {
      en: 'Choose photos → JPG → remove location → long side 2048 px → one ZIP → share.',
      zh: '多选照片 → 转 JPG → 去掉定位 → 长边 2048 像素 → 打包成一个 ZIP → 分享。',
    },
    icon: 'archive',
    steps: (locale) => [
      photos(1, 50),
      { id: 'jpg', action: 'image.convert', params: { format: 'jpeg', quality: 85 } },
      { id: 'clean', action: 'image.stripMetadata', params: {} },
      { id: 'size', action: 'image.resize', params: { mode: 'longEdge', px: 2048 } },
      { id: 'zip', action: 'zip.create', params: {} },
      rename(t(locale, 'Photos {date}', '照片-{date}')),
      share,
    ],
  },
  {
    id: 'video-too-big',
    scenario: 'photos',
    name: { en: 'Video too big to send', zh: '视频太大发不出去' },
    description: {
      en: 'Choose videos → make each one smaller than the size you need (20 MB unless you change it) as an MP4 that plays everywhere → share.',
      zh: '选视频 → 压到要求的大小以内（默认 20 MB，可以每次改），变成哪里都能放的 MP4 → 分享。',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      {
        id: 'compress',
        action: 'video.compress',
        params: { by: 'size', maxMB: 20, quality: '720p' },
        ask: ['maxMB'],
      },
      share,
    ],
  },
  {
    id: 'print-id-photos',
    scenario: 'ids',
    name: { en: 'ID photos to print', zh: '证件照打印' },
    description: {
      en: 'Choose a photo → frame it at the ID size → repeat it on 4×6 in photo paper with cut lines → print or save.',
      zh: '选照片 → 按证件照规格框选 → 排到 6 寸相纸上（带裁切线）→ 打印或保存。',
    },
    icon: 'printer',
    steps: () => [
      photos(1, 1),
      {
        id: 'photo',
        action: 'image.idPhoto',
        params: { spec: 'us-passport', maxKB: 0 },
        ask: ['spec'],
      },
      { id: 'sheet', action: 'image.printSheet', params: { sheet: '4x6', guides: true } },
    ],
  },
];

export const presetById = (id: string) => WORKFLOW_PRESETS.find((p) => p.id === id);

/** 一个场景里的预设，按 WORKFLOW_PRESETS 的顺序。 */
export const presetsIn = (scenario: PresetScenario) =>
  WORKFLOW_PRESETS.filter((p) => p.scenario === scenario);

/** 从预设复制一个工作流（不属于任何工具，记住 presetId 以便恢复）。 */
export function presetWorkflow(preset: WorkflowPreset, locale: Locale, id: string): Workflow {
  return {
    id,
    name: preset.name[locale],
    icon: preset.icon,
    presetId: preset.id,
    steps: preset.steps(locale),
  };
}

/** 新工作流的 ID：基于名字（预设 ID 等），已用过时加序号。 */
export function newWorkflowId(base: string, taken: readonly { id: string }[]): string {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^(\d)/, 'w-$1') || 'workflow';
  const used = new Set(taken.map((w) => w.id));
  if (!used.has(clean)) return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean}-${i}`)) return `${clean}-${i}`;
}
