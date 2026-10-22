import { parseArgs } from 'node:util';

import { EVAL_CASES, buildSetup, judgeEval, prepareOps } from '@morph/core';

import { MODELS, type Completion } from '@morph/planner';

import { createAIRuntime, loadRootEnv, type Transport } from '../src/config';

// 用评测集（packages/core/src/ai/eval-cases.ts）衡量真实模型。会产生 API 费用。
// 用法：npm run eval -- --model claude-haiku-5-5 [--cases A1,C1] [--effort low] [--transport http]
//   --transport http：使用 App 内“自带 key”模式的 HTTP 传输层（默认 sdk，即服务端）。
//   --verbose：失败时打印模型给出的计划。

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

const completions: Completion[] = [];
const transport: Transport = values.transport === 'http' ? 'http' : 'sdk';
const runtime = createAIRuntime(env, (c) => completions.push(c), transport);
if (runtime.providerName !== 'claude') {
  console.error('未配置 ANTHROPIC_API_KEY，无法评测真实模型。见 docs/API_KEY_SETUP.md。');
  process.exit(1);
}

const selected = values.cases ? new Set(values.cases.split(',')) : null;
const cases = EVAL_CASES.filter((c) => !selected || selected.has(c.id));
const now = new Date();
let passed = 0;
const failures: string[] = [];

console.log(
  `模型：${runtime.model}${env.MORPH_AI_EFFORT ? `（effort ${env.MORPH_AI_EFFORT}）` : ''}，传输：${transport}，用例数：${cases.length}\n`,
);

for (const c of cases) {
  const config = buildSetup(c.setup, c.locale, runtime.registry);
  const before = completions.length;
  const started = Date.now();
  let line: string;
  try {
    const plan = await runtime.provider.plan(c.input, {
      config,
      registry: runtime.registry,
      locale: c.locale,
    });
    const prepared =
      plan.kind === 'ops'
        ? prepareOps(config, plan.ops, { registry: runtime.registry, locale: c.locale, now })
        : null;
    const outcome = judgeEval(c, plan, prepared);
    const calls = completions.length - before;
    const repaired = calls > 1 ? `，修复 ${calls - 1} 次` : '';
    if (outcome.pass) {
      passed++;
      line = `✅ ${c.id}  ${Date.now() - started}ms${repaired}`;
    } else {
      line = `❌ ${c.id}  ${outcome.reason}${repaired}`;
      if (values.verbose) line += `\n   ${JSON.stringify(plan)}`;
      failures.push(`${c.id}（${c.input}）：${outcome.reason}`);
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
    (cost !== null ? `；估算费用 $${cost.toFixed(3)}` : ''),
);
const served = new Set(completions.map((c) => c.model));
if (served.size > 1 || (served.size === 1 && runtime.model && !served.has(runtime.model))) {
  console.log(`实际响应模型：${[...served].join(', ')}（可能触发了拒答回退）`);
}
if (failures.length > 0) console.log(`\n失败详情：\n${failures.map((f) => `- ${f}`).join('\n')}`);
