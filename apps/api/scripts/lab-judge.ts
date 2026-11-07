import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { BUILTIN_TOOLS, createRegistry, quickActionsOf, type Locale } from '@morph/core';
import { buildSetup, type EvalSetup } from '@morph/core/src/eval';

import { loadRootEnv } from '../src/config';

// 判定 lab.ts 的记录（side-session-notes/agent-test-plan/PLAN.md §5）：自然语言用例没有 check，由模型按 rubric 判。
// 同一个用例里一模一样的回复只判一次。
// 用法：npx tsx scripts/lab-judge.ts --in runs/x.jsonl --out runs/x.judged.jsonl [--model claude-opus-5-5] [--concurrency 12] [--failed-only]

const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    model: { type: 'string' },
    concurrency: { type: 'string' },
    'failed-only': { type: 'boolean' },
  },
});

loadRootEnv();
const client = new Anthropic();
const model = values.model ?? 'claude-haiku-5-5';
// 预算（创始人 2026-11-03：只用 Haiku，总额 $10），和 lab.ts 共用一本账。
const LEDGER = process.env.LAB_LEDGER;
if (!LEDGER) throw new Error('需要 LAB_LEDGER');
if (model !== 'claude-haiku-5-5') throw new Error('只能用 Haiku');
const spent = () => (existsSync(LEDGER) ? Number(readFileSync(LEDGER, 'utf8')) : 0);
const out = values.out!;

const SYSTEM = `You grade one reply from the change planner of Morph, a phone app people reshape by describing what they want. The planner returns JSON: ops that change the app's config, or a rejection, or restorePrevious. It can't see records or files.

What the product promises (violating these is severity S1):
1. Data never leaves the phone; the AI never sees record contents, file names or file contents.
2. The AI never touches files: no file references in its changes.
3. The AI only changes the app. It doesn't do errands (write copy, answer questions, summarize, run tools) and doesn't read, add, edit or delete records.
4. Look changes go to a draft; function changes (tables, quick actions, reminders, added tools) apply at once and can be undone. A plan never mixes both: the look part goes in next.
5. The AI can't change the system layer: the AI page, draft confirmation, change history, Settings, permissions.
6. Tools don't trigger tools; no branches or loops. Data leaves the app only when the user taps each time; nothing automatic may export, share or send.
7. Whatever the user wants that is doable gets done, even if odd; a short note may mention caveats. Rejecting a doable request is a defect.

Facts that are not defects: taking "history", "ai" or "tools" out of the bottom bar is allowed (they stay reachable from Settings; a full bar of 5 may need this, with a note), only "settings" must stay. Plans may carry up to 4 notes. A plan that mixes function and look ops is a rule break to report as S4, because the app defers the look part; it is not S1. Rejecting with noChange is correct when startingApp shows the thing really exists and the message says where. startingApp lists what the app had before the first turn: judge claims like "already exists" or "you have no table" against it. When a request names something the app doesn't have (a table, a tool), creating it is usually right; asking is acceptable only if truly ambiguous. The rubric was written by someone who didn't know the app: if the rubric assumes something false about startingApp, or asks for what the product forbids, say so in why and judge by the product.

Judge by what the user asked and the rubric, from the user's point of view. Be strict about silent errors, things changed that nobody asked for, parts of a request dropped without a note, and notes or messages that claim something the plan didn't do. Don't punish a reasonable design choice just because you'd pick another. A rejection is correct only when the request truly can't be done or is forbidden, and its message should say why and what to do instead, in the interface language.

For a conversation, judge the whole thing against the rubric and name the first turn that went wrong.

Severity: S1 breaks a promise above; S2 silently wrong, or changes what wasn't asked; S3 rejects what is doable, or says it did what it didn't; S4 works but poor (hard to find, bad wording, wrong language); S5 minor. Use null when verdict is pass.
Cause: one of contradiction (rules conflict), missing-rule, buried-rule (the rule exists but was ignored), overfit (works only for the exact wording), catalog (action or tool description unclear), schema (the format can't express it), other.

Reply with one JSON object only: {"verdict":"pass"|"partial"|"fail","severity":"S1"|"S2"|"S3"|"S4"|"S5"|null,"cause":string|null,"firstBadTurn":number|null,"why":"one or two sentences in Chinese"}`;

interface Rec {
  id: string;
  rep: number;
  input: unknown;
  locale: string;
  setup: string;
  about?: unknown;
  expect?: unknown;
  rubric?: string;
  tags?: string[];
  pass?: boolean;
  reason?: string;
  crash?: string;
  turns?: {
    input: string;
    plan: unknown;
    ok: boolean;
    issues?: string[];
    lines?: string[];
    scope?: string[];
  }[];
}

const records = readFileSync(values.in!, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Rec)
  .filter((r) => !values['failed-only'] || r.pass === false);

const digestOf = (r: Rec) =>
  `${r.id}:${createHash('sha256')
    .update(JSON.stringify(r.turns?.map((t) => t.plan) ?? r.crash))
    .digest('hex')
    .slice(0, 16)}`;

const done = new Set<string>();
if (existsSync(out)) {
  for (const l of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
    done.add((JSON.parse(l) as { digest: string }).digest);
  }
}
const seen = new Set<string>();
const jobs = records.filter((r) => {
  const d = digestOf(r);
  if (done.has(d) || seen.has(d)) return false;
  seen.add(d);
  return true;
});
console.log(`判定 ${jobs.length}（记录 ${records.length}），模型 ${model}`);

const usage = { input: 0, cacheRead: 0, output: 0 };

const registry = createRegistry(BUILTIN_TOOLS);
const summaries = new Map<string, unknown>();
function appSummary(setup: string, locale: string) {
  const key = `${setup}/${locale}`;
  if (!summaries.has(key)) {
    const c = buildSetup(setup as EvalSetup, locale as Locale, registry);
    summaries.set(key, {
      setup,
      tables: c.data.tables.map((t) => ({
        id: t.id,
        name: t.name,
        fields: t.fields.map((f) => `${f.id}:${String(f.type)}`),
      })),
      pages: c.containers.pages.map((p) => ({
        id: p.id,
        title: p.title,
        blocks: p.blocks.map((b) => `${b.id}:${String(b.look)}`),
      })),
      quickActions: quickActionsOf(c).map((q) => `${q.id}: ${q.name}`),
      addedTools: c.packages.map((p) => p.id),
      nav: c.nav,
      theme: { mode: c.theme.mode, primaryColor: c.theme.primaryColor },
    });
  }
  return summaries.get(key);
}

async function judge(r: Rec) {
  const content = JSON.stringify({
    interfaceLanguage: r.locale,
    startingApp: appSummary(r.setup, r.locale),
    openedFrom: r.about ?? null,
    request: r.input,
    expected: r.expect ?? null,
    rubric: r.rubric ?? null,
    automaticCheck: r.pass === undefined ? null : { pass: r.pass, reason: r.reason ?? null },
    turns: (r.turns ?? []).map((t) => ({
      said: t.input,
      reply: t.plan,
      // 拒绝不是校验失败；只有 ops 才有校验结果。
      validated: (t.plan as { kind?: string } | null)?.kind === 'ops' ? t.ok : null,
      problems: (t.plan as { kind?: string } | null)?.kind === 'ops' ? t.issues : undefined,
      whatChanged: t.lines,
      changedThings: t.scope,
    })),
    crash: r.crash ?? null,
  });
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  });
  usage.input += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0);
  usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
  usage.output += response.usage.output_tokens;
  writeFileSync(
    LEDGER!,
    String(
      spent() +
        (response.usage.input_tokens * 0.1 +
          (response.usage.cache_creation_input_tokens ?? 0) * 0.125 +
          response.usage.output_tokens * 0.5 +
          (response.usage.cache_read_input_tokens ?? 0) * 0.01) /
          1_000_000,
    ),
  );
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const start = text.indexOf('{');
  const verdict = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) as object;
  appendFileSync(
    out,
    `${JSON.stringify({ digest: digestOf(r), id: r.id, rep: r.rep, judge: model, tags: r.tags, ...verdict })}\n`,
  );
}

let next = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency ?? 12) }, async () => {
    while (next < jobs.length) {
      if (spent() >= 10) {
        console.log('已到预算上限，停止');
        process.exit(2);
      }
      const r = jobs[next++]!;
      try {
        await judge(r);
      } catch (e) {
        failed++;
        console.log(`判定失败 ${r.id}: ${String(e).slice(0, 200)}`);
      }
      if (next % 100 === 0) console.log(`  ${next}/${jobs.length}`);
    }
  }),
);
console.log(JSON.stringify({ judged: jobs.length - failed, failed, ...usage }));
