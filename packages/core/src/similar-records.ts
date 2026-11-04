import type { DataRecord } from './data';
import { recordCurrency } from './money-currency';
import { conceptOf, type ConceptId } from './prefill/concepts';
import { withDocKind } from './prefill/doc-context';
import type { Collection, Field } from './schema';

// 保存新记录前，这张表里有没有看起来一样的（D-426）。只看表上的 prefillRules（D-421）：收据比金额和日期，名片比电话和邮箱；
// 没有这个参数就什么都不比。纯函数，只在本机；结果只用来问一句，保存不会被挡住，也不合并、不删除任何记录（底线 5、19）。

/** 电话至少这么多位才算数（「分机 123」不算），只比最后这么多位（区号写法不同也对得上）。 */
const PHONE_MIN_DIGITS = 7;
const PHONE_TAIL_DIGITS = 9;

const text = (v: unknown) => (typeof v === 'string' ? v.normalize('NFKC') : '');

/** 名字：不分大小写，空格不算。 */
const nameKey = (v: unknown) => text(v).replace(/\s+/g, '').toLowerCase();

const emailKey = (v: unknown) => text(v).trim().toLowerCase();

const phoneKey = (v: unknown) => text(v).replace(/\D/g, '');

function samePhone(a: string, b: string): boolean {
  if (a.length < PHONE_MIN_DIGITS || b.length < PHONE_MIN_DIGITS) return false;
  const n = Math.min(a.length, b.length, PHONE_TAIL_DIGITS);
  return a.slice(-n) === b.slice(-n);
}

/** 金额（分）：数字，或文字字段里只有一个数；别的算没有。 */
function amountKey(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(text(v))
        ? Number(text(v).replace(',', '.'))
        : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 日期（YYYY-MM-DD，日期时间取那一天）：别的写法算没有。 */
const dayKey = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.exec(text(v))?.[0] ?? null;

const conceptField = (f: Field) => ({
  id: f.id,
  name: f.name,
  format: f.type === 'text' ? f.format : undefined,
});

function fieldsOf(collection: Collection, concepts: readonly ConceptId[]): Field[] {
  return collection.fields.filter((f) => {
    const concept = conceptOf(conceptField(f));
    return concept !== null && concepts.includes(concept);
  });
}

function receiptMatcher(collection: Collection) {
  const fields = collection.fields;
  const amount =
    fieldsOf(collection, ['amount']).find((f) => f.type !== 'formula') ??
    fields.find((f) => f.type === 'money' && conceptOf(conceptField(f)) !== 'tax');
  const notOther = (f: Field) => {
    const concept = conceptOf(conceptField(f));
    return concept !== 'dueDate' && concept !== 'signDate';
  };
  const date =
    fieldsOf(collection, ['issueDate'])[0] ??
    fields.find((f) => (f.type === 'date' || f.type === 'datetime') && notOther(f));
  if (!amount || !date) return null;
  const parties = fieldsOf(collection, ['merchant', 'company']);
  const partyOf = (values: Record<string, unknown>) =>
    parties.map((f) => nameKey(values[f.id])).find(Boolean) ?? '';
  return (values: Record<string, unknown>) => {
    const money = amountKey(values[amount.id]);
    const day = dayKey(values[date.id]);
    const party = partyOf(values);
    if (money === null || day === null) return () => false;
    return (other: Record<string, unknown>) => {
      if (amountKey(other[amount.id]) !== money || dayKey(other[date.id]) !== day) return false;
      // D-429：100 美元和 100 欧元不是同一笔。
      if (
        amount.type === 'money' &&
        recordCurrency(amount, values, collection) !== recordCurrency(amount, other, collection)
      )
        return false;
      const theirs = partyOf(other);
      return !party || !theirs || party === theirs;
    };
  };
}

function cardMatcher(collection: Collection) {
  const phones = fieldsOf(collection, ['phone']);
  const emails = fieldsOf(collection, ['email']);
  if (phones.length === 0 && emails.length === 0) return null;
  const list = (fields: readonly Field[], key: (v: unknown) => string, values: object) =>
    fields.map((f) => key((values as Record<string, unknown>)[f.id])).filter(Boolean);
  return (values: Record<string, unknown>) => {
    const myPhones = list(phones, phoneKey, values);
    const myEmails = list(emails, emailKey, values);
    return (other: Record<string, unknown>) =>
      list(phones, phoneKey, other).some((p) => myPhones.some((m) => samePhone(m, p))) ||
      list(emails, emailKey, other).some((e) => myEmails.includes(e));
  };
}

/**
 * values 是要存的值（prepareRecordValues 之后的），records 是这张表的记录。返回看起来一样的记录（保持原来的顺序）。
 * 回收站里的记录不算；空值永远对不上。
 */
export function findSimilarRecords<R extends DataRecord & { deletedAt?: number | null }>(
  collection: Collection,
  values: Record<string, unknown>,
  records: readonly R[],
): R[] {
  const rules = collection.prefillRules;
  if (!rules) return [];
  return withDocKind(rules, () => {
    const matcher = rules === 'receipt' ? receiptMatcher(collection) : cardMatcher(collection);
    if (!matcher) return [];
    const matches = matcher(values);
    return records.filter((r) => r.deletedAt == null && matches(r.values));
  });
}
