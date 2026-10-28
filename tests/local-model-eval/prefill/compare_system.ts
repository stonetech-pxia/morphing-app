// 比较系统识别和规则的候选（模拟器探针的输出）：每份 ocr.txt，真值的日期 / 金额在不在候选里（召回），
// 同一位置两边统一后的写法是否一致，系统补上了规则漏掉的几个。不挑选，只看候选。
// 用法（仓库根目录）：npx tsx tests/local-model-eval/prefill/compare_system.ts <探针输出.jsonl>
// 输入每行：{"id":"receipts-zh-001-clean","matches":[{"kind":"date","start":12,"end":22,"value":"2026-01-16"}, …]}
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mergeCandidates,
  ruleCandidates,
  systemCandidates,
} from '../../../packages/core/src/prefill';

const data = join(import.meta.dirname, '..', 'data');
const t = {
  samples: 0,
  amountTruth: 0,
  amountRule: 0,
  amountSystem: 0,
  amountOnlySystem: 0,
  dateTruth: 0,
  dateRule: 0,
  dateSystem: 0,
  dateOnlySystem: 0,
  sameSpot: 0,
  sameSpotDisagree: 0,
};
const disagreements: string[] = [];
for (const line of readFileSync(process.argv[2]!, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { id: string; matches: Parameters<typeof systemCandidates>[1] };
  const dir = join(data, row.id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8'));
  const text = readFileSync(join(dir, 'ocr.txt'), 'utf8');
  const rules = ruleCandidates(text, meta.language);
  const system = systemCandidates(text, row.matches);
  t.samples++;
  const has = (list: typeof rules, kind: 'amount' | 'date', v: unknown) =>
    list.some(
      (c) =>
        c.kind === kind &&
        (kind === 'amount' ? Math.abs(Number(c.value) - Number(v)) < 0.005 : c.value === v),
    );
  for (const kind of ['amount', 'date'] as const) {
    const v = truth[kind];
    if (v === null || v === undefined) continue;
    t[`${kind}Truth`]++;
    const r = has(rules, kind, v);
    const s = has(system, kind, v);
    if (r) t[`${kind}Rule`]++;
    if (s) t[`${kind}System`]++;
    if (s && !r) t[`${kind}OnlySystem`]++;
  }
  for (const c of mergeCandidates(rules, system)) {
    const overlap = system.find(
      (s) => s.kind === c.kind && s.line === c.line && s.start < c.end && s.end > c.start,
    );
    if (c.source !== 'rule' || !overlap) continue;
    t.sameSpot++;
    if (!c.confirmed) {
      t.sameSpotDisagree++;
      if (disagreements.length < 30)
        disagreements.push(`${row.id} ${c.kind} 规则=${c.value} 系统=${overlap.value}`);
    }
  }
}
console.log(t);
console.log(disagreements.join('\n'));
