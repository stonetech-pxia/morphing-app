import { t, pairText } from '../messages';
import { z } from 'zod';

import { OCR_LANGUAGES, ocrPackId } from '../packs';
import type { ToolDefinition } from '../registry';
import type { Locale, Localized, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 文字识别工具的清单（T5）：iOS 用系统的 Vision（D-085）、Android 用 ML Kit（D-087）识别，不需要下载；
// 系统识别不了的语言（Android 上的俄文）和 Expo Go 用文字识别包里的 tesseract.js（WebView），每种语言一个语言包。
// 识别出的文字只留在本机（RunValue 'text'）：复制、存成文件、生成 PDF，绝不发给 AI（D-036）。

export const OCR_TOOL_ID = 'ocr';
export const OCR_PAGE_ID = 'tool-ocr';

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
      en: 'Reads printed text in the images (one language per run). Handwriting and receipt amounts may be wrong. The text stays on this device.',
      zh: '识别图片里的印刷文字（每次一种语言）。手写和收据金额可能认错。文字只留在本机。',
      fr: 'Reconnaît le texte imprimé des images (une langue par exécution). L’écriture manuscrite et les montants de tickets peuvent être mal lus. Le texte reste sur cet appareil.',
    },
    input: ['images'],
    output: 'text',
    params: z.strictObject({ lang: z.enum(OCR_LANGUAGES) }),
    fields: [
      {
        key: 'lang',
        label: { en: 'Language', zh: '语言', fr: 'Langue' },
        kind: 'choice',
        options: OCR_LANGUAGES.map((value) => ({ value, label: OCR_LANGUAGE_NAMES[value] })),
      },
    ],
    pack: 'ocr',
    // 语言包依赖识别包：确保语言包就会连同识别包一起下载。系统能识别的语言不需要（engine 的 packNotNeeded）。
    packFor: (params) => ocrPackId(String(params.lang)),
    requires: [],
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

/** 单功能工作流（D-061）。默认语言跟随界面语言。 */
export function ocrWorkflows(locale: Locale): Workflow[] {
  const lang = locale === 'zh' ? 'chi_sim' : locale === 'fr' ? 'fra' : 'eng';
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
        { id: 'read', action: 'ocr.recognize', params: { lang }, ask: ['lang'] },
      ],
    ),
    wf(
      'ocr-scan',
      ['Scan and get text', '拍照识别文字'],
      [
        { id: 'shoot', action: 'in.photos', params: { source: 'scanner', min: 1, max: 10 } },
        { id: 'edges', action: 'scan.detect', params: {} },
        { id: 'read', action: 'ocr.recognize', params: { lang }, ask: ['lang'] },
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
