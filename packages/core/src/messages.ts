// 文案入口：t()、单复数规则、pairText。文案本身按语言放在 messages/en.ts、zh.ts、fr.ts，
// 三份的键由 MessageTable 保证完全一致。只用静态 import：App 跑在 Hermes 上。
import { FRENCH_PAIRS } from './french-pairs';
import { en, enSingular, type MessageTable, type StringKey } from './messages/en';
import { fr, frSingular } from './messages/fr';
import { zh } from './messages/zh';
import type { Locale } from './schema';

export type { StringKey } from './messages/en';

const TABLES: Record<Locale, MessageTable> = { en, zh, fr };
// 中文不分单复数，没有单数表。
const SINGULAR_TABLES: Record<Locale, Partial<MessageTable>> = {
  en: enSingular,
  zh: {},
  fr: frSingular,
};

/** 这个键有没有文案（键是拼出来的时候先查一下，例如 runError_<code>）。 */
export function hasMessage(key: string): key is StringKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** 哪个参数决定单复数（默认是 n）。 */
const PLURAL_COUNT_VARIABLE: Partial<Record<StringKey, string>> = {
  describe_Also_removes_card_s_that_ran_this_quic_5d29f: 'v0',
  describe_Also_removes_block_s_that_showed_a7a30: 'v0',
  describe_Also_removes_button_s_or_shortcut_s_th_d4dc1: 'v0',
  runDone: 'pages',
  runError_tooFew: 'min',
  runError_tooMany: 'max',
  runError_tooLong: 'seconds',
  packDeleteWithLanguages: 'count',
  recordCount: 'count',
  deleteForeverConfirm: 'count',
  editPageSummary: 'count',
  deleteGroupMessage: 'count',
  describe_Add_page_blocks_80d1f: 'v1',
  html_records_3f794: 'v0',
  ShareScreen_Needs_at_least_files_0ed9b: 'v0',
  ShareScreen_Takes_at_most_files_0fe59: 'v0',
  RedactScreen_boxes_4d76c: 'v0',
  FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442: 'v2',
  PagesScreen_Restore_removed_a7e1a: 'v0',
  io_taken_af2cf: 'v0',
  WorkflowsScreen_Needs_at_least_files_0ed9b: 'v0',
  WorkflowsScreen_Takes_at_most_files_0fe59: 'v0',
  runError_noneMatched: 'count',
  runItemImage: 'total',
  runItemFile: 'total',
  prefillMemoryCount: 'count',
  prefillMemoryRestoreConfirm: 'count',
  prefillMemoryRestored: 'count',
};

/**
 * 是否用单数（CLDR 的 one）。手写而不用 Intl.PluralRules：App 的 Hermes 引擎没有它，调用会直接抛错。
 * 法语 0 和小于 2 的数是单数，英文只有 1，中文不分单复数。
 */
export function isSingular(locale: Locale, n: number): boolean {
  if (locale === 'fr') return n >= 0 && n < 2;
  if (locale === 'en') return n === 1;
  return false;
}

export function t(
  locale: Locale,
  key: StringKey,
  vars: Record<string, string | number> = {},
): string {
  const count = vars[PLURAL_COUNT_VARIABLE[key] ?? 'n'];
  const table = TABLES[locale] ?? en;
  const text =
    (typeof count === 'number' && isSingular(locale, count)
      ? SINGULAR_TABLES[locale]?.[key]
      : undefined) ?? table[key];
  // 不分组：版本号、年份这类数字不能写成「12 345」。
  return text.replace(/\{(\w+)\}/g, (_, name: string) =>
    typeof vars[name] === 'number' && locale === 'fr'
      ? FRENCH_NUMBER.format(vars[name] as number)
      : String(vars[name] ?? `{${name}}`),
  );
}

const FRENCH_NUMBER = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 4,
  useGrouping: false,
});

/** 兼容工具定义中已有的英文/中文名称对；迁移完成前统一在此回退。 */
export function pairText(locale: Locale, pair: readonly [string, string]): string {
  return locale === 'zh' ? pair[1] : locale === 'fr' ? (FRENCH_PAIRS[pair[0]] ?? pair[0]) : pair[0];
}
