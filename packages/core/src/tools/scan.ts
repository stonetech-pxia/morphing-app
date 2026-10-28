import { t, pairText } from '../messages';
import { z } from 'zod';

import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 扫描工具的清单（T5）：找边和透视矫正在 iOS 上用系统的 Vision / Core Image（D-086），
// 其他平台用扫描包（WebView + OpenCV.js + jscanify）；拍照扫描用系统文档相机（iOS 的 VisionKit、Android 的 ML Kit）；四个角由用户在本地调整（找边在背景杂乱或纸张出画时会出错）；
// 系统文档相机拍的页面已经拉正，直接放行。增强用 Skia（D-266：去阴影、纠偏、自动彩色或灰度、黑白用局部阈值），不需要扩展包。

export const SCAN_TOOL_ID = 'scan';
export const SCAN_PAGE_ID = 'tool-scan';

export const ENHANCE_MODES = ['auto', 'gray', 'bw', 'none'] as const;

export const SCAN_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'scan.detect',
    label: {
      en: 'Find edges and straighten',
      zh: '找边并拉正',
      fr: 'Trouver les bords et redresser',
    },
    description: {
      en: 'Finds the edges of the paper in each photo; the user checks or drags the four corners; then the page is straightened. Pages from the document camera are already straight and pass through.',
      zh: '在每张照片里找到纸张的边，用户确认或拖动四个角，然后把页面拉正。文档相机扫描的页面已经拉正，直接通过。',
      fr: 'Recherche les bords du papier dans chaque photo ; vous vérifiez ou faites glisser les quatre coins, puis la page est redressée. Les pages de la caméra de document sont déjà droites et sont conservées telles quelles.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({}),
    fields: [],
    local: 'corners',
    pack: 'scan',
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [{ match: /^(?:扫描|找边|拉正)$|^(?:scan|straighten)$/i }],
  },
  {
    id: 'scan.enhance',
    label: { en: 'Enhance', zh: '增强', fr: 'Améliorer' },
    description: {
      en: 'Makes scanned pages easier to read: removes shadows, turns the paper white and straightens slightly tilted text. Auto keeps color only when the page has colored ink; grayscale and black and white are also available.',
      zh: '让扫描的页面更清楚：去掉阴影，把纸变白，把轻微歪斜的文字转正。「自动」只在页面上有彩色字迹时保留颜色；也可以选灰度或黑白。',
      fr: 'Rend les pages numérisées plus lisibles : supprime les ombres, blanchit le papier et redresse le texte légèrement penché. Automatique ne garde la couleur que si la page contient de l’encre de couleur ; niveaux de gris et noir et blanc sont aussi proposés.',
    },
    input: ['images'],
    output: 'images',
    params: z.strictObject({ mode: z.enum(ENHANCE_MODES) }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Look', zh: '效果', fr: 'Rendu' },
        kind: 'choice',
        options: [
          { value: 'auto', label: { en: 'Auto', zh: '自动', fr: 'Automatique' } },
          { value: 'gray', label: { en: 'Grayscale', zh: '灰度', fr: 'Niveaux de gris' } },
          { value: 'bw', label: { en: 'Black and white', zh: '黑白', fr: 'Noir et blanc' } },
          { value: 'none', label: { en: 'Original', zh: '原样', fr: 'Original' } },
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
    name: pairText(locale, name),
    steps,
  });
  const name = {
    id: 'name',
    action: 'file.rename',
    params: { template: t(locale, 'scan_Scan_5b295') },
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
  name: { en: 'Scanner', zh: '扫描', fr: 'Numériser' },
  description: {
    en: 'Turn photos of paper into straight, clean pages and PDFs on this device.',
    zh: '在本机把拍下的纸张拉正、变清楚，合成 PDF。',
    fr: 'Transformez les photos de papier en pages droites et nettes, et en PDF, sur cet appareil.',
  },
  icon: 'scan',
  aliases: ['scan', 'scanner', 'document scanner', '扫描', '扫描仪'],
  permissions: ['files.pick', 'files.write', 'photos.save', 'camera'],
  actions: SCAN_ACTIONS,
  createPage: (locale) => ({
    id: SCAN_PAGE_ID,
    title: t(locale, 'scan_Scanner_08f22'),
    icon: 'scan',
    toolId: SCAN_TOOL_ID,
    components: [
      { id: 'scan-header', type: 'header', props: { title: t(locale, 'scan_Scanner_08f22') } },
      {
        id: 'scan-intro',
        type: 'text',
        props: {
          text: t(locale, 'scan_Everything_runs_on_this_device_nothing_09e42'),
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
          title: t(locale, 'scan_Scans_7ac9d'),
          limit: 10,
          mimeType: 'application/pdf',
        },
      },
    ],
  }),
  createWorkflows: scanWorkflows,
};
