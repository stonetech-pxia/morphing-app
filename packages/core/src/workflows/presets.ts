import { localize } from '../localization';
import { mediaKindOf, type MediaKind } from '../media';
import { t } from '../messages';
import type { QuickActionKind } from '../quick-actions';
import type { IconName, Locale, Localized, Workflow } from '../schema';
import type { SharedFileInfo } from '../share';
import { speechLangFor } from '../tools/audio';

// 内置的预设工作流（TOOLS_DESIGN §7，D-081）：不随版本，用户在「工作流」页点「添加」时复制进配置，
// 之后就和用户自己的工作流一样，可以改参数、改步骤、复制、放到页面上、删除；编辑页可以「恢复预设」。
// 预设只用登记过的动作，不要求先安装对应的工具（跨工具的用户工作流，§2）。

/**
 * 预设按生活场景分组（D-130）：普通人说不清要什么，但看到「出国办证」「报销」就知道。
 * 顺序就是快捷操作页上的顺序。
 */
export const PRESET_SCENARIOS = [
  { id: 'ids', name: { en: 'Visas and IDs', zh: '出国办证', fr: 'Visas et pièces d’identité' } },
  {
    id: 'paperwork',
    name: { en: 'Forms and documents', zh: '交材料、签文件', fr: 'Formulaires et documents' },
  },
  {
    id: 'receipts',
    name: { en: 'Receipts and expenses', zh: '报销记账', fr: 'Reçus et dépenses' },
  },
  {
    id: 'photos',
    name: {
      en: 'Sending photos and videos',
      zh: '发照片和视频',
      fr: 'Envoi de photos et de vidéos',
    },
  },
  // 音频（D-156）：录音转文字、合成、按日期归档放「学习工作」；压小、剪一段、取视频的声音放「发声音」。
  { id: 'study', name: { en: 'Study and work', zh: '学习工作', fr: 'Études et travail' } },
  { id: 'sound', name: { en: 'Sending audio', zh: '发声音', fr: 'Envoi d’audio' } },
] as const satisfies readonly { id: string; name: Localized }[];

export type PresetScenario = (typeof PRESET_SCENARIOS)[number]['id'];

export interface WorkflowPreset {
  id: string;
  scenario: PresetScenario;
  kinds?: readonly QuickActionKind[];
  name: Localized;
  /** 一句话说明，显示在预设库里，也发给 AI。 */
  description: Localized;
  icon: IconName;
  /** 需要下载的扩展包（第一次运行时会请用户确认），只用于在预设库里提示。 */
  packs?: readonly string[];
  steps(locale: Locale): Workflow['steps'];
  /** 内置规则（mock AI）除了名字还认的叫法（「添加签证快捷操作」「把照片发邮件放到首页」），D-265。 */
  words?: RegExp;
  /** 别的预设的叫法也认得这个短语时先查它（「证件照打印」不是签证照片）。 */
  wordsFirst?: boolean;
}

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

// 翻译预设（D-173）用的步骤。
const recognize = (lang: string, ask = true) => ({
  id: 'read',
  action: 'ocr.recognize',
  params: { lang },
  ...(ask ? { ask: ['lang'] } : {}),
});
/** 翻成界面语言：中文界面翻成中文，英文界面翻成英文。 */
const translateTo = (locale: Locale) => ({
  id: 'translate',
  action: 'translate.text',
  params: { from: 'auto', to: locale === 'zh' ? 'zh-Hans' : locale === 'fr' ? 'fr' : 'en' },
});
/** 文字转语音（D-270）：自动识别语言、正常语速、M4A。 */
const speak = {
  id: 'speak',
  action: 'audio.fromText',
  params: { lang: 'auto', rate: 1, format: 'm4a' },
};
const textPdf = { id: 'pdf', action: 'text.toPdf', params: { pageSize: 'a4', fontSize: 12 } };
/** 转 Excel（D-272）：默认界面语言、全部内容，每次运行时问语言。 */
const toExcel = (locale: Locale) => ({
  id: 'excel',
  action: 'ocr.toExcel',
  params: {
    lang: locale === 'zh' ? 'chi_sim' : locale === 'fr' ? 'fra' : 'eng',
    scope: 'all',
  },
  ask: ['lang'],
});

export const WORKFLOW_PRESETS: readonly WorkflowPreset[] = [
  {
    id: 'visa-photo',
    words: /签证|证件照|visa|id photo|passport photo/i,
    scenario: 'ids',
    name: { en: 'Visa / ID photo', zh: '签证 / 证件照', fr: 'Photo de visa / d’identité' },
    description: {
      en: 'Choose a photo, frame your face, get the official size as a JPG under the size limit (US visa: 600×600, ≤ 240 KB).',
      zh: '选一张照片，框好脸部，得到官方尺寸、不超过大小上限的 JPG（美国签证：600×600，≤ 240 KB）。',
      fr: 'Choisissez une photo, cadrez votre visage, obtenez la taille officielle en JPG, sous la limite de taille (visa américain : 600×600, ≤ 240 Ko).',
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
      rename(t(locale, 'presets_ID_photo_20f6d'), false),
    ],
  },
  {
    id: 'document-packet',
    scenario: 'paperwork',
    name: { en: 'Application packet', zh: '材料包', fr: 'Dossier de demande' },
    description: {
      en: 'Photos of documents → crop and order them → one A4 PDF under 4 MB → name it → share.',
      zh: '拍下或选好材料照片 → 裁剪、排好顺序 → 合成一个不超过 4 MB 的 A4 PDF → 命名 → 分享。',
      fr: 'Photos des documents → recadrer et mettre en ordre → un seul PDF A4 de moins de 4 Mo → le nommer → partager.',
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
      rename(t(locale, 'presets_Documents_4ee07')),
      share,
    ],
  },
  {
    id: 'email-photos',
    words: /发邮件|传网站|email|upload/i,
    scenario: 'photos',
    name: {
      en: 'Photos for email or upload',
      zh: '照片发邮件 / 传网站',
      fr: 'Photos pour l’e-mail ou l’envoi en ligne',
    },
    description: {
      en: 'Choose photos → long side 1600 px → each under 500 KB as JPG → share.',
      zh: '选照片 → 长边 1600 像素 → 每张压到 500 KB 以内的 JPG → 分享。',
      fr: 'Choisir des photos → grand côté 1600 px → chacune en JPG de moins de 500 Ko → partager.',
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
    name: { en: 'Sign and send back', zh: '签回表格', fr: 'Signer et renvoyer' },
    description: {
      en: 'Choose a PDF → fill in its form fields (skipped when there are none) → sign → share.',
      zh: '选一个 PDF → 填写表单（没有表单字段时跳过）→ 签名 → 分享。',
      fr: 'Choisissez un PDF → remplissez ses champs de formulaire (ignoré s’il n’y en a pas) → signez → partagez.',
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
    name: { en: 'Scan a document', zh: '扫描文档', fr: 'Numériser un document' },
    description: {
      en: 'Scan pages with the document camera (or take photos and check the corners) → clean up → PDF → name it → share.',
      zh: '用文档相机扫描（或拍照后确认四个角）→ 变清楚 → 合成 PDF → 命名 → 分享。',
      fr: 'Numérisez les pages avec la caméra de documents (ou prenez des photos et vérifiez les coins) → améliorez la lisibilité → PDF → nommez-le → partagez.',
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
        params: {
          pageSize: 'a4',
          orientation: 'auto',
          marginMm: 0,
          fit: 'contain',
          maxMB: 0,
          textLayer: true,
        },
      },
      rename(t(locale, 'presets_Scan_5b295')),
      share,
    ],
  },
  {
    // D-272：拍纸质表格，做成 Excel；结果页可以查看和修改。
    id: 'scan-table-excel',
    scenario: 'paperwork',
    name: {
      en: 'Scan a table to Excel',
      zh: '拍表格转 Excel',
      fr: 'Numériser une grille en Excel',
    },
    description: {
      en: 'Scan a printed table (straightened automatically, or check the corners) → clean up → Excel workbook, a sheet per page → check and edit it on the result page. Tables with ruled lines work best.',
      zh: '扫描纸质表格（自动拉正，或确认四个角）→ 变清楚 → 转成 Excel，每页一张工作表 → 在结果页核对和修改。带线的表格效果最好。',
      fr: 'Numérisez une grille imprimée (redressement automatique, ou vérifiez les coins) → améliorez la lisibilité → classeur Excel, une feuille par page → vérifiez-le et modifiez-le sur la page de résultat. Les grilles à lignes donnent les meilleurs résultats.',
    },
    icon: 'scan',
    packs: ['scan'],
    steps: (locale) => [
      photos(1, 20, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      { id: 'look', action: 'scan.enhance', params: { mode: 'auto' } },
      toExcel(locale),
    ],
  },
  {
    // D-272：相册里的表格照片、截图做成 Excel。
    id: 'image-table-excel',
    scenario: 'paperwork',
    name: { en: 'Table picture to Excel', zh: '图片转 Excel', fr: 'Image de grille en Excel' },
    description: {
      en: 'Choose photos or screenshots of a table → Excel workbook, a sheet per picture → check and edit it on the result page. Tables with ruled lines work best.',
      zh: '选表格的照片或截图 → 转成 Excel，每张图一张工作表 → 在结果页核对和修改。带线的表格效果最好。',
      fr: 'Choisissez des photos ou des captures d’écran d’une grille → classeur Excel, une feuille par image → vérifiez-le et modifiez-le sur la page de résultat. Les grilles à lignes donnent les meilleurs résultats.',
    },
    icon: 'photo',
    steps: (locale) => [photos(1, 20), toExcel(locale)],
  },
  {
    id: 'combine-documents',
    scenario: 'paperwork',
    name: { en: 'Combine documents', zh: '多份材料合一', fr: 'Combiner des documents' },
    description: {
      en: 'Choose PDFs and images → merge into one PDF → pick, order and rotate pages → name it → share.',
      zh: '选 PDF 和图片 → 合成一个 PDF → 选页、排序、旋转 → 命名 → 分享。',
      fr: 'Choisissez des PDF et des images → fusionnez-les en un seul PDF → choisissez, ordonnez et faites pivoter les pages → nommez-le → partagez.',
    },
    icon: 'merge',
    steps: (locale) => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdfOrImages', min: 1, max: 30 } },
      { id: 'merge', action: 'pdf.merge', params: { imagePage: 'a4' } },
      { id: 'pages', action: 'pdf.pages', params: {} },
      rename(t(locale, 'presets_combined_7b1c7')),
      share,
    ],
  },
  {
    id: 'pdf-too-big',
    scenario: 'paperwork',
    name: {
      en: 'PDF too big to upload',
      zh: 'PDF 太大传不上去',
      fr: 'PDF trop lourd pour l’envoi',
    },
    description: {
      en: 'Choose PDFs → make each one smaller than the size you need (2 MB unless you change it; text stays selectable when possible) → share.',
      zh: '选 PDF → 压到要求的大小以内（默认 2 MB，可以每次改；能保留文字时文字仍可选中）→ 分享。',
      fr: 'Choisissez des PDF → compressez chacun sous la taille requise (2 Mo par défaut, modifiable ; le texte reste sélectionnable si possible) → partagez.',
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
    name: { en: 'Receipt archive', zh: '收据归档', fr: 'Archive de reçus' },
    description: {
      en: 'Scan a receipt (straightened automatically, or check the corners) → under 500 KB → name it by date → save to files.',
      zh: '扫描收据（自动拉正，或确认四个角）→ 压到 500 KB 以内 → 按日期命名 → 存到文件。',
      fr: 'Numérisez un reçu (redressement automatique, ou vérifiez les coins) → compressez à moins de 500 Ko → nommez-le par date → enregistrez dans les fichiers.',
    },
    icon: 'inbox',
    packs: ['scan'],
    steps: (locale) => [
      photos(1, 10, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      { id: 'compress', action: 'image.compress', params: { maxKB: 500, format: 'jpeg' } },
      rename(t(locale, 'presets_Receipt_d832a'), false),
      { id: 'save', action: 'file.save', params: {} },
    ],
  },
  {
    // D-197：扫一张收据，接到上次的报销单后面，合成一份。
    id: 'expense-report',
    scenario: 'receipts',
    name: {
      en: 'Expense report: add a receipt',
      zh: '报销单：扫一张加一张',
      fr: 'Note de frais : ajouter un reçu',
    },
    description: {
      en: 'Scan receipts → clean up → PDF → add them after the last expense report (or start a new one) → one PDF named by month → save to files.',
      zh: '扫描收据 → 变清楚 → 转 PDF → 接到上次的报销单后面（也可以新开一份）→ 合成一份，按月份命名 → 存到文件。',
      fr: 'Numérisez les reçus → améliorez la lisibilité → convertissez en PDF → ajoutez-les après la dernière note de frais (ou créez-en une nouvelle) → fusionnez en un seul PDF nommé par mois → enregistrez dans les fichiers.',
    },
    icon: 'inbox',
    packs: ['scan'],
    steps: (locale) => [
      photos(1, 10, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      { id: 'look', action: 'scan.enhance', params: { mode: 'auto' } },
      {
        id: 'pdf',
        action: 'pdf.fromImages',
        params: { pageSize: 'a4', orientation: 'auto', marginMm: 0, fit: 'contain', maxMB: 0 },
      },
      { id: 'add', action: 'file.addExisting', params: { position: 'before' } },
      { id: 'merge', action: 'pdf.merge', params: { imagePage: 'a4' } },
      rename(t(locale, 'presets_Expenses_427ff'), false),
      { id: 'save', action: 'file.save', params: {} },
    ],
  },
  {
    id: 'redact-screenshots',
    scenario: 'photos',
    name: {
      en: 'Hide parts of screenshots',
      zh: '截图打码分享',
      fr: 'Masquer des parties de captures d’écran',
    },
    description: {
      en: 'Choose screenshots → stitch into one long image → cover private parts → share.',
      zh: '选截图 → 拼成一张长图 → 盖住隐私部分 → 分享。',
      fr: 'Choisissez des captures d’écran → assemblez-les en une seule image longue → masquez les parties privées → partagez.',
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
    name: { en: 'Send many photos', zh: '批量发照片', fr: 'Envoyer beaucoup de photos' },
    description: {
      en: 'Choose photos → JPG → remove location → long side 2048 px → one ZIP → share.',
      zh: '多选照片 → 转 JPG → 去掉定位 → 长边 2048 像素 → 打包成一个 ZIP → 分享。',
      fr: 'Choisissez des photos → JPG → supprimer la localisation → côté le plus long 2048 px → un seul ZIP → partager.',
    },
    icon: 'archive',
    steps: (locale) => [
      photos(1, 50),
      { id: 'jpg', action: 'image.convert', params: { format: 'jpeg', quality: 85 } },
      { id: 'clean', action: 'image.stripMetadata', params: {} },
      { id: 'size', action: 'image.resize', params: { mode: 'longEdge', px: 2048 } },
      { id: 'zip', action: 'zip.create', params: {} },
      rename(t(locale, 'presets_Photos_c2260')),
      share,
    ],
  },
  {
    id: 'video-too-big',
    scenario: 'photos',
    name: {
      en: 'Video too big to send',
      zh: '视频太大发不出去',
      fr: 'Vidéo trop volumineuse pour l’envoi',
    },
    description: {
      en: 'Choose videos → make each one smaller than the size you need (20 MB unless you change it) as an MP4 that plays everywhere → share.',
      zh: '选视频 → 压到要求的大小以内（默认 20 MB，可以每次改），变成哪里都能放的 MP4 → 分享。',
      fr: 'Choisissez des vidéos → compressez chacune sous la taille requise (20 Mo par défaut, sauf si vous la modifiez) en MP4 lisible partout → partager.',
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
    id: 'join-videos',
    scenario: 'photos',
    name: { en: 'Join video clips', zh: '把几段视频拼成一段', fr: 'Assembler des extraits vidéo' },
    description: {
      en: 'Choose 2–10 clips, arrange them, and join them into one MP4 using the first clip’s size and frame rate.',
      zh: '选 2–10 段视频，调整顺序，按第一段的尺寸和帧率合成一个 MP4。',
      fr: 'Choisissez 2 à 10 extraits, réorganisez-les et assemblez-les en un seul MP4, en reprenant la taille et la fréquence d’images du premier extrait.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 2, max: 10 } },
      { id: 'order', action: 'file.order', params: {} },
      { id: 'merge', action: 'video.merge', params: {} },
    ],
  },
  {
    id: 'video-frame',
    scenario: 'photos',
    name: {
      en: 'Save a photo from a video',
      zh: '从视频里截一张照片',
      fr: 'Extraire une photo d’une vidéo',
    },
    description: {
      en: 'Choose videos, pick a frame in each, and save the photos to your library.',
      zh: '选视频，为每段挑一帧，存成照片放到相册。',
      fr: 'Choisissez des vidéos, sélectionnez une image dans chacune et enregistrez les photos dans votre photothèque.',
    },
    icon: 'photo',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'frame', action: 'video.frame', params: {} },
      { id: 'save', action: 'out.saveToPhotos', params: {} },
    ],
  },
  {
    id: 'mute-video',
    scenario: 'photos',
    name: { en: 'Remove sound from videos', zh: '视频去掉声音', fr: 'Supprimer le son des vidéos' },
    description: {
      en: 'Choose videos and make silent MP4 copies, keeping your originals.',
      zh: '选视频，另存为无声 MP4，原片保留。',
      fr: 'Choisissez des vidéos et créez des copies MP4 sans son ; vos originaux sont conservés.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'mute', action: 'video.mute', params: {} },
    ],
  },
  {
    id: 'video-background-music',
    scenario: 'photos',
    name: { en: 'Add background music', zh: '给视频换背景音乐', fr: 'Ajouter une musique de fond' },
    description: {
      en: 'Choose videos and a music file, then replace their sound. Music repeats when shorter; you can change how much original sound to keep.',
      zh: '选视频和音乐，换成新的配乐；较短音乐循环，可调整要保留多少原声。',
      fr: 'Choisissez des vidéos et un fichier musical, puis remplacez leur son. La musique se répète si elle est plus courte ; vous pouvez régler la part du son d’origine à conserver.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      {
        id: 'music',
        action: 'video.audio',
        params: { originalVolume: 0, loop: true },
        ask: ['originalVolume', 'loop'],
      },
    ],
  },
  {
    id: 'fix-video-rotation',
    scenario: 'photos',
    name: { en: 'Fix video rotation', zh: '把视频转正', fr: 'Corriger la rotation de la vidéo' },
    description: {
      en: 'Choose videos and rotate their picture right, left or upside down, keeping sound.',
      zh: '选视频，向右、向左或倒过来转正，声音保留。',
      fr: 'Choisissez des vidéos et faites pivoter l’image vers la droite, la gauche ou à l’envers, en conservant le son.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'rotate', action: 'video.rotate', params: { degrees: 90 }, ask: ['degrees'] },
    ],
  },
  {
    id: 'video-speed',
    scenario: 'photos',
    name: {
      en: 'Speed up or slow down video',
      zh: '视频加速或慢放',
      fr: 'Accélérer ou ralentir la vidéo',
    },
    description: {
      en: 'Choose videos and a playback speed from 0.5× to 4×. Sound changes speed and pitch too.',
      zh: '选视频，改成 0.5× 到 4× 速度。声音也会变速、变调。',
      fr: 'Choisissez des vidéos et une vitesse de lecture de 0,5× à 4×. Le son change aussi de vitesse et de tonalité.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'speed', action: 'video.speed', params: { factor: 2 }, ask: ['factor'] },
    ],
  },
  {
    id: 'vertical-video',
    scenario: 'photos',
    name: {
      en: 'Crop videos for portrait posts',
      zh: '裁成竖屏视频',
      fr: 'Vidéos au format portrait',
    },
    description: {
      en: 'Choose videos and crop the center to 9:16, or pick another shape each time.',
      zh: '选视频，居中裁成 9:16 竖屏，也可每次选别的比例。',
      fr: 'Choisissez des vidéos et recadrez le centre au format 9:16, ou choisissez un autre format à chaque fois.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'crop', action: 'video.crop', params: { ratio: '9:16' }, ask: ['ratio'] },
    ],
  },
  {
    // D-199：扫老照片。找边拉正，不增强、不压缩，存回相册。
    id: 'old-photos',
    scenario: 'photos',
    // 输入是扫描（归文档），但做出来的是照片：两个分类里都放。
    kinds: ['image', 'document'],
    name: { en: 'Scan old photos', zh: '扫老照片', fr: 'Numériser d’anciennes photos' },
    description: {
      en: 'Photograph printed photos with the document camera (or check the corners) → straightened, kept as they are → save to Photos.',
      zh: '用文档相机拍纸质老照片（或拍照后确认四个角）→ 拉正，不改颜色、不压缩 → 存到相册。',
      fr: 'Photographiez les tirages avec la caméra de document (ou vérifiez les coins) → redressés, conservés tels quels → enregistrez dans Photos.',
    },
    icon: 'photo',
    packs: ['scan'],
    steps: () => [
      photos(1, 30, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      { id: 'save', action: 'out.saveToPhotos', params: {} },
    ],
  },
  {
    id: 'print-id-photos',
    words: /证件照打印|打印证件照|证件照冲印|print(?:ing)? id photos?|id photos? to print/i,
    wordsFirst: true,
    scenario: 'ids',
    name: { en: 'ID photos to print', zh: '证件照打印', fr: 'Photos d’identité à imprimer' },
    description: {
      en: 'Choose a photo → frame it at the ID size → repeat it on 4×6 in photo paper with cut lines → print or save.',
      zh: '选照片 → 按证件照规格框选 → 排到 6 寸相纸上（带裁切线）→ 打印或保存。',
      fr: 'Choisissez une photo → cadrez-la à la taille de la photo d’identité → répétez-la sur papier photo 4×6 po avec lignes de coupe → imprimez ou enregistrez.',
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
  // ---- 翻译（D-173）：只出纯文字（可以排成 PDF），用来看懂意思，不是正式翻译 ----
  {
    id: 'foreign-pdf',
    scenario: 'paperwork',
    name: {
      en: 'Translate a PDF into English',
      zh: '外文 PDF 翻成中文',
      fr: 'Traduire un PDF en anglais',
    },
    description: {
      en: 'Choose a PDF with text → get its text → translate it into English on this device → plain-text PDF → share. For understanding, not an official translation.',
      zh: '选一个有文字的 PDF → 提取文字 → 在本机翻成中文 → 排成纯文字 PDF → 分享。用来看懂意思，不是正式翻译。',
      fr: 'Choisissez un PDF contenant du texte → extrayez son texte → traduisez-le en anglais sur cet appareil → PDF en texte brut → partagez. Pour comprendre le contenu, et non une traduction officielle.',
    },
    icon: 'document',
    packs: ['pdfview'],
    steps: (locale) => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
      { id: 'extract', action: 'pdf.extractText', params: {} },
      translateTo(locale),
      textPdf,
      rename(t(locale, 'presets_English_2d0eb'), false),
      share,
    ],
  },
  {
    id: 'foreign-paper',
    scenario: 'paperwork',
    name: {
      en: 'Translate paper documents into English',
      zh: '拍外文材料翻成中文',
      fr: 'Traduire des documents papier en anglais',
    },
    description: {
      en: 'Scan the pages → recognize the text (choose its language) → translate it into English on this device → plain-text PDF → share. For understanding, not an official translation.',
      zh: '扫描纸质材料 → 识别文字（选原文语言）→ 在本机翻成中文 → 排成纯文字 PDF → 分享。用来看懂意思，不是正式翻译。',
      fr: 'Numérisez les pages → reconnaissez le texte (choisissez sa langue) → traduisez-le en anglais sur cet appareil → PDF en texte brut → partagez. Pour comprendre le contenu, et non une traduction officielle.',
    },
    icon: 'scan',
    packs: ['scan', 'ocr'],
    steps: (locale) => [
      photos(1, 20, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      recognize(locale === 'zh' ? 'eng' : locale === 'fr' ? 'eng' : 'chi_sim'),
      translateTo(locale),
      textPdf,
      rename(t(locale, 'presets_Translation_38e12'), false),
      share,
    ],
  },
  {
    id: 'papers-to-english',
    scenario: 'ids',
    name: {
      en: 'Chinese documents into English',
      zh: '中文材料翻成英文',
      fr: 'Documents chinois en anglais',
    },
    description: {
      en: 'Scan Chinese documents → recognize the text → translate into English on this device → plain-text PDF → share. A draft to check; embassies and schools usually need a certified translation.',
      zh: '扫描中文材料 → 识别文字 → 在本机翻成英文 → 排成纯文字 PDF → 分享。是一份参考稿；使馆、学校通常要正式翻译件。',
      fr: 'Numérisez des documents chinois → reconnaissez le texte → traduisez-le en anglais sur cet appareil → PDF en texte brut → partagez. Un brouillon à vérifier ; les ambassades et les écoles demandent généralement une traduction certifiée.',
    },
    icon: 'scan',
    packs: ['scan', 'ocr'],
    steps: (locale) => [
      photos(1, 20, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      recognize('chi_sim', false),
      { id: 'translate', action: 'translate.text', params: { from: 'zh-Hans', to: 'en' } },
      textPdf,
      rename(t(locale, 'presets_English_fe3af'), false),
      share,
    ],
  },
  {
    id: 'screenshot-translate',
    scenario: 'photos',
    name: { en: 'Translate screenshots', zh: '截图翻译', fr: 'Traduire des captures d’écran' },
    description: {
      en: 'Choose screenshots → recognize the text (choose its language) → translate it into English on this device → copy the text.',
      zh: '选截图 → 识别文字（选原文语言）→ 在本机翻成中文 → 复制文字。',
      fr: 'Choisissez des captures d’écran → reconnaissez le texte (choisissez sa langue) → traduisez-le en anglais sur cet appareil → copiez le texte.',
    },
    icon: 'photo',
    packs: ['ocr'],
    steps: (locale) => [
      photos(1, 10),
      recognize(locale === 'zh' ? 'eng' : locale === 'fr' ? 'eng' : 'chi_sim'),
      translateTo(locale),
      { id: 'copy', action: 'text.copy', params: {} },
    ],
  },
  // ---- 音频（D-156）----
  {
    id: 'audio-to-text',
    scenario: 'study',
    name: { en: 'Recording to text', zh: '录音转文字', fr: 'Transcrire un enregistrement' },
    description: {
      en: 'Record now or choose recordings → turn them into text on this device (asks the language) → lay the text out as a PDF → share. The text may have mistakes; check it.',
      zh: '现在录音或选录音 → 在本机转成文字（每次问语言）→ 排成 PDF → 分享。文字可能有错字，请核对。',
      fr: 'Enregistrez du son ou choisissez des enregistrements → transcrivez-les sur cet appareil (la langue est demandée) → créez un PDF → partagez-le. Vérifiez le texte, qui peut contenir des erreurs.',
    },
    icon: 'audio',
    packs: ['speech-whisper-small'],
    steps: (locale) => [
      {
        id: 'pick',
        action: 'in.audio',
        params: { source: 'record', min: 1, max: 10 },
        ask: ['source'],
      },
      {
        id: 'text',
        action: 'audio.transcribe',
        params: { lang: speechLangFor(locale), model: 'standard' },
        ask: ['lang'],
      },
      { id: 'pdf', action: 'text.toPdf', params: { pageSize: 'a4', fontSize: 12 } },
      share,
    ],
  },
  {
    id: 'merge-recordings',
    scenario: 'study',
    name: {
      en: 'Join recordings into one',
      zh: '几段录音合成一个',
      fr: 'Assembler des enregistrements',
    },
    description: {
      en: 'Choose several recordings → put them in order → join them into one M4A → name it → share.',
      zh: '选几段录音 → 排好顺序 → 接成一段 M4A → 起个名字 → 分享。',
      fr: 'Choisissez plusieurs enregistrements → classez-les → assemblez-les en un fichier M4A → nommez-le → partagez-le.',
    },
    icon: 'audio',
    steps: (locale) => [
      { id: 'pick', action: 'in.audio', params: { source: 'files', min: 2, max: 10 } },
      { id: 'order', action: 'file.order', params: {} },
      { id: 'merge', action: 'audio.merge', params: {} },
      rename(t(locale, 'presets_Recording_cd46f')),
      share,
    ],
  },
  {
    id: 'voice-memo-archive',
    scenario: 'study',
    name: {
      en: 'Voice memos by date',
      zh: '语音备忘按日期归档',
      fr: 'Classer des mémos vocaux par date',
    },
    description: {
      en: 'Record a voice memo → name it with the date and time → save it in your folder in Files (chosen the first time).',
      zh: '录一段语音备忘 → 用日期和时间命名 → 存进「文件」里的文件夹（第一次时选一个）。',
      fr: 'Enregistrez un mémo vocal → nommez-le avec la date et l’heure → enregistrez-le dans un dossier de Fichiers (à choisir la première fois).',
    },
    icon: 'audio',
    steps: (locale) => [
      { id: 'pick', action: 'in.audio', params: { source: 'record', min: 1, max: 1 } },
      rename(t(locale, 'presets_Voice_memo_d1e75'), false),
      { id: 'save', action: 'out.saveToFolder', params: {} },
    ],
  },
  // ---- 文字转语音（D-270）：系统声音在本机读成音频文件，只出文件，不做播放器 ----
  {
    id: 'pdf-to-audio',
    scenario: 'study',
    name: { en: 'PDF to audio', zh: 'PDF 转成音频', fr: 'PDF en audio' },
    description: {
      en: 'Choose a PDF with text → get its text → read it aloud with the phone’s voice on this device (language detected) → M4A → share. Scanned PDFs without text don’t work.',
      zh: '选一个有文字的 PDF → 提取文字 → 在本机用手机自带的声音读出来（自动识别语言）→ 存成 M4A → 分享。扫描出来、没有文字的 PDF 不行。',
      fr: 'Choisissez un PDF contenant du texte → extrayez son texte → lisez-le à voix haute avec la voix du téléphone, sur cet appareil (langue détectée) → M4A → partagez. Les PDF numérisés sans texte ne fonctionnent pas.',
    },
    icon: 'audio',
    packs: ['pdfview'],
    steps: () => [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
      { id: 'extract', action: 'pdf.extractText', params: {} },
      speak,
      share,
    ],
  },
  {
    id: 'paper-to-audio',
    scenario: 'study',
    name: { en: 'Read paper pages aloud', zh: '拍纸张读成音频', fr: 'Lire des pages papier' },
    description: {
      en: 'Scan the pages → recognize the text → read it aloud with the phone’s voice on this device → M4A → share.',
      zh: '扫描纸质材料 → 识别文字 → 在本机用手机自带的声音读出来 → 存成 M4A → 分享。',
      fr: 'Numérisez les pages → reconnaissez le texte → lisez-le à voix haute avec la voix du téléphone, sur cet appareil → M4A → partagez.',
    },
    icon: 'scan',
    packs: ['scan', 'ocr'],
    steps: (locale) => [
      photos(1, 20, 'scanner'),
      { id: 'edges', action: 'scan.detect', params: {} },
      // 读的是用户自己的材料：语言自动识别，运行时不问（D-278）。
      recognize('auto', false),
      speak,
      share,
    ],
  },
  {
    id: 'video-srt-captions',
    scenario: 'photos',
    packs: ['speech-whisper-small'],
    name: {
      en: 'Export video captions as SRT',
      zh: '导出视频 SRT 字幕',
      fr: 'Exporter des sous-titres vidéo en SRT',
    },
    description: {
      en: 'Recognize video speech locally and save a separate SRT file. Captions are not burned into the video.',
      zh: '在本机识别视频里的讲话，生成单独的 SRT 字幕文件，不烧录进画面。',
      fr: 'Transcrivez les paroles de la vidéo sur cet appareil et créez un fichier SRT séparé. Les sous-titres ne sont pas incrustés dans la vidéo.',
    },
    icon: 'video',
    steps: (locale) => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      {
        id: 'captions',
        action: 'video.subtitles',
        params: { lang: speechLangFor(locale), model: 'standard' },
        ask: ['lang'],
      },
    ],
  },
  {
    id: 'mark-up-photos',
    scenario: 'photos',
    name: {
      en: 'Add arrows and notes to photos',
      zh: '在图片上画箭头和文字',
      fr: 'Annoter des photos',
    },
    description: {
      en: 'Draw arrows, boxes, freehand strokes and type notes on each photo, on this device.',
      zh: '在本机逐张添加箭头、方框、画笔和文字。',
      fr: 'Ajoutez des flèches, des cadres, des traits à main levée et du texte sur chaque photo, sur cet appareil.',
    },
    icon: 'photo',
    steps: () => [photos(1, 10), { id: 'mark', action: 'image.annotate', params: {} }],
  },
  {
    id: 'brighten-photos',
    scenario: 'photos',
    name: {
      en: 'Brighten dark photos',
      zh: '把太暗的照片调亮',
      fr: 'Éclaircir des photos sombres',
    },
    description: {
      en: 'Raise photo brightness a little, keeping the original dimensions.',
      zh: '适度提高照片亮度，保留原尺寸。',
      fr: 'Augmentez légèrement la luminosité des photos en conservant leurs dimensions.',
    },
    icon: 'photo',
    steps: () => [
      photos(1, 10),
      {
        id: 'adjust',
        action: 'image.adjust',
        params: { mode: 'manual', brightness: 15, contrast: 100, saturation: 100 },
      },
    ],
  },
  {
    id: 'remove-photo-background',
    scenario: 'photos',
    name: {
      en: 'Remove a photo background',
      zh: '把照片背景去掉',
      fr: 'Supprimer le fond d’une photo',
    },
    description: {
      en: 'Keep the subject on a transparent PNG. Requires iOS 17+ or Google Play services.',
      zh: '保留主体，输出透明 PNG。需要 iOS 17+ 或 Google Play 服务。',
      fr: 'Conservez le sujet sur un fond transparent au format PNG. Nécessite iOS 17 ou version ultérieure, ou les services Google Play.',
    },
    icon: 'photo',
    steps: () => [
      photos(1, 10),
      {
        id: 'remove',
        action: 'image.removeBackground',
        params: { background: 'transparent', color: '#FFFFFF' },
      },
    ],
  },
  {
    id: 'normal-audio-volume',
    scenario: 'sound',
    name: {
      en: 'Make quiet audio easier to hear',
      zh: '把录音调到正常音量',
      fr: 'Rendre un enregistrement plus audible',
    },
    description: {
      en: 'Choose recordings and adjust toward normal volume without clipping.',
      zh: '选录音，尽量调到正常音量，并限制峰值以避免削波。',
      fr: 'Choisissez des enregistrements et ajustez leur volume vers un niveau normal, en limitant les crêtes pour éviter la saturation.',
    },
    icon: 'audio',
    steps: () => [
      { id: 'pick', action: 'in.audio', params: { source: 'files', min: 1, max: 10 } },
      { id: 'volume', action: 'audio.volume', params: { mode: 'normal', db: 0 } },
    ],
  },
  {
    id: 'normal-video-volume',
    scenario: 'photos',
    name: {
      en: 'Make quiet video easier to hear',
      zh: '把视频调到正常音量',
      fr: 'Rendre une vidéo plus audible',
    },
    description: {
      en: 'Choose videos and adjust their sound toward normal volume, keeping the picture.',
      zh: '选视频，把声音尽量调到正常音量，保留画面。',
      fr: 'Choisissez des vidéos et réglez leur son vers un volume normal, tout en conservant l’image.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'volume', action: 'audio.volume', params: { mode: 'normal', db: 0 } },
    ],
  },
  {
    id: 'denoise-audio',
    scenario: 'sound',
    name: {
      en: 'Reduce noise in a voice recording',
      zh: '录音人声降噪',
      fr: 'Réduire le bruit d’un enregistrement',
    },
    description: {
      en: 'Reduce background noise around speech. Music may also be suppressed.',
      zh: '减少录音中人声周围的噪声，音乐也可能被削弱。',
      fr: 'Réduisez le bruit de fond autour de la voix. La musique peut aussi être atténuée.',
    },
    icon: 'audio',
    steps: () => [
      { id: 'pick', action: 'in.audio', params: { source: 'files', min: 1, max: 10 } },
      { id: 'denoise', action: 'audio.denoise', params: {} },
    ],
  },
  {
    id: 'denoise-video',
    scenario: 'photos',
    name: {
      en: 'Reduce noise in video speech',
      zh: '视频人声降噪',
      fr: 'Réduire le bruit de voix d’une vidéo',
    },
    description: {
      en: 'Reduce background noise around video speech and keep the picture. Music may also be suppressed.',
      zh: '减少视频中人声周围的噪声，保留画面，音乐也可能被削弱。',
      fr: 'Réduisez le bruit de fond autour de la voix dans une vidéo et conservez l’image. La musique peut aussi être atténuée.',
    },
    icon: 'video',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'denoise', action: 'audio.denoise', params: {} },
    ],
  },
  {
    id: 'audio-too-big',
    scenario: 'sound',
    name: {
      en: 'Recording too big to send',
      zh: '语音太大发不出去',
      fr: 'Alléger un enregistrement',
    },
    description: {
      en: 'Choose recordings → make each one smaller than the size you need (2 MB unless you change it) as an M4A that plays everywhere → share.',
      zh: '选录音 → 压到要求的大小以内（默认 2 MB，可以每次改），变成哪里都能放的 M4A → 分享。',
      fr: 'Choisissez des enregistrements → compressez chacun sous la taille requise (2 Mo par défaut, modifiable) en M4A lisible partout → partagez.',
    },
    icon: 'audio',
    steps: () => [
      { id: 'pick', action: 'in.audio', params: { source: 'files', min: 1, max: 10 } },
      {
        id: 'compress',
        action: 'audio.compress',
        params: { by: 'size', maxMB: 2, quality: 'standard' },
        ask: ['maxMB'],
      },
      share,
    ],
  },
  {
    id: 'cut-audio',
    scenario: 'sound',
    name: {
      en: 'Cut out part of a recording',
      zh: '剪一段音频',
      fr: 'Extraire un passage d’un enregistrement',
    },
    description: {
      en: 'Choose a recording or song → pick the part you want on the waveform → save it in Files. On Android you can then choose it as a ringtone in Settings; an iPhone app can not set ringtones.',
      zh: '选一段录音或歌曲 → 在波形图上选要的部分 → 存到「文件」。Android 可以再到系统设置里把它设成铃声；iPhone 不能由 App 设成铃声。',
      fr: 'Choisissez un enregistrement ou une chanson → sélectionnez le passage voulu sur la forme d’onde → enregistrez-le dans Fichiers. Sur Android, vous pouvez ensuite le définir comme sonnerie dans les Paramètres ; une application iPhone ne peut pas définir de sonnerie.',
    },
    icon: 'audio',
    steps: () => [
      { id: 'pick', action: 'in.audio', params: { source: 'files', min: 1, max: 1 } },
      { id: 'trim', action: 'audio.trim', params: {} },
      { id: 'save', action: 'out.saveToFolder', params: {} },
    ],
  },
  {
    id: 'video-sound',
    kinds: ['video', 'audio'],
    scenario: 'sound',
    name: {
      en: 'Keep the sound of a video',
      zh: '把视频的声音存下来',
      fr: 'Conserver le son d’une vidéo',
    },
    description: {
      en: 'Choose videos → keep only their sound as M4A → name it → save it in Files.',
      zh: '选视频 → 只要里面的声音（M4A）→ 起个名字 → 存到「文件」。',
      fr: 'Choisissez des vidéos → ne gardez que leur son en M4A → nommez-le → enregistrez-le dans Fichiers.',
    },
    icon: 'audio',
    steps: () => [
      { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
      { id: 'sound', action: 'audio.fromVideo', params: { format: 'm4a' } },
      rename('{sourceName}'),
      { id: 'save', action: 'out.saveToFolder', params: {} },
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
    name: localize(preset.name, locale),
    icon: preset.icon,
    presetId: preset.id,
    steps: preset.steps(locale),
  };
}

// 收件页面没用过时先推荐哪几个（D-237）：按文件类型、一个还是多个，最常见的排前面。
// 依据是 Smallpdf、iLovePDF、iLoveIMG 的热门工具和国内常见场景，还没有访谈验证。
const SHARE_ORDER: Partial<Record<MediaKind, { one: string[]; many: string[] }>> = {
  image: {
    one: [
      'email-photos',
      'document-packet',
      'visa-photo',
      'mark-up-photos',
      'remove-photo-background',
    ],
    many: [
      'document-packet',
      'send-photos',
      'email-photos',
      'redact-screenshots',
      'mark-up-photos',
    ],
  },
  video: {
    one: ['video-too-big', 'video-sound', 'video-frame', 'mute-video', 'fix-video-rotation'],
    many: ['join-videos', 'video-too-big', 'mute-video', 'video-sound', 'fix-video-rotation'],
  },
  pdf: {
    one: ['pdf-too-big', 'sign-return', 'combine-documents', 'foreign-pdf'],
    many: ['combine-documents', 'pdf-too-big'],
  },
  audio: {
    one: ['audio-to-text', 'audio-too-big', 'cut-audio', 'denoise-audio', 'normal-audio-volume'],
    many: [
      'merge-recordings',
      'audio-to-text',
      'audio-too-big',
      'denoise-audio',
      'normal-audio-volume',
    ],
  },
};

/** 这批文件先推荐的内设快捷操作 ID（最多 5 个）；类型混在一起或别的文件时为空。 */
export function sharePresetOrder(files: readonly SharedFileInfo[]): string[] {
  const kinds = new Set(files.map((f) => mediaKindOf(f.mimeType, f.name)));
  const order = kinds.size === 1 ? SHARE_ORDER[[...kinds][0]!] : undefined;
  if (!order) return [];
  return files.length === 1 ? order.one : order.many;
}

/**
 * 内设的快捷操作（D-236）：预设不用添加，直接用预设 ID 运行，运行记录也记在这个 ID 下。
 * 配置里有它的副本（改过、放到首页、旧版本添加过的）或同 ID 的快捷操作时，用配置里的。
 */
export function builtInWorkflows(workflows: readonly Workflow[], locale: Locale): Workflow[] {
  return WORKFLOW_PRESETS.filter(
    (p) => !workflows.some((w) => w.presetId === p.id || w.id === p.id),
  ).map((p) => presetWorkflow(p, locale, p.id));
}

/** 按 ID 找快捷操作：先找配置里的，再找内设的。 */
export function findWorkflow(
  workflows: readonly Workflow[],
  id: string,
  locale: Locale,
): Workflow | undefined {
  return (
    workflows.find((w) => w.id === id) ??
    builtInWorkflows(workflows, locale).find((w) => w.id === id)
  );
}

/**
 * 入口（按钮、快捷入口）指向的快捷操作（D-256）：和 findWorkflow 一样；指向内设快捷操作（预设 ID）、
 * 用户改过它以后配置里是 ID 不同的副本时，找到的是副本。
 */
export function findWorkflowTarget(
  workflows: readonly Workflow[],
  id: string,
  locale: Locale,
): Workflow | undefined {
  return (
    findWorkflow(workflows, id, locale) ??
    (presetById(id) ? workflows.find((w) => w.presetId === id) : undefined)
  );
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
