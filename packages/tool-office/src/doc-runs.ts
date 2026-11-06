import type { DocBlock, DocDoc, DocLeaf, DocList, DocParagraph, DocRun } from './doc';

// 编辑页整页直接改（D-465，创始人 2026-11-06：「可以自由在文档里面移动光标……还可以变换字体大小，加粗，
// 下划线，斜体」）：编辑页把每一块改完的样子交回来（EditedPage），这里合回 DocDoc。块用 ref 对回原来的块，
// 原来的位置、版面信息都留着；回车分出来的新段落照着它前面那一段。删掉的块就没了。

const zeroBox = { x: 0, y: 0, width: 0, height: 0 };

/** 编辑页交回来的一截字：每一项都写明（不是相对整段的）。 */
export interface EditedRun {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type EditedLeaf =
  | {
      kind: 'paragraph';
      /** 原来是哪一块（「页-块」或「页-块-格-第几个」）；回车新分出来的段落带着前一段的 ref。 */
      ref?: string;
      runs: EditedRun[];
      align?: 'left' | 'center' | 'right';
    }
  | { kind: 'list'; ref?: string; items: EditedRun[][] }
  | { kind: 'table'; ref: string; cells: { i: number; text: string }[] }
  | { kind: 'image'; ref: string };

export type EditedBlock = EditedLeaf | { kind: 'row'; ref: string; cells: EditedLeaf[][] };

export interface EditedPage {
  blocks: EditedBlock[];
}

/** 一段字的几截按 sep 切开（换行、制表符），每份各自带着样式。 */
export function splitRuns(runs: readonly DocRun[], sep: string): DocRun[][] {
  const out: DocRun[][] = [[]];
  for (const run of runs) {
    run.text.split(sep).forEach((part, i) => {
      if (i) out.push([]);
      if (part) out[out.length - 1]!.push({ ...run, text: part });
    });
  }
  return out;
}

/**
 * 整段（标题、粗体、字号）的样子：编辑页交回来的每一截和它一样的项不写。size 是编辑页上画成的字号（磅，
 * 按整点画，和文档里的字号差一点）；docSize 是文档里的字号：变大变小的那几截按差多少加在 docSize 上。
 */
export interface Base {
  size: number;
  docSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** 字号差不到这么多磅就当一样大（编辑页按点算，换回磅有误差）。 */
const SIZE_SNAP = 0.3;

function ownRuns(runs: readonly EditedRun[], base: Base): DocRun[] | undefined {
  const out: DocRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const run: DocRun = { text: r.text };
    if (Math.abs(r.size - base.size) >= SIZE_SNAP) {
      run.size = Math.max(1, Math.round((base.docSize + r.size - base.size) * 2) / 2);
    }
    if (r.bold !== base.bold) run.bold = r.bold;
    if (r.italic !== base.italic) run.italic = r.italic;
    if (r.underline !== base.underline) run.underline = r.underline;
    const last = out[out.length - 1];
    const { text: _a, ...a } = run;
    if (last) {
      const { text: _b, ...b } = last;
      if (sameValue(a, b)) {
        last.text += run.text;
        continue;
      }
    }
    out.push(run);
  }
  return out.some((r) => Object.keys(r).length > 1) ? out : undefined;
}

const textOf = (runs: readonly EditedRun[]) => runs.map((r) => r.text).join('');

function parseRef(ref: string | undefined) {
  const n = (ref ?? '').split('-').map(Number);
  if (n.length < 2 || n.some((v) => !Number.isInteger(v) || v < 0)) return null;
  return { page: n[0]!, block: n[1]!, cell: n[2], item: n[3] };
}

/**
 * 编辑页改完的样子合回文档。baseOf 给出每一块在编辑页里画成的样子（字号、粗体），交回来和它一样的不写。
 * 没变时返回原来的 doc（不多记一步撤销）。
 */
export function mergeEdited(
  doc: DocDoc,
  edited: readonly EditedPage[],
  baseOf: (block: DocParagraph | DocList, page: number) => Base,
): DocDoc {
  const leafAt = (ref: string | undefined): DocLeaf | undefined => {
    const at = parseRef(ref);
    if (!at) return undefined;
    const block = doc.pages[at.page]?.blocks[at.block];
    if (at.cell === undefined) return block?.kind === 'row' ? undefined : block;
    return block?.kind === 'row' ? block.cells[at.cell]?.blocks[at.item ?? -1] : undefined;
  };

  const pages = doc.pages.map((page, p) => {
    const blocks = edited[p]?.blocks;
    if (!blocks) return page;
    // 最近的一块：回车分出来的、没有 ref 的段落照着它。
    let previous: DocLeaf | undefined;
    const leaf = (e: EditedLeaf): DocLeaf | null => {
      const orig = leafAt(e.ref) ?? previous;
      if (e.kind === 'paragraph') {
        const text = textOf(e.runs);
        if (!text.trim()) return null;
        const like: DocParagraph =
          orig?.kind === 'paragraph'
            ? orig
            : { kind: 'paragraph', text: '', box: orig ? { ...orig.box } : zeroBox };
        const { runs: _r, align: _a, ...rest } = like;
        const runs = ownRuns(e.runs, baseOf(like, p));
        const align = e.align && e.align !== 'left' ? e.align : undefined;
        const next: DocParagraph = {
          ...rest,
          text,
          ...(runs ? { runs } : {}),
          ...(align ? { align } : {}),
        };
        previous = next;
        return next;
      }
      if (e.kind === 'list') {
        const items = e.items.filter((runs) => textOf(runs).trim());
        if (!items.length) return null;
        const like: DocList =
          orig?.kind === 'list'
            ? orig
            : { kind: 'list', ordered: false, items: [], box: orig ? { ...orig.box } : zeroBox };
        const base = baseOf(like, p);
        const own = items.map((runs) => ownRuns(runs, base) ?? null);
        const { itemRuns: _i, ...rest } = like;
        const next: DocList = {
          ...rest,
          items: items.map(textOf),
          ...(own.some(Boolean) ? { itemRuns: own } : {}),
        };
        previous = next;
        return next;
      }
      if (e.kind === 'table') {
        if (orig?.kind !== 'table') return null;
        const text = new Map(e.cells.map((c) => [c.i, c.text]));
        const cells = orig.table.cells.map((c, i) =>
          text.has(i) && text.get(i) !== c.text ? { ...c, text: text.get(i)! } : c,
        );
        previous = orig;
        return cells.every((c, i) => c === orig.table.cells[i])
          ? orig
          : { ...orig, table: { ...orig.table, cells } };
      }
      if (orig?.kind !== 'image') return null;
      previous = orig;
      return orig;
    };
    const out: DocBlock[] = [];
    for (const e of blocks) {
      if (e.kind !== 'row') {
        const next = leaf(e);
        if (next) out.push(next);
        continue;
      }
      const at = parseRef(e.ref);
      const row = at ? doc.pages[at.page]?.blocks[at.block] : undefined;
      if (row?.kind !== 'row') continue;
      const cells = row.cells.map((cell, c) => ({
        ...cell,
        blocks: (e.cells[c] ?? []).map(leaf).filter((b): b is DocLeaf => b !== null),
      }));
      if (cells.some((c) => c.blocks.length)) out.push({ ...row, cells });
    }
    return { ...page, blocks: out };
  });
  const next = { ...doc, pages };
  return sameValue(next, doc) ? doc : next;
}

/** 两个值一样（JSON 那样的值，键的顺序不算）。 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
