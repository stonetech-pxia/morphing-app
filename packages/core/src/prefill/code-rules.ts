import type { Field } from '../schema';
import { ruleCandidates } from './candidates';
import { amountChain, amountNear } from './amount-chain';
import { hasNoDecimals, rowHasDate, squash } from './check';
import { conceptOf, type ConceptId } from './concepts';
import { MAX_SUGGESTIONS, suggestValues, type SuggestInput, type ValueSuggestion } from './rank';
import { pageOccurrences } from './rows';
import {
  BAD_DATE_ROW,
  DEPART_ROW,
  HOTEL_DOC,
  invoiceNoByKey,
  NOT_NO,
  stripNoPrefix,
  upperAmount,
} from './zh-rules';

// 不用模型时每个字段的候选（D-394 的规则打分 + 算术 + 中文规则 + 值记忆），以及哪些字段代码有把握、不用问模型。

/**
 * 代码有把握的门槛（第一个候选的分 ≥ top，且比第二个高 ≥ gap）。测量时两折交叉定的、取更严的
 * （per-field/hybrid/plan.json，真实小票上这些格子 96% 对）。没列的字段从不算有把握。
 */
const SURE: Partial<Record<ConceptId, { top: number; gap: number }>> = {
  amount: { top: 4.5, gap: 1 },
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
  /** 代码拿不准，要问模型。 */
  ask: boolean;
}

export interface DocumentPlan {
  /** 整份文字，一排一个（按页接起来）。 */
  rows: string[];
  fields: FieldPlan[];
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

/** 这次文字里原样出现的、最长的存过的值。 */
function rememberedValue(known: readonly string[] | undefined, whole: string): string | null {
  const hits = (known ?? []).filter((v) => {
    const s = squash(v);
    return s.length >= 2 && whole.includes(s);
  });
  return [...hits].sort((a, b) => b.length - a.length)[0] ?? null;
}

/** 两个候选算不算同一个值。 */
export const sameValue = (f: Field, a: string, b: string) =>
  f.type === 'money' || f.type === 'number'
    ? Math.abs(Number(a) - Number(b)) < 0.005
    : squash(a) === squash(b);

/** 这份单据的规则结果和计划。 */
export function planDocument(input: SuggestInput): DocumentPlan {
  const pages = input.pages.map((p, i) => pageOccurrences(p, i, input.locale));
  const rows = pages.flatMap((p) => p.rows.map((r) => r.text));
  const whole = squash(rows.join('\n'));
  const scored = suggestValues(input);
  const upper = upperAmount(rows);
  const keyedNo = invoiceNoByKey(rows);
  const hotel = rows.some((r) => DEPART_ROW.test(r)) && rows.some((r) => HOTEL_DOC.test(r));
  const occurrences = pages.flatMap((p) => p.occ);

  // 不是规则打分给的值：记下它在哪一排（点了以后记忆用，D-394），标签用那一处的。
  const pickOf = (value: string): ValueSuggestion['pick'] => {
    const sq = squash(value);
    const hit =
      occurrences.find((o) => squash(o.value) === sq || squash(o.raw) === sq) ??
      occurrences.find((o) => Number(o.value) === Number(value) && value.trim() !== '');
    if (hit) return { label: hit.label, relY: Math.round(hit.relY * 1000) / 1000 };
    for (const p of pages) {
      const row = p.rows.find((r) => squash(r.text).includes(sq));
      if (row) return { label: '', relY: Math.round(row.relY * 1000) / 1000 };
    }
    return { label: '', relY: 0 };
  };
  const fromCode = (value: string): ValueSuggestion => ({ value, score: 0, pick: pickOf(value) });

  const fields = input.fields.map((field): FieldPlan => {
    const concept = conceptOf(field);
    let list = scored[field.id] ?? [];
    let code: string | null | undefined;
    const noDecimals = hasNoDecimals(field);
    const extras: string[] = [];
    if (concept === 'issueDate') {
      // 有效期、印制那排的日期不算。
      list = list.filter((s) => rows.some((r) => !BAD_DATE_ROW.test(r) && rowHasDate(r, s.value)));
      if (hotel) {
        const latest = rows
          .filter((r) => !BAD_DATE_ROW.test(r))
          .flatMap((r) => ruleCandidates(r, input.locale))
          .filter((c) => c.kind === 'date')
          .map((c) => c.value)
          .sort()
          .at(-1);
        if (latest) {
          code = latest;
          extras.push(latest);
        }
      }
    } else if (concept === 'number') {
      // 流水号、社保号那排的不要；NO 前缀去掉。
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
        extras.push(String(chain.value));
        const top = list[0]?.value;
        if (
          code === undefined &&
          (chain.how === 'payMinusChange' ||
            (top !== undefined && amountNear(chain.value, Number(top), noDecimals)))
        )
          code = String(chain.value);
      }
    }
    const top = list[0];
    if (code === undefined && top && concept) {
      const sure = SURE[concept];
      if (sure && top.score >= sure.top && top.score - (list[1]?.score ?? 0) >= sure.gap)
        code = top.value;
      else if (concept === 'phone') code = top.value;
    }
    if (code === undefined && !top && concept && EMPTY_IS_SURE.has(concept)) code = null;

    const merged: ValueSuggestion[] = [];
    const add = (s: ValueSuggestion) => {
      if (!merged.some((m) => sameValue(field, m.value, s.value))) merged.push(s);
    };
    if (code) add(list.find((s) => sameValue(field, s.value, code!)) ?? fromCode(code));
    for (const v of extras) add(list.find((s) => sameValue(field, s.value, v)) ?? fromCode(v));
    for (const s of list) add(s);

    const memory = usesValueMemory(field) ? rememberedValue(input.known?.[field.id], whole) : null;
    return {
      field,
      code: merged,
      remembered: memory ? fromCode(memory) : null,
      // 单选字段交给规则；不能填的字段（附件、勾选……）规则也不给候选。
      ask:
        code === undefined &&
        !(concept === null && (field.type === 'note' || FREE_NOTE.test(field.name.trim()))) &&
        (field.type === 'money' ||
          field.type === 'number' ||
          field.type === 'date' ||
          field.type === 'text' ||
          field.type === 'note'),
    };
  });
  return { rows, fields };
}

/** 一个字段最后给的候选：值记忆 → 模型 → 代码，去重，最多 3 个。 */
export function mergedSuggestions(plan: FieldPlan, model: readonly string[]): ValueSuggestion[] {
  const out: ValueSuggestion[] = [];
  const known = plan.code;
  const add = (s: ValueSuggestion) => {
    if (out.length < MAX_SUGGESTIONS && !out.some((m) => sameValue(plan.field, m.value, s.value)))
      out.push(s);
  };
  if (plan.remembered) add(plan.remembered);
  for (const v of model)
    add(
      known.find((s) => sameValue(plan.field, s.value, v)) ?? {
        value: v,
        score: 0,
        pick: { label: '', relY: 0 },
      },
    );
  for (const s of known) add(s);
  return out;
}
