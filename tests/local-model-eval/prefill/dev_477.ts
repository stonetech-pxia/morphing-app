// 在已有的 477 例（data/，开发时看过）上比较改进前后：旧的 text-rules extractFirst 对新的候选 + 按标签挑。
// 用法（仓库根目录）：npx tsx tests/local-model-eval/prefill/dev_477.ts [--misses amount|date]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ruleCandidates } from '../../../packages/core/src/prefill/candidates';
import { pickAmount, pickDate, pickTax } from '../../../packages/core/src/prefill/pick';
import { extractFirst } from '../../../packages/core/src/text-rules';

type Locale = 'zh' | 'en' | 'fr';
const data = join(import.meta.dirname, '..', 'data');
const misses = process.argv.includes('--misses')
  ? process.argv[process.argv.indexOf('--misses') + 1]
  : null;

type Tally = Record<'correct' | 'wrong' | 'empty' | 'emptyOk' | 'filledNull', number>;
const blank = (): Tally => ({ correct: 0, wrong: 0, empty: 0, emptyOk: 0, filledNull: 0 });
const tallies = new Map<string, Tally>();
const add = (key: string, truth: unknown, got: string | null, field: string) => {
  const t = tallies.get(key) ?? blank();
  tallies.set(key, t);
  const same = (a: unknown, b: string) =>
    field === 'date' ? a === b : Math.abs(Number(a) - Number(b)) < 0.005;
  if (truth === null || truth === undefined) {
    if (got === null) t.emptyOk++;
    else t.filledNull++;
  } else if (got === null) t.empty++;
  else if (same(truth, got)) t.correct++;
  else t.wrong++;
};

for (const name of readdirSync(data).sort()) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(data, name, 'meta.json'), 'utf8'));
  } catch {
    continue;
  }
  const truth = JSON.parse(readFileSync(join(data, name, 'truth.json'), 'utf8'));
  const text = readFileSync(join(data, name, 'ocr.txt'), 'utf8');
  const lang = meta.language as Locale;
  const candidates = ruleCandidates(text, lang);
  const results = {
    amount: {
      old: extractFirst(text, 'amount', lang),
      new: pickAmount(text, candidates)?.value ?? null,
    },
    date: { old: extractFirst(text, 'date', lang), new: pickDate(text, candidates)?.value ?? null },
    tax: { old: null, new: pickTax(text, candidates)?.value ?? null },
  };
  for (const [field, r] of Object.entries(results)) {
    if (!(field in truth)) continue;
    for (const version of ['old', 'new'] as const) {
      const got = r[version];
      for (const key of [
        `${field} ${version} all`,
        `${field} ${version} ${meta.category}`,
        `${field} ${version} ${meta.category}-${meta.difficulty}`,
      ])
        add(key, truth[field], got, field);
    }
    if (misses === field) {
      const t = truth[field];
      const ok =
        t === null
          ? r.new === null
          : r.new !== null &&
            (field === 'date' ? t === r.new : Math.abs(t - Number(r.new)) < 0.005);
      if (!ok) console.log(`MISS ${name} truth=${t} new=${r.new} old=${r.old}`);
    }
  }
}
if (!misses) {
  console.log('字段 版本 分组 | 对 | 错 | 该填没填 | 正确空着 | 不该填却填');
  for (const [key, t] of [...tallies].sort())
    console.log(`${key} | ${t.correct} | ${t.wrong} | ${t.empty} | ${t.emptyOk} | ${t.filledNull}`);
}
