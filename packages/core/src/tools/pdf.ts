import { z } from 'zod';

import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition, ParamField } from '../workflow/contract';

// 内置 PDF 工具的清单（Tool Manifest）。动作的真实实现在 packages/tool-pdf（pdf-lib）
// 和 App 运行时中；这里只声明契约，供校验、预览和 mock AI 使用。

export const PDF_TOOL_ID = 'pdf';
export const PDF_PAGE_ID = 'tool-pdf';
export const PDF_MERGE_WORKFLOW_ID = 'pdf-merge';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

/** 按页码选页的规则：AI 只能选这些符号规则，看不到文件内容（open-tool-research N4）。 */
export const PAGE_RULES = ['all', 'odd', 'even', 'first', 'last', 'range'] as const;

const ruleFields: ParamField[] = [
  {
    key: 'rule',
    label: { en: 'Pages', zh: '哪些页' },
    kind: 'choice',
    options: [
      { value: 'all', label: { en: 'All', zh: '全部' } },
      { value: 'odd', label: { en: 'Odd', zh: '奇数页' } },
      { value: 'even', label: { en: 'Even', zh: '偶数页' } },
      { value: 'first', label: { en: 'First', zh: '第一页' } },
      { value: 'last', label: { en: 'Last', zh: '最后一页' } },
      { value: 'range', label: { en: 'Page numbers', zh: '指定页码' } },
    ],
  },
  {
    key: 'range',
    label: { en: 'Page numbers (e.g. 1-3, 5)', zh: '页码（例如 1-3, 5）' },
    kind: 'text',
    showIf: { key: 'rule', equals: ['range'] },
  },
];

const rangeText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\d\s,，;；\-–—~]+$/, 'page numbers like 1-3, 5');

const ruleSchema = {
  rule: z.enum(PAGE_RULES),
  range: rangeText.optional(),
};
const needsRange = (p: { rule: string; range?: string | undefined }) =>
  p.rule !== 'range' || p.range !== undefined;

const imagePageFields: ParamField[] = [
  {
    key: 'pageSize',
    label: { en: 'Page size', zh: '纸张' },
    kind: 'choice',
    options: [
      { value: 'a4', label: { en: 'A4', zh: 'A4' } },
      { value: 'letter', label: { en: 'Letter', zh: 'Letter' } },
      { value: 'fit', label: { en: 'Same as image', zh: '跟随图片' } },
    ],
  },
  {
    key: 'orientation',
    label: { en: 'Orientation', zh: '方向' },
    kind: 'choice',
    options: [
      { value: 'auto', label: { en: 'Automatic', zh: '自动' } },
      { value: 'portrait', label: { en: 'Portrait', zh: '竖向' } },
      { value: 'landscape', label: { en: 'Landscape', zh: '横向' } },
    ],
    showIf: { key: 'pageSize', equals: ['a4', 'letter'] },
  },
  {
    key: 'marginMm',
    label: { en: 'Margin', zh: '边距' },
    kind: 'number',
    unit: 'mm',
    min: 0,
    max: 30,
  },
  {
    key: 'fit',
    label: { en: 'Image', zh: '图片' },
    kind: 'choice',
    options: [
      { value: 'contain', label: { en: 'Show whole image', zh: '完整显示' } },
      { value: 'cover', label: { en: 'Fill the page', zh: '铺满页面' } },
    ],
  },
];

const positions = [
  'bottomCenter',
  'bottomRight',
  'bottomLeft',
  'topCenter',
  'topRight',
  'topLeft',
] as const;
const positionLabels: Record<string, [string, string]> = {
  bottomCenter: ['Bottom center', '底部居中'],
  bottomRight: ['Bottom right', '右下'],
  bottomLeft: ['Bottom left', '左下'],
  topCenter: ['Top center', '顶部居中'],
  topRight: ['Top right', '右上'],
  topLeft: ['Top left', '左上'],
  center: ['Center', '正中'],
};
const positionField = (values: readonly string[]): ParamField => ({
  key: 'position',
  label: { en: 'Position', zh: '位置' },
  kind: 'choice',
  options: values.map((v) => ({
    value: v,
    label: { en: positionLabels[v]![0], zh: positionLabels[v]![1] },
  })),
});

export const STAMP_COLORS = ['#000000', '#C92A2A', '#1864AB', '#868E96'] as const;

export const PDF_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'pdf.merge',
    label: { en: 'Merge in order', zh: '按顺序合并' },
    description: {
      en: 'Merge PDFs and images into one PDF, in the order they were chosen. Each image becomes a page.',
      zh: '把 PDF 和图片按选择顺序合并成一个 PDF，每张图片占一页。',
    },
    input: ['files'],
    output: 'pdf',
    params: z.strictObject({ imagePage: z.enum(['a4', 'letter', 'fit']).optional() }),
    fields: [
      {
        key: 'imagePage',
        label: { en: 'Pages for images', zh: '图片页的纸张' },
        kind: 'choice',
        options: [
          { value: 'a4', label: { en: 'A4', zh: 'A4' } },
          { value: 'letter', label: { en: 'Letter', zh: 'Letter' } },
          { value: 'fit', label: { en: 'Same as image', zh: '跟随图片' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.fromImages',
    label: { en: 'Images to PDF', zh: '图片转 PDF' },
    description: {
      en: 'Put the images into one PDF (A4, Letter or the image size) with optional margins. Max size (MB) makes the PDF smaller by compressing the images; 0 = no limit.',
      zh: '把图片排成一个 PDF（A4、Letter 或跟随图片），可设边距。「不超过」会压缩图片让 PDF 小于这个大小，0 表示不限。',
    },
    input: ['images'],
    output: 'pdf',
    params: z.strictObject({
      pageSize: z.enum(['a4', 'letter', 'fit']),
      orientation: z.enum(['auto', 'portrait', 'landscape']),
      marginMm: z.number().min(0).max(30),
      fit: z.enum(['contain', 'cover']),
      maxMB: z.number().min(0).max(100),
    }),
    fields: [
      ...imagePageFields,
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过' },
        kind: 'number',
        unit: 'MB',
        min: 0,
        max: 100,
        step: 0.5,
      },
    ],
    presets: [
      {
        id: 'a4',
        label: { en: 'A4', zh: 'A4' },
        values: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
      },
      {
        id: 'a4-4mb',
        label: { en: 'A4 ≤ 4 MB', zh: 'A4 ≤ 4 MB' },
        values: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 4 },
      },
      {
        id: 'letter',
        label: { en: 'Letter', zh: 'Letter' },
        values: { pageSize: 'letter', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
      },
      {
        id: 'fit',
        label: { en: 'Same as image', zh: '跟随图片' },
        values: { pageSize: 'fit', orientation: 'auto', marginMm: 0, fit: 'contain', maxMB: 0 },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.pages',
    label: { en: 'Arrange pages', zh: '整理页面' },
    description: {
      en: 'The user picks, removes, reorders and rotates pages on the device.',
      zh: '用户在手机上选页、删页、调整顺序和旋转。',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({}),
    fields: [],
    local: 'pages',
    requires: [],
  },
  {
    id: 'pdf.selectPages',
    label: { en: 'Keep pages', zh: '提取页面' },
    description: {
      en: 'Keep only some pages: all, odd, even, first, last or page numbers like 1-3, 5.',
      zh: '只保留部分页：全部、奇数页、偶数页、第一页、最后一页或页码（例如 1-3, 5）。',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject(ruleSchema).refine(needsRange, { message: 'page numbers are missing' }),
    fields: ruleFields,
    requires: [],
  },
  {
    id: 'pdf.rotate',
    label: { en: 'Rotate pages', zh: '旋转页面' },
    description: { en: 'Rotate some or all pages clockwise.', zh: '把部分或全部页面顺时针旋转。' },
    input: ['pdf'],
    output: 'pdf',
    params: z
      .strictObject({
        angle: z.union([z.literal(90), z.literal(180), z.literal(270)]),
        ...ruleSchema,
      })
      .refine(needsRange, { message: 'page numbers are missing' }),
    fields: [
      {
        key: 'angle',
        label: { en: 'Rotate', zh: '旋转' },
        kind: 'choice',
        options: [
          { value: 90, label: { en: '90° right', zh: '右转 90°' } },
          { value: 180, label: { en: '180°', zh: '180°' } },
          { value: 270, label: { en: '90° left', zh: '左转 90°' } },
        ],
      },
      ...ruleFields,
    ],
    requires: [],
  },
  {
    id: 'pdf.split',
    label: { en: 'Split', zh: '拆分' },
    description: {
      en: 'Split into several PDFs: every N pages, or by page ranges separated by ; (e.g. 1-3; 4-6).',
      zh: '拆成多个 PDF：每 N 页一份，或按页码范围（用分号隔开，例如 1-3; 4-6）。',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z
      .strictObject({
        mode: z.enum(['every', 'ranges']),
        n: z.number().int().min(1).max(500).optional(),
        ranges: rangeText.optional(),
      })
      .refine((p) => (p.mode === 'every' ? p.n !== undefined : p.ranges !== undefined), {
        message: 'the split size is missing',
      }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Split', zh: '拆分方式' },
        kind: 'choice',
        options: [
          { value: 'every', label: { en: 'Every N pages', zh: '每 N 页' } },
          { value: 'ranges', label: { en: 'By page ranges', zh: '按页码范围' } },
        ],
      },
      {
        key: 'n',
        label: { en: 'Pages per file', zh: '每份页数' },
        kind: 'number',
        min: 1,
        max: 500,
        showIf: { key: 'mode', equals: ['every'] },
      },
      {
        key: 'ranges',
        label: { en: 'Ranges (e.g. 1-3; 4-6)', zh: '范围（例如 1-3; 4-6）' },
        kind: 'text',
        showIf: { key: 'mode', equals: ['ranges'] },
      },
    ],
    presets: [
      {
        id: 'single',
        label: { en: 'Every page', zh: '每页一份' },
        values: { mode: 'every', n: 1 },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.pageNumbers',
    label: { en: 'Add page numbers', zh: '加页码' },
    description: { en: 'Add page numbers to every page.', zh: '给每一页加页码。' },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({
      position: z.enum(positions),
      format: z.enum(['n', 'nOfTotal', 'pageNOfTotal']),
      startAt: z.number().int().min(0).max(100000),
      fontSize: z.number().min(6).max(48),
      skipFirst: z.boolean(),
    }),
    fields: [
      positionField(positions),
      {
        key: 'format',
        label: { en: 'Style', zh: '样式' },
        kind: 'choice',
        options: [
          { value: 'n', label: { en: '3', zh: '3' } },
          { value: 'nOfTotal', label: { en: '3 / 10', zh: '3 / 10' } },
          { value: 'pageNOfTotal', label: { en: 'Page 3 of 10', zh: 'Page 3 of 10' } },
        ],
      },
      {
        key: 'startAt',
        label: { en: 'Start at', zh: '起始页码' },
        kind: 'number',
        min: 0,
        max: 100000,
      },
      {
        key: 'fontSize',
        label: { en: 'Size', zh: '字号' },
        kind: 'number',
        unit: 'pt',
        min: 6,
        max: 48,
      },
      { key: 'skipFirst', label: { en: 'Skip the cover page', zh: '封面不编号' }, kind: 'toggle' },
    ],
    requires: [],
  },
  {
    id: 'pdf.stamp',
    label: { en: 'Text stamp', zh: '文字戳' },
    description: {
      en: 'Stamp a line of text (e.g. COPY, Confidential, or the date with {date}) on pages.',
      zh: '在页面上盖一行字（例如「副本」「仅供签证使用」，或用 {date} 盖日期）。',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z
      .strictObject({
        text: z.string().trim().min(1).max(80),
        position: z.enum([...positions, 'center']),
        fontSize: z.number().min(6).max(120),
        color: z.enum(STAMP_COLORS),
        opacity: z.number().int().min(10).max(100),
        angle: z.union([z.literal(0), z.literal(45)]),
        ...ruleSchema,
      })
      .refine(needsRange, { message: 'page numbers are missing' }),
    fields: [
      {
        key: 'text',
        label: { en: 'Text ({date} = today)', zh: '文字（{date} 是今天的日期）' },
        kind: 'text',
        private: true,
      },
      positionField([...positions, 'center']),
      {
        key: 'fontSize',
        label: { en: 'Size', zh: '字号' },
        kind: 'number',
        unit: 'pt',
        min: 6,
        max: 120,
      },
      {
        key: 'color',
        label: { en: 'Color', zh: '颜色' },
        kind: 'choice',
        options: [
          { value: '#000000', label: { en: 'Black', zh: '黑' } },
          { value: '#C92A2A', label: { en: 'Red', zh: '红' } },
          { value: '#1864AB', label: { en: 'Blue', zh: '蓝' } },
          { value: '#868E96', label: { en: 'Gray', zh: '灰' } },
        ],
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
        key: 'angle',
        label: { en: 'Angle', zh: '角度' },
        kind: 'choice',
        options: [
          { value: 0, label: { en: 'Straight', zh: '水平' } },
          { value: 45, label: { en: 'Diagonal', zh: '斜 45°' } },
        ],
      },
      ...ruleFields,
    ],
    presets: [
      {
        id: 'copy',
        label: { en: 'COPY', zh: 'COPY' },
        values: {
          text: 'COPY',
          position: 'topRight',
          fontSize: 18,
          color: '#C92A2A',
          opacity: 80,
          angle: 0,
          rule: 'all',
        },
      },
      {
        id: 'date',
        label: { en: 'Date', zh: '日期' },
        values: {
          text: '{date}',
          position: 'topRight',
          fontSize: 12,
          color: '#000000',
          opacity: 100,
          angle: 0,
          rule: 'all',
        },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.toImages',
    label: { en: 'PDF to images', zh: 'PDF 转图片' },
    description: {
      en: 'Turn every page into a JPG image (long side in pixels).',
      zh: '把每一页变成一张 JPG 图片（按长边像素）。',
    },
    input: ['pdf'],
    output: 'images',
    params: z.strictObject({ maxSide: z.number().int().min(400).max(4000) }),
    fields: [
      {
        key: 'maxSide',
        label: { en: 'Long side', zh: '长边' },
        kind: 'choice',
        options: [
          { value: 1200, label: { en: '1200 px (screen)', zh: '1200 像素（屏幕）' } },
          { value: 2000, label: { en: '2000 px (sharp)', zh: '2000 像素（清晰）' } },
          { value: 3300, label: { en: '3300 px (print)', zh: '3300 像素（打印）' } },
        ],
      },
    ],
    pack: 'pdfview',
    requires: [],
  },
  {
    id: 'pdf.extractText',
    label: { en: 'Get text from PDF', zh: '提取 PDF 文字' },
    description: {
      en: 'Read the text of a PDF that has a text layer. Scanned PDFs have no text — use text recognition instead. The text stays on this device.',
      zh: '读出 PDF 里的文字（有文字层的 PDF）。扫描件没有文字，需要用文字识别。文字只留在本机。',
    },
    input: ['pdf'],
    output: 'text',
    params: z.strictObject({}),
    fields: [],
    pack: 'pdfview',
    requires: [],
  },
  {
    id: 'pdf.sign',
    label: { en: 'Sign', zh: '签名' },
    description: {
      en: 'The user draws or picks a saved signature and places it on a page.',
      zh: '用户画一个签名（或用存好的签名），放到页面上的位置。',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({}),
    fields: [],
    local: 'sign',
    pack: 'pdfview',
    requires: [],
  },
  {
    id: 'pdf.fillForm',
    label: { en: 'Fill in form', zh: '填写表单' },
    description: {
      en: 'The user fills in the PDF form fields on the device; flatten makes them uneditable.',
      zh: '用户在手机上填写 PDF 表单；拍平后不能再改。',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({
      flatten: z.boolean(),
      /** 没有可填的字段时：stop 报错（默认），skip 原样交给下一步（签回表格时有的 PDF 只需要签名）。 */
      whenNoFields: z.enum(['stop', 'skip']).optional(),
    }),
    fields: [
      { key: 'flatten', label: { en: 'Flatten', zh: '拍平（填好后不能再改）' }, kind: 'toggle' },
      {
        key: 'whenNoFields',
        label: { en: 'If the PDF has no form fields', zh: '没有表单字段时' },
        kind: 'choice',
        options: [
          { value: 'stop', label: { en: 'Stop', zh: '停下提示' } },
          { value: 'skip', label: { en: 'Skip this step', zh: '跳过这一步' } },
        ],
      },
    ],
    local: 'fillForm',
    requires: [],
  },
];

const pickPdf = (min: number, max: number) => ({
  id: 'pick',
  action: 'in.files',
  params: { accept: 'pdf', min, max },
});

/** 单功能工作流（D-061）。合并 PDF（pdf-merge）保持原来的 ID 和步骤。 */
export function pdfWorkflows(locale: Locale): Workflow[] {
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    toolId: PDF_TOOL_ID,
    name: t(locale, ...name),
    steps,
  });
  return [
    wf(
      'pdf-merge',
      ['Merge PDFs', '合并 PDF'],
      [
        { id: 'select', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } },
        { id: 'merge', action: 'pdf.merge', params: {} },
        {
          id: 'name',
          action: 'file.rename',
          params: { template: t(locale, '{sourceName}-merged', '{sourceName}-合并') },
          ask: ['template'],
        },
        { id: 'save', action: 'file.save', params: {} },
      ],
    ),
    wf(
      'pdf-combine',
      ['PDFs and images into one', 'PDF 和图片合成一个'],
      [
        { id: 'pick', action: 'in.files', params: { accept: 'pdfOrImages', min: 1, max: 30 } },
        { id: 'order', action: 'pdf.merge', params: { imagePage: 'a4' } },
      ],
    ),
    wf(
      'pdf-images',
      ['Images to PDF', '图片转 PDF'],
      [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 50 } },
        {
          id: 'run',
          action: 'pdf.fromImages',
          params: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
          ask: ['pageSize', 'maxMB'],
        },
      ],
    ),
    wf(
      'pdf-arrange',
      ['Arrange pages', '整理页面'],
      [pickPdf(1, 1), { id: 'run', action: 'pdf.pages', params: {} }],
    ),
    wf(
      'pdf-extract',
      ['Keep pages', '提取页面'],
      [
        pickPdf(1, 1),
        {
          id: 'run',
          action: 'pdf.selectPages',
          params: { rule: 'range', range: '1' },
          ask: ['rule', 'range'],
        },
      ],
    ),
    wf(
      'pdf-rotate',
      ['Rotate pages', '旋转页面'],
      [
        pickPdf(1, 10),
        {
          id: 'run',
          action: 'pdf.rotate',
          params: { angle: 90, rule: 'all' },
          ask: ['angle', 'rule', 'range'],
        },
      ],
    ),
    wf(
      'pdf-split',
      ['Split', '拆分'],
      [
        pickPdf(1, 1),
        {
          id: 'run',
          action: 'pdf.split',
          params: { mode: 'every', n: 1 },
          ask: ['mode', 'n', 'ranges'],
        },
      ],
    ),
    wf(
      'pdf-numbers',
      ['Page numbers', '加页码'],
      [
        pickPdf(1, 10),
        {
          id: 'run',
          action: 'pdf.pageNumbers',
          params: {
            position: 'bottomCenter',
            format: 'nOfTotal',
            startAt: 1,
            fontSize: 10,
            skipFirst: false,
          },
        },
      ],
    ),
    wf(
      'pdf-fill',
      ['Fill in a form', '填表'],
      [pickPdf(1, 1), { id: 'run', action: 'pdf.fillForm', params: { flatten: true } }],
    ),
    wf(
      'pdf-sign',
      ['Sign a PDF', '签名'],
      [pickPdf(1, 1), { id: 'run', action: 'pdf.sign', params: {} }],
    ),
    wf(
      'pdf-toimages',
      ['PDF to images', 'PDF 转图片'],
      [
        pickPdf(1, 5),
        { id: 'run', action: 'pdf.toImages', params: { maxSide: 2000 }, ask: ['maxSide'] },
      ],
    ),
    wf(
      'pdf-text',
      ['Get text', '提取文字'],
      [pickPdf(1, 1), { id: 'run', action: 'pdf.extractText', params: {} }],
    ),
    wf(
      'pdf-stamp',
      ['Text stamp', '文字戳'],
      [
        pickPdf(1, 10),
        {
          id: 'run',
          action: 'pdf.stamp',
          params: {
            text: t(locale, 'COPY', '副本'),
            position: 'topRight',
            fontSize: 18,
            color: '#C92A2A',
            opacity: 80,
            angle: 0,
            rule: 'all',
          },
          ask: ['text'],
        },
      ],
    ),
  ];
}

export const pdfTool: ToolDefinition = {
  id: PDF_TOOL_ID,
  version: '2.1.0',
  name: { en: 'PDF', zh: 'PDF' },
  description: {
    en: 'Merge, convert, arrange, split, number, stamp, sign and fill in PDFs on this device.',
    zh: '在本机合并 PDF、图片转 PDF、整理和拆分页面、加页码和文字戳、签名、填表。',
  },
  icon: 'document',
  aliases: ['pdf', 'pdf tool', 'pdf 工具'],
  permissions: ['files.pick', 'files.write', 'photos.save', 'camera'],
  actions: PDF_ACTIONS,
  createPage: (locale) => ({
    id: PDF_PAGE_ID,
    title: 'PDF',
    icon: 'document',
    toolId: PDF_TOOL_ID,
    components: [
      {
        id: 'pdf-header',
        type: 'header',
        props: { title: t(locale, 'PDF tools', 'PDF 工具') },
      },
      {
        id: 'pdf-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Everything runs on this device; nothing is uploaded.',
            '全部在本机处理，不会上传。',
          ),
        },
      },
      ...pdfWorkflows(locale).map((wf) => ({
        id: wf.id === PDF_MERGE_WORKFLOW_ID ? 'pdf-runner' : `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
      {
        id: 'pdf-files',
        type: 'fileList',
        props: {
          title: t(locale, 'PDF files', 'PDF 文件'),
          limit: 10,
          mimeType: 'application/pdf',
        },
      },
    ],
  }),
  createWorkflows: pdfWorkflows,
};
