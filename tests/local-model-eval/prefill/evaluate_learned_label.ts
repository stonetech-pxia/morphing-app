// 纯规则实验：用户第一次保存后，只在值的原文位置唯一、标签也唯一时学习“字段 → 原文标签”。
// 下一张只按学到的标签找值；不存在、重复或日期顺序不明时留空。不调用模型，不改 App 实现。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  learnLayout,
  prefillRecord,
  ruleCandidates,
  type ValueCandidate,
} from '../../../packages/core/src/prefill';
import { labelOf } from '../../../packages/core/src/prefill/pick';
import type { Field, Locale } from '../../../packages/core/src/schema';

type NumericField = Field & { type: 'money' | 'date' };
type Truth = Record<string, string | number | null>;
interface Document {
  text: string;
  truth: Truth;
}
interface Pair {
  id: string;
  dataset: string;
  lang: Locale;
  fields: NumericField[];
  train: Document;
  test: Document;
}
interface LearnedLabel {
  kind: 'amount' | 'date';
  label: string;
  dateOrder?: 'DMY' | 'MDY';
}
type LearnReason =
  'learned' | 'noSavedValue' | 'candidateMissing' | 'duplicateValue' | 'noLabel' | 'duplicateLabel';
type ReadReason = 'filled' | 'noMemory' | 'labelMissing' | 'duplicateLabel' | 'ambiguousDate';
type Outcome = 'correct' | 'wrong' | 'empty' | 'emptyOk' | 'filledNull';

const dataDir = import.meta.dirname;
const readJsonl = (path: string): unknown[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const kindOf = (field: NumericField) => (field.type === 'date' ? 'date' : 'amount');
const spot = (c: ValueCandidate) => `${c.line}:${c.start}:${c.end}`;
const same = (field: NumericField, a: unknown, b: unknown) =>
  field.type === 'money' ? Math.abs(Number(a) - Number(b)) < 0.005 : a === b;

// 只统一拼写差异：OCR 空格、大小写、法语重音和标点；不内置任何业务词或同义词。
function labelKey(text: string): string {
  return [...text.normalize('NFKD').toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('');
}

function labelAt(text: string, c: ValueCandidate, candidates: readonly ValueCandidate[]): string {
  const lines = text.split('\n');
  const label = labelOf(lines, c, candidates);
  // 连续的纯数值行常是两栏表格的“值列”。上一行恰好是最后一个标签，
  // 不代表第一个值属于这个标签；没有版面列信息时整段留空。
  const valueOnly = (candidate: ValueCandidate): boolean => {
    const line = lines[candidate.line] ?? '';
    const rest = line.slice(0, candidate.start) + line.slice(candidate.end);
    return rest.replace(/[\p{Sc}\p{P}\p{Z}\s元]/gu, '').length === 0;
  };
  if (
    label.offset === 1 &&
    valueOnly(c) &&
    candidates.some((next) => next.kind === c.kind && next.line === c.line + 1 && valueOnly(next))
  )
    return '';
  return labelKey(label.text);
}

function learn(
  doc: Document,
  locale: Locale,
  field: NumericField,
): { habit: LearnedLabel | null; reason: LearnReason } {
  const saved = doc.truth[field.id];
  if (saved === null || saved === undefined || saved === '')
    return { habit: null, reason: 'noSavedValue' };
  const candidates = ruleCandidates(doc.text, locale);
  const kind = kindOf(field);
  const hits = candidates.filter((c) => c.kind === kind && same(field, saved, c.value));
  if (hits.length === 0) return { habit: null, reason: 'candidateMissing' };
  const positions = new Set(hits.map(spot));
  if (positions.size !== 1) return { habit: null, reason: 'duplicateValue' };
  const source = hits[0]!;
  const label = labelAt(doc.text, source, candidates);
  if (label.length < 2) return { habit: null, reason: 'noLabel' };
  const labelledPositions = new Set(
    candidates
      .filter((c) => c.kind === kind && labelAt(doc.text, c, candidates) === label)
      .map(spot),
  );
  if (labelledPositions.size !== 1) return { habit: null, reason: 'duplicateLabel' };
  return {
    habit: { kind, label, ...(source.dateOrder ? { dateOrder: source.dateOrder } : {}) },
    reason: 'learned',
  };
}

function readNext(
  text: string,
  locale: Locale,
  habit: LearnedLabel | null,
): { value: string | null; reason: ReadReason } {
  if (!habit) return { value: null, reason: 'noMemory' };
  const candidates = ruleCandidates(text, locale);
  const matches = candidates.filter(
    (c) => c.kind === habit.kind && labelAt(text, c, candidates) === habit.label,
  );
  if (matches.length === 0) return { value: null, reason: 'labelMissing' };
  const positions = new Set(matches.map(spot));
  if (positions.size !== 1) return { value: null, reason: 'duplicateLabel' };
  const valid = habit.dateOrder
    ? matches.filter((c) => !c.dateOrder || c.dateOrder === habit.dateOrder)
    : matches;
  if (new Set(valid.map((c) => c.value)).size !== 1)
    return { value: null, reason: 'ambiguousDate' };
  return { value: valid[0]!.value, reason: 'filled' };
}

function score(field: NumericField, truth: unknown, value: unknown): Outcome {
  if (truth === null || truth === undefined)
    return value === null || value === undefined ? 'emptyOk' : 'filledNull';
  if (value === null || value === undefined) return 'empty';
  return same(field, truth, value) ? 'correct' : 'wrong';
}

function heldoutPairs(dataset: string): Pair[] {
  const items = readJsonl(join(dataDir, `${dataset}.jsonl`)) as {
    id: string;
    lang: Locale;
    fields: Field[];
    train: Document;
    test: Document;
  }[];
  return items.map((item) => ({
    id: item.id,
    dataset,
    lang: item.lang,
    fields: item.fields.filter(
      (field) => field.type === 'date' || field.type === 'money',
    ) as NumericField[],
    train: item.train,
    test: item.test,
  }));
}

function sequencePairs(dataset: 'pairs' | 'pairs2'): Pair[] {
  const items = readJsonl(join(dataDir, dataset, 'cases.jsonl')) as {
    id: string;
    layout: string;
    seq: number;
    lang: Locale;
    text: string;
    truth: Truth;
  }[];
  const layouts = new Map<string, typeof items>();
  for (const item of items) layouts.set(item.layout, [...(layouts.get(item.layout) ?? []), item]);
  const pairs: Pair[] = [];
  for (const docs of layouts.values()) {
    docs.sort((a, b) => a.seq - b.seq);
    const first = docs[0]!;
    const fields: NumericField[] = [
      { id: 'amount', name: 'Amount', type: 'money', currency: 'EUR' },
      { id: 'date', name: 'Date', type: 'date' },
    ];
    for (const later of docs.slice(1))
      pairs.push({
        id: later.id,
        dataset,
        lang: later.lang,
        fields,
        train: { text: first.text, truth: first.truth },
        test: { text: later.text, truth: later.truth },
      });
  }
  return pairs;
}

const datasets = [
  'pairs',
  'pairs2',
  'heldout_pairs',
  'heldout_absence_pairs',
  'heldout_evidence_pairs',
  'source_label_pairs',
  'stacked_label_cases',
];
const selected = process.argv.includes('--dataset')
  ? [process.argv[process.argv.indexOf('--dataset') + 1]!]
  : datasets;
const allPairs = selected.flatMap((dataset) =>
  dataset === 'pairs' || dataset === 'pairs2' ? sequencePairs(dataset) : heldoutPairs(dataset),
);
const details: object[] = [];
const totals = new Map<string, Record<Outcome, number>>();
const learnCounts = new Map<string, number>();
const readCounts = new Map<string, number>();

for (const pair of allPairs) {
  const first = prefillRecord({ text: pair.train.text, locale: pair.lang, fields: pair.fields });
  const memory = learnLayout(
    first.layout,
    {
      text: pair.train.text,
      fields: pair.fields,
      saved: pair.train.truth,
      prefilled: first.values,
      candidates: first.candidates,
    },
    pair.id,
  );
  const rules = prefillRecord({ text: pair.test.text, locale: pair.lang, fields: pair.fields });
  const current = prefillRecord({
    text: pair.test.text,
    locale: pair.lang,
    fields: pair.fields,
    memories: memory ? [memory] : [],
  });
  for (const field of pair.fields) {
    const learned = learn(pair.train, pair.lang, field);
    const next = readNext(pair.test.text, pair.lang, learned.habit);
    learnCounts.set(learned.reason, (learnCounts.get(learned.reason) ?? 0) + 1);
    readCounts.set(next.reason, (readCounts.get(next.reason) ?? 0) + 1);
    const truth = pair.test.truth[field.id];
    for (const [method, value] of [
      ['learnedLabel', next.value],
      ['rules', rules.values[field.id]?.value],
      ['currentMemory', current.values[field.id]?.value],
    ] as const) {
      const outcome = score(field, truth, value);
      const key = `${pair.dataset}/${method}`;
      const counts = totals.get(key) ?? {
        correct: 0,
        wrong: 0,
        empty: 0,
        emptyOk: 0,
        filledNull: 0,
      };
      counts[outcome]++;
      totals.set(key, counts);
      details.push({
        dataset: pair.dataset,
        id: pair.id,
        lang: pair.lang,
        field: field.id,
        type: field.type,
        method,
        truth,
        value: value ?? null,
        outcome,
        ...(method === 'learnedLabel'
          ? {
              learnReason: learned.reason,
              label: learned.habit?.label ?? null,
              readReason: next.reason,
            }
          : {}),
      });
    }
  }
}

const resultPath = join(dataDir, '../results/learned_label_eval.json');
mkdirSync(join(dataDir, '../results'), { recursive: true });
writeFileSync(resultPath, JSON.stringify(details, null, 2));
console.log(`pairs=${allPairs.length} fields=${details.length / 3}`);
for (const [key, counts] of totals) console.log(key, counts);
console.log('learning', Object.fromEntries(learnCounts));
console.log('reading', Object.fromEntries(readCounts));
console.log(`details=${resultPath}`);

if (process.argv.includes('--assert-stacked')) {
  const outcomes = details.filter(
    (item): item is { id: string; method: string; outcome: Outcome } =>
      typeof item === 'object' && item !== null && 'id' in item && 'method' in item,
  );
  for (const [id, expected] of [
    ['stack-zh', 'empty'],
    ['stack-en', 'empty'],
    ['stack-control', 'correct'],
  ]) {
    const actual = outcomes.find((item) => item.id === id && item.method === 'learnedLabel');
    if (actual?.outcome !== expected)
      throw new Error(`${id}: expected ${expected}, got ${actual?.outcome}`);
  }
}
