import { t, pairText } from '../messages';
import { z } from 'zod';

import { OCR_LANGUAGES, ocrPackId } from '../packs';
import type { ToolDefinition } from '../registry';
import type { Locale, Localized, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 文字识别工具的清单（T5）：中文、日文、英法德西葡意用 PP-OCRv6（D-269，iOS 和 Android 都是，第一次用时下载模型）；
// 韩文等用系统自带的（iOS Vision，D-085；Android 只剩韩文用 ML Kit，D-087）；
// 系统也识别不了的语言（Android 上的俄文、越南文）和 Expo Go 用文字识别包里的 tesseract.js（WebView），每种语言一个语言包。
// 识别出的文字只留在本机（RunValue 'text'）：复制、存成文件、生成 PDF，绝不发给 AI（D-036）。

export const OCR_TOOL_ID = 'ocr';
export const OCR_PAGE_ID = 'tool-ocr';

/**
 * 识别语言的参数（D-278）：auto（默认，不问用户）或指定一种。auto 在手机上按手机语言选引擎：
 * PP-OCRv6 一个模型认中日英法德西葡意（字典里都有），手机是韩文、俄文、越南文时用系统的。
 */
export const OCR_LANGUAGE_CHOICES = ['auto', ...OCR_LANGUAGES] as const;
export type OcrLanguageChoice = (typeof OCR_LANGUAGE_CHOICES)[number];

export const OCR_LANGUAGE_NAMES: Record<(typeof OCR_LANGUAGES)[number], Localized> = {
  eng: { en: 'English', zh: '英文', fr: 'Anglais' },
  chi_sim: { en: 'Chinese (Simplified)', zh: '简体中文', fr: 'Chinois (simplifié)' },
  chi_tra: { en: 'Chinese (Traditional)', zh: '繁体中文', fr: 'Chinois (traditionnel)' },
  jpn: { en: 'Japanese', zh: '日文', fr: 'Japonais' },
  kor: { en: 'Korean', zh: '韩文', fr: 'Coréen' },
  fra: { en: 'French', zh: '法文', fr: 'Français' },
  deu: { en: 'German', zh: '德文', fr: 'Allemand' },
  spa: { en: 'Spanish', zh: '西班牙文', fr: 'Espagnol' },
  por: { en: 'Portuguese', zh: '葡萄牙文', fr: 'Portugais' },
  ita: { en: 'Italian', zh: '意大利文', fr: 'Italien' },
  rus: { en: 'Russian', zh: '俄文', fr: 'Russe' },
  vie: { en: 'Vietnamese', zh: '越南文', fr: 'Vietnamien' },
};

export const OCR_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'ocr.recognize',
    label: { en: 'Recognize text', zh: '识别文字', fr: 'Reconnaître le texte' },
    description: {
      en: 'Reads printed text in the images. lang "auto" (the default) reads Chinese, Japanese, English and Western European text with one model and picks by the phone’s language otherwise; set a language only when the user names one. Handwriting and receipt amounts may be wrong. The text stays on this device.',
      zh: '识别图片里的印刷文字。lang 为 auto（默认）时一个模型认中日英和西欧文字，其他按手机语言选；用户指定语言时才写具体语言。手写和收据金额可能认错。文字只留在本机。',
      fr: 'Reconnaît le texte imprimé des images. lang « auto » (par défaut) lit le chinois, le japonais, l’anglais et les langues d’Europe de l’Ouest avec un seul modèle, et choisit selon la langue du téléphone sinon ; n’indiquez une langue que si l’utilisateur la précise. L’écriture manuscrite et les montants de tickets peuvent être mal lus. Le texte reste sur cet appareil.',
    },
    input: ['images'],
    output: 'text',
    params: z.strictObject({ lang: z.enum(OCR_LANGUAGE_CHOICES) }),
    fields: [
      {
        key: 'lang',
        label: { en: 'Language', zh: '语言', fr: 'Langue' },
        kind: 'choice',
        options: [
          { value: 'auto', label: { en: 'Auto', zh: '自动', fr: 'Automatique' } },
          ...OCR_LANGUAGES.map((value) => ({ value, label: OCR_LANGUAGE_NAMES[value] })),
        ],
      },
    ],
    pack: 'ocr',
    // 语言包依赖识别包：确保语言包就会连同识别包一起下载。系统能识别的语言不需要（engine 的 packNotNeeded）。
    // auto 时用哪个由手机决定（App 的 devicePack / packNotNeeded），这里退回识别包本身。
    packFor: (params) => (params.lang === 'auto' ? undefined : ocrPackId(String(params.lang))),
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match: /^(?:识别文字|文字识别|提取文字)$|^(?:recognize|read|extract) (?:the )?text$/i,
        step: () => ({ params: { lang: 'auto' } }),
      },
    ],
  },
];

const CJK = '\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef';
// 韩文词之间本来就有空格，不算在内。不用后行断言：用捕获组保留前一个字。
const CJK_THEN = new RegExp(`([${CJK}]) +(?=[${CJK}0-9])`, 'g');
const DIGIT_THEN_CJK = new RegExp(`([0-9]) +(?=[${CJK}])`, 'g');

/**
 * 整理识别结果（在本机做）：tesseract 在中日韩文字之间会插空格（「租约 续签 通知」），去掉这些空格；
 * 拉丁文字之间的空格保留；去掉每行首尾空白和多余的空行。
 */
export function tidyOcrText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(CJK_THEN, '$1').replace(DIGIT_THEN_CJK, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 单功能工作流（D-061）。语言自动（D-278），运行时不问；用户可以在「调整设置」里指定。 */
export function ocrWorkflows(locale: Locale): Workflow[] {
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    toolId: OCR_TOOL_ID,
    name: pairText(locale, name),
    steps,
  });
  return [
    wf(
      'ocr-photos',
      ['Text from photos', '识别照片里的文字'],
      [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 20 } },
        { id: 'read', action: 'ocr.recognize', params: { lang: 'auto' } },
      ],
    ),
    wf(
      'ocr-scan',
      ['Scan and get text', '拍照识别文字'],
      [
        { id: 'shoot', action: 'in.photos', params: { source: 'scanner', min: 1, max: 10 } },
        { id: 'edges', action: 'scan.detect', params: {} },
        { id: 'read', action: 'ocr.recognize', params: { lang: 'auto' } },
      ],
    ),
  ];
}

export const ocrTool: ToolDefinition = {
  id: OCR_TOOL_ID,
  version: '1.0.0',
  name: { en: 'Text recognition', zh: '文字识别', fr: 'Reconnaissance de texte' },
  description: {
    en: 'Get printed text out of photos and scans on this device, in 12 languages.',
    zh: '在本机识别照片和扫描件里的印刷文字，支持 12 种语言。',
    fr: 'Extrait le texte imprimé des photos et numérisations sur cet appareil, en 12 langues.',
  },
  icon: 'text',
  aliases: ['ocr', 'text recognition', 'recognize text', '文字识别', '识别文字', 'ocr 工具'],
  permissions: ['files.pick', 'files.write', 'camera'],
  actions: OCR_ACTIONS,
  createPage: (locale) => ({
    id: OCR_PAGE_ID,
    title: t(locale, 'ocr_Text_recognition_fe569'),
    icon: 'text',
    toolId: OCR_TOOL_ID,
    components: [
      {
        id: 'ocr-header',
        type: 'header',
        props: { title: t(locale, 'ocr_Text_recognition_fe569') },
      },
      {
        id: 'ocr-intro',
        type: 'text',
        props: {
          text: t(locale, 'ocr_Runs_on_this_device_the_text_is_never__38fca'),
        },
      },
      ...ocrWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
    ],
  }),
  createWorkflows: ocrWorkflows,
};
