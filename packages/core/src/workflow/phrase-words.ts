// 内置规则（mock AI）的步骤说法用到的小工具：数字、大小、语言名、表名。
// 动作定义里的 phrases（workflow/contract.ts 的 StepPhraseRule）从这里取，也给 ai/workflow-phrases.ts 用。

export const num = (s: string) => Number(s.replace(/,/g, ''));

/** 「500KB」「2 MB」「1.5MB」→ KB。 */
export function sizeKB(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(kb|mb|k|m|兆)/i.exec(text);
  if (!m) return null;
  const n = num(m[1]!);
  return /^(mb|m|兆)$/i.test(m[2]!) ? Math.round(n * 1024) : Math.round(n);
}

/** 「中文」「英语」「Japanese」→ 翻译的语言代码。 */
const LANGUAGE_WORDS: [RegExp, string][] = [
  [/^(?:繁体中文|繁体|繁體中文|traditional chinese)$/i, 'zh-Hant'],
  [/^(?:中文|简体中文|汉语|chinese|simplified chinese)$/i, 'zh-Hans'],
  [/^(?:英文|英语|english)$/i, 'en'],
  [/^(?:日文|日语|japanese)$/i, 'ja'],
  [/^(?:韩文|韩语|korean)$/i, 'ko'],
  [/^(?:法文|法语|french)$/i, 'fr'],
  [/^(?:德文|德语|german)$/i, 'de'],
  [/^(?:西班牙文|西班牙语|spanish)$/i, 'es'],
  [/^(?:葡萄牙文|葡萄牙语|portuguese)$/i, 'pt'],
  [/^(?:意大利文|意大利语|italian)$/i, 'it'],
  [/^(?:俄文|俄语|russian)$/i, 'ru'],
  [/^(?:越南文|越南语|vietnamese)$/i, 'vi'],
  [/^(?:泰文|泰语|thai)$/i, 'th'],
];
export const LANGUAGE_WORD =
  '(繁体中文|繁體中文|简体中文|中文|汉语|英文|英语|日文|日语|韩文|韩语|法文|法语|德文|德语|西班牙文|西班牙语|葡萄牙文|葡萄牙语|意大利文|意大利语|俄文|俄语|越南文|越南语|泰文|泰语|traditional chinese|simplified chinese|chinese|english|japanese|korean|french|german|spanish|portuguese|italian|russian|vietnamese|thai)';

/** 语言说法 → 代码；不认识返回 null。 */
export function languageOf(word: string): string | null {
  return LANGUAGE_WORDS.find(([re]) => re.test(word.trim()))?.[1] ?? null;
}

/** 句子里说的表名：去掉引号和「表」「里」这类尾巴。 */
export const tableName = (raw: string | undefined) =>
  (raw ?? '')
    .replace(/["「」“”]/g, '')
    .replace(/(?:这张表|数据表|表格|表|里)$/, '')
    .trim();
