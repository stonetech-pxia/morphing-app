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

export async function readDocx(bytes: Uint8Array): Promise<{ xml: string; paras: DocxPara[] }> {
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
  return { xml, paras };
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export interface Converted {
  doc: DocDoc;
  paras: DocxPara[];
  xml: string;
  /** 识别出的所有行（一页一页按识别顺序）。 */
  ocr: string[];
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

/** 原样写的检查。 */
export const custom = (name: string, run: (c: Converted) => string | null): Check => ({
  name,
  run,
});

// ── 每个用例都跑的通用检查 ─────────────────────────────

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
      const got = new Map<string, number>();
      // docx 里换行连字符、断词会合起来：两个识别出的词在 docx 里可能是一个词，所以按子串补数。
      for (const w of words(fullText(c))) got.set(w, (got.get(w) ?? 0) + 1);
      const glued = norm(fullText(c));
      let total = 0;
      let kept = 0;
      let extra = 0;
      const lost: string[] = [];
      const dup: string[] = [];
      for (const [w, n] of want) {
        total += n;
        const k = got.get(w) ?? 0;
        const found = Math.min(n, k >= n ? n : Math.max(k, count(glued, norm(w))));
        kept += found;
        if (found < n) lost.push(w);
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
