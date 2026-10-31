// 新记录表单的候选值（D-394）：标签和关键词的字符相似度（测量里的变体 A，照搬
// side-session-notes/prefill-ranking/scripts/score.py）。不分大小写、去掉重音和空格标点，
// 所以 OCR 吞掉空格（`Amountpaid`）和小的错字（`Totel`）都还算得上；短的拉丁词（tel、no、to）
// 必须是一个完整的词。

/** 统一写法：NFKC、小写、去掉重音，只留字母和数字。 */
export function norm(s: string): string {
  return unicode(unicode(s, 'NFKC').toLowerCase(), 'NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** 引擎不支持 normalize 时原样返回（只是重音和全角字少认一点）。 */
function unicode(s: string, form: 'NFKC' | 'NFD'): string {
  try {
    return s.normalize(form);
  } catch {
    return s;
  }
}

/** 按空格和常见的分隔符切成词（每个词再统一写法）。 */
export function tokens(s: string): string[] {
  return s
    .split(/[\s:：/\-–·.,()[\]|]+/)
    .map(norm)
    .filter(Boolean);
}

const CJK = /[㐀-鿿]/;

function grams(s: string): Map<string, number> {
  const n = norm(s);
  const out = new Map<string, number>();
  if (n.length <= 2) {
    if (n) out.set(n, 1);
    return out;
  }
  for (let i = 0; i < n.length - 1; i++) {
    const g = n.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
function shared(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  for (const [g, c] of a) n += Math.min(c, b.get(g) ?? 0);
  return n;
}

const latinShort = (kw: string) => {
  const n = norm(kw);
  return n.length <= 3 && !CJK.test(n);
};

/** 关键词出现在标签里的程度：0.75·覆盖 + 0.25·精确（标签里多余的字越多越低）。 */
export function charSim(label: string, kw: string): number {
  if (!label || !kw) return 0;
  const nl = norm(label);
  const nk = norm(kw);
  if (!nl || !nk) return 0;
  if (latinShort(kw)) {
    return tokens(label).includes(nk) || nk === nl ? 0.75 + (0.25 * nk.length) / nl.length : 0;
  }
  const gl = grams(label);
  const gk = grams(kw);
  const inter = shared(gk, gl);
  return (0.75 * inter) / Math.max(1, total(gk)) + (0.25 * inter) / Math.max(1, total(gl));
}

/** 排除词：几乎整个出现在标签里（覆盖 ≥ 0.75）才算，否则 0。 */
export function charCover(label: string, kw: string): number {
  if (!label || !kw) return 0;
  if (latinShort(kw)) return tokens(label).includes(norm(kw)) ? 1 : 0;
  const gk = grams(kw);
  const cov = shared(gk, grams(label)) / Math.max(1, total(gk));
  return cov >= 0.75 ? cov : 0;
}

/** 部分字偶然相同（bigram 撞上）不给分：(s − 0.4) / 0.6，截到 0..1。 */
const A0 = 0.4;

/** 标签分 0..1：和关键词最像的那个（校准后）减去和排除词最像的那个。 */
export function labelScore(
  label: string,
  keywords: readonly string[],
  exclude: readonly string[],
): number {
  if (!label) return 0;
  let p = 0;
  for (const k of keywords) p = Math.max(p, charSim(label, k));
  p = Math.max(0, (p - A0) / (1 - A0));
  let e = 0;
  for (const k of exclude) e = Math.max(e, charCover(label, k));
  return Math.max(0, Math.min(1, p - e));
}

/** 标签明明白白是这个字段的排除词（覆盖 ≥ 0.75，和 labelScore 整个减掉的门槛一样）：小计、找零、优惠。 */
export function isExcludedLabel(label: string, exclude: readonly string[]): boolean {
  return !!label && exclude.some((k) => charCover(label, k) >= 0.75);
}

/** 两段文字有多像（0..1，编辑距离）；单选的选项比对用（difflib 的近似）。 */
export function ratio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}
