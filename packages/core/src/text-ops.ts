import { extractAll, type ExtractKind } from './text-rules';
import type { Locale } from './schema';

// 文字加工（D-245）：text → text 的几种固定操作。文字只在本机处理，AI 只选操作和参数；
// 替换用的词是用户自己写的（私有参数，发给 AI 前换成占位符，D-065 / D-082），按字面替换，不是正则。

export type BlankLines = 'keep' | 'single' | 'remove';

/** 去掉多余空格（行首行尾、连续的空格和制表符）和空行（keep 不动、single 连续空行只留一个、remove 全去掉）。 */
export function tidyText(text: string, blankLines: BlankLines, spaces: boolean): string {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (spaces) lines = lines.map((l) => l.replace(/[ \t 　]+/g, ' ').trim());
  if (blankLines === 'remove') lines = lines.filter((l) => l.trim() !== '');
  else if (blankLines === 'single')
    lines = lines.filter((l, i) => l.trim() !== '' || (i > 0 && lines[i - 1]!.trim() !== ''));
  return lines.join('\n').replace(/^\n+|\n+$/g, '');
}

/** 按字面替换全部出现的地方；ignoreCase 时不分大小写。返回替换后的文字和替换了几处。 */
export function replaceText(
  text: string,
  find: string,
  replaceWith: string,
  ignoreCase: boolean,
): { text: string; count: number } {
  if (!find) return { text, count: 0 };
  const haystack = ignoreCase ? text.toLowerCase() : text;
  const needle = ignoreCase ? find.toLowerCase() : find;
  let out = '';
  let count = 0;
  let from = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
    out += text.slice(from, at) + replaceWith;
    from = at + find.length;
    count++;
  }
  return { text: out + text.slice(from), count };
}

/** 取出全部手机号 / 邮箱 / 网址 / 数字 / 日期，一行一个。 */
export const extractText = (text: string, kind: ExtractKind, locale: Locale) =>
  extractAll(text, kind, locale).join('\n');

export const LINE_SEPARATORS = ['newline', 'comma', 'semicolon', 'space', 'tab', 'none'] as const;
export type LineSeparator = (typeof LINE_SEPARATORS)[number];

const JOIN: Record<LineSeparator, string> = {
  newline: '\n',
  comma: ', ',
  semicolon: '; ',
  space: ' ',
  tab: '\t',
  none: '',
};
// 拆分时中文的逗号、分号、顿号也算。
const SPLIT: Record<Exclude<LineSeparator, 'none' | 'newline'>, RegExp> = {
  comma: /[,，、]/,
  semicolon: /[;；]/,
  space: /[ 　]+/,
  tab: /\t/,
};

/**
 * 拆成行：按分隔符拆开，每段一行（去掉首尾空格和空段）。合成一行：每行去掉首尾空格、跳过空行，用分隔符接起来。
 */
export function splitOrJoinLines(text: string, mode: 'split' | 'join', separator: LineSeparator) {
  if (mode === 'join') {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(JOIN[separator]);
  }
  if (separator === 'none' || separator === 'newline') return text;
  return text
    .split(/\r?\n/)
    .flatMap((l) => l.split(SPLIT[separator]))
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');
}
