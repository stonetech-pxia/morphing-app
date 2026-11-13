// 版式检查：直接读 docx 的 XML 看字号、下划线、缩进、段前距、纸张、格子宽和图片大小。
// 尽量比关系（两段字号之比、两段缩进之差、放不放得下一行），不钉死具体数值。
import { norm, type Check, type Converted } from './checks';

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** docx 里的一段：最内层的 w:p（不含嵌套段），at 是它在 document.xml 里的位置。 */
export interface XmlPara {
  xml: string;
  text: string;
  at: number;
}

const cache = new WeakMap<Converted, XmlPara[]>();

/** 所有最内层的段，按文档顺序。 */
export function xmlParas(c: Converted): XmlPara[] {
  let out = cache.get(c);
  if (out) return out;
  out = [];
  for (const m of c.xml.matchAll(/<w:p>(?:(?!<w:p[ >])[\s\S])*?<\/w:p>/g)) {
    const text = [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
      .map((t) => decodeXml(t[1]!))
      .join('');
    out.push({ xml: m[0], text, at: m.index });
  }
  cache.set(c, out);
  return out;
}

/** 含这处文字的第一段。 */
export function xmlPara(c: Converted, text: string): XmlPara | undefined {
  return xmlParas(c).find((p) => norm(p.text).includes(norm(text)));
}

const pPrOf = (p: XmlPara) =>
  (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(p.xml)?.[1] ?? '').replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '');

const runsOf = (p: XmlPara) =>
  [...p.xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)]
    .map((r) => ({
      xml: r[1]!,
      text: [...r[1]!.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]!).join(''),
    }))
    .filter((r) => r.text.trim());

/** 段里有字的 run 的字号（磅）；没写 w:sz 的是 NaN。 */
export const runSizes = (p: XmlPara): number[] =>
  runsOf(p).map((r) => Number(/<w:sz w:val="(\d+)"/.exec(r.xml)?.[1]) / 2);

/** 段的字号：字最多的那个字号（磅）。 */
export function paraSize(p: XmlPara): number {
  const chars = new Map<number, number>();
  for (const r of runsOf(p)) {
    const s = Number(/<w:sz w:val="(\d+)"/.exec(r.xml)?.[1]) / 2;
    chars.set(s, (chars.get(s) ?? 0) + r.text.length);
  }
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
}

/** 这处文字的字号（磅）：含它的 run 的字号；跨了几个 run 时按含它的段的字号。 */
export function sizeOf(c: Converted, text: string): number {
  for (const p of xmlParas(c)) {
    if (!norm(p.text).includes(norm(text))) continue;
    const run = runsOf(p).find((r) => norm(decodeXml(r.text)).includes(norm(text)));
    return run ? Number(/<w:sz w:val="(\d+)"/.exec(run.xml)?.[1]) / 2 : paraSize(p);
  }
  return NaN;
}

/** 每个有字的 run 都有这个属性（如 '<w:u w:val="single"/>'、'<w:b/>'）。 */
export const allRuns = (p: XmlPara, prop: RegExp) => runsOf(p).every((r) => prop.test(r.xml));
/** 有字的 run 里有一个带这个属性。 */
export const anyRun = (p: XmlPara, prop: RegExp) => runsOf(p).some((r) => prop.test(r.xml));

const pPrNumber = (p: XmlPara, re: RegExp) => Number(re.exec(pPrOf(p))?.[1] ?? 0);
/** 左缩进（twip），没写是 0。 */
export const indentLeft = (p: XmlPara) => pPrNumber(p, /<w:ind\b[^>]*\bw:left="(-?[\d.]+)"/);
/** 段前距（twip），没写是 0。 */
export const spaceBefore = (p: XmlPara) => pPrNumber(p, /<w:spacing\b[^>]*\bw:before="(\d+)"/);
/** 对齐（w:jc），没写是 left。 */
export const jcOf = (p: XmlPara) => /<w:jc w:val="(\w+)"/.exec(pPrOf(p))?.[1] ?? 'left';

/** 段所在的最内层表格格子的宽（twip，w:tcW）；不在表格里时 undefined。 */
export function cellWidth(c: Converted, p: XmlPara): number | undefined {
  const open: number[] = [];
  for (const m of c.xml.slice(0, p.at).matchAll(/<(\/?)w:tc>/g)) {
    if (m[1]) open.pop();
    else open.push(m.index);
  }
  const start = open[open.length - 1];
  if (start === undefined) return undefined;
  return Number(/<w:tcW w:w="(\d+)"/.exec(c.xml.slice(start, p.at))?.[1]);
}

/** 每一节的纸张（twip）和页边距。 */
export function sections(c: Converted) {
  return [...c.xml.matchAll(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g)].map((m) => {
    const n = (re: RegExp) => Number(re.exec(m[0])?.[1] ?? 0);
    return {
      width: n(/<w:pgSz [^>]*w:w="(\d+)"/),
      height: n(/<w:pgSz [^>]*w:h="(\d+)"/),
      landscape: /w:orient="landscape"/.test(m[0]),
      left: n(/<w:pgMar [^>]*w:left="(\d+)"/),
      right: n(/<w:pgMar [^>]*w:right="(\d+)"/),
      at: m.index,
    };
  });
}

/** 文字流里的图片（不算衬在字下面的底图）：wp:extent 的宽高（磅），按文档顺序。 */
export function pictures(c: Converted) {
  return [...c.xml.matchAll(/<w:drawing>([\s\S]*?)<\/w:drawing>/g)]
    .filter((m) => !/behindDoc="1"/.test(m[1]!))
    .map((m) => {
      const e = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(m[1]!)!;
      return { width: Number(e[1]) / 12700, height: Number(e[2]) / 12700 };
    });
}

/** Arial 里 ASCII 字符的宽（千分之一字号，32–126）。 */
const ARIAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** 一段字在 Arial 里有多少个字号宽：带重音的字母按不带的算，中日韩的字和全角符号算 1，其他算 0.556。 */
export function arialEm(text: string): number {
  let em = 0;
  for (const ch of text.normalize('NFD')) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x300 && code < 0x370) continue;
    if (code >= 32 && code <= 126) em += ARIAL[code - 32]! / 1000;
    else if (code >= 0x2e80) em += 1;
    else em += 0.556;
  }
  return em;
}

/** 所有表格格子左右的边距（twip，docx.ts 的 CELL_PAD × 2）。 */
const CELL_PADDING = 160;
/** Arial Bold 比常规体宽这么多（大致）。 */
const BOLD_WIDER = 1.07;

/** 这一段在 Word 里能放在一行：段所在的格子（或页面内容区）减去边距和缩进，放得下 Arial 量出的字宽。 */
export const fitsOneLine = (text: string): Check => ({
  name: `${JSON.stringify(text)} fits on one line`,
  run(c) {
    const p = xmlPara(c, text);
    if (!p) return 'missing';
    const size = paraSize(p);
    const em = arialEm(p.text.trim()) * (anyRun(p, /<w:b\/>/) ? BOLD_WIDER : 1);
    const need = Math.ceil(em * size * 20);
    const cell = cellWidth(c, p);
    const sect = sections(c).find((s) => s.at > p.at) ?? sections(c).at(-1)!;
    const room =
      (cell !== undefined ? cell - CELL_PADDING : sect.width - sect.left - sect.right) -
      indentLeft(p);
    return need <= room
      ? null
      : `needs ${need} twips at ${size} pt but has ${room}${cell !== undefined ? ` (cell ${cell})` : ''}`;
  },
});

/** a 的字号 ÷ b 的字号在 ratio 的 ±tol（相对）以内。 */
export const sizeRatio = (a: string, b: string, ratio: number, tol = 0.1): Check => ({
  name: `size of ${JSON.stringify(a)} / ${JSON.stringify(b)} ≈ ${ratio} ±${tol * 100}%`,
  run(c) {
    const x = sizeOf(c, a);
    const y = sizeOf(c, b);
    if (Number.isNaN(x)) return `"${a}" is missing`;
    if (Number.isNaN(y)) return `"${b}" is missing`;
    const got = x / y;
    return Math.abs(got / ratio - 1) <= tol ? null : `${x} pt / ${y} pt = ${got.toFixed(2)}`;
  },
});

/** 这几段（各自所有的 run）字号一样。 */
export const sameSize = (...texts: string[]): Check => ({
  name: `same size ${texts.map((t) => JSON.stringify(t)).join(', ')}`,
  run(c) {
    const got: string[] = [];
    const all = new Set<number>();
    for (const t of texts) {
      const p = xmlPara(c, t);
      if (!p) return `"${t}" is missing`;
      const s = runSizes(p);
      s.forEach((v) => all.add(v));
      got.push(`${t.slice(0, 12)}=${[...new Set(s)].join('/')}`);
    }
    return all.size === 1 ? null : got.join(', ');
  },
});
