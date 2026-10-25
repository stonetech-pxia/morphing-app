import { t, pairText } from '../messages';
import { z } from 'zod';

import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition, ParamField } from '../workflow/contract';

// 内置 PDF 工具的清单（Tool Manifest）。动作的真实实现在 packages/tool-pdf（pdf-lib）
// 和 App 运行时中；这里只声明契约，供校验、预览和 mock AI 使用。

export const PDF_TOOL_ID = 'pdf';
export const PDF_PAGE_ID = 'tool-pdf';
export const PDF_MERGE_WORKFLOW_ID = 'pdf-merge';

/** 按页码选页的规则：AI 只能选这些符号规则，看不到文件内容（open-tool-research N4）。 */
export const PAGE_RULES = ['all', 'odd', 'even', 'first', 'last', 'range'] as const;

const ruleFields: ParamField[] = [
  {
    key: 'rule',
    label: { en: 'Pages', zh: '哪些页', fr: 'Pages' },
    kind: 'choice',
    options: [
      { value: 'all', label: { en: 'All', zh: '全部', fr: 'Tout' } },
      { value: 'odd', label: { en: 'Odd', zh: '奇数页', fr: 'Impaires' } },
      { value: 'even', label: { en: 'Even', zh: '偶数页', fr: 'Paires' } },
      { value: 'first', label: { en: 'First', zh: '第一页', fr: 'Première page' } },
      { value: 'last', label: { en: 'Last', zh: '最后一页', fr: 'Dernière page' } },
      { value: 'range', label: { en: 'Page numbers', zh: '指定页码', fr: 'Numéros de pages' } },
    ],
  },
  {
    key: 'range',
    label: {
      en: 'Page numbers (e.g. 1-3, 5)',
      zh: '页码（例如 1-3, 5）',
      fr: 'Numéros de pages (par ex. 1-3, 5)',
    },
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
    label: { en: 'Page size', zh: '纸张', fr: 'Format du papier' },
    kind: 'choice',
    options: [
      { value: 'a4', label: { en: 'A4', zh: 'A4', fr: 'A4' } },
      { value: 'letter', label: { en: 'Letter', zh: 'Letter', fr: 'Letter' } },
      { value: 'fit', label: { en: 'Same as image', zh: '跟随图片', fr: 'Comme l’image' } },
    ],
  },
  {
    key: 'orientation',
    label: { en: 'Orientation', zh: '方向', fr: 'Orientation' },
    kind: 'choice',
    options: [
      { value: 'auto', label: { en: 'Automatic', zh: '自动', fr: 'Automatique' } },
      { value: 'portrait', label: { en: 'Portrait', zh: '竖向', fr: 'Portrait' } },
      { value: 'landscape', label: { en: 'Landscape', zh: '横向', fr: 'Paysage' } },
    ],
    showIf: { key: 'pageSize', equals: ['a4', 'letter'] },
  },
  {
    key: 'marginMm',
    label: { en: 'Margin', zh: '边距', fr: 'Marges' },
    kind: 'number',
    unit: 'mm',
    min: 0,
    max: 30,
  },
  {
    key: 'fit',
    label: { en: 'Image', zh: '图片', fr: 'Image' },
    kind: 'choice',
    options: [
      {
        value: 'contain',
        label: { en: 'Show whole image', zh: '完整显示', fr: 'Afficher l’image entière' },
      },
      { value: 'cover', label: { en: 'Fill the page', zh: '铺满页面', fr: 'Remplir la page' } },
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
  label: { en: 'Position', zh: '位置', fr: 'Position' },
  kind: 'choice',
  options: values.map((v) => ({
    value: v,
    label: {
      en: positionLabels[v]![0],
      zh: positionLabels[v]![1],
      fr: pairText('fr', positionLabels[v]!),
    },
  })),
});

export const STAMP_COLORS = ['#000000', '#C92A2A', '#1864AB', '#868E96'] as const;

export const PDF_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'pdf.merge',
    label: { en: 'Merge in order', zh: '按顺序合并', fr: 'Fusionner dans l’ordre' },
    description: {
      en: 'Merge PDFs and images into one PDF, in the order they were chosen. Each image becomes a page.',
      zh: '把 PDF 和图片按选择顺序合并成一个 PDF，每张图片占一页。',
      fr: 'Fusionnez des PDF et des images en un seul PDF, dans l’ordre de sélection. Chaque image devient une page.',
    },
    input: ['files'],
    rejects: ['video', 'audio'],
    output: 'pdf',
    params: z.strictObject({ imagePage: z.enum(['a4', 'letter', 'fit']).optional() }),
    fields: [
      {
        key: 'imagePage',
        label: { en: 'Pages for images', zh: '图片页的纸张', fr: 'Format des pages d’image' },
        kind: 'choice',
        options: [
          { value: 'a4', label: { en: 'A4', zh: 'A4', fr: 'A4' } },
          { value: 'letter', label: { en: 'Letter', zh: 'Letter', fr: 'Letter' } },
          { value: 'fit', label: { en: 'Same as image', zh: '跟随图片', fr: 'Comme l’image' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.fromImages',
    label: { en: 'Images to PDF', zh: '图片转 PDF', fr: 'Images en PDF' },
    description: {
      en: 'Put the images into one PDF (A4, Letter or the image size) with optional margins. Max size (MB) makes the PDF smaller by compressing the images; 0 = no limit. textLayer recognises the text on the device and adds it invisibly, so the PDF can be searched and copied from (Latin-script languages; needs the built-in text recognition).',
      zh: '把图片排成一个 PDF（A4、Letter 或跟随图片），可设边距。「不超过」会压缩图片让 PDF 小于这个大小，0 表示不限。textLayer 在本机识别文字，加一层看不见的字，PDF 就能搜索、复制文字（拉丁字母的语言；要有系统自带的文字识别）。',
      fr: 'Assemblez les images en un seul PDF (A4, Letter ou taille de l’image), avec des marges facultatives. « Taille max (Mo) » réduit la taille des images pour que le PDF soit plus petit ; 0 = pas de limite. textLayer reconnaît le texte sur l’appareil et l’ajoute de façon invisible, pour que le PDF puisse être recherché et copié (langues à alphabet latin ; nécessite la reconnaissance de texte intégrée).',
    },
    input: ['images'],
    output: 'pdf',
    params: z.strictObject({
      pageSize: z.enum(['a4', 'letter', 'fit']),
      orientation: z.enum(['auto', 'portrait', 'landscape']),
      marginMm: z.number().min(0).max(30),
      fit: z.enum(['contain', 'cover']),
      maxMB: z.number().min(0).max(100),
      /** D-195：能搜索、复制文字（旧配置没有这个参数时当作关）。 */
      textLayer: z.boolean().optional(),
    }),
    fields: [
      ...imagePageFields,
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过', fr: 'Au plus' },
        kind: 'number',
        unit: 'MB',
        min: 0,
        max: 100,
        step: 0.5,
      },
      {
        key: 'textLayer',
        label: { en: 'Searchable text', zh: '能搜索、复制文字', fr: 'Texte consultable' },
        kind: 'toggle',
      },
    ],
    presets: [
      {
        id: 'a4',
        label: { en: 'A4', zh: 'A4', fr: 'A4' },
        values: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
      },
      {
        id: 'a4-4mb',
        label: { en: 'A4 ≤ 4 MB', zh: 'A4 ≤ 4 MB', fr: 'A4 ≤ 4 MB' },
        values: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 4 },
      },
      {
        id: 'letter',
        label: { en: 'Letter', zh: 'Letter', fr: 'Letter' },
        values: { pageSize: 'letter', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 0 },
      },
      {
        id: 'fit',
        label: { en: 'Same as image', zh: '跟随图片', fr: 'Comme l’image' },
        values: { pageSize: 'fit', orientation: 'auto', marginMm: 0, fit: 'contain', maxMB: 0 },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.compress',
    label: { en: 'Make PDF smaller', zh: '压缩 PDF', fr: 'Réduire le PDF' },
    description: {
      en: 'Make existing PDFs smaller than a size by recompressing the pictures inside; text stays selectable. If that is not enough, whenTooBig decides: ask the user, turn the pages into pictures (text can no longer be selected), or keep the text and accept a bigger file.',
      zh: '把已有的 PDF 压到不超过某个大小：重新压缩里面的图片，文字仍可选中。不够小时按「压不到时」：问用户、把每页转成图片（文字不能再选中），或保留文字、接受大一点的文件。',
      fr: 'Réduisez des PDF existants à une taille maximale en recompressant les images qu’ils contiennent ; le texte reste sélectionnable. Si ce n’est pas suffisant, whenTooBig décide : demander à l’utilisateur, transformer les pages en images (le texte ne sera plus sélectionnable), ou conserver le texte et accepter un fichier plus volumineux.',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({
      maxMB: z.number().min(0.1).max(100),
      whenTooBig: z.enum(['ask', 'images', 'keepText']),
    }),
    fields: [
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过', fr: 'Au plus' },
        kind: 'number',
        unit: 'MB',
        min: 0.1,
        max: 100,
        step: 0.5,
      },
      {
        key: 'whenTooBig',
        label: {
          en: 'If it cannot get that small',
          zh: '压不到时',
          fr: 'Si la taille ne peut pas être atteinte',
        },
        kind: 'choice',
        options: [
          { value: 'ask', label: { en: 'Ask me', zh: '问我', fr: 'Me demander' } },
          {
            value: 'images',
            label: {
              en: 'Turn pages into pictures',
              zh: '把页面转成图片',
              fr: 'Transformer les pages en images',
            },
          },
          {
            value: 'keepText',
            label: { en: 'Keep the text', zh: '保留文字', fr: 'Conserver le texte' },
          },
        ],
      },
    ],
    presets: [
      {
        id: '2mb',
        label: { en: '2 MB', zh: '2 MB', fr: '2 MB' },
        values: { maxMB: 2, whenTooBig: 'ask' },
      },
      {
        id: '1mb',
        label: { en: '1 MB', zh: '1 MB', fr: '1 MB' },
        values: { maxMB: 1, whenTooBig: 'ask' },
      },
      {
        id: '5mb',
        label: { en: '5 MB', zh: '5 MB', fr: '5 MB' },
        values: { maxMB: 5, whenTooBig: 'ask' },
      },
      {
        id: '10mb',
        label: { en: '10 MB', zh: '10 MB', fr: '10 MB' },
        values: { maxMB: 10, whenTooBig: 'ask' },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.pages',
    label: { en: 'Arrange pages', zh: '整理页面', fr: 'Organiser les pages' },
    description: {
      en: 'The user picks, removes, reorders and rotates pages on the device.',
      zh: '用户在手机上选页、删页、调整顺序和旋转。',
      fr: 'Choisissez, supprimez, réordonnez et faites pivoter les pages sur l’appareil.',
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
    label: { en: 'Keep pages', zh: '提取页面', fr: 'Extraire des pages' },
    description: {
      en: 'Keep only some pages: all, odd, even, first, last or page numbers like 1-3, 5.',
      zh: '只保留部分页：全部、奇数页、偶数页、第一页、最后一页或页码（例如 1-3, 5）。',
      fr: 'Ne garder que certaines pages : toutes, impaires, paires, première, dernière, ou numéros comme 1-3, 5.',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject(ruleSchema).refine(needsRange, { message: 'page numbers are missing' }),
    fields: ruleFields,
    requires: [],
  },
  {
    id: 'pdf.rotate',
    label: { en: 'Rotate pages', zh: '旋转页面', fr: 'Faire pivoter les pages' },
    description: {
      en: 'Rotate some or all pages clockwise.',
      zh: '把部分或全部页面顺时针旋转。',
      fr: 'Faites pivoter certaines pages ou toutes les pages dans le sens horaire.',
    },
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
        label: { en: 'Rotate', zh: '旋转', fr: 'Rotation' },
        kind: 'choice',
        options: [
          { value: 90, label: { en: '90° right', zh: '右转 90°', fr: '90° à droite' } },
          { value: 180, label: { en: '180°', zh: '180°', fr: '180°' } },
          { value: 270, label: { en: '90° left', zh: '左转 90°', fr: '90° à gauche' } },
        ],
      },
      ...ruleFields,
    ],
    requires: [],
  },
  {
    id: 'pdf.split',
    label: { en: 'Split', zh: '拆分', fr: 'Diviser' },
    description: {
      en: 'Split into several PDFs: every N pages, or by page ranges separated by ; (e.g. 1-3; 4-6).',
      zh: '拆成多个 PDF：每 N 页一份，或按页码范围（用分号隔开，例如 1-3; 4-6）。',
      fr: 'Divisez en plusieurs PDF : toutes les N pages, ou par plages de pages séparées par des points-virgules (par ex. 1-3 ; 4-6).',
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
        label: { en: 'Split', zh: '拆分方式', fr: 'Mode de division' },
        kind: 'choice',
        options: [
          {
            value: 'every',
            label: { en: 'Every N pages', zh: '每 N 页', fr: 'Toutes les N pages' },
          },
          {
            value: 'ranges',
            label: { en: 'By page ranges', zh: '按页码范围', fr: 'Par plages de pages' },
          },
        ],
      },
      {
        key: 'n',
        label: { en: 'Pages per file', zh: '每份页数', fr: 'Pages par fichier' },
        kind: 'number',
        min: 1,
        max: 500,
        showIf: { key: 'mode', equals: ['every'] },
      },
      {
        key: 'ranges',
        label: {
          en: 'Ranges (e.g. 1-3; 4-6)',
          zh: '范围（例如 1-3; 4-6）',
          fr: 'Plages (par ex. 1-3 ; 4-6)',
        },
        kind: 'text',
        showIf: { key: 'mode', equals: ['ranges'] },
      },
    ],
    presets: [
      {
        id: 'single',
        label: { en: 'Every page', zh: '每页一份', fr: 'Chaque page' },
        values: { mode: 'every', n: 1 },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.pageNumbers',
    label: { en: 'Add page numbers', zh: '加页码', fr: 'Ajouter des numéros de page' },
    description: {
      en: 'Add page numbers to every page.',
      zh: '给每一页加页码。',
      fr: 'Ajoutez un numéro sur chaque page.',
    },
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
        label: { en: 'Style', zh: '样式', fr: 'Style' },
        kind: 'choice',
        options: [
          { value: 'n', label: { en: '3', zh: '3', fr: '3' } },
          { value: 'nOfTotal', label: { en: '3 / 10', zh: '3 / 10', fr: '3 / 10' } },
          {
            value: 'pageNOfTotal',
            label: { en: 'Page 3 of 10', zh: 'Page 3 of 10', fr: 'Page 3 of 10' },
          },
        ],
      },
      {
        key: 'startAt',
        label: { en: 'Start at', zh: '起始页码', fr: 'Commencer à' },
        kind: 'number',
        min: 0,
        max: 100000,
      },
      {
        key: 'fontSize',
        label: { en: 'Size', zh: '字号', fr: 'Taille' },
        kind: 'number',
        unit: 'pt',
        min: 6,
        max: 48,
      },
      {
        key: 'skipFirst',
        label: {
          en: 'Skip the cover page',
          zh: '封面不编号',
          fr: 'Ne pas numéroter la page de couverture',
        },
        kind: 'toggle',
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.stamp',
    label: { en: 'Text stamp', zh: '文字戳', fr: 'Tampon texte' },
    description: {
      en: 'Stamp a line of text (e.g. COPY, Confidential, or the date with {date}) on pages.',
      zh: '在页面上盖一行字（例如「副本」「仅供签证使用」，或用 {date} 盖日期）。',
      fr: 'Apposez une ligne de texte (par ex. « COPIE », « Confidentiel », ou la date avec {date}) sur les pages.',
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
        label: {
          en: 'Text ({date} = today)',
          zh: '文字（{date} 是今天的日期）',
          fr: 'Texte ({date} = aujourd’hui)',
        },
        kind: 'text',
        private: true,
      },
      positionField([...positions, 'center']),
      {
        key: 'fontSize',
        label: { en: 'Size', zh: '字号', fr: 'Taille' },
        kind: 'number',
        unit: 'pt',
        min: 6,
        max: 120,
      },
      {
        key: 'color',
        label: { en: 'Color', zh: '颜色', fr: 'Couleur' },
        kind: 'choice',
        options: [
          { value: '#000000', label: { en: 'Black', zh: '黑', fr: 'Noir' } },
          { value: '#C92A2A', label: { en: 'Red', zh: '红', fr: 'Rouge' } },
          { value: '#1864AB', label: { en: 'Blue', zh: '蓝', fr: 'Bleu' } },
          { value: '#868E96', label: { en: 'Gray', zh: '灰', fr: 'Gris' } },
        ],
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
        key: 'angle',
        label: { en: 'Angle', zh: '角度', fr: 'Angle' },
        kind: 'choice',
        options: [
          { value: 0, label: { en: 'Straight', zh: '水平', fr: 'Horizontal' } },
          { value: 45, label: { en: 'Diagonal', zh: '斜 45°', fr: 'Diagonale (45°)' } },
        ],
      },
      ...ruleFields,
    ],
    presets: [
      {
        id: 'copy',
        label: { en: 'COPY', zh: 'COPY', fr: 'COPY' },
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
        label: { en: 'Date', zh: '日期', fr: 'Date' },
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
    label: { en: 'PDF to images', zh: 'PDF 转图片', fr: 'PDF vers images' },
    description: {
      en: 'Turn every page into a JPG image (long side in pixels).',
      zh: '把每一页变成一张 JPG 图片（按长边像素）。',
      fr: 'Transforme chaque page en image JPG (côté long en pixels).',
    },
    input: ['pdf'],
    output: 'images',
    params: z.strictObject({ maxSide: z.number().int().min(400).max(4000) }),
    fields: [
      {
        key: 'maxSide',
        label: { en: 'Long side', zh: '长边', fr: 'Côté long' },
        kind: 'choice',
        options: [
          {
            value: 1200,
            label: { en: '1200 px (screen)', zh: '1200 像素（屏幕）', fr: '1200 px (écran)' },
          },
          {
            value: 2000,
            label: { en: '2000 px (sharp)', zh: '2000 像素（清晰）', fr: '2000 px (net)' },
          },
          {
            value: 3300,
            label: { en: '3300 px (print)', zh: '3300 像素（打印）', fr: '3300 px (impression)' },
          },
        ],
      },
    ],
    pack: 'pdfview',
    requires: [],
  },
  {
    // D-186：iOS 用系统的文档预览排版（Word、Excel、PowerPoint、RTF 都能看），Android 系统不会显示
    // 办公文档，只能把 Word（.docx）转成网页再排版，复杂排版会走样。
    id: 'pdf.fromDocument',
    label: { en: 'Document to PDF', zh: '文档转 PDF', fr: 'Document vers PDF' },
    description: {
      en: 'Turn Word, Excel and PowerPoint files (also RTF) into PDFs on this device. On Android only Word (.docx) works, and complex layouts may shift.',
      zh: '在本机把 Word、Excel、PowerPoint 文件（还有 RTF）转成 PDF。Android 上只支持 Word（.docx），排版复杂的可能会走样。',
      fr: 'Convertit des fichiers Word, Excel et PowerPoint (ainsi que RTF) en PDF sur cet appareil. Sur Android, seul Word (.docx) est pris en charge, et les mises en page complexes peuvent être altérées.',
    },
    input: ['files'],
    rejects: ['images', 'pdf', 'zip', 'video', 'audio'],
    output: 'pdf',
    params: z.strictObject({ pageSize: z.enum(['a4', 'letter']) }),
    fields: [
      {
        key: 'pageSize',
        label: { en: 'Page size', zh: '纸张', fr: 'Format du papier' },
        kind: 'choice',
        options: [
          { value: 'a4', label: { en: 'A4', zh: 'A4', fr: 'A4' } },
          { value: 'letter', label: { en: 'Letter', zh: 'Letter', fr: 'Letter' } },
        ],
      },
    ],
    presets: [
      { id: 'a4', label: { en: 'A4', zh: 'A4', fr: 'A4' }, values: { pageSize: 'a4' } },
      {
        id: 'letter',
        label: { en: 'Letter', zh: 'Letter', fr: 'Letter' },
        values: { pageSize: 'letter' },
      },
    ],
    requires: [],
  },
  {
    id: 'pdf.extractText',
    label: { en: 'Get text from PDF', zh: '提取 PDF 文字', fr: 'Extraire le texte d’un PDF' },
    description: {
      en: 'Read the text of a PDF that has a text layer. Scanned PDFs have no text — use text recognition instead. The text stays on this device.',
      zh: '读出 PDF 里的文字（有文字层的 PDF）。扫描件没有文字，需要用文字识别。文字只留在本机。',
      fr: 'Lit le texte d’un PDF qui contient une couche de texte. Les PDF numérisés n’ont pas de texte : utilisez plutôt la reconnaissance de texte. Le texte reste sur cet appareil.',
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
    label: { en: 'Sign', zh: '签名', fr: 'Signer' },
    description: {
      en: 'The user draws or picks a saved signature and places it on a page.',
      zh: '用户画一个签名（或用存好的签名），放到页面上的位置。',
      fr: 'L’utilisateur dessine une signature ou choisit une signature enregistrée, puis la place sur une page.',
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
    label: { en: 'Fill in form', zh: '填写表单', fr: 'Remplir le formulaire' },
    description: {
      en: 'The user fills in the PDF form fields on the device; flatten makes them uneditable.',
      zh: '用户在手机上填写 PDF 表单；拍平后不能再改。',
      fr: 'L’utilisateur remplit les champs de formulaire du PDF sur l’appareil ; l’aplatissement les rend non modifiables.',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({
      flatten: z.boolean(),
      /** 没有可填的字段时：stop 报错（默认），skip 原样交给下一步（签回表格时有的 PDF 只需要签名）。 */
      whenNoFields: z.enum(['stop', 'skip']).optional(),
    }),
    fields: [
      {
        key: 'flatten',
        label: {
          en: 'Flatten',
          zh: '拍平（填好后不能再改）',
          fr: 'Aplatir (non modifiable après remplissage)',
        },
        kind: 'toggle',
      },
      {
        key: 'whenNoFields',
        label: {
          en: 'If the PDF has no form fields',
          zh: '没有表单字段时',
          fr: 'Si le PDF n’a pas de champs de formulaire',
        },
        kind: 'choice',
        options: [
          {
            value: 'stop',
            label: { en: 'Stop', zh: '停下提示', fr: 'Arrêter et afficher un message' },
          },
          {
            value: 'skip',
            label: { en: 'Skip this step', zh: '跳过这一步', fr: 'Passer cette étape' },
          },
        ],
      },
    ],
    local: 'fillForm',
    requires: [],
  },
];

// ---- PDF 密码（D-194）：iOS 用 PDFKit；Android 先不做（P-025），运行时报不支持 ----

export const PDF_PASSWORD_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'pdf.unlock',
    label: {
      en: 'Remove PDF password',
      zh: '去掉 PDF 密码',
      fr: 'Supprimer le mot de passe du PDF',
    },
    description: {
      en: 'For each PDF that needs a password to open, the user types it on the device (or skips that file); the result has no password, so later steps can merge, compress or sign it. Other files (images, PDFs without a password) pass through unchanged. Passwords are never saved. iPhone only for now.',
      zh: '每个要密码才能打开的 PDF，用户在手机上输一次密码（也可以跳过这个文件），得到没有密码的 PDF，后面的步骤就能合并、压缩、签名。别的文件（图片、没有密码的 PDF）原样通过。密码不会保存。暂时只有 iPhone 能用。',
      fr: 'Pour chaque PDF protégé par mot de passe, l’utilisateur saisit ce mot de passe sur l’appareil (ou passe ce fichier) ; le résultat n’a plus de mot de passe, afin que les étapes suivantes puissent fusionner, compresser ou signer le fichier. Les autres fichiers (images, PDF sans mot de passe) passent sans modification. Les mots de passe ne sont jamais enregistrés. Pour l’instant, disponible uniquement sur iPhone.',
    },
    input: ['files'],
    rejects: ['video', 'audio'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'pdf.protect',
    label: { en: 'Add a PDF password', zh: '给 PDF 加密码', fr: 'Ajouter un mot de passe au PDF' },
    description: {
      en: 'Adds a password needed to open the PDFs. The password is asked on every run (typed twice) and never saved. Put it last, right before sharing or saving: other PDF steps can’t open a protected PDF. iPhone only for now.',
      zh: '给 PDF 加上打开密码。密码每次运行时问（输两遍），不会保存。放在最后、分享或保存之前：加了密码的 PDF 别的步骤打不开。暂时只有 iPhone 能用。',
      fr: 'Ajoute un mot de passe d’ouverture aux PDF. Le mot de passe est demandé à chaque exécution (saisi deux fois) et n’est jamais enregistré. Placez cette étape en dernier, juste avant le partage ou l’enregistrement : les autres étapes PDF ne peuvent pas ouvrir un PDF protégé. Pour l’instant, disponible uniquement sur iPhone.',
    },
    input: ['pdf'],
    output: 'pdf',
    params: z.strictObject({}),
    fields: [
      {
        key: 'password',
        label: { en: 'Password', zh: '密码', fr: 'Mot de passe' },
        kind: 'secret',
        confirm: true,
      },
    ],
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
    name: pairText(locale, name),
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
          params: { template: t(locale, 'pdf_merged_19094') },
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
      'pdf-document',
      ['Word / Excel / PPT to PDF', 'Word / Excel / PPT 转 PDF'],
      [
        { id: 'pick', action: 'in.files', params: { accept: 'documents', min: 1, max: 10 } },
        { id: 'run', action: 'pdf.fromDocument', params: { pageSize: 'a4' } },
      ],
    ),
    wf(
      'pdf-compress',
      ['Make PDF smaller', '压缩 PDF'],
      [
        pickPdf(1, 10),
        {
          id: 'run',
          action: 'pdf.compress',
          params: { maxMB: 2, whenTooBig: 'ask' },
          ask: ['maxMB'],
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
      'pdf-unlock',
      ['Remove a password', '去掉密码'],
      [pickPdf(1, 10), { id: 'run', action: 'pdf.unlock', params: {} }],
    ),
    wf(
      'pdf-protect',
      ['Add a password', '加密码'],
      [pickPdf(1, 10), { id: 'run', action: 'pdf.protect', params: {} }],
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
            text: t(locale, 'pdf_COPY_3fef3'),
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
  version: '2.4.0',
  name: { en: 'PDF', zh: 'PDF', fr: 'PDF' },
  description: {
    en: 'Merge, convert (images, Word, Excel, PowerPoint), compress, arrange, split, number, stamp, sign, fill in, unlock and password-protect PDFs on this device.',
    zh: '在本机合并 PDF、图片和 Word / Excel / PPT 转 PDF、压缩 PDF、整理和拆分页面、加页码和文字戳、签名、填表、去掉和加上密码。',
    fr: 'Fusionner, convertir (images, Word, Excel, PowerPoint), compresser, organiser, découper, numéroter, tamponner, signer, remplir, déverrouiller et protéger par mot de passe les PDF, sur cet appareil.',
  },
  icon: 'document',
  aliases: ['pdf', 'pdf tool', 'pdf 工具', 'word to pdf', 'word 转 pdf'],
  permissions: ['files.pick', 'files.write', 'photos.save', 'camera'],
  actions: [...PDF_ACTIONS, ...PDF_PASSWORD_ACTIONS],
  createPage: (locale) => ({
    id: PDF_PAGE_ID,
    title: 'PDF',
    icon: 'document',
    toolId: PDF_TOOL_ID,
    components: [
      {
        id: 'pdf-header',
        type: 'header',
        props: { title: t(locale, 'pdf_PDF_tools_d81ee') },
      },
      {
        id: 'pdf-intro',
        type: 'text',
        props: {
          text: t(locale, 'pdf_Everything_runs_on_this_device_nothing_d4b96'),
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
          title: t(locale, 'pdf_PDF_files_2d348'),
          limit: 10,
          mimeType: 'application/pdf',
        },
      },
    ],
  }),
  createWorkflows: pdfWorkflows,
};
