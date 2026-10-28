import type { Field, FieldType } from '../schema';
import { splitLines, type ValueCandidate } from './candidates';
import { amountTier, labelOf, normalizeLabel } from './pick';

// 版式记忆（D-244 的扩展，原型，没接界面）：从用户「记下」时最终保存的值学（不是从预填的值学），
// 记住「这个字段的值跟在哪个标签后面、大约在第几行、什么写法」，金额和日期不记值本身；
// 商家这类每次都一样的文字字段记值，新文件的文字里出现同样的值才填。
// 值在文字里找不到出处、或者出现几次分不清是哪个时不学；同一个字段两次一致才算学会；
// 用户改了记忆填的值就降级。按字段 ID 存，字段删了或者类型变了就丢掉。
// 认版式主要看标签文字（几次都出现的那些行），行框的位置只在同一个标签下有几个值时用来挑。
// 只存在本机（存不存、能不能清空、进不进备份见报告的待决定）。

/** 一行在图片上的位置（recognizeText 的行框，像素，原点在左上角）。没有时按行号算位置。 */
export interface LineBox {
  y: number;
  height: number;
}

export interface ValueHabit {
  kind: 'amount' | 'date';
  /** 统一后的标签文字。 */
  label: string;
  /** 0：标签和值在同一行；1：标签在上一行。 */
  offset: 0 | 1;
  /** 0–1，大约在页面的哪个高度（行号 / 行数，或者行框的 y / 页高）。 */
  position: number;
  /** 写法：金额是小数点（dot / comma / none），日期是数字换成 9 以后的样子（9/9/9、9年9月9日）。 */
  format: string;
  /** 连续几次一致；2 次起才用。 */
  hits: number;
}

export interface ConstantHabit {
  kind: 'constant';
  value: string;
  hits: number;
}

export type FieldHabit = ValueHabit | ConstantHabit;

export interface LayoutMemory {
  id: string;
  /** 每次都出现的标签行（统一后的文字）。 */
  anchors: string[];
  fieldTypes: Record<string, FieldType>;
  fields: Record<string, FieldHabit>;
}

/** 学会了的才用。 */
export const LEARNED_HITS = 2;
const MAX_ANCHORS = 40;
/** 记忆里的标签行至少要在新文件里出现这么多，才算同一个版式。 */
export const MIN_LAYOUT_MATCH = 0.6;
/** 至少要有这么多个标签行才认版式（太少的什么都像）。 */
const MIN_ANCHORS = 3;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * 这份文字里的标签行：有字的行统一写法后去重。带着没有标签的金额的行（商品行，每次不同）不算；
 * 「合计 98.75」这类有标签的金额行去掉数字后算（「合计」）。
 */
export function layoutAnchors(text: string, candidates: readonly ValueCandidate[]): string[] {
  const lines = splitLines(text);
  const out = new Set<string>();
  lines.forEach((line, i) => {
    if (out.size >= MAX_ANCHORS) return;
    const items = candidates.filter((c) => c.line === i && c.kind === 'amount');
    if (items.some((c) => amountTier(labelOf(lines, c, candidates).text, false) === 0)) return;
    const label = normalizeLabel(line);
    if (label.length >= 3 || /[\u4e00-\u9fff]{2}/.test(label)) out.add(label);
  });
  return [...out];
}

/** 记忆里的标签行有多少出现在这份文字里（行被拍歪连在一起也算，所以按包含比）。 */
export function layoutScore(memory: LayoutMemory, text: string): number {
  if (memory.anchors.length < MIN_ANCHORS) return 0;
  const page = ` ${normalizeLabel(text)} `;
  const found = memory.anchors.filter((a) => page.includes(` ${a} `) || page.includes(a)).length;
  return found / memory.anchors.length;
}

/** 最像的那个版式；都不够像时为 null。 */
export function findLayout(memories: readonly LayoutMemory[], text: string): LayoutMemory | null {
  let best: LayoutMemory | null = null;
  let bestScore = MIN_LAYOUT_MATCH;
  for (const m of memories) {
    const score = layoutScore(m, text);
    if (score >= bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

/** 表结构改了：字段没了或者类型变了的记忆丢掉。 */
export function reconcileLayout(memory: LayoutMemory, fields: readonly Field[]): LayoutMemory {
  const types = new Map(fields.map((f) => [f.id, f.type]));
  const kept = Object.entries(memory.fields).filter(
    ([id]) => types.get(id) === memory.fieldTypes[id],
  );
  return {
    ...memory,
    fieldTypes: Object.fromEntries(kept.map(([id]) => [id, memory.fieldTypes[id]!])),
    fields: Object.fromEntries(kept),
  };
}

function formatOf(c: ValueCandidate): string {
  if (c.kind === 'date') return c.raw.replace(/\d+/g, '9').replace(/\s+/g, '');
  return /,\d{2}\b/.test(c.raw) ? 'comma' : /\.\d{2}\b/.test(c.raw) ? 'dot' : 'none';
}

function positionOf(
  c: ValueCandidate,
  lineCount: number,
  boxes?: readonly (LineBox | null)[],
): number {
  const box = boxes?.[c.line];
  const page = boxes?.reduce((h, b) => (b ? Math.max(h, b.y + b.height) : h), 0) ?? 0;
  if (box && page > 0) return (box.y + box.height / 2) / page;
  return lineCount > 1 ? c.line / (lineCount - 1) : 0;
}

function sameHabit(a: FieldHabit, b: FieldHabit): boolean {
  if (a.kind === 'constant' || b.kind === 'constant')
    return a.kind === 'constant' && b.kind === 'constant' && a.value === b.value;
  return a.kind === b.kind && a.label === b.label && a.offset === b.offset && a.format === b.format;
}

const sameNumber = (a: unknown, b: string) => Math.abs(Number(a) - Number(b)) < 0.005;

/** 保存的值在文字里的出处：只有一个，或者几个里只有一个的标签说得清（金额看「实付 / 合计」这一级）。 */
function sourceOf(
  kind: 'amount' | 'date',
  saved: unknown,
  lines: readonly string[],
  candidates: readonly ValueCandidate[],
): ValueCandidate | null {
  const hits = candidates.filter(
    (c) => c.kind === kind && (kind === 'amount' ? sameNumber(saved, c.value) : saved === c.value),
  );
  if (hits.length <= 1) return hits[0] ?? null;
  // 出现几次：日期分不清；金额只有一处的标签是「实付 / 合计」这一级时才认它。
  if (kind === 'date') return null;
  const labels = hits.map((c) => labelOf(lines, c, candidates));
  const changeOnPage = lines.some((l) => /找零|找赎|\bchange\b|rendu|monnaie/i.test(l));
  const tiers = labels.map((l) => amountTier(l.text, changeOnPage));
  const top = Math.max(...tiers);
  const best = hits.filter((_, i) => tiers[i] === top);
  return top >= 2 && best.length === 1 ? best[0]! : null;
}

export interface LearnInput {
  text: string;
  /** 这张表的字段（只学金额、日期和文字字段）。 */
  fields: readonly Field[];
  /** 用户最终保存的值（字段 ID → 值）。 */
  saved: Readonly<Record<string, unknown>>;
  /** 这次预填的值和来源；记忆填的被用户改了就降级。 */
  prefilled?: Readonly<Record<string, { value: unknown; source: string }>>;
  candidates: readonly ValueCandidate[];
  boxes?: readonly (LineBox | null)[];
}

/**
 * 记一次保存。memory 是 findLayout 找到的版式（没有时传 null，开一个新的）；
 * 一个字段都学不到、或者标签行太少认不出版式时返回 null（不存）。
 */
export function learnLayout(
  memory: LayoutMemory | null,
  input: LearnInput,
  id: string,
): LayoutMemory | null {
  const lines = splitLines(input.text);
  const anchors = layoutAnchors(input.text, input.candidates);
  const kept = memory ? reconcileLayout(memory, input.fields) : null;
  const fields: Record<string, FieldHabit> = { ...(kept?.fields ?? {}) };
  const fieldTypes: Record<string, FieldType> = { ...(kept?.fieldTypes ?? {}) };
  for (const field of input.fields) {
    const saved = input.saved[field.id];
    const before = fields[field.id];
    const filled = input.prefilled?.[field.id];
    const corrected =
      filled?.source === 'memory' &&
      (field.type === 'money' ? !sameNumber(saved, String(filled.value)) : filled.value !== saved);
    let seen: FieldHabit | null = null;
    if (field.type === 'money' || field.type === 'date') {
      const kind = field.type === 'money' ? 'amount' : 'date';
      const source =
        saved === null || saved === undefined || saved === ''
          ? null
          : sourceOf(kind, saved, lines, input.candidates);
      if (source) {
        const label = labelOf(lines, source, input.candidates);
        seen = {
          kind,
          label: label.text,
          offset: label.offset,
          position: positionOf(source, lines.length, input.boxes),
          format: formatOf(source),
          hits: 1,
        };
      }
    } else if (field.type === 'text' && typeof saved === 'string' && saved.trim()) {
      if (squash(input.text).includes(squash(saved)))
        seen = { kind: 'constant', value: saved.trim(), hits: 1 };
    }
    if (corrected) {
      // 用户改了记忆填的值：降级，从这次看到的重新开始（看不到出处就先不用）。
      if (seen) fields[field.id] = seen;
      else if (before) fields[field.id] = { ...before, hits: 0 };
    } else if (seen && before && sameHabit(before, seen)) {
      fields[field.id] = { ...seen, hits: Math.min(before.hits + 1, 9) };
    } else if (seen) {
      fields[field.id] = seen;
    }
    if (fields[field.id]) fieldTypes[field.id] = field.type;
  }
  // 版式的标签行：第一次是全部，以后只留每次都出现的（商品名这类每次不同的行会被去掉）。
  const page = ` ${normalizeLabel(input.text)} `;
  const nextAnchors = kept ? kept.anchors.filter((a) => page.includes(a)) : anchors;
  if (Object.keys(fields).length === 0 || nextAnchors.length < MIN_ANCHORS) return null;
  return { id: kept?.id ?? id, anchors: nextAnchors, fieldTypes, fields };
}

/** 按学会的版式读一个字段；读不出或者分不清时为 null（交给标签规则或者空着）。 */
export function readWithLayout(
  habit: FieldHabit,
  text: string,
  candidates: readonly ValueCandidate[],
  boxes?: readonly (LineBox | null)[],
): string | null {
  if (habit.hits < LEARNED_HITS) return null;
  if (habit.kind === 'constant')
    return squash(text).includes(squash(habit.value)) ? habit.value : null;
  const lines = splitLines(text);
  const matches = candidates
    .filter((c) => c.kind === habit.kind && formatOf(c) === habit.format)
    .filter((c) => {
      const label = labelOf(lines, c, candidates);
      return label.offset === habit.offset && label.text === habit.label;
    })
    .map((c) => ({ c, distance: Math.abs(positionOf(c, lines.length, boxes) - habit.position) }));
  if (new Set(matches.map(({ c }) => c.value)).size <= 1) return matches[0]?.c.value ?? null;
  // 同一个标签下几个不同的值：取位置最近的；最近的两个差不多远就空着。
  matches.sort((a, b) => a.distance - b.distance);
  return matches[1]!.distance - matches[0]!.distance > 0.1 ? matches[0]!.c.value : null;
}
