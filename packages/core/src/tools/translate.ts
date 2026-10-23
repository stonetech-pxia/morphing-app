import { z } from 'zod';

import type { ToolDefinition } from '../registry';
import type { Locale, Localized, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 翻译工具（D-170–D-176）：iOS 用系统的 Translation 框架、Android 用 ML Kit 在本机翻译，文字不上传、
// 不发给 AI（D-036）。这是用户自己运行的工具；AI 只会把它搭进快捷操作，不会直接给出译文（D-113、D-128）。
// 只输出纯文字（可以再排成 PDF），不保留原文件的排版。

export const TRANSLATE_TOOL_ID = 'translate';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

/**
 * 能选的语言（BCP 47）：Apple 翻译和 ML Kit 都支持的常用语言。繁体中文只有 iOS 支持
 * （ML Kit 只有一种中文，译文是简体）。App 把它们换成各平台自己的语言代码。
 */
export const TRANSLATE_LANGUAGES = [
  'zh-Hans',
  'en',
  'zh-Hant',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'vi',
  'th',
  'id',
  'ar',
  'tr',
  'nl',
  'pl',
  'uk',
  'hi',
] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

export const TRANSLATE_LANGUAGE_NAMES: Record<TranslateLanguage, Localized> = {
  'zh-Hans': { en: 'Chinese (Simplified)', zh: '简体中文' },
  en: { en: 'English', zh: '英文' },
  'zh-Hant': { en: 'Chinese (Traditional)', zh: '繁体中文' },
  ja: { en: 'Japanese', zh: '日文' },
  ko: { en: 'Korean', zh: '韩文' },
  fr: { en: 'French', zh: '法文' },
  de: { en: 'German', zh: '德文' },
  es: { en: 'Spanish', zh: '西班牙文' },
  pt: { en: 'Portuguese', zh: '葡萄牙文' },
  it: { en: 'Italian', zh: '意大利文' },
  ru: { en: 'Russian', zh: '俄文' },
  vi: { en: 'Vietnamese', zh: '越南文' },
  th: { en: 'Thai', zh: '泰文' },
  id: { en: 'Indonesian', zh: '印尼文' },
  ar: { en: 'Arabic', zh: '阿拉伯文' },
  tr: { en: 'Turkish', zh: '土耳其文' },
  nl: { en: 'Dutch', zh: '荷兰文' },
  pl: { en: 'Polish', zh: '波兰文' },
  uk: { en: 'Ukrainian', zh: '乌克兰文' },
  hi: { en: 'Hindi', zh: '印地文' },
};

/** 一次最多翻译多少字（约 30 页）：本机翻译很快，但太长会让用户等很久。 */
export const MAX_TRANSLATE_CHARS = 100_000;

const languageOptions = TRANSLATE_LANGUAGES.map((value) => ({
  value,
  label: TRANSLATE_LANGUAGE_NAMES[value],
}));

export const TRANSLATE_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'translate.text',
    label: { en: 'Translate', zh: '翻译' },
    description: {
      en: 'Translate the text on this device (Apple Translation on iPhone, ML Kit on Android) into another language; the result is plain text, without the original layout. Good for understanding the meaning, not for official translations. The first use of a language may need a download. The text stays on this device.',
      zh: '在本机把文字翻译成另一种语言（iPhone 用系统翻译，Android 用 ML Kit），结果是纯文字，不保留原来的排版。适合看懂意思，正式文件请找专业翻译。第一次用某种语言时可能要下载。文字只留在本机。',
    },
    input: ['text'],
    output: 'text',
    params: z.strictObject({
      from: z.enum(['auto', ...TRANSLATE_LANGUAGES]),
      to: z.enum(TRANSLATE_LANGUAGES),
    }),
    fields: [
      {
        key: 'from',
        label: { en: 'From', zh: '原文语言' },
        kind: 'choice',
        options: [{ value: 'auto', label: { en: 'Detect', zh: '自动识别' } }, ...languageOptions],
      },
      {
        key: 'to',
        label: { en: 'Into', zh: '翻译成' },
        kind: 'choice',
        // 简体中文、英文排在最前（最常用）。只有这一个参数要问，不另设常用规格按钮（会和选项重复）。
        options: languageOptions,
        ask: true,
      },
    ],
    requires: [],
  },
];

// ---- 分段和拼回（纯函数，App 端翻译前后用）----

const CJK = '　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯';
const ENDS_CJK = new RegExp(`[${CJK}]$`);
const STARTS_CJK = new RegExp(`^[${CJK}]`);
/** 一行在这里结束一句话（或是标题、称呼）：后面另起。 */
const HARD_END = /[.!?。！？:：;；]["'”’）)]?$/;
/** 列表项、编号：前面另起。 */
const LIST_START =
  /^(?:[-•*·●▪◦]\s|\d{1,3}[.)、]\s?|[a-zA-Z][.)]\s|[一二三四五六七八九十]+[、.]|[（(]\d{1,3}[）)])/;
/** 一段太长时按句子切开（系统翻译一次处理的文字有限）。 */
const MAX_UNIT = 1500;
const SENTENCE = /[^.!?。！？]+[.!?。！？]+["'”’）)]?\s*|[^.!?。！？]+$/g;

function joinLine(current: string, line: string): string {
  if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) return current.slice(0, -1) + line;
  if (ENDS_CJK.test(current) || STARTS_CJK.test(line)) return current + line;
  return `${current} ${line}`;
}

function splitLong(unit: string): string[] {
  if (unit.length <= MAX_UNIT) return [unit];
  const out: string[] = [];
  let current = '';
  for (const sentence of unit.match(SENTENCE) ?? [unit]) {
    if (current && current.length + sentence.length > MAX_UNIT) {
      out.push(current.trim());
      current = '';
    }
    current += sentence;
    while (current.length > MAX_UNIT) {
      out.push(current.slice(0, MAX_UNIT));
      current = current.slice(MAX_UNIT);
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * 把文字拆成要翻译的小段：空行分段；段里的行重新接起来（文字识别和 PDF 每一行都断开，逐行翻译会把
 * 一句话拆坏），但一句话结束、短行（标题、地址、称呼）和列表项另起。结果是「段 → 行 → 片」，
 * 一行太长时按句子切成几片。
 */
export function splitForTranslation(text: string): string[][][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const longest = Math.max(...lines.map((l) => l.length));
      const units: string[] = [];
      let current = '';
      lines.forEach((line, i) => {
        current = current ? joinLine(current, line) : line;
        const next = lines[i + 1];
        // 断字（agree-/ment）一定接着下一行。
        const short = line.length < longest * 0.6 && !/\p{L}-$/u.test(line);
        if (!next || HARD_END.test(line) || short || LIST_START.test(next)) {
          units.push(current);
          current = '';
        }
      });
      return units.map(splitLong);
    });
}

/** 拼回去：同一行的几片按译文的文字接起来，行之间换行，段之间空一行。 */
export function joinTranslation(pieces: string[][][], to: string): string {
  const glue = /^(?:zh|ja)/.test(to) ? '' : ' ';
  return pieces
    .map((lines) => lines.map((parts) => parts.map((p) => p.trim()).join(glue)).join('\n'))
    .join('\n\n');
}

/** 系统识别出的语言代码 → 翻译用的代码；认不出（und、拼音）返回 null。 */
export function normalizeDetected(code: string | null | undefined): string | null {
  if (!code || code === 'und') return null;
  const lower = code.toLowerCase();
  if (lower.startsWith('zh')) {
    if (lower.includes('latn')) return null;
    return /hant|tw|hk|mo/.test(lower) ? 'zh-Hant' : 'zh-Hans';
  }
  return lower.split(/[-_]/)[0]!;
}

/** 两个代码是不是同一种语言（「zh-Hans」和「zh-Hant」不算）。 */
export const sameLanguage = (a: string, b: string) =>
  (normalizeDetected(a) ?? a) === (normalizeDetected(b) ?? b);

/** 有没有要翻译的字（只有数字、符号的片原样保留）。 */
export const hasWords = (text: string) => /\p{L}/u.test(text);

/**
 * 按原文语言分组：返回「原文语言 → 片的下标」。from 是 auto 时用每一片识别出的语言，识别不出的
 * 跟着全文最多的语言（按字数）；和目标语言相同的不翻译。
 */
export function groupBySource(
  pieces: readonly string[],
  detected: readonly (string | null)[] | null,
  from: string,
  to: string,
): Map<string, number[]> {
  const sources = pieces.map((p, i) =>
    !hasWords(p) ? null : from === 'auto' ? normalizeDetected(detected?.[i]) : from,
  );
  const chars = new Map<string, number>();
  sources.forEach((s, i) => s && chars.set(s, (chars.get(s) ?? 0) + pieces[i]!.length));
  const dominant = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const groups = new Map<string, number[]>();
  sources.forEach((s, i) => {
    const source = s ?? (hasWords(pieces[i]!) ? dominant : null);
    if (!source || sameLanguage(source, to)) return;
    groups.set(source, [...(groups.get(source) ?? []), i]);
  });
  return groups;
}

/** 语言的显示名；不在列表里的（自动识别出的瑞典文等）显示代码。 */
export function translateLanguageName(code: string, locale: Locale): string {
  const known = TRANSLATE_LANGUAGE_NAMES[code as TranslateLanguage];
  return known ? known[locale] : code;
}

// ---- 工具 ----

/**
 * 单功能工作流（D-061）：目标语言每次运行时问（D-072），默认是界面语言；照片里的文字默认按英文
 * （中文界面）或中文（英文界面）识别，也是每次问。
 */
export function translateWorkflows(locale: Locale): Workflow[] {
  const to = locale === 'zh' ? 'zh-Hans' : 'en';
  const ocrLang = locale === 'zh' ? 'eng' : 'chi_sim';
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    toolId: TRANSLATE_TOOL_ID,
    name: t(locale, ...name),
    steps,
  });
  return [
    wf(
      'translate-typed',
      ['Translate text', '翻译文字'],
      [
        { id: 'type', action: 'in.text', params: { text: '' }, ask: ['text'] },
        { id: 'translate', action: 'translate.text', params: { from: 'auto', to }, ask: ['to'] },
      ],
    ),
    wf(
      'translate-photos',
      ['Translate text in photos', '翻译照片里的文字'],
      [
        { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 20 } },
        { id: 'read', action: 'ocr.recognize', params: { lang: ocrLang }, ask: ['lang'] },
        { id: 'translate', action: 'translate.text', params: { from: 'auto', to }, ask: ['to'] },
      ],
    ),
    wf(
      'translate-pdf',
      ['Translate a PDF', '翻译 PDF'],
      [
        { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
        { id: 'extract', action: 'pdf.extractText', params: {} },
        { id: 'translate', action: 'translate.text', params: { from: 'auto', to }, ask: ['to'] },
      ],
    ),
  ];
}

export const translateTool: ToolDefinition = {
  id: TRANSLATE_TOOL_ID,
  version: '1.0.0',
  name: { en: 'Translate', zh: '翻译' },
  description: {
    en: 'Translate text, photos and PDFs on this device, in 20 languages. Plain text only, for understanding the meaning.',
    zh: '在本机翻译文字、照片和 PDF 里的文字，支持 20 种语言。只出纯文字，用来看懂意思。',
  },
  icon: 'text',
  aliases: ['translate', 'translation', 'translator', '翻译', '翻译工具', '翻译文字'],
  permissions: ['files.pick', 'files.write'],
  actions: TRANSLATE_ACTIONS,
  createPage: (locale) => ({
    id: `tool-${TRANSLATE_TOOL_ID}`,
    title: t(locale, 'Translate', '翻译'),
    icon: 'text',
    toolId: TRANSLATE_TOOL_ID,
    components: [
      {
        id: 'translate-header',
        type: 'header',
        props: { title: t(locale, 'Translate', '翻译') },
      },
      {
        id: 'translate-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Translates on this device; the text is never uploaded. Good for understanding the meaning — for official documents, use a professional translator. The first use of a language may need a download.',
            '在本机翻译，文字不会上传。适合看懂意思；正式文件请找专业翻译。第一次用某种语言时可能要下载。',
          ),
        },
      },
      ...translateWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
    ],
  }),
  createWorkflows: translateWorkflows,
};
