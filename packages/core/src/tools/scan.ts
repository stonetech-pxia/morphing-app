import { z } from 'zod';

import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 扫描工具的清单（T5）：找边和透视矫正在 iOS 上用系统的 Vision / Core Image（D-084），
// 其他平台用扫描包（WebView + OpenCV.js + jscanify）；四个角由用户在本地调整（找边在背景杂乱或纸张出画时会出错）；
// 系统文档相机拍的页面已经拉正，直接放行。增强用 Skia，不需要扩展包。

export const SCAN_TOOL_ID = 'scan';
export const SCAN_PAGE_ID = 'tool-scan';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

export const ENHANCE_MODES = ['auto', 'gray', 'bw', 'none'] as const;

export const SCAN_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'scan.detect',
    label: { en: 'Find edges and straighten', zh: '找边并拉正' },
    description: {
      en: 'Finds the edges of the paper in each photo; the user checks or drags the four corners; then the page is straightened. Pages from the document camera are already straight and pass through.',
      zh: '在每张照片里找到纸张的边，用户确认或拖动四个角，然后把页面拉正。文档相机扫描的页面已经拉正，直接通过。',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({}),
    fields: [],
    local: 'corners',
    pack: 'scan',
    requires: [],
  },
  {
    id: 'scan.enhance',
    label: { en: 'Enhance', zh: '增强' },
    description: {
      en: 'Makes scanned pages easier to read: brighter (auto), grayscale, or black and white.',
      zh: '让扫描的页面更清楚：自动提亮、灰度或黑白。',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ mode: z.enum(ENHANCE_MODES) }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Look', zh: '效果' },
        kind: 'choice',
        options: [
          { value: 'auto', label: { en: 'Brighter', zh: '提亮' } },
          { value: 'gray', label: { en: 'Grayscale', zh: '灰度' } },
          { value: 'bw', label: { en: 'Black and white', zh: '黑白' } },
          { value: 'none', label: { en: 'Original', zh: '原样' } },
        ],
      },
    ],
    requires: [],
  },
];

const toPdf = {
  id: 'pdf',
  action: 'pdf.fromImages',
  params: { pageSize: 'a4', orientation: 'auto', marginMm: 0, fit: 'contain', maxMB: 0 },
};

/** 单功能工作流（D-061）。 */
export function scanWorkflows(locale: Locale): Workflow[] {
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    toolId: SCAN_TOOL_ID,
    name: t(locale, ...name),
    steps,
  });
  const name = {
    id: 'name',
    action: 'file.rename',
    params: { template: t(locale, 'Scan {date}', '扫描-{date}') },
  };
  return [
    wf(
      'scan-camera',
      ['Scan to PDF', '扫描成 PDF'],
      [
        { id: 'shoot', action: 'in.photos', params: { source: 'scanner', min: 1, max: 30 } },
        { id: 'edges', action: 'scan.detect', params: {} },
        { id: 'look', action: 'scan.enhance', params: { mode: 'auto' }, ask: ['mode'] },
        toPdf,
        name,
      ],
    ),
    wf(
      'scan-library',
      ['Scan photos to PDF', '照片扫描成 PDF'],
      [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } },
        { id: 'edges', action: 'scan.detect', params: {} },
        { id: 'look', action: 'scan.enhance', params: { mode: 'auto' }, ask: ['mode'] },
        toPdf,
        name,
      ],
    ),
    wf(
      'scan-straighten',
      ['Straighten photos of paper', '拉正纸张照片'],
      [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 30 } },
        { id: 'edges', action: 'scan.detect', params: {} },
      ],
    ),
  ];
}

export const scanTool: ToolDefinition = {
  id: SCAN_TOOL_ID,
  version: '1.0.0',
  name: { en: 'Scanner', zh: '扫描' },
  description: {
    en: 'Turn photos of paper into straight, clean pages and PDFs on this device.',
    zh: '在本机把拍下的纸张拉正、变清楚，合成 PDF。',
  },
  icon: 'scan',
  aliases: ['scan', 'scanner', 'document scanner', '扫描', '扫描仪'],
  permissions: ['files.pick', 'files.write', 'photos.save', 'camera'],
  actions: SCAN_ACTIONS,
  createPage: (locale) => ({
    id: SCAN_PAGE_ID,
    title: t(locale, 'Scanner', '扫描'),
    icon: 'scan',
    toolId: SCAN_TOOL_ID,
    components: [
      { id: 'scan-header', type: 'header', props: { title: t(locale, 'Scanner', '扫描') } },
      {
        id: 'scan-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Everything runs on this device; nothing is uploaded. iPhone uses its built-in scanner; on other devices the first scan downloads the scanner pack.',
            '全部在本机处理，不会上传。iPhone 用系统自带的扫描；其他设备第一次扫描时需要下载扫描包。',
          ),
        },
      },
      ...scanWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
      {
        id: 'scan-files',
        type: 'fileList',
        props: {
          title: t(locale, 'Scans', '扫描件'),
          limit: 10,
          mimeType: 'application/pdf',
        },
      },
    ],
  }),
  createWorkflows: scanWorkflows,
};
