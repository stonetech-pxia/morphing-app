// 不同类型、不同用户字段的合成文字筛查；不是实机 OCR 或真实世界准确率。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { prefillRecord } from '../../../packages/core/src/prefill';
import type { Field, Locale } from '../../../packages/core/src/schema';

interface Case {
  id: string;
  kind: string;
  lang: Locale;
  text: string;
  fields: Field[];
  truth: Record<string, string | number | null>;
}

const cases = readFileSync(join(import.meta.dirname, 'diverse_cases.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Case);

const counts = new Map<string, Record<string, number>>();
const failures: string[] = [];
const exported: object[] = [];
for (const item of cases) {
  const result = prefillRecord({
    text: item.text,
    locale: item.lang,
    fields: item.fields,
    now: new Date('2026-10-28T12:00:00Z'),
  });
  exported.push({ ...item, candidates: result.candidates, values: result.values });
  for (const field of item.fields) {
    const truth = item.truth[field.id];
    const got = result.values[field.id]?.value;
    const same =
      field.type === 'money' || field.type === 'number'
        ? Math.abs(Number(truth) - Number(got)) < 0.005
        : truth === got;
    const outcome =
      truth === null || truth === undefined
        ? got === undefined
          ? 'emptyOk'
          : 'filledNull'
        : got === undefined
          ? 'empty'
          : same
            ? 'correct'
            : 'wrong';
    const tally = counts.get(field.type) ?? {
      correct: 0,
      wrong: 0,
      empty: 0,
      emptyOk: 0,
      filledNull: 0,
    };
    tally[outcome]! += 1;
    counts.set(field.type, tally);
    if (outcome === 'wrong' || outcome === 'filledNull')
      failures.push(`${item.id}/${field.id}: expected=${truth}, got=${got}`);
  }
}
console.log(`cases=${cases.length}, kinds=${new Set(cases.map((c) => c.kind)).size}`);
for (const [type, tally] of counts) console.log(type, tally);
for (const failure of failures) console.log('MISS', failure);
writeFileSync(
  join(import.meta.dirname, '../results/diverse_export.json'),
  JSON.stringify(exported, null, 2),
);
