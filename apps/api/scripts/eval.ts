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
// 用法：npm run eval -- --model claude-haiku-5-5 [--cases A1,C1] [--effort low] [--transport http]
//   默认（relay）：和「Morph 服务器」模式完全一样——App 的转发传输层 → 本进程里的 /v1/complete → Claude（D-193）。
//   --transport http：App 内「自带 key」模式的 HTTP 传输层，直接调用 Claude。
//   --verbose：失败时打印模型给出的计划。计划里的 notes（D-110）总是打印。

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    cases: { type: 'string' },
    effort: { type: 'string' },
    transport: { type: 'string' },
    verbose: { type: 'boolean' },
  },
});

loadRootEnv();
const env = { ...process.env };
if (values.model) env.MORPH_AI_MODEL = values.model;
if (values.effort) env.MORPH_AI_EFFORT = values.effort;

const runtime = createRelayRuntime(env);
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
        timeoutMs: 120_000,
        fetchImpl: ((url: string, init?: RequestInit) => server.request(url, init)) as typeof fetch,
      });
const provider = createClaudePlanner({
  complete,
  registry,
  now: () => new Date(),
  onCompletion: (c) => completions.push(c),
});

const selected = values.cases ? new Set(values.cases.split(',')) : null;
const cases = EVAL_CASES.filter((c) => !selected || selected.has(c.id));
const now = new Date();
let passed = 0;
const failures: string[] = [];

console.log(
  `模型：${runtime.model}${env.MORPH_AI_EFFORT ? `（effort ${env.MORPH_AI_EFFORT}）` : ''}，传输：${transport}，用例数：${cases.length}\n`,
);

for (const c of cases) {
  const before = completions.length;
  const started = Date.now();
  let line: string;
  try {
    const { outcome, plans } = await runEvalCase(c, provider, registry, now);
    const calls = completions.length - before - (plans.length - 1);
    const repaired = calls > 1 ? `，修复 ${calls - 1} 次` : '';
    if (outcome.pass) {
      passed++;
      line = `✅ ${c.id}  ${Date.now() - started}ms${repaired}`;
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
  console.log(line);
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
const cost = price
  ? (total.input * price.input + total.output * price.output + total.cacheRead * price.cacheRead) /
    1_000_000
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
if (failures.length > 0) console.log(`\n失败详情：\n${failures.map((f) => `- ${f}`).join('\n')}`);
