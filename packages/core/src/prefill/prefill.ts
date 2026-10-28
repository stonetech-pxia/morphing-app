import type { Field, Locale } from '../schema';
import { extractFirst } from '../text-rules';
import {
  mergeCandidates,
  ruleCandidates,
  systemCandidates,
  type SystemMatch,
  type ValueCandidate,
} from './candidates';
import {
  findLayout,
  readWithLayout,
  reconcileLayout,
  type LayoutMemory,
  type LineBox,
} from './memory';
import { pickAmount, pickDate, pickTax } from './pick';

// 「记一笔」预填（D-244 的扩展，原型，没接界面）。顺序：
//   1. 版式记忆学会了的字段，按记忆读；
//   2. 没有记忆或记忆读不出的，按标签规则挑（金额、税额、日期、单号）；候选以规则为主，系统识别补充；
//   3. 挑不出来就空着。商家这类没有规则的字段只靠记忆；分类和其他字段不预填，也不用大模型预填。
// 只预填表单，用户确认后点「记下」才保存（D-187、D-190）。文字只在本机，不发给 AI。

export type PrefillSource = 'memory' | 'rule' | 'system';

export interface PrefillValue {
  value: string | number;
  source: PrefillSource;
}

export interface PrefillInput {
  text: string;
  /** 文件的语言（年在后、日月分不清时英文按月在前）。 */
  locale: Locale;
  fields: readonly Field[];
  /** 系统识别的结果；没有（Expo Go、旧系统）时只用规则。 */
  system?: readonly SystemMatch[];
  /** 每行的位置（recognizeText 的行框），版式记忆用来在同一个标签下挑。 */
  boxes?: readonly (LineBox | null)[];
  /** 这张表的版式记忆。 */
  memories?: readonly LayoutMemory[];
}

export interface PrefillResult {
  values: Record<string, PrefillValue>;
  /** 认出的版式（保存时传给 learnLayout）。 */
  layout: LayoutMemory | null;
  candidates: ValueCandidate[];
}

const TAX_NAME = /税|tax|tva|vat/i;
const NUMBER_NAME =
  /单号|编号|号码|发票号|订单号|invoice|receipt no|order no|number|\bno\b|n°|numéro|référence|\bref\b/i;

const sourceOf = (c: ValueCandidate): PrefillSource => (c.source === 'system' ? 'system' : 'rule');

export function prefillRecord(input: PrefillInput): PrefillResult {
  const rules = ruleCandidates(input.text, input.locale);
  const candidates = input.system
    ? mergeCandidates(rules, systemCandidates(input.text, input.system))
    : rules;
  const found = input.memories ? findLayout(input.memories, input.text) : null;
  const layout = found ? reconcileLayout(found, input.fields) : null;
  const values: Record<string, PrefillValue> = {};

  // 没有记忆时规则只认得出「哪个是金额、哪个是税额、哪个是日期」：表里同一种字段不止一个就分不清，不填。
  const money = input.fields.filter((f) => f.type === 'money');
  const tax = money.filter((f) => TAX_NAME.test(f.name));
  const amount = money.filter((f) => !TAX_NAME.test(f.name));
  const dates = input.fields.filter((f) => f.type === 'date');
  const numbers = input.fields.filter((f) => f.type === 'text' && NUMBER_NAME.test(f.name));

  for (const field of input.fields) {
    const habit = layout?.fields[field.id];
    const remembered = habit ? readWithLayout(habit, input.text, candidates, input.boxes) : null;
    if (remembered !== null) {
      values[field.id] = {
        value: field.type === 'money' ? Number(remembered) : remembered,
        source: 'memory',
      };
      continue;
    }
    let picked: ValueCandidate | null = null;
    if (field.type === 'money' && amount.length === 1 && amount[0] === field)
      picked = pickAmount(input.text, candidates);
    else if (field.type === 'money' && tax.length === 1 && tax[0] === field)
      picked = pickTax(input.text, candidates);
    else if (field.type === 'date' && dates.length === 1) picked = pickDate(input.text, candidates);
    if (picked) {
      values[field.id] = {
        value: field.type === 'money' ? Number(picked.value) : picked.value,
        source: sourceOf(picked),
      };
      continue;
    }
    if (field.type === 'text' && numbers.length === 1 && numbers[0] === field) {
      const no = extractFirst(input.text, 'invoiceNo', input.locale);
      if (no) values[field.id] = { value: no, source: 'rule' };
    }
  }
  return { values, layout, candidates };
}
