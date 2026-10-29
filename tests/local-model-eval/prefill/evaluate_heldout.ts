// 冻结样本：第一张模拟用户检查后保存，第二张只用于评测。只导出结果，不改预填实现。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { learnLayout, prefillRecord } from '../../../packages/core/src/prefill';
import type { Field, Locale } from '../../../packages/core/src/schema';

interface Case {
  id: string;
  kind: string;
  lang: Locale;
  fields: Field[];
  train: { text: string; truth: Record<string, string | number | null> };
  test: { text: string; truth: Record<string, string | number | null> };
}

const dataset = process.argv.includes('--absence') ? 'heldout_absence_pairs' : 'heldout_pairs';
const cases = readFileSync(join(import.meta.dirname, `${dataset}.jsonl`), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Case);

const rows = cases.map((item) => {
  const first = prefillRecord({
    text: item.train.text,
    locale: item.lang,
    fields: item.fields,
    now: new Date('2026-10-29T12:00:00Z'),
  });
  const memory = learnLayout(
    first.layout,
    {
      text: item.train.text,
      fields: item.fields,
      saved: item.train.truth,
      prefilled: first.values,
      candidates: first.candidates,
    },
    item.id,
  );
  const input = {
    text: item.test.text,
    locale: item.lang,
    fields: item.fields,
    now: new Date('2026-10-29T12:00:00Z'),
  };
  const rules = prefillRecord(input);
  const withMemory = prefillRecord({ ...input, memories: memory ? [memory] : [] });
  return {
    id: item.id,
    kind: item.kind,
    lang: item.lang,
    text: item.test.text,
    fields: item.fields,
    truth: item.test.truth,
    candidates: rules.candidates,
    rules: rules.values,
    memory: withMemory.values,
    memoryMatched: Boolean(withMemory.layout),
    memoryLearned: Boolean(memory),
  };
});

const path = join(import.meta.dirname, `../results/${dataset}_export.json`);
mkdirSync(join(import.meta.dirname, '../results'), { recursive: true });
writeFileSync(path, JSON.stringify(rows, null, 2));
console.log(
  `heldout=${rows.length} fields=${rows.reduce((sum, row) => sum + row.fields.length, 0)}`,
);
console.log(`memoryLearned=${rows.filter((row) => row.memoryLearned).length}`);
console.log(`memoryMatched=${rows.filter((row) => row.memoryMatched).length}`);
