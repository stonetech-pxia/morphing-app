import { hasRecordCurrency } from '../money-currency';
import type { Field, Locale } from '../schema';
import { CONCEPTS, fieldTerms, type ConceptId, type ValueKind } from './concepts';
import { fieldNameKey } from './field-names';
import { looksTyped, pageOccurrences, type Occurrence, type TextPage } from './rows';
import { ctx, receiptRules } from './doc-context';
import {
  adjustTerms,
  amountSet,
  extraSumRow,
  extraWholeNumbers,
  isExcludedX,
  isInvoiceText,
  labelScoreX,
  reorderTiedAmounts,
  sellerLabelScore,
  taxAddCheck,
  taxRateCheck,
} from './rules';
import * as D from './rules-data';
import {
  cleanMerchant,
  companyRow,
  isTitleRow,
  POWERED,
  sellerClientName,
  weakStore,
} from './rules-text';
import { charSim, norm, ratio } from './similarity';

// 新记录表单的候选值（D-394）：每个空字段最多给 3 个候选，用户点了才填，从不自动填
// （创始人 2026-10-31：「宁可不填，不能乱填」，两次测量都找不到 0 错的门槛）。
// 打分照搬测量的变体 A（side-session-notes/prefill-ranking/scripts/score.py）：
//   3·标签 + 3·记忆 + 1·唯一 + 1·合理 + 1·位置，每项 0..1。
// 不用向量模型，全部在本机；识别出的文字、文件名和记录都不发给云端 AI。这里只有规则打分：
// 算术、中文规则、值记忆在 code-rules.ts，本机模型（D-396）在 model.ts。

/** 这个字段学过的一个标签（统一写法，见 fieldNameKey）。 */
export interface LearnedLabel {
  label: string;
  /** 这个标签后面日月分不清的日期，用户点的是哪种读法。 */
  order?: 'DMY' | 'MDY';
  /** 这个标签出现时用户点了别的值：还留着，但不再排第一。 */
  rejected?: true;
}

/** 用户点过的候选：这张表这个字段上次点的是哪个标签后面、页面上多高的值（不记值）。 */
export interface FieldPick {
  label: string;
  relY: number;
  /** 日月分不清的日期，用户点的是哪种读法。 */
  order?: 'DMY' | 'MDY';
  /** 这个字段学过的标签，最近点的在前。旧的记忆没有，那时算学过 label 一个。 */
  labels?: readonly LearnedLabel[];
}

/** 每个字段最多记几个学过的标签：超出时丢掉最久没点的。 */
export const MAX_LEARNED_LABELS = 20;

/** 这个字段学过的标签，最近点的在前。 */
export function learnedLabels(pick: FieldPick | undefined): readonly LearnedLabel[] {
  if (!pick) return [];
  if (pick.labels) return pick.labels;
  const label = fieldNameKey(pick.label);
  return label ? [{ label, ...(pick.order ? { order: pick.order } : {}) }] : [];
}

/**
 * 用户点了一个候选以后的记忆：这一处的标签记到字段下面；当时排在前面、用户没点的学过的标签不再排第一。
 * 这个值在文字里找不到位置（没有 pick）时不学新标签。什么都没变时给 undefined。
 */
export function rememberPick(
  previous: FieldPick | undefined,
  tapped: ValueSuggestion,
  shown: readonly ValueSuggestion[],
): FieldPick | undefined {
  const keep = new Set(tapped.learned ?? []);
  const passed = new Set(shown.flatMap((s) => s.learned ?? []).filter((l) => !keep.has(l)));
  let labels = learnedLabels(previous).map((l) =>
    passed.has(l.label) ? { ...l, rejected: true as const } : l,
  );
  const pick = tapped.pick;
  if (!pick) return previous && passed.size > 0 ? { ...previous, labels } : undefined;
  const label = fieldNameKey(pick.label);
  if (label) {
    const old = labels.find((l) => l.label === label);
    labels = [
      {
        label,
        ...(pick.order ? { order: pick.order } : {}),
        ...(old?.rejected ? { rejected: true as const } : {}),
      },
      ...labels.filter((l) => l !== old),
    ].slice(0, MAX_LEARNED_LABELS);
  }
  return { ...pick, labels };
}

export interface ValueSuggestion {
  /** 表单里的写法：金额、数字是文字，日期 YYYY-MM-DD，单选是选项 ID。 */
  value: string;
  score: number;
  /** 点了以后记下来的（FieldPick）。这个值在文字里找不到位置时没有，点了也不记。 */
  pick?: FieldPick;
  /** 这个值是靠哪些学过的标签排到前面的。 */
  learned?: readonly string[];
}

export interface SuggestInput {
  fields: readonly Field[];
  /** 这张表的 prefillRules：通用规则之外再用哪组规则（D-421）。 */
  rules?: 'receipt' | 'card';
  pages: readonly TextPage[];
  /** 识别用的语言（日月分不清时只影响先后，两种都给）。 */
  locale: Locale;
  /** 这张表各字段上次点的（字段 ID → FieldPick）。 */
  picks?: Readonly<Record<string, FieldPick>>;
  /** 这张表存过的店名、公司（字段 ID → 值，现查的，见 knownValues）；原样出现在文字里就当候选。 */
  known?: Readonly<Record<string, readonly string[]>>;
  /** 名片表（rules: card）：附件里的二维码读出来的文字（D-423）。vCard、MeCard 的值和网址排在每个字段候选的最前面。 */
  codes?: readonly string[];
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
/** 税额候选的最低分：税额多半有「税」字标签，没有标签的数靠巧合，不如不填。 */
const TAX_FLOOR = 2;

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
  '感谢惠顾',
  '欢迎再次光临',
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
/**
 * 位置分要是 0 的字：通用的单据字样、单据名（「收据」）、「Powered by」、太短太长、数字多、网址邮箱、看起来是别的种类。
 * 不再按门牌、国家、州名字样排除地址行：测量里带地址词的行在真店名行里占 8.6%、在它上面的行里占 7.2%，分不开，直接排除是在丢真店名。
 */
// 旧的写法（D-403 之前）：不是收据的文档（名片、其他）还用它。
const ADDRESS_OLD =
  /\b(street|st|road|rd|jalan|jln|lorong|taman|avenue|ave|rue|bd|boulevard|no|lot|blok|block)\b|[路街号巷弄区]/i;
const ADDRESS_ONLY_OLD =
  /(,.*\b\d{4,6}\b|\b\d{4,6}\b.*,)|\b(malaysia|singapore|selangor|johor|kuala lumpur|china|france|usa|united states|canada|australia|cedex)\b|中国|[省市县]/i;
function positionZero(text: string, locale: Locale): boolean {
  const n = norm(text);
  if (isGeneric(n)) return true;
  if (receiptRules() && (isTitleRow(text) || POWERED.test(text))) return true;
  if (n.length <= 2 || text.split(/\s+/).length > 8 || text.length > 45) return true;
  if (!receiptRules()) {
    if (/\d/.test(text) && ADDRESS_OLD.test(text)) return true;
    if (ADDRESS_ONLY_OLD.test(text)) return true;
  }
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
  /** 没有记忆时的分：够不够格当候选。 */
  base: number;
  first: number;
  /** 日期落在合理窗口里。 */
  plaus?: boolean;
}

const NO_DECIMAL_CCY = ['JPY', 'KRW', 'IDR', 'VND', 'CLP'];
/** 整份文字里的金额都写两位小数时，合计候选里写成整数的（订单号、数量、年份）扣 1 分（分和门槛都扣）。 */
function demoteWholeNumbers(cands: Candidate[]): void {
  const live = cands.filter((c) => c.score > 0 && Number.isFinite(Number(c.value)));
  const decimalsOf = (o: Occurrence) => o.raw.replace(/[^\d.,]/g, '');
  const hasDec = live.some((c) => c.occ.some((o) => /[.,]\d{2}$/.test(decimalsOf(o))));
  if (!hasDec || NO_DECIMAL_CCY.includes(ctx.currency)) return;
  for (const c of live) {
    if (c.occ.every((o) => !/[.,]\d{1,2}$/.test(decimalsOf(o)))) {
      c.score -= 1;
      c.base -= 1;
    }
  }
}

/** 解析日期、金额的规则要用的上下文：币种、整份文字、现在的年份、是不是发票。 */
export function setDocContext(input: SuggestInput): void {
  // 表上写了用哪组规则（D-421）：后面每条规则查 ctx.kind；没写就只有通用规则。
  ctx.kind = input.rules ?? 'other';
  ctx.nowYear = (input.now ?? new Date()).getUTCFullYear();
  ctx.text = input.pages.flatMap((p) => p.lines.map((l) => l.text)).join('\n');
  ctx.invoice = receiptRules() && isInvoiceText(ctx.text);
  // 每笔自己选货币时（D-429），字段上的货币不说明这张票是哪国的。
  ctx.currency = input.fields.some(hasRecordCurrency)
    ? ''
    : ((
        input.fields.find((f) => f.type === 'money' && (f as { currency?: string }).currency) as
          { currency?: string } | undefined
      )?.currency ?? '');
}

/** 全部字段的候选（字段 ID → 按分从高到低，最多 3 个）。只给可以填的字段；空着的字段由调用方挑。 */
export function suggestValues(input: SuggestInput): Record<string, ValueSuggestion[]> {
  const now = input.now ?? new Date();
  setDocContext(input);
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
    const terms = fieldTerms(field);
    const concept = terms.concept;
    // 合计、税额、店名的词表按规则补充；「Printed」不再是开票日的排除词（打印日期另外排到最后）。
    const adjusted = adjustTerms(concept, terms.keywords, terms.exclude);
    const keywords = adjusted.kw;
    const exclude =
      concept === 'issueDate' && receiptRules()
        ? adjusted.ex.filter((e) => e !== 'printed')
        : adjusted.ex;
    const scoreLabel = (label: string) => labelScoreX(concept, label, keywords, exclude);
    const isExcluded = (label: string) => isExcludedX(concept, label, exclude);
    const want = wantOf(field, concept);
    if (!want) continue;
    // 合计、税额再多找两种候选：标签后面的整数，和一排「A + B = C」里的数。
    let occF = occ;
    if (receiptRules() && want === 'money' && (concept === 'amount' || concept === 'tax')) {
      const extra = [
        ...extraWholeNumbers(pages, scoreLabel, isExcluded),
        ...extraSumRow(concept, pages, scoreLabel, isExcluded),
      ];
      if (extra.length) occF = occ.concat(extra);
    }
    const longAhead = concept === 'dueDate' || concept === 'signDate';
    // 日期合不合理：落在「现在」前 10 年到后 1 年里；不在时看单据自己的其他日期（单据的日子）。
    // 其他日期里有落在窗口里的，只拿它们当参照（避免一个打印日期、有效期把参照拉歪）。
    const plausibleDate = (v: string) => {
      const t = day(v);
      if (!receiptRules()) {
        const old = anchors.filter((a) => a !== v).map(day);
        if (old.length > 0)
          return t >= Math.min(...old) - YEAR && t <= Math.max(...old) + 10 * YEAR;
        return t >= now.getTime() - 10 * YEAR && t <= now.getTime() + (longAhead ? 10 : 1) * YEAR;
      }
      const n = now.getTime();
      const inWindow = (u: number) => u >= n - 10 * YEAR && u <= n + (longAhead ? 10 : 1) * YEAR;
      if (inWindow(t)) return true;
      const pool = anchors.filter((a) => a !== v);
      const fresh = pool.filter((a) => inWindow(day(a)));
      const others = (fresh.length > 0 ? fresh : pool).map(day);
      if (others.length === 0) return false;
      return t >= Math.min(...others) - YEAR && t <= Math.max(...others) + 10 * YEAR;
    };

    // 同一个值合并（金额按两位小数，日期连同读法，文字按统一写法）。
    const byKey = new Map<string, Candidate>();
    for (const o of occF) {
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
        if (receiptRules() && concept === 'merchant' && POWERED.test(rowText(o))) continue;
        value = o.value.trim();
        if (receiptRules() && concept === 'merchant') {
          value = cleanMerchant(value);
          if (!textOk(value)) continue;
        }
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
          base: 0,
          first: 0,
        });
    }
    const cands = [...byKey.values()];
    const n = cands.length;
    const pick = input.picks?.[field.id];
    const position = concept !== null && CONCEPTS[concept].position === true;
    for (const c of cands) {
      // 每一处都在排除词后面（小计、优惠、找零）的值不给：它们明白地不是这个字段要的。
      if (c.occ.every((o) => isExcluded(o.label))) continue;
      let L = Math.max(
        ...c.occ.map(
          (o) =>
            scoreLabel(o.label) * (receiptRules() && position && weakStore(o.label) ? 0.25 : 1),
        ),
      );
      // 店名这类靠位置的字段：标签分不到 0.6 就当没有标签。上一排被当成标签时，一句标语和 store、shop
      // 共享几个字母对也能拿到零点几分，再乘 3 就盖过位置分，把标语排到店名前面。
      if (receiptRules() && position && L < 0.6) L = 0;
      // 发票：开票方的标签（Remit to、Supplier、From…）按整词给分。
      if (ctx.invoice && position) L = Math.max(L, ...c.occ.map((o) => sellerLabelScore(o.label)));
      const U = 1 / n;
      let P = 1;
      if (want === 'money') {
        const v = Number(c.value);
        P = v > 0 && v < 100000 && c.occ.some((o) => o.raw.replace(/\D/g, '').length < 9) ? 1 : 0;
      } else if (want === 'date') P = plausibleDate(c.value) ? 1 : 0;
      let M = 0;
      if (pick) {
        for (const o of c.occ) {
          // 上次点的是没有标签的一排（店名）时，只认同样没有标签、又不是地址这类的排。
          const ls =
            !pick.label && !o.label
              ? want === 'text' && positionZero(rowText(o), input.locale)
                ? 0
                : 1
              : pick.label && o.label
                ? charSim(o.label, pick.label)
                : 0;
          const ps = Math.max(0, 1 - Math.abs(o.relY - pick.relY) / 0.1);
          // 文字只靠「高度差不多」不算记得：标签一点都对不上就不给记忆分。
          let m = want === 'text' && ls === 0 ? 0 : 0.5 * ls + 0.5 * ps;
          if (pick.order && c.order && pick.order !== c.order) m *= 0.5;
          M = Math.max(M, m);
        }
      }
      let X = 0;
      // 没有记忆时的位置分：够不够格当候选只看这个，记忆只调整顺序（别的店点过的位置不能带来新候选）。
      let X0 = 0;
      if (position) {
        for (const o of c.occ) {
          if (
            o.label ||
            positionZero(o.value, input.locale) ||
            positionZero(rowText(o), input.locale)
          )
            continue;
          if (o.page === 0 && o.row < 3) X0 = Math.max(X0, (3 - o.row) / 3);
          if (pick) {
            // 记住的位置代替「最上面三排」。
            if (!pick.label) X = Math.max(X, Math.max(0, 1 - Math.abs(o.relY - pick.relY) / 0.1));
          } else if (o.page === 0 && o.row < 3) X = Math.max(X, (3 - o.row) / 3);
        }
      }
      // 文字字段只靠「唯一」和「合理」不够：标签、记忆、位置一样都不沾边的排不给（「备注」「事由」
      // 下面列出店名、地址这类没用的候选，iOS 模拟器上 2026-10-31 发现）。
      c.score = want === 'text' && L === 0 && M === 0 && X === 0 ? 0 : 3 * L + 3 * M + U + P + X;
      c.base = want === 'text' && L === 0 && X0 === 0 ? 0 : 3 * L + U + P + X0;
      c.first = Math.min(...c.occ.map((o) => o.page * 10000 + o.row));
      if (want === 'date') c.plaus = P === 1;
      // 整份文字里一个税字样都没有，没有标签分的税额候选多半是别的数：扣 1 分（分和门槛都扣）。
      if (receiptRules() && concept === 'tax' && L === 0 && !D.TAX_WORD.test(ctx.text)) {
        c.score -= 1;
        c.base -= 1;
      }
    }
    if (receiptRules() && want === 'money' && concept === 'amount') demoteWholeNumbers(cands);
    if (receiptRules() && concept === 'tax') {
      const amounts = amountSet(occF);
      taxRateCheck(cands, rowText, amounts);
      taxAddCheck(cands, amounts);
      // 分差不到 0.05 算同分，同分的税额取小的（大的多半是含税合计）。
      cands.sort((a, b) =>
        Math.abs(b.score - a.score) >= 0.05
          ? b.score - a.score
          : Number(a.value) - Number(b.value) || a.first - b.first,
      );
    } else cands.sort((a, b) => b.score - a.score || a.first - b.first);
    if (receiptRules() && concept === 'amount') {
      const reordered = reorderTiedAmounts(cands);
      cands.length = 0;
      cands.push(...reordered);
    }
    if (receiptRules() && concept === 'issueDate') {
      // 「Printed」打印日期排到最后。
      const isPrint = (c: Candidate) =>
        c.occ.every((o) => {
          const row = rowText(o);
          const at = row.indexOf(o.raw);
          return (
            D.PRINT_WORD.test(o.label) ||
            (at > 0 && D.PRINT_WORD.test(row.slice(Math.max(0, at - 30), at)))
          );
        });
      const keep = cands.filter((c) => !isPrint(c));
      const back = cands.filter(isPrint);
      cands.length = 0;
      cands.push(...keep, ...back);
    }
    // 税额的门槛高一些（2 分）：没有标签、也对不上税率和加法的数不当税额。
    const floor =
      receiptRules() && concept === 'tax'
        ? Math.max(SUGGESTION_FLOOR, TAX_FLOOR)
        : SUGGESTION_FLOOR;
    // 低于门槛、但落在页面最上面四分之一、又是单独一排或带月份名的合理日期，也给。
    const lowOk = (c: Candidate) =>
      receiptRules() &&
      want === 'date' &&
      c.plaus === true &&
      c.occ.some(
        (o) =>
          o.page === 0 &&
          o.relY <= 0.25 &&
          (rowText(o).trim().length <= o.raw.trim().length + 3 || /[A-Za-z]{3}/.test(o.raw)),
      );
    const list: ValueSuggestion[] = [];
    for (const c of cands) {
      if (list.length >= MAX_SUGGESTIONS) break;
      if (c.base < floor && !lowOk(c)) continue;
      // 同一个值（例如两种读法里有一种和别处的日期一样）只留分最高的。
      if (list.some((s) => s.value === c.value)) continue;
      // 记下来的那一处：标签分最高的，其次最靠上的。
      const best = [...c.occ].sort(
        (a, b) => scoreLabel(b.label) - scoreLabel(a.label) || a.page - b.page || a.row - b.row,
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
    if (receiptRules() && concept === 'merchant') {
      // 候选不到 3 个时，文字里只有一排带公司后缀（LLC、GmbH、株式会社…）的，补上它当最后一个。
      if (list.length < 3) {
        const hits: { text: string; relY: number }[] = [];
        for (const pg of pages) for (const r of pg.rows) if (companyRow(r.text)) hits.push(r);
        const only = hits.length === 1 ? hits[0]! : null;
        const text = only ? cleanMerchant(only.text.trim()) : '';
        if (only && textOk(text) && !list.some((s) => norm(s.value) === norm(text)))
          list.push({
            value: text,
            score: 0,
            pick: { label: '', relY: Math.round(only.relY * 1000) / 1000 },
          });
      }
      // 发票表头「Seller: Client:」下面一排的第一格是卖方：排第一。
      const name = sellerClientName(pages);
      if (name && textOk(name.text)) {
        const rest = list.filter((s) => norm(s.value) !== norm(name.text));
        list.length = 0;
        list.push({ value: name.text, score: 99, pick: { label: '', relY: name.relY } }, ...rest);
        list.length = Math.min(list.length, MAX_SUGGESTIONS);
      }
    }
    if (list.length > 0) out[field.id] = list;
  }
  return out;
}
