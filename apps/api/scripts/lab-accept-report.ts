import { readFileSync } from 'node:fs';

// 个人记录能力验收的统计（lab.ts --acceptance 写的 jsonl）。不调用模型。
// 用法：npx tsx scripts/lab-accept-report.ts runs/accept.jsonl [更多文件]

interface Row {
  id: string;
  category?: string;
  qualified?: boolean;
  qualifiedAtRound?: number | null;
  missingCore?: string[];
  missing?: string[];
  blockers?: unknown[];
  callCount?: number;
  usd?: number;
  crash?: string;
}

const files = process.argv.slice(2);
if (files.length === 0) throw new Error('用法：lab-accept-report.ts <jsonl>...');
const rows = files.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row),
);

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);
const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);

const finished = rows.filter((r) => !r.crash);
const qualified = finished.filter((r) => r.qualified);
const usd = rows.reduce((sum, r) => sum + (r.usd ?? 0), 0);
const calls = rows.reduce((sum, r) => sum + (r.callCount ?? 0), 0);
console.log(
  `共 ${rows.length} 次，合格 ${qualified.length}（${pct(qualified.length, finished.length)}），崩溃 ${rows.length - finished.length}，调用 ${calls} 次，$${usd.toFixed(3)}（每次 $${(usd / Math.max(rows.length, 1)).toFixed(4)}）`,
);

console.log('\n每类合格率');
for (const category of [...new Set(rows.map((r) => r.category ?? '?'))].sort()) {
  const inCategory = finished.filter((r) => (r.category ?? '?') === category);
  const ok = inCategory.filter((r) => r.qualified).length;
  console.log(`  ${category}: ${ok}/${inCategory.length} (${pct(ok, inCategory.length)})`);
}

console.log('\n每个场景');
for (const id of [...new Set(rows.map((r) => r.id))].sort()) {
  const runs = finished.filter((r) => r.id === id);
  const atRounds = runs.map((r) => r.qualifiedAtRound ?? '×').join(' ');
  console.log(
    `  ${id}: ${runs.filter((r) => r.qualified).length}/${runs.length}  第几轮: ${atRounds}`,
  );
}

console.log('\n第几轮合格（0 = 开场白一句就合格）');
const atRound = new Map<string, number>();
for (const r of finished) bump(atRound, r.qualified ? String(r.qualifiedAtRound) : '没合格');
for (const [round, n] of [...atRound].sort()) console.log(`  ${round}: ${n}`);

const missing = new Map<string, number>();
const missingOptional = new Map<string, number>();
for (const r of finished) {
  for (const id of r.missingCore ?? []) bump(missing, `${r.id}/${id}`);
  for (const id of r.missing ?? [])
    if (!r.missingCore?.includes(id)) bump(missingOptional, `${r.id}/${id}`);
}
console.log('\n最常缺的能力（core，到最后还没过）');
for (const [id, n] of sorted(missing)) console.log(`  ${n}  ${id}`);
console.log('\n最常缺的可选项');
for (const [id, n] of sorted(missingOptional)) console.log(`  ${n}  ${id}`);

const blocked = finished.filter((r) => (r.blockers?.length ?? 0) > 0).length;
console.log(`\n结束时还有 blocker：${blocked}/${finished.length}`);
for (const r of rows.filter((x) => x.crash)) console.log(`崩溃 ${r.id}: ${r.crash}`);
