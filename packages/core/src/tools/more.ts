import { t, pairText } from '../messages';
import { z } from 'zod';

import { RECORD_TEMPLATES } from '../html';
import type { ToolDefinition } from '../registry';
import type { IconName, Locale, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// T6 的小工具：压缩包（fflate）、二维码（lean-qr / jsQR）、文字转 PDF、用记录生成 PDF。
// 实现分别在 packages/tool-archive、packages/tool-qr、core/html.ts 和 App 运行时（expo-print）。

const pageSizeField = {
  key: 'pageSize',
  label: { en: 'Paper', zh: '纸张' },
  kind: 'choice',
  options: [
    { value: 'a4', label: { en: 'A4', zh: 'A4' } },
    { value: 'letter', label: { en: 'Letter', zh: 'Letter' } },
  ],
} as const;

/** 一个工具：单功能工作流放在工具页上，每个一个运行卡片。 */
function simpleTool(spec: {
  id: string;
  version: string;
  name: [string, string];
  description: [string, string];
  intro: [string, string];
  icon: IconName;
  aliases: string[];
  actions: readonly ActionDefinition[];
  workflows: (locale: Locale) => Workflow[];
  permissions: ToolDefinition['permissions'];
}): ToolDefinition {
  const pageId = `tool-${spec.id}`;
  const createWorkflows = (locale: Locale) =>
    spec.workflows(locale).map((wf) => ({ ...wf, toolId: spec.id }));
  return {
    id: spec.id,
    version: spec.version,
    name: { en: spec.name[0], zh: spec.name[1] },
    description: { en: spec.description[0], zh: spec.description[1] },
    icon: spec.icon,
    aliases: spec.aliases,
    permissions: spec.permissions,
    actions: spec.actions,
    createPage: (locale) => ({
      id: pageId,
      title: pairText(locale, spec.name),
      icon: spec.icon,
      toolId: spec.id,
      components: [
        { id: `${spec.id}-header`, type: 'header', props: { title: pairText(locale, spec.name) } },
        { id: `${spec.id}-intro`, type: 'text', props: { text: pairText(locale, spec.intro) } },
        ...createWorkflows(locale).map((wf) => ({
          id: `${wf.id}-runner`,
          type: 'workflowRunner' as const,
          props: { workflowId: wf.id },
        })),
      ],
    }),
    createWorkflows,
  };
}

// ---- 压缩包 ----

export const ZIP_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'zip.create',
    label: { en: 'Make a ZIP', zh: '打包成 ZIP' },
    description: {
      en: 'Put all the files into one ZIP archive (photos are stored as they are; documents are compressed).',
      zh: '把所有文件打包成一个 ZIP（照片原样存入，文档会压缩）。',
    },
    input: ['files'],
    output: 'zip',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'zip.extract',
    label: { en: 'Unzip', zh: '解压' },
    description: {
      en: 'Take the files out of a ZIP archive (password-protected archives are not supported).',
      zh: '把 ZIP 里的文件取出来（不支持带密码的压缩包）。',
    },
    input: ['zip'],
    output: 'files',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
];

export const zipTool = simpleTool({
  id: 'zip',
  version: '1.0.0',
  name: ['ZIP', '压缩包'],
  description: [
    'Make ZIP archives from files or photos, and unzip archives, on this device.',
    '在本机把文件或照片打包成 ZIP，或者解压 ZIP。',
  ],
  intro: ['Everything runs on this device; nothing is uploaded.', '全部在本机处理，不会上传。'],
  icon: 'archive',
  aliases: ['zip', 'archive', 'unzip', '压缩包', '打包', '解压'],
  permissions: ['files.pick', 'files.write'],
  actions: ZIP_ACTIONS,
  workflows: (locale) => [
    {
      id: 'zip-files',
      name: t(locale, 'more_ZIP_files_d8402'),
      steps: [
        { id: 'pick', action: 'in.files', params: { accept: 'any', min: 1, max: 50 } },
        { id: 'zip', action: 'zip.create', params: {} },
        {
          id: 'name',
          action: 'file.rename',
          params: { template: t(locale, 'more_Files_0e973') },
          ask: ['template'],
        },
      ],
    },
    {
      id: 'zip-photos',
      name: t(locale, 'more_ZIP_photos_b72f4'),
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 50 } },
        { id: 'zip', action: 'zip.create', params: {} },
        {
          id: 'name',
          action: 'file.rename',
          params: { template: t(locale, 'more_Photos_c2260') },
          ask: ['template'],
        },
      ],
    },
    {
      id: 'zip-extract',
      name: t(locale, 'more_Unzip_cc21e'),
      steps: [
        { id: 'pick', action: 'in.files', params: { accept: 'zip', min: 1, max: 1 } },
        { id: 'unzip', action: 'zip.extract', params: {} },
      ],
    },
  ],
});

// ---- 二维码 ----

export const QR_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'qr.generate',
    label: { en: 'Make a QR code', zh: '生成二维码' },
    description: {
      en: 'Turn the text (a link, Wi-Fi details, contact) into a QR code image (PNG).',
      zh: '把文字（链接、Wi-Fi 信息、联系方式）变成二维码图片（PNG）。',
    },
    input: ['text'],
    output: 'images',
    params: z.strictObject({
      sizePx: z.number().int().min(200).max(2000),
      ecc: z.enum(['L', 'M', 'Q', 'H']),
    }),
    fields: [
      {
        key: 'sizePx',
        label: { en: 'Size', zh: '大小' },
        kind: 'choice',
        options: [
          { value: 600, label: { en: '600 px (screen)', zh: '600 像素（屏幕）' } },
          { value: 1200, label: { en: '1200 px (print)', zh: '1200 像素（打印）' } },
        ],
      },
      {
        key: 'ecc',
        label: { en: 'Error correction', zh: '容错' },
        kind: 'choice',
        options: [
          { value: 'L', label: { en: 'Low', zh: '低' } },
          { value: 'M', label: { en: 'Medium', zh: '中' } },
          { value: 'Q', label: { en: 'High', zh: '较高' } },
          { value: 'H', label: { en: 'Highest', zh: '最高' } },
        ],
      },
    ],
    presets: [
      { id: 'screen', label: { en: 'Screen', zh: '屏幕' }, values: { sizePx: 600, ecc: 'M' } },
    ],
    requires: [],
  },
  {
    id: 'qr.read',
    label: { en: 'Read QR codes', zh: '识别二维码' },
    description: {
      en: 'Find and read the QR code in each image. The text stays on this device.',
      zh: '找出每张图片里的二维码并读出内容。内容只留在本机。',
    },
    input: ['images'],
    output: 'text',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
];

export const qrTool = simpleTool({
  id: 'qr',
  version: '1.1.0',
  name: ['QR code', '二维码'],
  description: [
    'Make QR codes from text, and read QR codes in photos and screenshots, on this device.',
    '在本机把文字做成二维码，或者识别照片和截图里的二维码。',
  ],
  intro: ['Everything runs on this device; nothing is uploaded.', '全部在本机处理，不会上传。'],
  icon: 'qrcode',
  aliases: ['qr', 'qr code', 'qrcode', '二维码', '扫码'],
  permissions: ['files.pick', 'files.write', 'photos.save'],
  actions: QR_ACTIONS,
  workflows: (locale) => [
    {
      id: 'qr-make',
      name: t(locale, 'more_Make_a_QR_code_7011a'),
      steps: [
        { id: 'type', action: 'in.text', params: { text: '' }, ask: ['text'] },
        { id: 'make', action: 'qr.generate', params: { sizePx: 600, ecc: 'M' } },
      ],
    },
    {
      // D-199：给客人连 Wi-Fi 的码。每次问网络名和加密方式，密码总是问、不保存。
      id: 'qr-wifi',
      name: t(locale, 'more_Wi_Fi_QR_code_12af4'),
      steps: [
        {
          id: 'wifi',
          action: 'in.wifi',
          params: { network: '', security: 'WPA', hidden: false },
          ask: ['network', 'security'],
        },
        { id: 'make', action: 'qr.generate', params: { sizePx: 1200, ecc: 'M' } },
      ],
    },
    {
      id: 'qr-read',
      name: t(locale, 'more_Read_a_QR_code_df393'),
      steps: [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
        { id: 'read', action: 'qr.read', params: {} },
      ],
    },
  ],
});

// ---- 文字 ----

export const TEXT_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'text.toPdf',
    label: { en: 'Text to PDF', zh: '文字转 PDF' },
    description: {
      en: 'Lay the text out on pages as a PDF (system fonts, so Chinese and Japanese work).',
      zh: '把文字排成 PDF（用系统字体，中文、日文都能显示）。',
    },
    input: ['text'],
    output: 'pdf',
    params: z.strictObject({
      pageSize: z.enum(['a4', 'letter']),
      fontSize: z.number().min(8).max(24),
    }),
    fields: [
      pageSizeField,
      {
        key: 'fontSize',
        label: { en: 'Text size', zh: '字号' },
        kind: 'number',
        unit: 'pt',
        min: 8,
        max: 24,
      },
    ],
    presets: [
      { id: 'a4', label: { en: 'A4', zh: 'A4' }, values: { pageSize: 'a4', fontSize: 12 } },
    ],
    requires: [],
  },
  {
    id: 'text.toFile',
    label: { en: 'Text to file', zh: '存成文字文件' },
    description: {
      en: 'Save the text as a .txt file (UTF-8).',
      zh: '把文字存成 .txt 文件（UTF-8）。',
    },
    input: ['text'],
    output: 'files',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'text.copy',
    label: { en: 'Copy text', zh: '复制文字' },
    description: { en: 'Copy the text to the clipboard.', zh: '把文字复制到剪贴板。' },
    input: ['text'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
];

export const textTool = simpleTool({
  id: 'text',
  version: '1.0.0',
  name: ['Text', '文字'],
  description: [
    'Turn typed or pasted text into a PDF or a text file, on this device.',
    '在本机把输入或粘贴的文字变成 PDF 或文字文件。',
  ],
  intro: ['The text stays on this device.', '文字只留在本机。'],
  icon: 'note',
  aliases: ['text', 'text to pdf', '文字', '文字转pdf', '文字转 pdf'],
  permissions: ['files.write'],
  actions: TEXT_ACTIONS,
  workflows: (locale) => [
    {
      id: 'text-pdf',
      name: t(locale, 'more_Text_to_PDF_ac970'),
      steps: [
        { id: 'type', action: 'in.text', params: { text: '' }, ask: ['text'] },
        { id: 'pdf', action: 'text.toPdf', params: { pageSize: 'a4', fontSize: 12 } },
      ],
    },
  ],
});

// ---- 用记录生成 PDF ----

export const PRINT_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'print.records',
    label: { en: 'Records to PDF', zh: '记录生成 PDF' },
    description: {
      en: 'Make a PDF from the records with a fixed template: table, cards, or receipt (table with a total of the first money field). The values are filled in on the device; only the template, title and field names are settings.',
      zh: '用固定模板把记录做成 PDF：表格、卡片，或清单（表格加第一个金额字段的合计）。记录内容在本机填进去，设置里只有模板、标题和字段。',
    },
    input: ['records'],
    output: 'pdf',
    params: z.strictObject({
      template: z.enum(RECORD_TEMPLATES),
      title: z.string().trim().max(60),
      fields: z.array(z.string().max(40)).max(12),
      pageSize: z.enum(['a4', 'letter']),
    }),
    fields: [
      {
        key: 'template',
        label: { en: 'Template', zh: '模板' },
        kind: 'choice',
        options: [
          { value: 'table', label: { en: 'Table', zh: '表格' } },
          { value: 'cards', label: { en: 'Cards', zh: '卡片' } },
          { value: 'receipt', label: { en: 'With total', zh: '带合计的清单' } },
        ],
      },
      { key: 'title', label: { en: 'Title', zh: '标题' }, kind: 'text' },
      {
        key: 'fields',
        label: { en: 'Fields (none = all)', zh: '字段（不选 = 全部）' },
        kind: 'fields',
      },
      pageSizeField,
    ],
    requires: [],
  },
];

export const printTool = simpleTool({
  id: 'print',
  version: '1.0.0',
  name: ['Reports', '报表'],
  description: [
    'Turn the records in your data tables into a PDF report, list or receipt to share or print.',
    '把数据表里的记录做成 PDF（报表、清单、收据），可以分享或打印。',
  ],
  intro: [
    'Your records are filled in on this device and never uploaded. To make a report, ask AI (for example \u201cMake a PDF of this month\u2019s expenses\u201d) or add a quick action on the Quick actions page.',
    '记录在本机填进模板，不会上传。要做报表，可以对 AI 说「把本月的报销记录做成 PDF」，或者在「快捷操作」页新建。',
  ],
  icon: 'printer',
  aliases: ['print', 'report', 'records to pdf', '打印', '报表', '记录生成pdf'],
  permissions: ['files.write'],
  actions: PRINT_ACTIONS,
  // 报表要先有数据表：工作流由用户或 AI 按自己的表创建（in.records → print.records）。
  workflows: () => [],
});
