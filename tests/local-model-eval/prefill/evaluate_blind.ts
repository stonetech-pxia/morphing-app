// 没看过的测试样本（prefill/blind/cases.jsonl，由没读过规则代码的人写）上的最终成绩：
// 旧的 text-rules extractFirst 对新的 prefillRecord（候选 + 按标签挑，没有版式记忆、没有系统识别）。
// 用法（仓库根目录）：npx tsx tests/local-model-eval/prefill/evaluate_blind.ts [--show-wrong]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { prefillRecord } from '../../../packages/core/src/prefill/prefill';
import type { Field } from '../../../packages/core/src/schema';
import { extractFirst } from '../../../packages/core/src/text-rules';

type Locale = 'zh' | 'en' | 'fr';
const NAMES: Record<Locale, [string, string, string, string]> = {
  zh: ['金额', '税额', '日期', '单号'],
  en: ['Amount', 'Tax', 'Date', 'Number'],
  fr: ['Montant', 'TVA', 'Date', 'Numéro'],
};
const fieldsFor = (lang: Locale): Field[] => {
  const [amount, tax, date, no] = NAMES[lang];
  return [
    { id: 'amount', name: amount, type: 'money', currency: 'EUR' },
    { id: 'tax', name: tax, type: 'money', currency: 'EUR' },
    { id: 'date', name: date, type: 'date' },
    { id: 'invoiceNo', name: no, type: 'text' },
  ] as Field[];
};

const FIELDS = ['amount', 'date', 'tax', 'invoiceNo'] as const;
type Outcome = 'correct' | 'wrong' | 'empty' | 'emptyOk' | 'filledNull';
const tallies = new Map<string, Record<Outcome, number>>();
const count = (key: string, o: Outcome) => {
  const t = tallies.get(key) ?? { correct: 0, wrong: 0, empty: 0, emptyOk: 0, filledNull: 0 };
  t[o]++;
  tallies.set(key, t);
};
const same = (field: string, a: unknown, b: unknown) =>
  field === 'amount' || field === 'tax' ? Math.abs(Number(a) - Number(b)) < 0.005 : a === b;
const outcome = (field: string, truth: unknown, got: unknown): Outcome =>
  truth === null
    ? got === null || got === undefined
      ? 'emptyOk'
      : 'filledNull'
    : got === null || got === undefined
      ? 'empty'
      : same(field, truth, got)
        ? 'correct'
        : 'wrong';

const show = process.argv.includes('--show-wrong');
const path = join(import.meta.dirname, 'blind', 'cases.jsonl');
for (const line of readFileSync(path, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line) as {
    id: string;
    lang: Locale;
    category: string;
    text: string;
    truth: Record<string, unknown>;
  };
  const result = prefillRecord({ text: c.text, locale: c.lang, fields: fieldsFor(c.lang) });
  const old: Record<string, unknown> = {
    amount: extractFirst(c.text, 'amount', c.lang),
    date: extractFirst(c.text, 'date', c.lang),
    tax: null,
    invoiceNo: extractFirst(c.text, 'invoiceNo', c.lang),
  };
  for (const field of FIELDS) {
    const truth = c.truth[field] ?? null;
    const now = result.values[field]?.value ?? null;
    for (const [version, got] of [
      ['old', old[field]],
      ['new', now],
    ] as const) {
      const o = outcome(field, truth, got);
      for (const key of [
        `${field} ${version} all`,
        `${field} ${version} ${c.lang}`,
        `${field} ${version} ${c.category}`,
      ])
        count(key, o);
      if (show && version === 'new' && (o === 'wrong' || o === 'filledNull'))
        console.log(`WRONG ${c.id} ${field} truth=${truth} new=${got}`);
    }
  }
}
console.log('字段 版本 分组 | 对 | 填错 | 该填没填 | 正确空着 | 不该填却填');
for (const [key, t] of [...tallies].sort())
  console.log(`${key} | ${t.correct} | ${t.wrong} | ${t.empty} | ${t.emptyOk} | ${t.filledNull}`);
