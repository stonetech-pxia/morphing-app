import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { BUILTIN_TOOLS, EVAL_CASES, createRegistry, runEvalCase } from '@morph/core';

import {
  MODELS,
  createClaudePlanner,
  createHttpCompleter,
  createRelayCompleter,
  type Completion,
  type HttpCompleterOptions,
} from '@morph/planner';

import { createRelayRuntime, loadRootEnv } from '../src/config';
import { createApp } from '../src/server';

// 用评测集（packages/core/src/ai/eval-cases.ts）衡量真实模型。会产生 API 费用。
// 用法：npm run eval -- --model claude-haiku-5-5 [--cases A1,C1] [--effort low] [--transport http] [--batch]
//   默认（relay）：和「Morph 服务器」模式完全一样——App 的转发传输层 → 本进程里的 /v1/complete → Claude（D-193）。
//   --transport http：App 内「自带 key」模式的 HTTP 传输层，直接调用 Claude。
//   --batch：所有用例同时跑，请求攒成批走批处理 API。半价，但每一轮要等几分钟到几小时；
//     修复请求是下一批。批处理 API 不接受 fallbacks，所以没有拒答回退。只能配 relay 传输。
//   --verbose：失败时打印模型给出的计划。计划里的 notes（D-110）总是打印。
//   --full：不按需加载，每次都发完整的提示词（默认和 App 一样走 route.ts 的路由）。
//   --dump <文件>：把每个用例的计划（含通过的）和结果写成 JSON，给提示词路由的测试取「需要哪些部分」。

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    cases: { type: 'string' },
    effort: { type: 'string' },
    transport: { type: 'string' },
    batch: { type: 'boolean' },
    verbose: { type: 'boolean' },
    dump: { type: 'string' },
    full: { type: 'boolean' },
  },
});

loadRootEnv();
const env = { ...process.env };
if (values.model) env.MORPH_AI_MODEL = values.model;
if (values.effort) env.MORPH_AI_EFFORT = values.effort;

const batch = values.batch ?? false;
if (batch && values.transport === 'http') {
  console.error('--batch 只能配 relay 传输。');
  process.exit(1);
}
const runtime = createRelayRuntime(env, { batch });
const apiKey = env.ANTHROPIC_API_KEY?.trim();
if (!runtime.relay || !apiKey) {
  console.error('未配置 ANTHROPIC_API_KEY，无法评测真实模型。见 docs/API_KEY_SETUP.md。');
  process.exit(1);
}

const registry = createRegistry(BUILTIN_TOOLS);
const completions: Completion[] = [];
const transport = values.transport === 'http' ? 'http' : 'relay';
const server = createApp({
  ...runtime,
  perMinuteLimit: 1000,
  deviceDailyUsd: 100,
  globalDailyUsd: 100,
  offPlanLimit: 1000,
  log: () => {},
});
const complete =
  transport === 'http'
    ? createHttpCompleter({
        apiKey,
        model: runtime.model,
        registry,
        effort: values.effort as HttpCompleterOptions['effort'],
      })
    : createRelayCompleter({
        baseUrl: 'http://relay.test',
        registry,
        // 一批最长 24 小时。
        timeoutMs: batch ? 24 * 60 * 60_000 : 120_000,
        fetchImpl: ((url: string, init?: RequestInit) => server.request(url, init)) as typeof fetch,
      });
const selected = values.cases ? new Set(values.cases.split(',')) : null;
const cases = EVAL_CASES.filter((c) => !selected || selected.has(c.id));
const now = new Date();
let passed = 0;
const failures: string[] = [];
const dumped: Record<string, { pass: boolean; plans: unknown[]; routes: string[] }> = {};
// 每种路由的请求数和 token（输入含缓存写入，另记缓存读取）。
const byRoute = new Map<string, { calls: number; input: number; cacheRead: number }>();

console.log(
  `模型：${runtime.model}${env.MORPH_AI_EFFORT ? `（effort ${env.MORPH_AI_EFFORT}）` : ''}，传输：${transport}${batch ? '（批处理）' : ''}，用例数：${cases.length}\n`,
);

async function runCase(c: (typeof cases)[number]): Promise<string> {
  // 每个用例一个 planner，批处理时用例同时跑，请求次数也能分开数。
  let calls = 0;
  const routes: string[] = [];
  const provider = createClaudePlanner({
    complete,
    registry,
    now: () => new Date(),
    route: !values.full,
    onRoute: (route) => routes.push(route),
    onCompletion: (completion) => {
      calls++;
      completions.push(completion);
      const route = routes.at(-1) ?? 'full';
      const r = byRoute.get(route) ?? { calls: 0, input: 0, cacheRead: 0 };
      r.calls++;
      r.input += completion.usage.inputTokens + completion.usage.cacheWriteTokens;
      r.cacheRead += completion.usage.cacheReadTokens;
      byRoute.set(route, r);
    },
  });
  const started = Date.now();
  let line: string;
  try {
    const { outcome, plans } = await runEvalCase(c, provider, registry, now);
    dumped[c.id] = { pass: outcome.pass, plans, routes };
    const repairs = calls - plans.length;
    const repaired = repairs > 0 ? `，修复 ${repairs} 次` : '';
    if (outcome.pass) {
      passed++;
      line = `✅ ${c.id}${batch ? '' : `  ${Date.now() - started}ms`}${repaired}`;
    } else {
      line = `❌ ${c.id}  ${outcome.reason}${repaired}`;
      if (values.verbose) line += plans.map((p) => `\n   ${JSON.stringify(p)}`).join('');
      failures.push(`${c.id}（${c.input}）：${outcome.reason}`);
    }
    for (const plan of plans) {
      if (plan.kind !== 'ops') continue;
      if (plan.notes?.length) line += `\n   notes: ${plan.notes.join(' / ')}`;
      if (plan.next) line += `\n   next: ${plan.next}`;
    }
  } catch (e) {
    line = `💥 ${c.id}  ${String(e)}`;
    failures.push(`${c.id}（${c.input}）：${String(e)}`);
  }
  return line;
}

if (batch) {
  for (const line of await Promise.all(cases.map(runCase))) console.log(line);
} else {
  for (const c of cases) console.log(await runCase(c));
}

const total = completions.reduce(
  (sum, c) => ({
    input: sum.input + c.usage.inputTokens + c.usage.cacheWriteTokens,
    output: sum.output + c.usage.outputTokens,
    cacheRead: sum.cacheRead + c.usage.cacheReadTokens,
  }),
  { input: 0, output: 0, cacheRead: 0 },
);
const price = MODELS.find((m) => m.id === runtime.model)?.price;
// 批处理半价。
const cost = price
  ? ((total.input * price.input + total.output * price.output + total.cacheRead * price.cacheRead) /
      1_000_000) *
    (batch ? 0.5 : 1)
  : null;

console.log(`\n通过：${passed}/${cases.length}`);
console.log(
  `请求 ${completions.length} 次；输入 ${total.input} token（另有缓存读取 ${total.cacheRead}），输出 ${total.output} token` +
    `（单次最多 ${Math.max(0, ...completions.map((c) => c.usage.outputTokens))}）` +
    (cost !== null ? `；估算费用 $${cost.toFixed(3)}` : ''),
);
const served = new Set(completions.map((c) => c.model));
if (served.size > 1 || (served.size === 1 && runtime.model && !served.has(runtime.model))) {
  console.log(`实际响应模型：${[...served].join(', ')}（可能触发了拒答回退）`);
}
for (const [route, r] of [...byRoute].sort()) {
  console.log(
    `路由 ${route}：请求 ${r.calls} 次，平均输入 ${Math.round(r.input / r.calls)} token + 缓存读取 ${Math.round(r.cacheRead / r.calls)}`,
  );
}
if (values.dump) writeFileSync(values.dump, JSON.stringify(dumped, null, 1));
if (failures.length > 0) console.log(`\n失败详情：\n${failures.map((f) => `- ${f}`).join('\n')}`);
