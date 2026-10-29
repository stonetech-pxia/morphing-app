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
  anchorOf,
  isLearned,
  matchLayout,
  readWithLayout,
  reconcileLayout,
  SURE_LAYOUT_MATCH,
  type LayoutMemory,
  type LineBox,
} from './memory';
import { amountTier, labelOf, pickAmount, pickDate, pickTax } from './pick';

// 「记一笔」预填（D-244 的扩展，原型，没接界面）。顺序：
//   1. 版式记忆学会了的字段，按记忆读；新文件和记忆有任何对不上、不合理的地方（版式只是有点像、
//      记忆读不出、规则读出的不一样、多了一行记忆里没有的优惠、日期离谱），这个字段宁可空着，
//      也不退回规则去猜（创始人 2026-10-28 定）；
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
  /** 判断日期合不合理用；默认现在。 */
  now?: Date;
}

/** 记忆学过、但这次宁可空着的原因。 */
export type PrefillBlock =
  'layoutUnsure' | 'memoryUnreadable' | 'conflictsWithRules' | 'newAdjustment' | 'implausible';

export interface PrefillResult {
  values: Record<string, PrefillValue>;
  /** 记忆学过、但这次空着的字段和原因（只给测试和调试看，不显示给用户）。 */
  blocked: Record<string, PrefillBlock>;
  /** 认出的版式（保存时传给 learnLayout）；只是有点像时为 null，保存时开一个新的。 */
  layout: LayoutMemory | null;
  candidates: ValueCandidate[];
}

const TAX_NAME = /税|tax|tva|vat/i;
const NUMBER_NAME =
  /单号|编号|号码|发票号|订单号|invoice|receipt no|order no|number|\bno\b|n°|numéro|référence|\bref\b/i;

const sourceOf = (c: ValueCandidate): PrefillSource => (c.source === 'system' ? 'system' : 'rule');

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function prefillRecord(input: PrefillInput): PrefillResult {
  const rules = ruleCandidates(input.text, input.locale);
  const candidates = input.system
    ? mergeCandidates(rules, systemCandidates(input.text, input.system))
    : rules;
  const match = input.memories ? matchLayout(input.memories, input.text) : null;
  const memory = match ? reconcileLayout(match.memory, input.fields) : null;
  const sure = match !== null && match.score >= SURE_LAYOUT_MATCH;
  const values: Record<string, PrefillValue> = {};
  const blocked: Record<string, PrefillBlock> = {};
  const now = input.now ?? new Date();
  const lines = input.text.split('\n');

  // 没有记忆时规则只认得出「哪个是金额、哪个是税额、哪个是日期」：表里同一种字段不止一个就分不清，不填。
  const money = input.fields.filter((f) => f.type === 'money');
  const tax = money.filter((f) => TAX_NAME.test(f.name));
  const amount = money.filter((f) => !TAX_NAME.test(f.name));
  const dates = input.fields.filter((f) => f.type === 'date');
  const numbers = input.fields.filter((f) => f.type === 'text' && NUMBER_NAME.test(f.name));

  const byRules = (field: Field): ValueCandidate | null => {
    if (field.type === 'money' && amount.length === 1 && amount[0] === field)
      return pickAmount(input.text, candidates);
    if (field.type === 'money' && tax.length === 1 && tax[0] === field)
      return pickTax(input.text, candidates);
    if (field.type === 'date' && dates.length === 1) return pickDate(input.text, candidates);
    return null;
  };

  // 记忆里没见过的优惠、抵扣、负数行：合计的算法变了，记忆里的「实付在哪」不一定还对。
  const anchors = new Set(memory?.anchors ?? []);
  const newAdjustment = candidates.some((c) => {
    if (c.kind !== 'amount') return false;
    const adjusts =
      Number(c.value) < 0 || amountTier(labelOf(lines, c, candidates).text, false) === -1;
    return adjusts && !anchors.has(anchorOf(lines[c.line] ?? ''));
  });

  /** 记忆读出的值有没有不合理的地方；有就返回原因。 */
  const doubt = (field: Field, value: string): PrefillBlock | null => {
    if (field.type === 'money') {
      if (!(Number(value) > 0)) return 'implausible';
      if (newAdjustment && !tax.includes(field)) return 'newAdjustment';
    }
    if (field.type === 'date') {
      const t = Date.parse(`${value}T12:00:00`);
      if (!(t > now.getTime() - 10 * YEAR_MS && t < now.getTime() + YEAR_MS)) return 'implausible';
    }
    const ruled = byRules(field);
    if (ruled) {
      const same =
        field.type === 'money'
          ? Math.abs(Number(ruled.value) - Number(value)) < 0.005
          : ruled.value === value;
      if (!same) return 'conflictsWithRules';
    }
    return null;
  };

  for (const field of input.fields) {
    const habit = memory?.fields[field.id];
    // 商家这类不变的文字：新文字里有同样的值才填，没有就当没有记忆（不挡规则）。
    if (habit?.kind === 'constant') {
      const same = isLearned(habit) ? readWithLayout(habit, input.text, candidates) : null;
      if (sure && same !== null) {
        values[field.id] = { value: same, source: 'memory' };
        continue;
      }
    } else if (habit && isLearned(habit)) {
      // 记忆学过这个字段：只按记忆填；有任何不对劲就空着，不退回规则。
      const remembered = sure ? readWithLayout(habit, input.text, candidates, input.boxes) : null;
      const reason: PrefillBlock | null = !sure
        ? 'layoutUnsure'
        : remembered === null
          ? 'memoryUnreadable'
          : doubt(field, remembered);
      if (reason || remembered === null) {
        blocked[field.id] = reason ?? 'memoryUnreadable';
        continue;
      }
      values[field.id] = {
        value: field.type === 'money' ? Number(remembered) : remembered,
        source: 'memory',
      };
      continue;
    }
    const picked = byRules(field);
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
  return { values, blocked, layout: sure ? memory : null, candidates };
}
