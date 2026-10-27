import { t, pairText } from '../messages';
import { z } from 'zod';

import { GROUP_FIELDS, groupNeedsSize, groupParams } from '../grouping';
import { RECORD_TEMPLATES } from '../html';
import { LINE_SEPARATORS } from '../text-ops';
import { EXTRACT_KINDS } from '../text-rules';
import type { ToolDefinition } from '../registry';
import type { IconName, Locale, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// T6 的小工具：压缩包（fflate）、二维码（lean-qr / jsQR）、文字转 PDF、用记录生成 PDF。
// 实现分别在 packages/tool-archive、packages/tool-qr、core/html.ts 和 App 运行时（expo-print）。

const pageSizeField = {
  key: 'pageSize',
  label: { en: 'Paper', zh: '纸张', fr: 'Format papier' },
  kind: 'choice',
  options: [
    { value: 'a4', label: { en: 'A4', zh: 'A4', fr: 'A4' } },
    { value: 'letter', label: { en: 'Letter', zh: 'Letter', fr: 'Letter' } },
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
    name: { en: spec.name[0], zh: spec.name[1], fr: pairText('fr', spec.name) },
    description: {
      en: spec.description[0],
      zh: spec.description[1],
      fr: pairText('fr', spec.description),
    },
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
    label: { en: 'Make a ZIP', zh: '打包成 ZIP', fr: 'Créer un ZIP' },
    description: {
      en: 'Put all the files into one ZIP archive (photos are stored as they are; documents are compressed). group makes one ZIP per group instead: "count" every groupSize files, "day" / "month" by the date taken (or modified).',
      zh: '把所有文件打包成一个 ZIP（照片原样存入，文档会压缩）。group 改成每组一个 ZIP：count 每 groupSize 个一组，day / month 按拍摄（或修改）日期每天 / 每月一组。',
      fr: 'Place tous les fichiers dans une seule archive ZIP (les photos sont conservées telles quelles ; les documents sont compressés). group crée plutôt une archive par groupe : « count » tous les groupSize fichiers, « day » / « month » selon la date de prise de vue (ou de modification).',
    },
    input: ['files'],
    output: 'zip',
    params: z.strictObject(groupParams).refine(groupNeedsSize, { message: 'groupSize is missing' }),
    fields: GROUP_FIELDS,
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [{ match: /^(?:打包|打包成|压缩成)\s*zip$|^(?:zip(?: them)?|make a zip)$/i }],
  },
  {
    id: 'zip.extract',
    label: { en: 'Unzip', zh: '解压', fr: 'Décompresser' },
    description: {
      en: 'Take the files out of a ZIP archive (password-protected archives are not supported).',
      zh: '把 ZIP 里的文件取出来（不支持带密码的压缩包）。',
      fr: 'Extrait les fichiers d’une archive ZIP (les archives protégées par mot de passe ne sont pas prises en charge).',
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
    label: { en: 'Make a QR code', zh: '生成二维码', fr: 'Créer un code QR' },
    description: {
      en: 'Turn the text (a link, Wi-Fi details, contact) into a QR code image (PNG).',
      zh: '把文字（链接、Wi-Fi 信息、联系方式）变成二维码图片（PNG）。',
      fr: 'Transforme le texte (lien, informations Wi-Fi, contact) en image de code QR (PNG).',
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
        label: { en: 'Size', zh: '大小', fr: 'Taille' },
        kind: 'choice',
        options: [
          {
            value: 600,
            label: { en: '600 px (screen)', zh: '600 像素（屏幕）', fr: '600 px (écran)' },
          },
          {
            value: 1200,
            label: { en: '1200 px (print)', zh: '1200 像素（打印）', fr: '1200 px (impression)' },
          },
        ],
      },
      {
        key: 'ecc',
        label: { en: 'Error correction', zh: '容错', fr: 'Correction d’erreurs' },
        kind: 'choice',
        options: [
          { value: 'L', label: { en: 'Low', zh: '低', fr: 'Faible' } },
          { value: 'M', label: { en: 'Medium', zh: '中', fr: 'Moyen' } },
          { value: 'Q', label: { en: 'High', zh: '较高', fr: 'Élevée' } },
          { value: 'H', label: { en: 'Highest', zh: '最高', fr: 'Maximale' } },
        ],
      },
    ],
    presets: [
      {
        id: 'screen',
        label: { en: 'Screen', zh: '屏幕', fr: 'Écran' },
        values: { sizePx: 600, ecc: 'M' },
      },
    ],
    requires: [],
  },
  {
    id: 'qr.read',
    label: { en: 'Read QR codes', zh: '识别二维码', fr: 'Lire les codes QR' },
    description: {
      en: 'Find and read the QR code in each image. The text stays on this device.',
      zh: '找出每张图片里的二维码并读出内容。内容只留在本机。',
      fr: 'Trouve et lit le code QR de chaque image. Le contenu reste sur cet appareil.',
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
    label: { en: 'Text to PDF', zh: '文字转 PDF', fr: 'Texte en PDF' },
    description: {
      en: 'Lay the text out on pages as a PDF (system fonts, so Chinese and Japanese work).',
      zh: '把文字排成 PDF（用系统字体，中文、日文都能显示）。',
      fr: 'Mettez le texte en pages dans un PDF (polices du système, pour que le chinois et le japonais s’affichent).',
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
        label: { en: 'Text size', zh: '字号', fr: 'Taille du texte' },
        kind: 'number',
        unit: 'pt',
        min: 8,
        max: 24,
      },
    ],
    presets: [
      {
        id: 'a4',
        label: { en: 'A4', zh: 'A4', fr: 'A4' },
        values: { pageSize: 'a4', fontSize: 12 },
      },
    ],
    requires: [],
  },
  {
    id: 'text.toFile',
    label: { en: 'Text to file', zh: '存成文字文件', fr: 'Texte vers fichier' },
    description: {
      en: 'Save the text as a .txt file (UTF-8).',
      zh: '把文字存成 .txt 文件（UTF-8）。',
      fr: 'Enregistrez le texte dans un fichier .txt (UTF-8).',
    },
    input: ['text'],
    output: 'files',
    params: z.strictObject({}),
    fields: [],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match:
          /^(?:存成|保存成|存为)(?:文字|文本|txt)(?:文件)?$|^save (?:it )?as (?:a )?(?:text|txt)(?: file)?$/i,
      },
    ],
  },
  {
    id: 'text.copy',
    label: { en: 'Copy text', zh: '复制文字', fr: 'Copier le texte' },
    description: {
      en: 'Copy the text to the clipboard.',
      zh: '把文字复制到剪贴板。',
      fr: 'Copiez le texte dans le presse-papiers.',
    },
    input: ['text'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [{ match: /^复制(?:文字|译文|结果|下来)?$|^copy(?: the)? (?:text|translation)$/i }],
  },
  // ---- 文字加工（D-245）：text → text，文字只在本机处理 ----
  {
    id: 'text.tidy',
    label: { en: 'Tidy up text', zh: '整理文字', fr: 'Nettoyer le texte' },
    description: {
      en: 'Remove extra spaces (at line ends, repeated spaces and tabs) and blank lines: blankLines "remove" drops them all, "single" keeps one between paragraphs, "keep" leaves them.',
      zh: '去掉多余的空格（行首行尾、连续的空格和制表符）和空行：blankLines 为 remove 全部去掉，single 段落之间只留一个，keep 不动。',
      fr: 'Supprime les espaces en trop (en début et fin de ligne, espaces et tabulations répétés) et les lignes vides : blankLines « remove » les retire toutes, « single » en garde une entre les paragraphes, « keep » les laisse.',
    },
    input: ['text'],
    output: 'same',
    params: z.strictObject({
      blankLines: z.enum(['keep', 'single', 'remove']),
      spaces: z.boolean(),
    }),
    fields: [
      {
        key: 'blankLines',
        label: { en: 'Blank lines', zh: '空行', fr: 'Lignes vides' },
        kind: 'choice',
        options: [
          {
            value: 'remove',
            label: { en: 'Remove all', zh: '全部去掉', fr: 'Toutes les retirer' },
          },
          {
            value: 'single',
            label: {
              en: 'One between paragraphs',
              zh: '段落之间留一个',
              fr: 'Une entre les paragraphes',
            },
          },
          { value: 'keep', label: { en: 'Keep', zh: '不动', fr: 'Garder' } },
        ],
      },
      {
        key: 'spaces',
        label: { en: 'Remove extra spaces', zh: '去掉多余空格', fr: 'Retirer les espaces en trop' },
        kind: 'toggle',
      },
    ],
    presets: [
      {
        id: 'tidy',
        label: { en: 'Tidy up', zh: '整理', fr: 'Nettoyer' },
        values: { blankLines: 'single', spaces: true },
      },
    ],
    requires: [],
  },
  {
    id: 'text.replace',
    label: { en: 'Replace words', zh: '替换文字', fr: 'Remplacer des mots' },
    description: {
      en: 'Replace every occurrence of a word or phrase with another, exactly as typed (not a pattern). Both are the user’s own words: shown to AI only as "<user text>".',
      zh: '把一个词（或一句话）全部换成另一个，按字面替换（不是规则或通配符）。两个词都是用户自己写的，AI 只看到「<user text>」。',
      fr: 'Remplace chaque occurrence d’un mot ou d’une expression par une autre, telle que saisie (pas un motif). Les deux sont vos propres mots : l’IA ne voit que « <user text> ».',
    },
    input: ['text'],
    output: 'same',
    params: z.strictObject({
      // 空的时候什么都不换（新加的步骤先是空的，编辑页里再填）。
      find: z.string().max(200),
      replaceWith: z.string().max(200),
      ignoreCase: z.boolean(),
    }),
    fields: [
      {
        key: 'find',
        label: { en: 'Find', zh: '把', fr: 'Rechercher' },
        kind: 'text',
        private: true,
      },
      {
        key: 'replaceWith',
        label: { en: 'Replace with', zh: '换成', fr: 'Remplacer par' },
        kind: 'text',
        private: true,
      },
      {
        key: 'ignoreCase',
        label: { en: 'Ignore upper / lower case', zh: '不分大小写', fr: 'Ignorer la casse' },
        kind: 'toggle',
      },
    ],
    requires: [],
  },
  {
    id: 'text.extract',
    label: { en: 'Pick out from text', zh: '提取文字', fr: 'Extraire du texte' },
    description: {
      en: 'Keep only every phone number, e-mail address, web address, number or date found in the text, one per line (dates as YYYY-MM-DD, numbers without thousands separators). A fixed list of kinds: no patterns.',
      zh: '只留下文字里的全部手机号、邮箱、网址、数字或日期，一行一个（日期写成 YYYY-MM-DD，数字去掉千位分隔）。只能从这几种里选，不能写规则。',
      fr: 'Ne garde que les numéros de téléphone, adresses e-mail, adresses web, nombres ou dates trouvés dans le texte, un par ligne (dates au format AAAA-MM-JJ, nombres sans séparateur de milliers). Une liste fixe de types : pas de motif.',
    },
    input: ['text'],
    output: 'same',
    params: z.strictObject({ kind: z.enum(EXTRACT_KINDS) }),
    fields: [
      {
        key: 'kind',
        label: { en: 'What', zh: '提取什么', fr: 'Quoi' },
        kind: 'choice',
        options: [
          {
            value: 'phone',
            label: { en: 'Phone numbers', zh: '手机号 / 电话', fr: 'Numéros de téléphone' },
          },
          { value: 'email', label: { en: 'E-mail addresses', zh: '邮箱', fr: 'Adresses e-mail' } },
          { value: 'url', label: { en: 'Web addresses', zh: '网址', fr: 'Adresses web' } },
          { value: 'number', label: { en: 'Numbers', zh: '数字', fr: 'Nombres' } },
          { value: 'date', label: { en: 'Dates', zh: '日期', fr: 'Dates' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'text.lines',
    label: { en: 'Split or join lines', zh: '拆分 / 合并行', fr: 'Découper ou joindre les lignes' },
    description: {
      en: 'mode "split": cut the text at each separator (comma, semicolon, space or tab; Chinese commas count too) and put each part on its own line. mode "join": put all non-empty lines on one line, joined by the separator (newline, comma, semicolon, space, tab, or none).',
      zh: 'mode 为 split：在分隔符（逗号、分号、空格或制表符，中文的逗号、顿号也算）处拆开，每段一行。mode 为 join：把所有不空的行接成一行，中间用分隔符（换行、逗号、分号、空格、制表符或不加）。',
      fr: 'mode « split » : coupe le texte à chaque séparateur (virgule, point-virgule, espace ou tabulation ; les virgules chinoises comptent aussi) et met chaque partie sur sa propre ligne. mode « join » : met toutes les lignes non vides sur une seule ligne, reliées par le séparateur (retour à la ligne, virgule, point-virgule, espace, tabulation ou rien).',
    },
    input: ['text'],
    output: 'same',
    params: z.strictObject({
      mode: z.enum(['split', 'join']),
      separator: z.enum(LINE_SEPARATORS),
    }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Lines', zh: '方式', fr: 'Lignes' },
        kind: 'choice',
        options: [
          {
            value: 'split',
            label: { en: 'Split into lines', zh: '拆成多行', fr: 'Découper en lignes' },
          },
          {
            value: 'join',
            label: { en: 'Join into one line', zh: '合成一行', fr: 'Joindre en une ligne' },
          },
        ],
      },
      {
        key: 'separator',
        label: { en: 'Separator', zh: '分隔符', fr: 'Séparateur' },
        kind: 'choice',
        options: [
          { value: 'comma', label: { en: 'Comma', zh: '逗号', fr: 'Virgule' } },
          { value: 'semicolon', label: { en: 'Semicolon', zh: '分号', fr: 'Point-virgule' } },
          { value: 'space', label: { en: 'Space', zh: '空格', fr: 'Espace' } },
          { value: 'tab', label: { en: 'Tab', zh: '制表符', fr: 'Tabulation' } },
          { value: 'newline', label: { en: 'New line', zh: '换行', fr: 'Retour à la ligne' } },
          { value: 'none', label: { en: 'Nothing', zh: '不加', fr: 'Rien' } },
        ],
      },
    ],
    presets: [
      {
        id: 'split-comma',
        label: { en: 'Split at commas', zh: '按逗号拆成多行', fr: 'Découper aux virgules' },
        values: { mode: 'split', separator: 'comma' },
      },
      {
        id: 'join-none',
        label: { en: 'Join lines', zh: '接成一段', fr: 'Joindre les lignes' },
        values: { mode: 'join', separator: 'none' },
      },
    ],
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
    label: { en: 'Records to PDF', zh: '记录生成 PDF', fr: 'Enregistrements en PDF' },
    description: {
      en: 'Make a PDF from the records with a fixed template: table, cards, or receipt (table with a total of the first money field). The values are filled in on the device; only the template, title and field names are settings.',
      zh: '用固定模板把记录做成 PDF：表格、卡片，或清单（表格加第一个金额字段的合计）。记录内容在本机填进去，设置里只有模板、标题和字段。',
      fr: 'Créez un PDF à partir des entrées avec un modèle fixe : tableau, fiches ou reçu (tableau avec le total du premier champ montant). Les valeurs sont remplies sur l’appareil ; seuls le modèle, le titre et les noms de champs sont des réglages.',
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
        label: { en: 'Template', zh: '模板', fr: 'Modèle' },
        kind: 'choice',
        options: [
          { value: 'table', label: { en: 'Table', zh: '表格', fr: 'Tableau' } },
          { value: 'cards', label: { en: 'Cards', zh: '卡片', fr: 'Fiches' } },
          { value: 'receipt', label: { en: 'With total', zh: '带合计的清单', fr: 'Avec total' } },
        ],
      },
      { key: 'title', label: { en: 'Title', zh: '标题', fr: 'Titre' }, kind: 'text' },
      {
        key: 'fields',
        label: {
          en: 'Fields (none = all)',
          zh: '字段（不选 = 全部）',
          fr: 'Champs (aucun = tous)',
        },
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
