// 防倒退检查：每个用例写几条「转出来应该是这样」的断言，查转出的 DocDoc（编辑页用的那份）和 docx 本身。
// 文字比较前统一规范化（小写、去掉空白和大部分标点、全角转半角），所以断言里写原文里看得到的字就行。
import JSZip from 'jszip';

import type {
  DocBlock,
  DocDoc,
  DocLeaf,
  DocPage,
  DocTable,
} from '../../../packages/tool-office/src';

export const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s '’"“”«».,:;!?·•_\-–—()[\]{}|/\\*]+/g, '');

/** docx 里的一段（w:p），按文档顺序；表格里的段记下是第几张表、第几行第几格。 */
export interface DocxPara {
  text: string;
  table?: { index: number; row: number; col: number };
  /** 嵌套在文本框（w:txbxContent）里。 */
  textbox?: boolean;
  /** 这一段 w:pPr 里的 w:jc 值。 */
  jc?: string;
}

export async function readDocx(
  bytes: Uint8Array,
): Promise<{ xml: string; paras: DocxPara[]; media: DocxMedia[]; contentTypes: string }> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const paras: DocxPara[] = [];
  const open: DocxPara[] = [];
  const tables: { index: number; row: number; col: number }[] = [];
  let tableCount = 0;
  let textbox = 0;
  const tag = /<(\/?)(w:p|w:tbl|w:tr|w:tc|w:t|w:tab|w:br|w:txbxContent|w:jc)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml))) {
    const [, close, name, attrs, self] = m as unknown as [string, string, string, string, string];
    const top = open[open.length - 1];
    if (name === 'w:p') {
      if (close) {
        const p = open.pop();
        if (p) paras.push(p);
      } else if (!self) {
        const t = tables[tables.length - 1];
        open.push({
          text: '',
          ...(t ? { table: { ...t } } : {}),
          ...(textbox ? { textbox: true } : {}),
        });
      }
    } else if (name === 'w:tbl') {
      if (close) tables.pop();
      else tables.push({ index: tableCount++, row: -1, col: -1 });
    } else if (name === 'w:tr' && !close) {
      const t = tables[tables.length - 1]!;
      t.row++;
      t.col = -1;
    } else if (name === 'w:tc' && !close) tables[tables.length - 1]!.col++;
    else if (name === 'w:txbxContent') textbox += close ? -1 : self ? 0 : 1;
    else if (name === 'w:jc' && top && !close) {
      const v = /w:val="([^"]+)"/.exec(attrs);
      if (v) top.jc = v[1];
    } else if (name === 'w:t' && !close && !self && top) {
      const end = xml.indexOf('</w:t>', tag.lastIndex);
      top.text += decodeXml(xml.slice(tag.lastIndex, end));
      tag.lastIndex = end;
    } else if ((name === 'w:tab' || name === 'w:br') && top)
      top.text += name === 'w:tab' ? '\t' : '\n';
  }
  const media: DocxMedia[] = [];
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith('word/media/'))) {
    media.push({ name, head: [...(await zip.file(name)!.async('uint8array')).slice(0, 8)] });
  }
  const contentTypes = (await zip.file('[Content_Types].xml')?.async('string')) ?? '';
  return { xml, paras, media, contentTypes };
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** docx 里的一个媒体文件：路径和开头几个字节（看真实格式）。 */
export interface DocxMedia {
  name: string;
  head: number[];
}

export interface Converted {
  doc: DocDoc;
  paras: DocxPara[];
  xml: string;
  /** word/media/ 里的文件（旧的调用方可以不给）。 */
  media?: DocxMedia[];
  /** [Content_Types].xml 的原文。 */
  contentTypes?: string;
  /** 识别出的所有行（一页一页按识别顺序）。 */
  ocr: string[];
  /** 识别出的行和它们的框（page 是识别用的图的大小，和编辑页的像素坐标一样时才能拿来比位置）。 */
  ocrBoxes?: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    page: { width: number; height: number };
  }[];
}

export interface Check {
  name: string;
  /** 通过时 null，否则是说明哪里不对的一句话。 */
  run(c: Converted): string | null;
}

/** 叶子块，按页、按块的顺序；并排行里的块记下是哪一行、第几格。 */
export function leaves(doc: DocDoc) {
  const out: { leaf: DocLeaf; page: number; row?: { block: DocBlock; cell: number } }[] = [];
  doc.pages.forEach((p: DocPage, page) => {
    for (const b of p.blocks) {
      if (b.kind === 'row') {
        b.cells.forEach((c, cell) => {
          for (const leaf of c.blocks) out.push({ leaf, page, row: { block: b, cell } });
        });
      } else out.push({ leaf: b, page });
    }
  });
  return out;
}

const tableText = (t: DocTable) => t.table.cells.map((c) => c.text).join(' ');
const leafText = (b: DocLeaf): string =>
  b.kind === 'paragraph'
    ? b.text
    : b.kind === 'list'
      ? b.items.join('\n')
      : b.kind === 'table'
        ? tableText(b)
        : '';

/** docx 的全文（段与段之间换行），规范化前。 */
const fullText = (c: Converted) => c.paras.map((p) => p.text).join('\n');

const count = (hay: string, needle: string) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

const paraIndex = (c: Converted, text: string) =>
  c.paras.findIndex((p) => norm(p.text).includes(norm(text)));

// ── 断言 ───────────────────────────────────────────────

/** 这些字在 docx 里按这个顺序出现（各出现一次以上；跨段、跨表格都算）。 */
export const order = (...texts: string[]): Check => ({
  name: `order ${texts.map((t) => JSON.stringify(t)).join(' < ')}`,
  run(c) {
    const all = norm(fullText(c));
    let at = 0;
    for (const t of texts) {
      const i = all.indexOf(norm(t), at);
      if (i < 0) {
        return all.includes(norm(t)) ? `"${t}" comes too early` : `"${t}" is missing`;
      }
      at = i + norm(t).length;
    }
    return null;
  },
});

/** 这几处文字在 docx 的同一段（同一个 w:p）里。 */
export const together = (...texts: string[]): Check => ({
  name: `same paragraph ${texts.map((t) => JSON.stringify(t)).join(' + ')}`,
  run(c) {
    const p = c.paras.find((p) => texts.every((t) => norm(p.text).includes(norm(t))));
    if (p) return null;
    return `not in one paragraph: ${texts.map((t) => `"${t}"→#${paraIndex(c, t)}`).join(', ')}`;
  },
});

/** 这几处文字分在不同的段里（没有哪一段同时含两处）。 */
export const apart = (a: string, b: string): Check => ({
  name: `separate paragraphs ${JSON.stringify(a)} / ${JSON.stringify(b)}`,
  run(c) {
    if (paraIndex(c, a) < 0) return `"${a}" is missing`;
    if (paraIndex(c, b) < 0) return `"${b}" is missing`;
    const p = c.paras.find((p) => norm(p.text).includes(norm(a)) && norm(p.text).includes(norm(b)));
    return p ? `merged into one paragraph: "${p.text.slice(0, 120)}"` : null;
  },
});

/** 这处文字在 docx 里正好出现 n 次（防重复、防丢）。 */
export const times = (text: string, n: number): Check => ({
  name: `${JSON.stringify(text)} appears ${n}×`,
  run(c) {
    const k = count(norm(fullText(c)), norm(text));
    return k === n ? null : `appears ${k}×`;
  },
});

export interface TableShape {
  /** 表里要有的字（每处落在某一格里）。 */
  containing?: string[];
  rows?: number;
  cols?: number;
  minRows?: number;
  minCols?: number;
  maxRows?: number;
  maxCols?: number;
  /** 某一格（从 0 数）的字。 */
  cells?: { row: number; col: number; text: string }[];
}

const shapeOf = (t: DocTable) => {
  const cols = Math.max(0, ...t.table.cells.map((c) => c.col + c.colSpan)) - t.table.col;
  return { rows: t.table.rows, cols: Math.max(cols, t.table.cols) };
};

const describeTable = (t: DocTable) => {
  const s = shapeOf(t);
  return `${s.rows}×${s.cols} "${tableText(t).slice(0, 60)}"`;
};

function matches(t: DocTable, want: TableShape): boolean {
  const s = shapeOf(t);
  const text = norm(tableText(t));
  if (want.containing && !want.containing.every((x) => text.includes(norm(x)))) return false;
  if (want.rows !== undefined && s.rows !== want.rows) return false;
  if (want.cols !== undefined && s.cols !== want.cols) return false;
  if (want.minRows !== undefined && s.rows < want.minRows) return false;
  if (want.minCols !== undefined && s.cols < want.minCols) return false;
  if (want.maxRows !== undefined && s.rows > want.maxRows) return false;
  if (want.maxCols !== undefined && s.cols > want.maxCols) return false;
  for (const cell of want.cells ?? []) {
    const found = t.table.cells.find((x) => x.row === cell.row && x.col - t.table.col === cell.col);
    if (!found || !norm(found.text).includes(norm(cell.text))) return false;
  }
  return true;
}

const tablesOf = (c: Converted) =>
  leaves(c.doc)
    .map((l) => l.leaf)
    .filter((b): b is DocTable => b.kind === 'table');

/** 有一张这样的表（编辑页里的表格，不是并排的版式行）。 */
export const table = (want: TableShape): Check => ({
  name: `table ${JSON.stringify(want)}`,
  run(c) {
    const all = tablesOf(c);
    if (all.some((t) => matches(t, want))) return null;
    return all.length ? `tables: ${all.map(describeTable).join('; ')}` : 'no table';
  },
});

/** 有一张表的某一排从左到右依次有这几处文字，每处在不同的格里（一项的名称和金额在同一排）。 */
export const inRow = (...texts: string[]): Check => ({
  name: `one table row ${texts.map((t) => JSON.stringify(t)).join(' | ')}`,
  run(c) {
    for (const t of tablesOf(c)) {
      for (let r = 0; r < t.table.rows; r++) {
        const cells = t.table.cells
          .filter((x) => x.row === r)
          .sort((a, b) => a.col - b.col)
          .map((x) => norm(x.text));
        let at = 0;
        const ok = texts.every((want) => {
          const i = cells.findIndex((x, k) => k >= at && x.includes(norm(want)));
          if (i < 0) return false;
          at = i + 1;
          return true;
        });
        if (ok) return null;
      }
    }
    const t = tablesOf(c).find((t) => norm(tableText(t)).includes(norm(texts[0]!)));
    return t ? `not in one row of ${describeTable(t)}` : `"${texts[0]}" is in no table`;
  },
});

/** a、b 各在一张表里，但不是同一张（两张原本分开的表没有被接成一张）。 */
export const differentTables = (a: string, b: string): Check => ({
  name: `different tables ${JSON.stringify(a)} / ${JSON.stringify(b)}`,
  run(c) {
    const all = tablesOf(c);
    const x = all.findIndex((t) => norm(tableText(t)).includes(norm(a)));
    const y = all.findIndex((t) => norm(tableText(t)).includes(norm(b)));
    if (x < 0) return `"${a}" is in no table`;
    if (y < 0) return `"${b}" is in no table`;
    return x === y ? `both in ${describeTable(all[x]!)}` : null;
  },
});

/** 这处文字不在任何表格里（是正文段落）。 */
export const notInTable = (text: string): Check => ({
  name: `${JSON.stringify(text)} is not in a table`,
  run(c) {
    const t = tablesOf(c).find((t) => norm(tableText(t)).includes(norm(text)));
    return t ? `inside table ${describeTable(t)}` : null;
  },
});

/** 整页没有表格。 */
export const noTables = (): Check => ({
  name: 'no tables',
  run(c) {
    const all = tablesOf(c);
    return all.length ? `tables: ${all.map(describeTable).join('; ')}` : null;
  },
});

/** 图片块（不算整页的底图）数在范围里；src 要剪出来了。 */
export const images = (range: { min?: number; max?: number }): Check => ({
  name: `images ${JSON.stringify(range)}`,
  run(c) {
    const all = leaves(c.doc)
      .map((l) => l.leaf)
      .filter((b) => b.kind === 'image' && !b.background);
    const n = all.length;
    if (range.min !== undefined && n < range.min) return `${n} images`;
    if (range.max !== undefined && n > range.max) return `${n} images`;
    if (all.some((b) => b.kind === 'image' && !b.src)) return 'an image was not cropped';
    return null;
  },
});

/** a、b 在同一个并排行里的不同格（左右两栏、标签和值并排）。 */
export const sideBySide = (a: string, b: string): Check => ({
  name: `side by side ${JSON.stringify(a)} | ${JSON.stringify(b)}`,
  run(c) {
    const ls = leaves(c.doc);
    const where = (t: string) => ls.find((l) => norm(leafText(l.leaf)).includes(norm(t)));
    const x = where(a);
    const y = where(b);
    if (!x) return `"${a}" is missing from the blocks`;
    if (!y) return `"${b}" is missing from the blocks`;
    if (x.row && y.row && x.row.block === y.row.block && x.row.cell !== y.row.cell) return null;
    return 'not in different cells of one row';
  },
});

/** 这处文字所在的段落（或表格）是这样对齐的。 */
export const aligned = (text: string, align: 'left' | 'center' | 'right'): Check => ({
  name: `${JSON.stringify(text)} aligned ${align}`,
  run(c) {
    const l = leaves(c.doc).find((l) => norm(leafText(l.leaf)).includes(norm(text)));
    if (!l) return 'missing';
    const got = 'align' in l.leaf && l.leaf.align ? l.leaf.align : 'left';
    return got === align ? null : `aligned ${got}`;
  },
});

/** 这处文字是标题（heading 1/2），或明确不是。 */
export const heading = (text: string, is = true): Check => ({
  name: `${JSON.stringify(text)} ${is ? 'is' : 'is not'} a heading`,
  run(c) {
    const l = leaves(c.doc).find((l) => norm(leafText(l.leaf)).includes(norm(text)));
    if (!l) return 'missing';
    const h = l.leaf.kind === 'paragraph' && !!l.leaf.heading;
    return h === is ? null : h ? 'is a heading' : 'is not a heading';
  },
});

/** 这处文字是列表的一项。 */
export const listItem = (text: string): Check => ({
  name: `${JSON.stringify(text)} is a list item`,
  run(c) {
    const l = leaves(c.doc).find((l) => norm(leafText(l.leaf)).includes(norm(text)));
    if (!l) return 'missing';
    return l.leaf.kind === 'list' ? null : `is a ${l.leaf.kind}`;
  },
});

/** 这处文字显示出来的编号是 n：列表项按列表的起始编号和位置算，普通段落看开头写的「n.」。 */
export const numbered = (text: string, n: number): Check => ({
  name: `${JSON.stringify(text)} is numbered ${n}`,
  run(c) {
    const l = leaves(c.doc).find((l) => norm(leafText(l.leaf)).includes(norm(text)));
    if (!l) return 'missing';
    const leaf = l.leaf;
    const shown =
      leaf.kind === 'list'
        ? leaf.ordered
          ? (leaf.start ?? 1) + leaf.items.findIndex((t) => norm(t).includes(norm(text)))
          : undefined
        : leaf.kind === 'paragraph'
          ? Number(/^\s*(\d+)[.)]/.exec(leaf.text)?.[1] ?? NaN)
          : undefined;
    return shown === n ? null : `is numbered ${shown}`;
  },
});

/**
 * 标签和值一对一行：每一对 [标签, 值] 在 docx 同一张表的同一行、不同格里，而且每一对各占一行
 * （整列标签挤在一格、整列值挤在另一格的并排行不算）。
 */
export const pairedRows = (...pairs: [string, string][]): Check => ({
  name: `one row per pair ${pairs.map(([a, b]) => `${JSON.stringify(a)}|${JSON.stringify(b)}`).join(', ')}`,
  run(c) {
    const cell = (t: string) => c.paras.find((p) => norm(p.text).includes(norm(t)))?.table;
    const rows = new Set<string>();
    for (const [a, b] of pairs) {
      const x = cell(a);
      const y = cell(b);
      if (!x || !y) return `"${x ? b : a}" is missing or not in a table`;
      if (x.index !== y.index || x.row !== y.row || x.col === y.col) {
        return `"${a}" and "${b}" are not in different cells of one row`;
      }
      rows.add(`${x.index}:${x.row}`);
    }
    return rows.size === pairs.length ? null : 'several pairs share one row';
  },
});

/** 有一段（w:p）的字正好是这些（不多不少）。 */
export const exactParagraph = (text: string): Check => ({
  name: `a paragraph is exactly ${JSON.stringify(text)}`,
  run(c) {
    if (c.paras.some((p) => norm(p.text) === norm(text))) return null;
    const p = c.paras[paraIndex(c, text)];
    return p ? `inside "${p.text.slice(0, 120)}"` : 'missing';
  },
});

/** 这处文字不在并排行里（是从上到下排的一块，不是左右分栏的某一格）。 */
export const notInRow = (text: string): Check => ({
  name: `${JSON.stringify(text)} is not in a side-by-side row`,
  run(c) {
    const l = leaves(c.doc).find((l) => norm(leafText(l.leaf)).includes(norm(text)));
    if (!l) return 'missing';
    return l.row ? `in cell ${l.row.cell} of a row` : null;
  },
});

/** docx 里含这处文字的那一段（w:p）的原始 XML。 */
const paraXml = (c: Converted, text: string) =>
  (c.xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).find((p) =>
    norm(
      decodeXml([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? '').join('')),
    ).includes(norm(text)),
  );

/** 含这处文字的段落有首行缩进（w:ind w:firstLine > 0）。 */
export const firstLineIndent = (text: string): Check => ({
  name: `${JSON.stringify(text)} has a first-line indent`,
  run(c) {
    const p = paraXml(c, text);
    if (!p) return 'missing';
    const v = /<w:ind\b[^>]*\bw:firstLine="(\d+)"/.exec(p);
    return v && Number(v[1]) > 0 ? null : 'no w:firstLine';
  },
});

/** 含这处文字的段落里没有强制换行（w:br），也不是编号列表（w:numPr）。 */
export const flowing = (text: string): Check => ({
  name: `${JSON.stringify(text)} flows without line breaks or numbering`,
  run(c) {
    const p = paraXml(c, text);
    if (!p) return 'missing';
    if (/<w:br\b/.test(p)) return 'has w:br';
    if (/<w:numPr\b/.test(p)) return 'has w:numPr';
    return null;
  },
});

/** 原样写的检查。 */
export const custom = (name: string, run: (c: Converted) => string | null): Check => ({
  name,
  run,
});

// ── 每个用例都跑的通用检查 ─────────────────────────────

/** 不超过这么多个字（规范化以后）的词不按子串补数。 */
const SHORT_WORD = 3;

const words = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s ]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 1 || /\p{N}/u.test(w));

/**
 * 认出的字都还在、没有多出来：识别出的词至少 minRecall 在 docx 里（按次数算），
 * docx 里多出来的同一个词不超过识别次数的 maxExtra（版式行里的重复、整段写两遍都会让这里失败）。
 */
export function textKept(minRecall = 0.97, maxExtra = 0.02): Check {
  return {
    name: `text kept (recall ≥ ${minRecall}, extra ≤ ${maxExtra})`,
    run(c) {
      const want = new Map<string, number>();
      for (const w of c.ocr.flatMap(words)) want.set(w, (want.get(w) ?? 0) + 1);
      // 留在图片里的字（中心在一张不是底图的图片块里的行）：图里有，Word 里没有可编辑的字不算丢。
      const pictured = new Map<string, number>();
      const shots = leaves(c.doc).flatMap((l) =>
        l.leaf.kind === 'image' && !l.leaf.background
          ? [{ box: l.leaf.box, page: c.doc.pages[l.page]! }]
          : [],
      );
      for (const line of c.ocrBoxes ?? []) {
        const cx = line.x + line.width / 2;
        const cy = line.y + line.height / 2;
        const inside = shots.some(
          ({ box, page }) =>
            page.width === line.page.width &&
            page.height === line.page.height &&
            cx >= box.x &&
            cx <= box.x + box.width &&
            cy >= box.y &&
            cy <= box.y + box.height,
        );
        if (inside) for (const w of words(line.text)) pictured.set(w, (pictured.get(w) ?? 0) + 1);
      }
      const got = new Map<string, number>();
      // docx 里换行连字符、断词会合起来：两个识别出的词在 docx 里可能是一个词，所以按子串补数。
      for (const w of words(fullText(c))) got.set(w, (got.get(w) ?? 0) + 1);
      const glued = norm(fullText(c));
      const docWords = [...got.keys()];
      let total = 0;
      let kept = 0;
      let extra = 0;
      const lost: string[] = [];
      const dup: string[] = [];
      for (const [w, n] of want) {
        total += n;
        const k = got.get(w) ?? 0;
        // 短词（「n.a.」「2/2」「Art」）几乎总能在别的词里找到同样的几个字，子串补数会把它的丢失盖住：
        // 只认接在 docx 某个词头上或尾巴上的（换行连字符、断词合起来的就是这样）。
        const loose =
          norm(w).length <= SHORT_WORD
            ? docWords
                .filter((d) => d !== w && (d.startsWith(w) || d.endsWith(w)))
                .reduce((sum, d) => sum + got.get(d)!, k)
            : count(glued, norm(w));
        const found = Math.min(n, k >= n ? n : Math.max(k, loose));
        // 没找到的里面留在图片里的那几次不算。
        const excused = Math.min(n - found, pictured.get(w) ?? 0);
        total -= excused;
        kept += found;
        if (found + excused < n) lost.push(w);
        if (k > n) {
          extra += k - n;
          dup.push(`${w}×${k}/${n}`);
        }
      }
      const recall = total ? kept / total : 1;
      const extraRatio = total ? extra / total : 0;
      const problems: string[] = [];
      if (recall < minRecall) {
        problems.push(`recall ${recall.toFixed(3)}; lost: ${lost.slice(0, 12).join(' ')}`);
      }
      if (extraRatio > maxExtra) {
        problems.push(`extra ${extraRatio.toFixed(3)}; repeated: ${dup.slice(0, 12).join(' ')}`);
      }
      return problems.length ? problems.join(' | ') : null;
    },
  };
}

// ── 图片、底图和原生 PDF 绘图（graphics / native 套件加的）────────────

type Region = { x: number; y: number; width: number; height: number };

/** 不算底图的图片块，带所在页的大小。 */
const pictures = (c: Converted) =>
  leaves(c.doc).flatMap((l) =>
    l.leaf.kind === 'image' && !l.leaf.background
      ? [{ ...l, box: l.leaf.box, size: c.doc.pages[l.page]! }]
      : [],
  );

const coverOf = (a: Region, b: Region) =>
  (Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))) /
  Math.max(1, a.width * a.height);

/**
 * 原页上这一块（按页宽、页高的比例给，0–1）被一张图片块盖住至少 min：图形整张剪下来了（没丢、没切成碎条）。
 */
export const imageCovers = (region: Region, min = 0.8): Check => ({
  name: `an image covers ${JSON.stringify(region)} (≥ ${min})`,
  run(c) {
    const all = pictures(c);
    const best = Math.max(
      0,
      ...all.map((p) =>
        coverOf(
          {
            x: region.x * p.size.width,
            y: region.y * p.size.height,
            width: region.width * p.size.width,
            height: region.height * p.size.height,
          },
          p.box,
        ),
      ),
    );
    return best >= min ? null : `best cover ${best.toFixed(2)} (${all.length} images)`;
  },
});

/** 有一张至少占页宽 minWidth 的图片，在编辑页的块顺序里排在这处文字前面（图在图注、正文之前）。 */
export const imageBefore = (text: string, minWidth = 0.5): Check => ({
  name: `a wide image comes before ${JSON.stringify(text)}`,
  run(c) {
    const ls = leaves(c.doc);
    const at = ls.findIndex((l) => norm(leafText(l.leaf)).includes(norm(text)));
    if (at < 0) return 'text missing';
    const img = ls.findIndex(
      (l) =>
        l.leaf.kind === 'image' &&
        !l.leaf.background &&
        l.leaf.box.width >= minWidth * c.doc.pages[l.page]!.width,
    );
    if (img < 0) return 'no wide image';
    return img < at ? null : 'the image comes after it';
  },
});

/** 至少 n 张图片在同一个并排行的不同格里（并排的几张图没有被上下摞起来）。 */
export const imagesSideBySide = (n = 2): Check => ({
  name: `${n} images side by side`,
  run(c) {
    const rows = new Map<DocBlock, Set<number>>();
    for (const p of pictures(c)) {
      if (!p.row) continue;
      const cells = rows.get(p.row.block) ?? new Set<number>();
      cells.add(p.row.cell);
      rows.set(p.row.block, cells);
    }
    const most = Math.max(0, ...[...rows.values()].map((s) => s.size));
    return most >= n ? null : `at most ${most} images in one row`;
  },
});

/**
 * 上下范围大半重叠、左右基本不重叠的两张图（一排并排的图）都在同一个并排行的不同格里：
 * 没有哪一张被拿出这一排、单独放在上面或下面。
 */
export const picturesInRows = (): Check => ({
  name: 'pictures beside each other share one row',
  run(c) {
    const all = pictures(c);
    for (const a of all) {
      for (const b of all) {
        if (a === b || a.page !== b.page) continue;
        const y =
          Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y);
        const x =
          Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
        if (y < 0.5 * Math.min(a.box.height, b.box.height)) continue;
        if (x > 0.2 * Math.min(a.box.width, b.box.width)) continue;
        if (a.row && b.row && a.row.block === b.row.block && a.row.cell !== b.row.cell) continue;
        const at = (p: typeof a) => `(${Math.round(p.box.x)}, ${Math.round(p.box.y)})`;
        return `pictures at ${at(a)} and ${at(b)} are not in one row`;
      }
    }
    return null;
  },
});

/** 整页底图（DocImage.background）的个数在范围里。 */
export const backgrounds = (range: { min?: number; max?: number }): Check => ({
  name: `background images ${JSON.stringify(range)}`,
  run(c) {
    const n = leaves(c.doc).filter((l) => l.leaf.kind === 'image' && l.leaf.background).length;
    if (range.min !== undefined && n < range.min) return `${n} backgrounds`;
    if (range.max !== undefined && n > range.max) return `${n} backgrounds`;
    return null;
  },
});

/** docx 里浮动在页上的图（wp:anchor）不超过 max 个、都在正文后面（behindDoc），而且不在表格格子里。 */
export const anchoredDrawings = (max: number): Check => ({
  name: `≤ ${max} anchored drawings, behind the text and outside table cells`,
  run(c) {
    const anchors = [...c.xml.matchAll(/<wp:anchor\b([^>]*)>/g)];
    if (anchors.length > max) return `${anchors.length} anchored drawings`;
    if (anchors.some((a) => !/behindDoc="1"/.test(a[1]!))) return 'an anchored drawing is in front';
    for (const tc of c.xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)) {
      if (tc[0].includes('<wp:anchor')) return 'an anchored drawing sits inside a table cell';
    }
    return null;
  },
});

/** 原生 PDF 绘图剪出的图（PNG）有没有：扫描件、退回识别的页不该有。 */
export const nativeGraphics = (expected: boolean): Check => ({
  name: expected ? 'native PDF graphics used' : 'no native PDF graphics',
  run(c) {
    const native = leaves(c.doc).some(
      (l) => l.leaf.kind === 'image' && /\.png$/i.test(l.leaf.src ?? ''),
    );
    return native === expected ? null : native ? 'native crops present' : 'no native crops';
  },
});

const MAGIC: [string, number[]][] = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46]],
  ['bmp', [0x42, 0x4d]],
];

/** 每个媒体文件的扩展名和真实格式一致，[Content_Types].xml 也声明了这个扩展名（D-509）。 */
export const mediaTypesMatch = (): Check => ({
  name: 'media extensions match their bytes and content types',
  run(c) {
    if (!c.media) return 'no media list';
    for (const m of c.media) {
      const kind = MAGIC.find(([, sig]) => sig.every((b, i) => m.head[i] === b))?.[0];
      const ext = m.name.split('.').pop()!.toLowerCase().replace('jpeg', 'jpg');
      if (kind && kind !== ext) return `${m.name} holds ${kind} bytes`;
      const declared = new RegExp(`Extension="${m.name.split('.').pop()}"`, 'i');
      if (!declared.test(c.contentTypes ?? '')) return `${m.name}: extension not declared`;
    }
    return null;
  },
});

const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/**
 * 没有看不见的字：有底色（段落或格子的 w:shd）的段落里，字的颜色和底色的对比度至少 minContrast
 * （深色字写在同样深的底色上，字在、但看不见）。
 */
export const textVisible = (minContrast = 2): Check => ({
  name: `text contrasts with its shading (≥ ${minContrast}:1)`,
  run(c) {
    const bad: string[] = [];
    const scan = (xml: string, outerFill?: string) => {
      for (const p of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
        const fill = /<w:pPr>[\s\S]*?w:fill="([0-9A-Fa-f]{6})"/.exec(p[0])?.[1] ?? outerFill;
        if (!fill) continue;
        for (const r of p[0].matchAll(/<w:r>[\s\S]*?<\/w:r>/g)) {
          const text = [...r[0].matchAll(/<w:t[^>]*>([^<]*)/g)].map((m) => m[1]).join('');
          if (!text.trim()) continue;
          const color = /<w:color w:val="([0-9A-Fa-f]{6})"/.exec(r[0])?.[1] ?? '000000';
          const [hi, lo] = [luminance(color), luminance(fill)].sort((a, b) => b - a);
          if ((hi! + 0.05) / (lo! + 0.05) < minContrast)
            bad.push(`"${text.slice(0, 30)}" ${color}/${fill}`);
        }
      }
    };
    for (const tc of c.xml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)) {
      const fill = /<w:tcPr>[\s\S]*?w:fill="([0-9A-Fa-f]{6})"[\s\S]*?<\/w:tcPr>/.exec(tc[1]!)?.[1];
      scan(tc[1]!, fill);
    }
    scan(c.xml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, ''));
    return bad.length ? `invisible: ${bad.slice(0, 5).join('; ')}` : null;
  },
});
