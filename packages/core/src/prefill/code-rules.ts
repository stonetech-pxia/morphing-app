import type { Field, Locale } from '../schema';
import { ruleCandidates } from './candidates';
import { amountChain, amountNear } from './amount-chain';
import { canAskCategory, categoryByCode } from './category';
import { hasNoDecimals, rowHasDate, squash } from './check';
import { conceptOf, type ConceptId } from './concepts';
import { cardRules, ctx, receiptRules, resetDocContext, type DocumentKind } from './doc-context';
import { documentLanguage } from './model';
import {
  MAX_SUGGESTIONS,
  setDocContext,
  suggestValues,
  type SuggestInput,
  type ValueSuggestion,
} from './rank';
import { pageOccurrences } from './rows';
import { analyzeCard, cardCandidates, cardLike, looseEmails } from './card-rules';
import { addressCandidates } from './address-rules';
import { NOT_ISSUE_DATE_LEFT, PRINT_WORD_LEFT } from './rules-data';
import { contactCodeValues, parseContactCode } from '../vcard';
import {
  BAD_DATE_ROW,
  DEPART_ROW,
  HOTEL_DOC,
  invoiceNoByKey,
  mayHaveNumber,
  NOT_NO,
  stripNoPrefix,
  TRAVEL_DOC,
  upperAmount,
} from './zh-rules';

// 不用模型时每个字段的候选（D-394 的规则打分 + 算术 + 中文规则 + 值记忆），以及哪些字段代码有把握、不用问模型。

/**
 * 代码有把握的门槛（第一个候选的分 ≥ top，且比第二个高 ≥ gap）。测量时两折交叉定的、取更严的
 * （per-field/hybrid/plan.json，真实小票上这些格子 96% 对）；合计在 D-403 的规则上重新量过，放到
 * 3.5（D-404）。没列的字段从不算有把握。
 */
const SURE: Partial<Record<ConceptId, { top: number; gap: number }>> = {
  amount: { top: 3.5, gap: 1 },
  issueDate: { top: 0, gap: 0 },
  email: { top: 0, gap: 0 },
  category: { top: 0, gap: 0 },
  number: { top: 0, gap: 3 },
  tax: { top: 2.5, gap: 0 },
  destination: { top: 0, gap: 0 },
};
/** 规则一个候选都没有时，这些字段多半就是没有（单据上不一定印），不问模型。 */
const EMPTY_IS_SURE: ReadonlySet<ConceptId> = new Set([
  'number',
  'tax',
  'email',
  'origin',
  'destination',
]);

/**
 * 自由填写的字段：单据上没有它的值，问模型只会得到地址、电话这类没用的候选
 * （iOS 模拟器上 2026-11-01 看到的；D-394 也不给这种字段列候选）。
 */
const FREE_NOTE = /^(备注|附注|说明|notes?|remarks?|comments?|remarques?|commentaires?)$/i;

export interface FieldPlan {
  field: Field;
  /** 代码给的候选（好的在前），还没算值记忆。 */
  code: ValueSuggestion[];
  /** 这张表存过、这次文字里也有的值。 */
  remembered: ValueSuggestion | null;
  /** 二维码里写明的值（D-423）：排在最前面，也不用问模型。 */
  fromCode: ValueSuggestion[];
  /** 代码拿不准，要问模型。 */
  ask: boolean;
  /** 问了模型也让规则的候选排在前面（中文单据的合计，模型常挑小计，D-404）。 */
  codeFirst: boolean;
}

const CARD_NO_ASK = new Set<ConceptId>(['phone', 'email', 'website', 'address']);

export interface DocumentPlan {
  /** 用哪组规则：问模型和核对模型的答案时要一样。 */
  kind: DocumentKind;
  /** 整份文字，一排一个（按页接起来）。 */
  rows: string[];
  fields: FieldPlan[];
  /** 不是规则打分给的值（算术、值记忆、模型）在哪一排；找不到时没有，不记。 */
  pickOf(value: string): ValueSuggestion['pick'];
}

/** 这张表哪些字段用值记忆：店名、公司（别的字段的值换一张单据就不同了）。 */
export const usesValueMemory = (f: Field) => {
  const c = conceptOf(f);
  return (f.type === 'text' || f.type === 'note') && (c === 'merchant' || c === 'company');
};

/**
 * 从这张表已有的记录现查值记忆（字段 ID → 存过的值）。底线 14：不另存值；记录只读。
 * 每条记录的 values 是用户自己存的，不发给云端 AI（底线 2）。
 */
export function knownValues(
  fields: readonly Field[],
  records: readonly { values: Readonly<Record<string, unknown>> }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of fields) {
    if (!usesValueMemory(f)) continue;
    const seen = new Set<string>();
    for (const r of records) {
      const v = r.values[f.id];
      if (typeof v === 'string' && v.trim()) seen.add(v.trim());
    }
    if (seen.size > 0) out[f.id] = [...seen];
  }
  return out;
}

const HAS_CJK = /[㐀-鿿]/;
const LOWER = (t: string) => t.normalize('NFKC').toLowerCase();
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** 存过的值是不是原样出现在这一排：英文、数字要整个词（空格可以多可以少）；中文要整排，或者足够长（2、3 个字太容易是别的名字的开头）。 */
function rowHasValue(value: string, row: string): boolean {
  const sq = squash(value);
  if (sq.length < 2) return false;
  if (HAS_CJK.test(sq)) {
    const whole = squash(row);
    return whole === sq || (sq.length >= 4 && whole.includes(sq));
  }
  const body = [...sq].map((c) => c.replace(ESCAPE, '\\$&')).join('\\s*');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u').test(LOWER(row));
}

/** 这次文字里（在同一排上）原样出现的、最长的存过的值。 */
function rememberedValue(
  known: readonly string[] | undefined,
  rows: readonly string[],
): string | null {
  const hits = (known ?? []).filter((v) => rows.some((r) => rowHasValue(v, r)));
  return [...hits].sort((a, b) => b.length - a.length)[0] ?? null;
}

const withPick = (value: string, pick: ValueSuggestion['pick']): ValueSuggestion => ({
  value,
  score: 0,
  ...(pick ? { pick } : {}),
});

/**
 * 酒店账单：全文最晚的日期（有效期那种排不算）。一段文字分不清日月时只按语言先给的那个读法算，
 * 不在两种读法里取较晚的；最晚的恰好是这种日期时标出来。
 */
function latestDate(
  rows: readonly string[],
  locale: Locale,
): { value: string; ambiguous: boolean } | null {
  let best: { value: string; ambiguous: boolean } | null = null;
  for (const row of rows) {
    if (BAD_DATE_ROW.test(row)) continue;
    const dates = ruleCandidates(row, locale).filter((c) => c.kind === 'date');
    const seen = new Set<number>();
    for (const c of dates) {
      // 「Time printed : 28-OCT-20」这类打印日期不进最晚日期。
      if (receiptRules() && PRINT_WORD_LEFT.test(row.slice(Math.max(0, c.start - 30), c.start)))
        continue;
      if (seen.has(c.start)) continue;
      seen.add(c.start);
      const ambiguous = dates.some((o) => o.start === c.start && o.value !== c.value);
      if (!best || c.value > best.value || (c.value === best.value && !ambiguous))
        best = { value: c.value, ambiguous };
    }
  }
  return best;
}

/** 两个候选算不算同一个值。 */
export const sameValue = (f: Field, a: string, b: string) =>
  f.type === 'money' || f.type === 'number'
    ? Math.abs(Number(a) - Number(b)) < 0.005
    : squash(a) === squash(b);

/**
 * 这个日期（YYYY-MM-DD）在这一排里是不是只有有效期、退货期限这类日期：它左边 30 个字符里有 BAD_DATE_ROW 或
 * 「有效期、return by、refund」之类的词。排里认不出这个值时按整排判断。
 */
function badLeft(row: string, value: string, locale: Locale): boolean {
  const hits = ruleCandidates(row, locale).filter((c) => c.kind === 'date' && c.value === value);
  if (hits.length === 0) return BAD_DATE_ROW.test(row);
  return hits.every((c) => {
    const left = row.slice(Math.max(0, c.start - 30), c.start);
    return BAD_DATE_ROW.test(left) || NOT_ISSUE_DATE_LEFT.test(left);
  });
}

/** 附件里的二维码读出来的值（字段 ID → 值）：先读到的码在前，别的文字不算（D-423）。 */
function codeValues(input: SuggestInput): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const text of input.codes ?? []) {
    const code = parseContactCode(text);
    if (!code) continue;
    for (const [id, values] of Object.entries(contactCodeValues(input.fields, code)))
      out[id] = [...(out[id] ?? []), ...values];
  }
  return out;
}

/** 这份单据的规则结果和计划。 */
export function planDocument(input: SuggestInput): DocumentPlan {
  // 解析日期、金额的规则要知道币种、整份文字和「现在」；算完把上下文清掉，别让下一份文档用到这一份的。
  setDocContext(input);
  try {
    return planDocumentInner(input);
  } finally {
    resetDocContext();
  }
}

function planDocumentInner(input: SuggestInput): DocumentPlan {
  const pages = input.pages.map((p, i) => pageOccurrences(p, i, input.locale));
  const rows = pages.flatMap((p) => p.rows.map((r) => r.text));
  const scored = suggestValues(input);
  const upper = upperAmount(rows);
  const keyedNo = invoiceNoByKey(rows);
  const hotel =
    rows.some((r) => DEPART_ROW.test(r)) &&
    rows.some((r) => HOTEL_DOC.test(r)) &&
    !rows.some((r) => TRAVEL_DOC.test(r));
  const occurrences = pages.flatMap((p) => p.occ);
  const coded = cardRules() ? codeValues(input) : {};

  // 不是规则打分给的值：记下它在哪一排（点了以后记忆用，D-394），标签用那一处的。
  const pickOf = (value: string): ValueSuggestion['pick'] => {
    const sq = squash(value);
    const hit =
      occurrences.find((o) => squash(o.value) === sq || squash(o.raw) === sq) ??
      occurrences.find((o) => Number(o.value) === Number(value) && value.trim() !== '');
    if (hit)
      return {
        label: hit.label,
        relY: Math.round(hit.relY * 1000) / 1000,
        ...(hit.dateOrder ? { order: hit.dateOrder } : {}),
      };
    for (const p of pages) {
      const row = p.rows.find((r) => squash(r.text).includes(sq));
      if (row) return { label: '', relY: Math.round(row.relY * 1000) / 1000 };
    }
    return undefined;
  };
  const fromCode = (field: Field, value: string): ValueSuggestion =>
    // 单选的值是选项 ID，不在文字里：没有位置可记（D-405）。
    field.type === 'choice' ? { value, score: 0 } : withPick(value, pickOf(value));

  const fields = input.fields.map((field): FieldPlan => {
    const concept = conceptOf(field);
    // 分类（单选）：票面写了选项名，或词表有把握，就不问模型（D-405）。
    const category = field.type === 'choice' && concept === 'category';
    let list = scored[field.id] ?? [];
    if (
      cardRules() &&
      (concept === 'website' ||
        concept === 'jobTitle' ||
        concept === 'name' ||
        // 公司栏更严一点：还要有电话、邮箱或网站，行也不能多。
        (concept === 'company' && cardLike(analyzeCard(input.pages), true)))
    )
      list = cardCandidates(concept, input.pages);
    let code: string | null | undefined;
    const noDecimals = hasNoDecimals(field);
    const extras: string[] = [];
    // 排在打分第一个后面的算术结果（见下）。
    const second: string[] = [];
    if (concept === 'issueDate') {
      // 有效期、退货期限、印制那排的日期不算。
      list = list.filter((s) =>
        rows.some((r) =>
          receiptRules()
            ? rowHasDate(r, s.value) && !badLeft(r, s.value, input.locale)
            : !BAD_DATE_ROW.test(r) && rowHasDate(r, s.value),
        ),
      );
      if (hotel) {
        const latest = latestDate(rows, input.locale);
        // 最晚的那个分不清日月：不算有把握，候选的先后交给规则打分（按语言）。
        if (latest && !latest.ambiguous) {
          code = latest.value;
          extras.push(latest.value);
        }
      }
    } else if (concept === 'number') {
      // 流水号、社保号、公司号、地址那排的不要；NO 前缀去掉。
      list = list
        .filter((s) => !rows.some((r) => squash(r).includes(squash(s.value)) && NOT_NO.test(r)))
        .map((s) => ({ ...s, value: stripNoPrefix(s.value) }));
      if (keyedNo) {
        code = keyedNo;
        extras.push(keyedNo);
      }
    } else if (concept === 'amount') {
      if (upper?.sure) {
        code = String(upper.value);
        extras.push(code);
      }
      const chain = amountChain(rows, noDecimals, input.locale);
      if (chain) {
        // 算术只靠明细求和（不是付款减找零）得出、规则打分里又没有这个数，而打分第一个的标签分 ≥ 3
        // （标签明明白白写着合计）时，算术结果排第二，不抢第一个：错位的排版里「找零 7.00」会被当成总额。
        if (
          receiptRules() &&
          chain.how !== 'payMinusChange' &&
          (list[0]?.score ?? 0) >= 3 &&
          !list.some((s) => Math.abs(Number(s.value) - chain.value) < 0.005)
        )
          second.push(String(chain.value));
        else extras.push(String(chain.value));
        const top = list[0]?.value;
        if (
          code === undefined &&
          (chain.how === 'payMinusChange' ||
            (top !== undefined && amountNear(chain.value, Number(top), noDecimals)))
        )
          code = String(chain.value);
      }
    }
    if (concept === 'address' && cardRules())
      list = addressCandidates(analyzeCard(input.pages)).slice(0, 3);
    if (concept === 'email' && cardRules()) {
      const extra = looseEmails(analyzeCard(input.pages)).filter(
        (e) => !list.some((s) => s.value.toLowerCase() === e.value),
      );
      list = [...list, ...extra].slice(0, 3);
    }
    const top = list[0];
    if (code === undefined && top && concept) {
      const sure = SURE[concept];
      if (sure && top.score >= sure.top && top.score - (list[1]?.score ?? 0) >= sure.gap)
        code = top.value;
      else if (concept === 'phone') code = top.value;
    }
    if (code === undefined && category && field.type === 'choice')
      code = categoryByCode(field, rows) ?? undefined;
    if (code === undefined && !top && concept && EMPTY_IS_SURE.has(concept)) {
      // 文字里有单号的键名、代码又取不到值时是没把握，不是没有：要问模型。
      if (concept !== 'number' || !mayHaveNumber(rows)) code = null;
    }

    const merged: ValueSuggestion[] = [];
    const add = (s: ValueSuggestion) => {
      if (!merged.some((m) => sameValue(field, m.value, s.value))) merged.push(s);
    };
    if (code) add(list.find((s) => sameValue(field, s.value, code!)) ?? fromCode(field, code));
    for (const v of extras)
      add(list.find((s) => sameValue(field, s.value, v)) ?? fromCode(field, v));
    list.forEach((s, i) => {
      add(s);
      if (i === 0) for (const v of second) add(fromCode(field, v));
    });
    if (list.length === 0) for (const v of second) add(fromCode(field, v));

    const memory = usesValueMemory(field) ? rememberedValue(input.known?.[field.id], rows) : null;
    return {
      field,
      code: merged,
      remembered: memory ? fromCode(field, memory) : null,
      // 不带 pick：二维码的值不在文字的版面里，点了也不记位置。
      fromCode: (coded[field.id] ?? []).map((value) => ({ value, score: 0 })),
      // 单选字段只有分类问模型（D-405），别的交给规则；不能填的字段（附件、勾选……）规则也不给候选。
      ask:
        !coded[field.id]?.length &&
        code === undefined &&
        !(concept === null && (field.type === 'note' || FREE_NOTE.test(field.name.trim()))) &&
        // 店名的分数看不出对错，模型又换不对第一个，有候选就不为它加载模型（D-404）。
        !(concept === 'merchant' && merged.length > 0) &&
        // 名片上电话、邮箱、网址、地址问模型只会多出错的候选，不问。
        !(cardRules() && concept !== null && CARD_NO_ASK.has(concept)) &&
        ((category && field.type === 'choice' && canAskCategory(field)) ||
          field.type === 'money' ||
          field.type === 'number' ||
          field.type === 'date' ||
          field.type === 'text' ||
          field.type === 'note'),
      codeFirst: cardRules() || (concept === 'amount' && documentLanguage(rows) === 'zh'),
    };
  });
  return { rows, fields, pickOf, kind: ctx.kind };
}

/** 一个字段最后给的候选：值记忆 → 模型 → 代码，去重，最多 3 个。 */
export function mergedSuggestions(
  plan: FieldPlan,
  model: readonly string[],
  pickOf: DocumentPlan['pickOf'],
): ValueSuggestion[] {
  const out: ValueSuggestion[] = [];
  const known = plan.code;
  const add = (s: ValueSuggestion) => {
    if (out.length < MAX_SUGGESTIONS && !out.some((m) => sameValue(plan.field, m.value, s.value)))
      out.push(s);
  };
  for (const s of plan.fromCode) add(s);
  if (plan.remembered) add(plan.remembered);
  if (plan.codeFirst) for (const s of known) add(s);
  for (const v of model)
    add(
      known.find((s) => sameValue(plan.field, s.value, v)) ??
        (plan.field.type === 'choice' ? { value: v, score: 0 } : withPick(v, pickOf(v))),
    );
  for (const s of known) add(s);
  return out;
}
