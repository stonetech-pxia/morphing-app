import type { Field, Locale } from '../schema';
import { CONCEPTS, fieldTerms, type ConceptId, type ValueKind } from './concepts';
import { looksTyped, pageOccurrences, type Occurrence, type TextPage } from './rows';
import { charSim, labelScore, norm, ratio } from './similarity';

// 新记录表单的候选值（D-388）：每个空字段最多给 3 个候选，用户点了才填，从不自动填
// （创始人 2026-10-31：「宁可不填，不能乱填」，两次测量都找不到 0 错的门槛）。
// 打分照搬测量的变体 A（side-session-notes/prefill-ranking/scripts/score.py）：
//   3·标签 + 3·记忆 + 1·唯一 + 1·合理 + 1·位置，每项 0..1。
// 不用大模型、不用向量模型，全部在本机；识别出的文字、文件名和记录都不发给 AI。

/** 用户点过的候选：这张表这个字段上次点的是哪个标签后面、页面上多高的值（不记值）。 */
export interface FieldPick {
  label: string;
  relY: number;
  /** 日月分不清的日期，用户点的是哪种读法。 */
  order?: 'DMY' | 'MDY';
}

export interface ValueSuggestion {
  /** 表单里的写法：金额、数字是文字，日期 YYYY-MM-DD，单选是选项 ID。 */
  value: string;
  score: number;
  /** 点了以后记下来的（FieldPick）。 */
  pick: FieldPick;
}

export interface SuggestInput {
  fields: readonly Field[];
  pages: readonly TextPage[];
  /** 识别用的语言（日月分不清时只影响先后，两种都给）。 */
  locale: Locale;
  /** 这张表各字段上次点的（字段 ID → FieldPick）。 */
  picks?: Readonly<Record<string, FieldPick>>;
  now?: Date;
}

/** 每个字段最多几个候选。 */
export const MAX_SUGGESTIONS = 3;
/**
 * 低于这个分的不显示（只有「唯一」和「合理」的一点分，标签、记忆、位置都不沾边）。在测量数据上定的：
 * 全部数据里前三中对的 99.6% 在 1.25 以上，错的少一半；真实小票（SROIE 150 张）金额前三里对的
 * 95 → 90、日期 131 → 126。门槛 1.5 时 SROIE 金额只剩 80，2.0 会丢掉单独一个没标签的日期，都不用。
 */
export const SUGGESTION_FLOOR = 1.25;

const GENERIC = [
  'receipt',
  'invoice',
  'tax invoice',
  'official receipt',
  'cash bill',
  'cash sale',
  'simplified tax invoice',
  'bill',
  'ticket',
  'order',
  'welcome',
  'thank you',
  'note',
  'handwritten note',
  'handwritten',
  'sample',
  'sample document',
  'test',
  'test only',
  'copy',
  '欢迎光临',
  '增值税普通发票',
  '增值税专用发票',
  '增值税电子普通发票',
  '发票',
  '收据',
  '小票',
  '谢谢惠顾',
  '合同',
  '账单',
  '样本',
  '测试',
  'facture',
  'reçu',
  'ticket de caisse',
  'bienvenue',
  'merci',
  'contrat',
  'échantillon',
].map(norm);
const isGeneric = (n: string) =>
  GENERIC.some((g) => n === g || (n.includes(g) && n.length <= g.length + 4));
const ADDRESS =
  /\b(street|st|road|rd|jalan|jln|lorong|taman|avenue|ave|rue|bd|boulevard|no|lot|blok|block)\b|[路街号巷弄区]/i;

/** 位置分要是 0 的字：通用的单据字样、太短太长、地址、数字多、网址邮箱、看起来是别的种类。 */
function positionZero(text: string, locale: Locale): boolean {
  const n = norm(text);
  if (isGeneric(n)) return true;
  if (n.length <= 2 || text.split(/\s+/).length > 8 || text.length > 45) return true;
  if (/\d/.test(text) && ADDRESS.test(text)) return true;
  if ([...n].filter((c) => /\d/.test(c)).length > 0.3 * n.length) return true;
  if (/@|www\.|https?:|\.com\b/i.test(text)) return true;
  return looksTyped(text, locale);
}

const hasLetter = /\p{L}/u;
/** 文字字段的值：至少两个字、最多 40 个，有字母，数字不超过三成，不是「发票」「Tax invoice」这种通用字样。 */
function textOk(v: string): boolean {
  const n = norm(v);
  if (n.length < 2 || v.length > 40 || !hasLetter.test(v) || isGeneric(n)) return false;
  return [...n].filter((c) => /\d/.test(c)).length <= 0.3 * n.length;
}

/** 字段要哪一种值；不给候选的字段为 null。 */
function wantOf(field: Field, concept: ConceptId | null): ValueKind | 'choice' | null {
  switch (field.type) {
    case 'money':
    case 'number':
      return 'money';
    case 'date':
      return 'date';
    case 'choice':
      return 'choice';
    case 'text':
    case 'note':
      return (concept && CONCEPTS[concept].kind) || 'text';
    default:
      return null;
  }
}

function choiceOf(value: string, options: readonly { id: string; label: string }[]): string | null {
  const nv = norm(value);
  let best = 0;
  let id: string | null = null;
  for (const o of options) {
    const no = norm(o.label);
    const s = nv === no ? 1 : nv.length >= 3 ? ratio(nv, no) : 0;
    if (s > best) {
      best = s;
      id = o.id;
    }
  }
  return best >= 0.85 ? id : null;
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const YEAR = 365.25 * 24 * 3600 * 1000;

interface Candidate {
  value: string;
  occ: Occurrence[];
  order?: 'DMY' | 'MDY';
  score: number;
  first: number;
}

/** 全部字段的候选（字段 ID → 按分从高到低，最多 3 个）。只给可以填的字段；空着的字段由调用方挑。 */
export function suggestValues(input: SuggestInput): Record<string, ValueSuggestion[]> {
  const now = input.now ?? new Date();
  const pages = input.pages.map((p, i) => pageOccurrences(p, i, input.locale));
  const occ = pages.flatMap((p) => p.occ);
  const rowText = (o: Occurrence) => pages[o.page]!.rows[o.row]?.text ?? '';
  // 只有一种读法的日期：其他日期合不合理按它们来判断（单据的日子），没有时按现在。
  const readings = new Map<string, number>();
  for (const o of occ)
    if (o.kind === 'date') {
      const k = `${o.page}|${o.row}|${o.raw}`;
      readings.set(k, (readings.get(k) ?? 0) + 1);
    }
  const anchors = [
    ...new Set(
      occ
        .filter((o) => o.kind === 'date' && readings.get(`${o.page}|${o.row}|${o.raw}`) === 1)
        .map((o) => o.value),
    ),
  ];

  const out: Record<string, ValueSuggestion[]> = {};
  for (const field of input.fields) {
    const { concept, keywords, exclude } = fieldTerms(field);
    const want = wantOf(field, concept);
    if (!want) continue;
    const longAhead = concept === 'dueDate' || concept === 'signDate';
    const plausibleDate = (v: string) => {
      const t = day(v);
      const others = anchors.filter((a) => a !== v).map(day);
      if (others.length > 0)
        return t >= Math.min(...others) - YEAR && t <= Math.max(...others) + 10 * YEAR;
      const n = now.getTime();
      return t >= n - 10 * YEAR && t <= n + (longAhead ? 10 : 1) * YEAR;
    };

    // 同一个值合并（金额按两位小数，日期连同读法，文字按统一写法）。
    const byKey = new Map<string, Candidate>();
    for (const o of occ) {
      let value: string;
      let key: string;
      if (want === 'choice') {
        if (o.kind !== 'text' || o.other || field.type !== 'choice') continue;
        const id = choiceOf(o.value, field.options);
        if (!id) continue;
        value = id;
        key = id;
      } else if (o.kind !== want) continue;
      else if (want === 'text') {
        if (o.other || !textOk(o.value)) continue;
        value = o.value.trim();
        key = norm(value);
      } else if (want === 'money') {
        const n = Number(o.value);
        value = o.value;
        key = n.toFixed(2);
      } else if (want === 'date') {
        value = o.value;
        key = `${o.value}|${o.dateOrder ?? ''}`;
      } else {
        // 电话、编号填原文的写法（带空格和括号），邮箱填小写。
        value = want === 'email' ? o.value : o.raw.trim();
        key = o.value;
      }
      const c = byKey.get(key);
      if (c) c.occ.push(o);
      else
        byKey.set(key, {
          value,
          occ: [o],
          ...(o.dateOrder ? { order: o.dateOrder } : {}),
          score: 0,
          first: 0,
        });
    }
    const cands = [...byKey.values()];
    const n = cands.length;
    const pick = input.picks?.[field.id];
    const position = concept !== null && CONCEPTS[concept].position === true;
    for (const c of cands) {
      const L = Math.max(...c.occ.map((o) => labelScore(o.label, keywords, exclude)));
      const U = 1 / n;
      let P = 1;
      if (want === 'money') {
        const v = Number(c.value);
        P = v > 0 && v < 100000 && c.occ.some((o) => o.raw.replace(/\D/g, '').length < 9) ? 1 : 0;
      } else if (want === 'date') P = plausibleDate(c.value) ? 1 : 0;
      let M = 0;
      if (pick) {
        for (const o of c.occ) {
          const ls =
            !pick.label && !o.label ? 1 : pick.label && o.label ? charSim(o.label, pick.label) : 0;
          const ps = Math.max(0, 1 - Math.abs(o.relY - pick.relY) / 0.1);
          let m = 0.5 * ls + 0.5 * ps;
          if (pick.order && c.order && pick.order !== c.order) m *= 0.5;
          M = Math.max(M, m);
        }
      }
      let X = 0;
      if (position) {
        for (const o of c.occ) {
          if (
            o.label ||
            positionZero(o.value, input.locale) ||
            positionZero(rowText(o), input.locale)
          )
            continue;
          if (pick) {
            // 记住的位置代替「最上面三排」。
            if (!pick.label) X = Math.max(X, Math.max(0, 1 - Math.abs(o.relY - pick.relY) / 0.1));
          } else if (o.page === 0 && o.row < 3) X = Math.max(X, (3 - o.row) / 3);
        }
      }
      c.score = 3 * L + 3 * M + U + P + X;
      c.first = Math.min(...c.occ.map((o) => o.page * 10000 + o.row));
    }
    cands.sort((a, b) => b.score - a.score || a.first - b.first);
    const list: ValueSuggestion[] = [];
    for (const c of cands) {
      if (c.score < SUGGESTION_FLOOR || list.length >= MAX_SUGGESTIONS) break;
      // 同一个值（例如两种读法里有一种和别处的日期一样）只留分最高的。
      if (list.some((s) => s.value === c.value)) continue;
      // 记下来的那一处：标签分最高的，其次最靠上的。
      const best = [...c.occ].sort(
        (a, b) =>
          labelScore(b.label, keywords, exclude) - labelScore(a.label, keywords, exclude) ||
          a.page - b.page ||
          a.row - b.row,
      )[0]!;
      list.push({
        value: c.value,
        score: c.score,
        pick: {
          label: best.label,
          relY: Math.round(best.relY * 1000) / 1000,
          ...(c.order ? { order: c.order } : {}),
        },
      });
    }
    if (list.length > 0) out[field.id] = list;
  }
  return out;
}
