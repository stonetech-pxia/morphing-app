import { z } from 'zod';

import { FILTER_KINDS, FILTER_ORIENTATIONS, hasFileCondition } from '../file-filter';
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
      label: { en: 'At least', zh: '至少', fr: 'Au moins' },
      kind: 'number',
      min: 1,
      max,
      step: 1,
    },
    {
      key: 'max',
      label: { en: 'At most', zh: '最多', fr: 'Au maximum' },
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

/** Wi-Fi 网络名最长 32 字节（IEEE 802.11）；这里按字数先挡一下，运行时再按字节检查。 */
export const WIFI_NAME_MAX = 32;

/** 读取记录的时间范围：表里第一个日期字段（没有就用创建时间）落在这段时间里。 */
export const RECORD_PERIODS = ['all', ...PERIODS] as const;

const RECORD_PERIOD_OPTIONS = [
  { value: 'all', label: { en: 'All', zh: '全部', fr: 'Tout' } },
  { value: 'today', label: { en: 'Today', zh: '今天', fr: 'Aujourd’hui' } },
  { value: 'thisWeek', label: { en: 'This week', zh: '本周', fr: 'Cette semaine' } },
  { value: 'thisMonth', label: { en: 'This month', zh: '本月', fr: 'Ce mois-ci' } },
  { value: 'thisYear', label: { en: 'This year', zh: '今年', fr: 'Cette année' } },
  {
    value: 'last7days',
    label: { en: 'Last 7 days', zh: '最近 7 天', fr: '7 derniers jours' },
  },
  {
    value: 'last30days',
    label: { en: 'Last 30 days', zh: '最近 30 天', fr: '30 derniers jours' },
  },
];

export const MAX_PICK = 50;

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date like 2026-10-22');
const ANY = { en: 'Any', zh: '不限', fr: 'Peu importe' };

/** file.filter 的「全部不限」：预设在它上面只改一两项。 */
const NO_FILTER = {
  kind: 'any',
  size: 'any',
  orientation: 'any',
  date: 'any',
  duration: 'any',
  whenEmpty: 'stop',
} as const;

export const IO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'in.photos',
    label: { en: 'Choose photos', zh: '选照片', fr: 'Choisir des photos' },
    description: {
      en: 'Pick photos from the library or from the Files app (pictures downloaded or sent from a computer), take them with the camera, or scan paper with the document camera (finds the edges, captures automatically, several pages, already straightened; where it is not available, the camera is used).',
      zh: '从相册或「文件」App 选照片（下载的、电脑传来的图片），用相机拍照，或用文档相机扫描纸张（自动找边、自动拍、可以多页、拍完已经拉正；没有文档相机的设备改用相机）。',
      fr: 'Choisir des photos dans la photothèque ou dans l’app Fichiers (images téléchargées ou envoyées depuis un ordinateur), les prendre avec l’appareil photo, ou numériser du papier avec la caméra de document (détecte les bords, capture automatiquement, plusieurs pages, déjà redressées ; si elle n’est pas disponible, l’appareil photo est utilisé).',
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
        label: { en: 'From', zh: '来源', fr: 'Source' },
        kind: 'choice',
        options: [
          { value: 'library', label: { en: 'Photo library', zh: '相册', fr: 'Photothèque' } },
          { value: 'files', label: { en: 'Files', zh: '从文件选', fr: 'Fichiers' } },
          { value: 'camera', label: { en: 'Camera', zh: '拍照', fr: 'Appareil photo' } },
          {
            value: 'scanner',
            label: { en: 'Scan documents', zh: '扫描文档', fr: 'Numériser des documents' },
          },
        ],
      },
      ...countFields(MAX_PICK),
    ],
    presets: [
      {
        id: 'library',
        label: { en: 'Library, up to 30', zh: '相册，最多 30 张', fr: 'Photothèque, 30 maximum' },
        values: { source: 'library', min: 1, max: 30 },
      },
      {
        id: 'camera',
        label: { en: 'Camera, up to 10', zh: '拍照，最多 10 张', fr: 'Appareil photo, 10 maximum' },
        values: { source: 'camera', min: 1, max: 10 },
      },
      {
        id: 'scanner',
        label: {
          en: 'Scan documents, up to 30 pages',
          zh: '扫描文档，最多 30 页',
          fr: 'Numériser des documents, 30 pages maximum',
        },
        values: { source: 'scanner', min: 1, max: 30 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.files',
    label: { en: 'Choose files', zh: '选文件', fr: 'Choisir des fichiers' },
    description: {
      en: 'Pick files from the Files app (PDFs, images, videos, audio, Word / Excel / PowerPoint documents, or any file).',
      zh: '从「文件」App 选文件（PDF、图片、视频、音频、Word / Excel / PowerPoint 文档或任意文件）。',
      fr: 'Choisir des fichiers dans l’app Fichiers (PDF, images, vidéos, audio, documents Word / Excel / PowerPoint ou tout fichier).',
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
        label: { en: 'File type', zh: '文件类型', fr: 'Type de fichier' },
        kind: 'choice',
        options: [
          { value: 'pdf', label: { en: 'PDF', zh: 'PDF', fr: 'PDF' } },
          { value: 'images', label: { en: 'Images', zh: '图片', fr: 'Images' } },
          {
            value: 'pdfOrImages',
            label: { en: 'PDFs and images', zh: 'PDF 和图片', fr: 'PDF et images' },
          },
          { value: 'zip', label: { en: 'ZIP archive', zh: 'ZIP 压缩包', fr: 'Archive ZIP' } },
          { value: 'videos', label: { en: 'Videos', zh: '视频', fr: 'Vidéos' } },
          { value: 'audio', label: { en: 'Audio', zh: '音频', fr: 'Audio' } },
          {
            value: 'documents',
            label: {
              en: 'Word, Excel, PowerPoint',
              zh: 'Word、Excel、PowerPoint',
              fr: 'Word, Excel, PowerPoint',
            },
          },
          { value: 'any', label: { en: 'Any file', zh: '任意文件', fr: 'Tout fichier' } },
        ],
      },
      ...countFields(MAX_PICK),
    ],
    presets: [
      {
        id: 'pdf',
        label: { en: 'PDFs, up to 10', zh: 'PDF，最多 10 个', fr: 'PDF, 10 maximum' },
        values: { accept: 'pdf', min: 1, max: 10 },
      },
      {
        id: 'mixed',
        label: {
          en: 'PDFs and images, up to 30',
          zh: 'PDF 和图片，最多 30 个',
          fr: 'PDF et images, 30 maximum',
        },
        values: { accept: 'pdfOrImages', min: 1, max: 30 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.videos',
    label: { en: 'Choose videos', zh: '选视频', fr: 'Choisir des vidéos' },
    description: {
      en: 'Pick videos from the photo library, or from the Files app (downloaded or copied from a computer: MP4, MOV, and on Android also MKV, WEBM, AVI); up to 10, each up to 4 GB.',
      zh: '从相册选视频，或从「文件」App 选（下载的、电脑拷来的：MP4、MOV，Android 还能选 MKV、WEBM、AVI）；最多 10 个，每个不超过 4 GB。',
      fr: 'Choisir des vidéos dans la photothèque, ou dans l’app Fichiers (téléchargées ou copiées depuis un ordinateur : MP4, MOV, et sur Android aussi MKV, WEBM, AVI) ; 10 maximum, chacune jusqu’à 4 Go.',
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
        label: { en: 'From', zh: '来源', fr: 'Source' },
        kind: 'choice',
        options: [
          { value: 'library', label: { en: 'Photo library', zh: '相册', fr: 'Photothèque' } },
          { value: 'files', label: { en: 'Files', zh: '从文件选', fr: 'Fichiers' } },
        ],
      },
      ...countFields(MEDIA_LIMITS.maxCount),
    ],
    presets: [
      {
        id: 'several',
        label: { en: 'Up to 10 videos', zh: '最多 10 个视频', fr: '10 vidéos maximum' },
        values: { source: 'library', min: 1, max: 10 },
      },
      {
        id: 'one',
        label: { en: 'One video', zh: '1 个视频', fr: '1 vidéo' },
        values: { source: 'library', min: 1, max: 1 },
      },
      {
        id: 'files',
        label: {
          en: 'From Files, up to 10',
          zh: '从文件选，最多 10 个',
          fr: 'Depuis Fichiers, 10 maximum',
        },
        values: { source: 'files', min: 1, max: 10 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    // 音频（D-154）：从「文件」选录音或音乐（语音备忘录分享出来的、微信下载的），或者现在录一段。
    id: 'in.audio',
    label: {
      en: 'Choose or record audio',
      zh: '选音频 / 录音',
      fr: 'Choisir ou enregistrer un audio',
    },
    description: {
      en: 'Pick recordings or music from the Files app (up to 10, each up to 4 GB), or record one now with the microphone (it keeps recording when the screen locks).',
      zh: '从「文件」选录音或音乐（最多 10 个，每个不超过 4 GB），或者现在用麦克风录一段（锁屏后继续录）。',
      fr: 'Choisissez des enregistrements ou de la musique dans l’app Fichiers (10 au maximum, 4 Go chacun), ou enregistrez-en un maintenant avec le micro (l’enregistrement continue lorsque l’écran se verrouille).',
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
        label: { en: 'From', zh: '来源', fr: 'Source' },
        kind: 'choice',
        options: [
          { value: 'files', label: { en: 'Files', zh: '从文件选', fr: 'Fichiers' } },
          {
            value: 'record',
            label: { en: 'Record now', zh: '现在录音', fr: 'Enregistrer maintenant' },
          },
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
        label: {
          en: 'Files, up to 10',
          zh: '从文件选，最多 10 个',
          fr: 'Depuis Fichiers, 10 max.',
        },
        values: { source: 'files', min: 1, max: 10 },
      },
      {
        id: 'record',
        label: { en: 'Record now', zh: '现在录音', fr: 'Enregistrer maintenant' },
        values: { source: 'record', min: 1, max: 1 },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'in.text',
    label: { en: 'Type or paste text', zh: '输入文字', fr: 'Saisir ou coller du texte' },
    description: {
      en: 'The user types or pastes text (for a QR code or a text PDF). The text stays on this device.',
      zh: '用户输入或粘贴一段文字（用来生成二维码或文字 PDF）。文字只留在本机。',
      fr: 'Vous saisissez ou collez un texte (pour un code QR ou un PDF de texte). Le texte reste sur cet appareil.',
    },
    input: [],
    output: 'text',
    params: z.strictObject({ text: z.string().max(MAX_INPUT_TEXT) }),
    fields: [
      {
        key: 'text',
        label: { en: 'Text', zh: '文字', fr: 'Texte' },
        kind: 'text',
        multiline: true,
        private: true,
      },
    ],
    requires: [],
  },
  {
    // D-199：给客人连 Wi-Fi 的二维码。网络名是用户写的（发给 AI 前换成占位符），密码每次运行时问、不保存。
    id: 'in.wifi',
    label: { en: 'Wi-Fi details', zh: 'Wi-Fi 信息', fr: 'Infos Wi-Fi' },
    description: {
      en: 'The user enters a Wi-Fi network (name, security, password); the result is the text phones read from a Wi-Fi QR code (follow with qr.generate). The password is asked on every run and never saved.',
      zh: '用户填一个 Wi-Fi 网络（名字、加密方式、密码），变成手机扫 Wi-Fi 二维码时读到的文字（后面接「生成二维码」）。密码每次运行时问，不会保存。',
      fr: 'Vous saisissez un réseau Wi-Fi (nom, sécurité, mot de passe) ; le résultat est le texte que lisent les téléphones à partir d’un code QR Wi-Fi (à suivre de qr.generate). Le mot de passe est demandé à chaque exécution et n’est jamais enregistré.',
    },
    input: [],
    output: 'text',
    params: z.strictObject({
      network: z.string().max(WIFI_NAME_MAX),
      security: z.enum(['WPA', 'WEP', 'none']),
      hidden: z.boolean(),
    }),
    fields: [
      {
        key: 'network',
        label: { en: 'Network name', zh: '网络名', fr: 'Nom du réseau' },
        kind: 'text',
        private: true,
      },
      {
        key: 'security',
        label: { en: 'Security', zh: '加密方式', fr: 'Sécurité' },
        kind: 'choice',
        options: [
          {
            value: 'WPA',
            label: { en: 'WPA / WPA2 / WPA3', zh: 'WPA / WPA2 / WPA3', fr: 'WPA / WPA2 / WPA3' },
          },
          { value: 'WEP', label: { en: 'WEP', zh: 'WEP', fr: 'WEP' } },
          { value: 'none', label: { en: 'No password', zh: '没有密码', fr: 'Aucun mot de passe' } },
        ],
      },
      {
        key: 'hidden',
        label: { en: 'Hidden network', zh: '隐藏的网络', fr: 'Réseau caché' },
        kind: 'toggle',
      },
      {
        key: 'password',
        label: { en: 'Password', zh: '密码', fr: 'Mot de passe' },
        kind: 'secret',
      },
    ],
    requires: [],
  },
  {
    id: 'in.records',
    label: { en: 'Use records', zh: '读取记录', fr: 'Lire les entrées' },
    description: {
      en: 'Take the records of one data table (optionally only a time period, by its first date field). Records stay on this device.',
      zh: '读取一张数据表的记录（可以只取某段时间，按表里第一个日期字段）。记录只留在本机。',
      fr: 'Vous lisez les entrées d’un tableau de données (vous pouvez aussi ne prendre qu’une période, d’après son premier champ de date). Les entrées restent sur cet appareil.',
    },
    input: [],
    output: 'records',
    params: z.strictObject({ collectionId: IdSchema, period: z.enum(RECORD_PERIODS) }),
    fields: [
      {
        key: 'collectionId',
        label: { en: 'Data table', zh: '数据表', fr: 'Table de données' },
        kind: 'collection',
      },
      {
        key: 'period',
        label: { en: 'Time', zh: '时间', fr: 'Période' },
        kind: 'choice',
        options: RECORD_PERIOD_OPTIONS,
      },
    ],
    requires: [],
  },
  {
    // D-187：快捷操作写记录。AI 只选哪张表；填什么由用户在运行时的表单里填，记录不进配置、不发给 AI（D-036）。
    id: 'out.addRecord',
    label: { en: 'Add a record', zh: '记一笔', fr: 'Ajouter un enregistrement' },
    description: {
      en: "Add a record to a data table for each file (or once for text): the file is saved in Morph and goes into the table's first attachment field, text goes into its first long-text or text field, and the user fills in the other fields (amount, category…) on a form while the quick action runs; date fields start as today. The records stay on this device. The files are passed on unchanged.",
      zh: '给每个文件（或这段文字）在一张数据表里记一笔：文件存进 Morph，放进表里第一个附件字段；文字放进第一个长文本或文字字段；其他字段（金额、分类等）由用户在运行时的表单里填，日期默认今天。记录只留在本机。文件原样交给下一步。',
      fr: 'Ajoutez une entrée à un tableau de données pour chaque fichier (ou une seule fois pour un texte) : le fichier est enregistré dans Morph et placé dans le premier champ pièce jointe du tableau ; le texte va dans le premier champ texte long ou texte du tableau ; vous remplissez les autres champs (montant, catégorie…) dans un formulaire pendant l’exécution de l’action rapide ; les champs de date commencent à aujourd’hui. Les enregistrements restent sur cet appareil. Les fichiers sont transmis sans modification.',
    },
    input: ['files', 'text'],
    output: 'same',
    params: z.strictObject({ collectionId: IdSchema }),
    fields: [
      {
        key: 'collectionId',
        label: { en: 'Data table', zh: '数据表', fr: 'Table de données' },
        kind: 'collection',
      },
    ],
    local: 'recordEntry',
    requires: ['files.write'],
  },
  {
    id: 'file.rename',
    label: { en: 'Name the files', zh: '命名', fr: 'Nommer les fichiers' },
    description: {
      en: 'Name the result with a template such as {sourceName}-{date}.',
      zh: '按模板命名结果，例如 {sourceName}-{date}。',
      fr: 'Nommez le résultat avec un modèle, par exemple {sourceName}-{date}.',
    },
    input: ['files', 'images', 'pdf', 'zip'],
    output: 'same',
    params: z.strictObject({ template: nameTemplateSchema }),
    fields: [
      {
        key: 'template',
        label: { en: 'File name', zh: '文件名', fr: 'Nom du fichier' },
        kind: 'nameTemplate',
      },
    ],
    presets: [
      {
        id: 'source-date',
        label: { en: 'Name + date', zh: '原名 + 日期', fr: 'Nom + date' },
        values: { template: '{sourceName}-{date}' },
      },
      {
        id: 'source',
        label: { en: 'Original name', zh: '原文件名', fr: 'Nom d’origine' },
        values: { template: '{sourceName}' },
      },
    ],
    requires: [],
  },
  {
    id: 'file.order',
    label: { en: 'Put in order', zh: '排序', fr: 'Ordonner' },
    description: {
      en: 'The user puts the files in order and can drop some, on the device.',
      zh: '用户在手机上调整文件顺序，也可以去掉几个。',
      fr: 'Vous mettez les fichiers dans l’ordre et pouvez en retirer certains, sur cet appareil.',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    local: 'reorder',
    requires: [],
  },
  {
    // D-242：按固定条件筛选文件（类型、大小、方向、日期、时长），全部满足才保留。没有表达式。
    id: 'file.filter',
    label: { en: 'Keep only some files', zh: '按条件筛选', fr: 'Filtrer les fichiers' },
    description: {
      en: 'Keep only the files that meet every condition set here (the others are dropped from this run, never deleted): kind of file; size larger / smaller than N MB; photo orientation (landscape, portrait, square); date taken (or last modified) in the last N days or between two dates; video or audio length longer / shorter than N seconds. A condition left at "any" is not checked. A file whose date, size in pixels or length can’t be read does not meet that condition. whenEmpty: "stop" ends the run with a message when nothing is left, "skip" passes all the files on unfiltered.',
      zh: '只保留满足这里全部条件的文件（其他的只是这次不用，不会删除）：文件类型；大于 / 小于 N MB；照片方向（横、竖、方）；拍摄（或修改）日期在最近 N 天或两个日期之间；视频、音频长于 / 短于 N 秒。选「不限」的条件不检查。读不到日期、尺寸或时长的文件算不满足这一条。whenEmpty：stop 一个都不剩时停下并说明，skip 不筛、全部交给下一步。',
      fr: 'Ne garde que les fichiers qui remplissent toutes les conditions indiquées ici (les autres sont simplement écartés de cette exécution, jamais supprimés) : type de fichier ; taille supérieure / inférieure à N Mo ; orientation de la photo (paysage, portrait, carré) ; date de prise de vue (ou de modification) dans les N derniers jours ou entre deux dates ; durée d’une vidéo ou d’un audio supérieure / inférieure à N secondes. Une condition laissée sur « peu importe » n’est pas vérifiée. Un fichier dont la date, la taille en pixels ou la durée est illisible ne remplit pas cette condition. whenEmpty : « stop » arrête l’exécution avec un message s’il ne reste rien, « skip » transmet tous les fichiers sans les filtrer.',
    },
    input: ['files'],
    output: 'same',
    params: z
      .strictObject({
        kind: z.enum(FILTER_KINDS),
        size: z.enum(['any', 'larger', 'smaller']),
        sizeMB: z.number().min(0.01).max(4096).optional(),
        orientation: z.enum(FILTER_ORIENTATIONS),
        date: z.enum(['any', 'lastDays', 'period', 'between']),
        days: z.number().int().min(1).max(3650).optional(),
        period: z.enum(PERIODS).optional(),
        from: dateText.optional(),
        to: dateText.optional(),
        duration: z.enum(['any', 'longer', 'shorter']),
        seconds: z.number().min(1).max(86400).optional(),
        whenEmpty: z.enum(['stop', 'skip']),
      })
      .refine(hasFileCondition, { message: 'choose at least one condition' })
      .refine((p) => p.size === 'any' || p.sizeMB !== undefined, { message: 'sizeMB is missing' })
      .refine((p) => p.date !== 'lastDays' || p.days !== undefined, { message: 'days is missing' })
      .refine((p) => p.date !== 'period' || p.period !== undefined, {
        message: 'period is missing',
      })
      .refine(
        (p) =>
          p.date !== 'between' || (p.from !== undefined && p.to !== undefined && p.from <= p.to),
        { message: 'from and to must be dates with from <= to' },
      )
      .refine((p) => p.duration === 'any' || p.seconds !== undefined, {
        message: 'seconds is missing',
      }),
    fields: [
      {
        key: 'kind',
        label: { en: 'Kind', zh: '类型', fr: 'Type' },
        kind: 'choice',
        options: [
          { value: 'any', label: ANY },
          { value: 'images', label: { en: 'Images', zh: '图片', fr: 'Images' } },
          { value: 'pdf', label: { en: 'PDF', zh: 'PDF', fr: 'PDF' } },
          { value: 'video', label: { en: 'Videos', zh: '视频', fr: 'Vidéos' } },
          { value: 'audio', label: { en: 'Audio', zh: '音频', fr: 'Audio' } },
          {
            value: 'documents',
            label: { en: 'Office documents', zh: '办公文档', fr: 'Documents Office' },
          },
        ],
      },
      {
        key: 'size',
        label: { en: 'Size', zh: '大小', fr: 'Taille' },
        kind: 'choice',
        options: [
          { value: 'any', label: ANY },
          { value: 'larger', label: { en: 'Larger than', zh: '大于', fr: 'Plus de' } },
          { value: 'smaller', label: { en: 'Smaller than', zh: '小于', fr: 'Moins de' } },
        ],
      },
      {
        key: 'sizeMB',
        label: { en: 'Size limit', zh: '大小界限', fr: 'Limite de taille' },
        kind: 'number',
        unit: 'MB',
        min: 0.01,
        max: 4096,
        showIf: { key: 'size', equals: ['larger', 'smaller'] },
      },
      {
        key: 'orientation',
        label: { en: 'Orientation', zh: '方向', fr: 'Orientation' },
        kind: 'choice',
        options: [
          { value: 'any', label: ANY },
          { value: 'landscape', label: { en: 'Landscape', zh: '横的', fr: 'Paysage' } },
          { value: 'portrait', label: { en: 'Portrait', zh: '竖的', fr: 'Portrait' } },
          { value: 'square', label: { en: 'Square', zh: '方的', fr: 'Carré' } },
        ],
      },
      {
        key: 'date',
        label: {
          en: 'Date taken or modified',
          zh: '拍摄或修改日期',
          fr: 'Date de prise ou de modification',
        },
        kind: 'choice',
        options: [
          { value: 'any', label: ANY },
          {
            value: 'lastDays',
            label: { en: 'In the last days', zh: '最近几天', fr: 'Derniers jours' },
          },
          {
            value: 'period',
            label: { en: 'In a calendar period', zh: '某段日历时间', fr: 'Dans une période' },
          },
          {
            value: 'between',
            label: { en: 'Between two dates', zh: '两个日期之间', fr: 'Entre deux dates' },
          },
        ],
      },
      {
        key: 'days',
        label: { en: 'Number of days', zh: '天数', fr: 'Nombre de jours' },
        kind: 'number',
        min: 1,
        max: 3650,
        step: 1,
        showIf: { key: 'date', equals: ['lastDays'] },
      },
      {
        key: 'period',
        label: { en: 'Period', zh: '时间段', fr: 'Période' },
        kind: 'choice',
        options: RECORD_PERIOD_OPTIONS.filter((o) => o.value !== 'all'),
        showIf: { key: 'date', equals: ['period'] },
      },
      {
        key: 'from',
        label: { en: 'From (YYYY-MM-DD)', zh: '从（YYYY-MM-DD）', fr: 'Du (AAAA-MM-JJ)' },
        kind: 'text',
        showIf: { key: 'date', equals: ['between'] },
      },
      {
        key: 'to',
        label: { en: 'To (YYYY-MM-DD)', zh: '到（YYYY-MM-DD）', fr: 'Au (AAAA-MM-JJ)' },
        kind: 'text',
        showIf: { key: 'date', equals: ['between'] },
      },
      {
        key: 'duration',
        label: {
          en: 'Length (video, audio)',
          zh: '时长（视频、音频）',
          fr: 'Durée (vidéo, audio)',
        },
        kind: 'choice',
        options: [
          { value: 'any', label: ANY },
          { value: 'longer', label: { en: 'Longer than', zh: '长于', fr: 'Plus de' } },
          { value: 'shorter', label: { en: 'Shorter than', zh: '短于', fr: 'Moins de' } },
        ],
      },
      {
        key: 'seconds',
        label: { en: 'Seconds', zh: '秒数', fr: 'Secondes' },
        kind: 'number',
        min: 1,
        max: 86400,
        step: 1,
        showIf: { key: 'duration', equals: ['longer', 'shorter'] },
      },
      {
        key: 'whenEmpty',
        label: { en: 'If none are left', zh: '一个都不剩时', fr: 'S’il ne reste rien' },
        kind: 'choice',
        options: [
          {
            value: 'stop',
            label: { en: 'Stop and say so', zh: '停下并说明', fr: 'Arrêter et le signaler' },
          },
          {
            value: 'skip',
            label: { en: 'Keep all files', zh: '不筛，全部保留', fr: 'Garder tous les fichiers' },
          },
        ],
      },
    ],
    presets: [
      {
        id: 'last-7-days',
        label: { en: 'Last 7 days', zh: '最近 7 天', fr: '7 derniers jours' },
        values: { ...NO_FILTER, date: 'lastDays', days: 7 },
      },
      {
        id: 'larger-10',
        label: { en: 'Larger than 10 MB', zh: '大于 10 MB', fr: 'Plus de 10 Mo' },
        values: { ...NO_FILTER, size: 'larger', sizeMB: 10 },
      },
      {
        id: 'landscape',
        label: { en: 'Landscape photos', zh: '横的照片', fr: 'Photos paysage' },
        values: { ...NO_FILTER, kind: 'images', orientation: 'landscape' },
      },
    ],
    requires: [],
  },
  {
    // D-197：一份报销单越攒越多。默认接上这个快捷操作上次存下的结果；选中的文件只在这次运行里用。
    id: 'file.addExisting',
    label: { en: 'Add an existing file', zh: '加上已有文件', fr: 'Ajouter un fichier existant' },
    description: {
      en: 'Asks which earlier file to add to the files so far: by default the last result this quick action saved, or a PDF or image picked in Files, or none this time. position "before" puts the existing file first. Follow with pdf.merge to grow one PDF run after run (an expense report that gets one more receipt each time).',
      zh: '问用户把哪个已有的文件加进来：默认是这个快捷操作上次存下的结果，也可以从「文件」里选一个 PDF 或图片，或者这次不加。position 为 before 时已有的文件放在前面。后面接「按顺序合并」，一份 PDF 就能一次比一次长（报销单每次加一张收据）。',
      fr: 'Permet de choisir quel fichier déjà enregistré ajouter aux fichiers existants : par défaut, le dernier résultat enregistré par cette action rapide, ou un PDF ou une image choisi dans Fichiers, ou aucun cette fois. Avec position « before », le fichier existant passe en premier. À suivre de pdf.merge pour allonger un PDF d’une exécution à l’autre (une note de frais qui reçoit un justificatif de plus à chaque fois).',
    },
    input: ['files'],
    output: 'files',
    params: z.strictObject({ position: z.enum(['before', 'after']) }),
    fields: [
      {
        key: 'position',
        label: { en: 'Existing file goes', zh: '已有的文件放在', fr: 'Fichier existant placé' },
        kind: 'choice',
        options: [
          { value: 'before', label: { en: 'First', zh: '前面', fr: 'Devant' } },
          { value: 'after', label: { en: 'Last', zh: '后面', fr: 'Derrière' } },
        ],
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'file.save',
    label: {
      en: 'Save to Morph files',
      zh: '存到文件',
      fr: 'Enregistrer dans les fichiers de Morph',
    },
    description: {
      en: 'Save the result to the files in this app.',
      zh: '把结果存到这个 App 的文件里。',
      fr: 'Enregistre le résultat dans les fichiers de cette app.',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: ['files.write'],
  },
  {
    id: 'out.share',
    label: { en: 'Share', zh: '分享', fr: 'Partager' },
    description: {
      en: 'Open the share sheet once with all the files (WeChat, WhatsApp, Mail, Messages, AirDrop, Files…).',
      zh: '打开一次系统分享面板，带上全部文件（微信、WhatsApp、邮件、信息、隔空投送、存到文件…）。',
      fr: 'Ouvre une fois la feuille de partage avec tous les fichiers (WeChat, WhatsApp, Mail, Messages, AirDrop, Fichiers…).',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'out.saveToFolder',
    label: { en: 'Save to a folder', zh: '存到文件夹', fr: 'Enregistrer dans un dossier' },
    description: {
      en: 'Copy the files into a folder in Files (on this device, iCloud Drive, Google Drive, Dropbox…). The user picks the folder the first time; after that the same folder is used (it can be changed on the result page). Morph does not upload anything; the cloud app syncs the folder.',
      zh: '把文件复制进「文件」里的一个文件夹（本机、iCloud 云盘、Google Drive、Dropbox…）。第一次由用户选，之后存到同一个文件夹（可以在结果页换）。Morph 不上传，网盘由它自己的 App 同步。',
      fr: 'Copie les fichiers dans un dossier de l’app Fichiers (sur cet appareil, iCloud Drive, Google Drive, Dropbox…). Au premier usage, vous choisissez le dossier ; ensuite, le même dossier est utilisé (modifiable sur la page du résultat). Morph ne téléverse rien : c’est l’app du service de stockage qui synchronise le dossier.',
    },
    input: ['files'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'out.saveToPhotos',
    label: { en: 'Save to Photos', zh: '存到相册', fr: 'Enregistrer dans Photos' },
    description: {
      en: 'Save the images or videos to the photo library.',
      zh: '把图片或视频存到系统相册。',
      fr: 'Enregistre les images ou vidéos dans la photothèque.',
    },
    input: ['images', 'video'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: ['photos.save'],
  },
  {
    id: 'out.print',
    label: { en: 'Print', zh: '打印', fr: 'Imprimer' },
    description: {
      en: 'Print with AirPrint or a system printer.',
      zh: '用系统打印（AirPrint 等）。',
      fr: 'Imprimer avec AirPrint ou une imprimante du système.',
    },
    input: ['pdf', 'images'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
];
