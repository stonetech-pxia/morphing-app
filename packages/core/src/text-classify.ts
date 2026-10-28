// 文件的「形式 / 主题」原型（只在本机，还没接进收件页面）：识别出的文字先由代码判断能不能读，
// 空白和乱码直接判「无法判断」，不交给模型；能读的再拿本地 Embedding 的相似度排候选，
// 分数不够高、或者第一和第二名太接近时也给「无法判断」。只给可点的推荐用，绝不自动运行（D-190）。
// 文字、向量和结果都不离开手机，不发给 AI。阈值由调用方给：要在校准集上定，见
// tests/local-model-eval/CLASSIFY_124_REPORT.md。
// 不用 \p{…}（Hermes 的老版本不支持 Unicode 属性），字符范围直接写出来。

export type TextReadability = 'blank' | 'garbled' | 'readable';

/** 至少要有这么多个能读的字（汉字、单词里的字母、数字）才交给模型。 */
export const MIN_READABLE_CHARS = 6;
/** 能读的字至少要占非空白字符的这么多。 */
export const MIN_READABLE_SHARE = 0.5;

// 中日韩文字（汉字、假名、谚文）：每个字都算能读。
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
// 拉丁（含法文重音）、希腊、西里尔字母。
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿ';
const LETTER = new RegExp(`[${LETTERS}]`);
const ANY_TEXT = new RegExp(`[${LETTERS}0-9]|${CJK.source}`);
const WORD = new RegExp(`^[${LETTERS}]+(?:['’\\-][${LETTERS}]+)*$`);
// 数字、金额、日期、时间、百分比（12,50 €、$4.20、2026-03-12、14:05、-20%）。
const NUMBER = /^[-+]?[$€£¥]?\d[\d.,:/\-]*[%€$£¥]?$/;
// 单号、编码（INV-2026-0042、F2026-118、A12B34）：至少两个数字，至少四个字符。
const CODE = /^(?=(?:[^\d]*\d){2})[A-Za-z0-9#/\-]{4,}$/;
// 表格的填写横线和勾选框（申请人姓名：________ □男 □女）是版面，不算字也不算乱码。
const FORM_BLANKS = /[_\u2610\u25a1]+/g;
// 前后的标点不算进单词。
const EDGE = /^[\s.,;:!?¡¿()[\]{}"'«»“”‘’<>*·•…—–]+|[\s.,;:!?¡¿()[\]{}"'«»“”‘’<>*·•…—–]+$/g;

/** 一个用空白隔开的片段里能读的字数。 */
function readableChars(token: string): number {
  if (CJK.test(token)) {
    // 中文的一段常常连着数字和单位（实付32.00元），汉字、字母、数字都算。
    return [...token].filter((ch) => CJK.test(ch) || LETTER.test(ch) || /\d/.test(ch)).length;
  }
  const core = token.replace(EDGE, '');
  if (core.length === 0) return 0;
  // 单个字母（à、a、l）不算：乱码里最常见的就是零散的单个字母。
  if (WORD.test(core) && core.length >= 2) return core.length;
  if (NUMBER.test(core) || CODE.test(core)) return core.length;
  return 0;
}

/**
 * 识别结果能不能拿去判断：没有任何字母、数字或汉字是 blank；能读的字太少、或者占比太低
 * （「lI1 |:; 0O0 ■■」这类）是 garbled；其余是 readable。只看字符，不看意思：读得通但说的是别的事
 * （一首诗、一页说明书）由后面的分数判断。
 */
export function textReadability(text: string): TextReadability {
  if (!ANY_TEXT.test(text)) return 'blank';
  const tokens = text
    .replace(FORM_BLANKS, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const total = tokens.reduce((n, t) => n + [...t].length, 0);
  const good = tokens.reduce((n, t) => n + readableChars(t), 0);
  return good >= MIN_READABLE_CHARS && good >= MIN_READABLE_SHARE * total ? 'readable' : 'garbled';
}

/** 一个候选（内设的形式、主题，或者用户自己的类别）和它说明文字的向量。 */
export interface LabelVector {
  id: string;
  vector: ArrayLike<number>;
}

export interface LabelScore {
  id: string;
  score: number;
}

/** 余弦相似度；有一个是零向量时为 0。 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('vector lengths differ');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** 按相似度从高到低排候选；同分时保持原来的顺序。 */
export function rankLabels(query: ArrayLike<number>, labels: readonly LabelVector[]): LabelScore[] {
  return labels
    .map((l, i) => ({ id: l.id, score: cosine(query, l.vector), i }))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map(({ id, score }) => ({ id, score }));
}

/**
 * 给出类别的条件（每个维度分开定）：最高分不低于 minScore，并且比第二名至少高 minMargin。
 * 相似度不是正确的概率，这两个数只能在校准集上定，换模型、换量化、换候选说明都要重新定。
 */
export interface GuessThresholds {
  minScore: number;
  minMargin: number;
}

export type UnknownReason = 'blank' | 'garbled' | 'noCandidates' | 'lowScore' | 'tooClose';

export type LabelGuess =
  | { status: 'label'; id: string; score: number; margin: number }
  | { status: 'unknown'; reason: UnknownReason };

/** 从排好的分数里挑一个，或者给「无法判断」。只有一个候选时，差距算无限大。 */
export function pickLabel(scores: readonly LabelScore[], thresholds: GuessThresholds): LabelGuess {
  const valid = scores.filter((s) => Number.isFinite(s.score)).sort((x, y) => y.score - x.score);
  const [first, second] = valid;
  if (!first) return { status: 'unknown', reason: 'noCandidates' };
  const margin = second ? first.score - second.score : Number.POSITIVE_INFINITY;
  if (first.score < thresholds.minScore) return { status: 'unknown', reason: 'lowScore' };
  if (margin < thresholds.minMargin) return { status: 'unknown', reason: 'tooClose' };
  return { status: 'label', id: first.id, score: first.score, margin };
}

export type TextFacet = 'kind' | 'topic';

export interface FacetGuesses {
  kind: LabelGuess;
  topic: LabelGuess;
}

/**
 * 判断一段识别出的文字的形式和主题。空白、乱码不调用模型，两个维度都给「无法判断」。
 * embed 是本机的 Embedding（查询要带和校准时同样的任务说明，所以按维度分开编码）。
 */
export async function guessFacets(
  text: string,
  embed: (text: string, facet: TextFacet) => Promise<ArrayLike<number>>,
  labels: Readonly<Record<TextFacet, readonly LabelVector[]>>,
  thresholds: Readonly<Record<TextFacet, GuessThresholds>>,
): Promise<FacetGuesses> {
  const readability = textReadability(text);
  if (readability !== 'readable') {
    const unknown: LabelGuess = { status: 'unknown', reason: readability };
    return { kind: unknown, topic: unknown };
  }
  const guess = async (facet: TextFacet): Promise<LabelGuess> => {
    if (labels[facet].length === 0) return { status: 'unknown', reason: 'noCandidates' };
    return pickLabel(rankLabels(await embed(text, facet), labels[facet]), thresholds[facet]);
  };
  return { kind: await guess('kind'), topic: await guess('topic') };
}
