import {
  leafBlocks,
  type DocBlock,
  type DocDoc,
  type DocImage,
  type DocLeaf,
  type DocTable,
} from './doc';
import type { Box, TableBlock, TableDoc } from './types';

// 转 Word 的编辑（D-328）：DocDoc 不可变地改，每次返回新的（撤销、重做用 edit.ts 的 History）。
// 段落改文字；列表一行一项；表格交给转 Excel 的编辑页（换成只有这一张表的 TableDoc，改完换回来）；
// 任何块都能删除。并排行（D-331）里的块用 cell、item 指明，和别的块一样改；整行不能直接改，格子都空了就删掉。

export interface DocRef {
  page: number;
  block: number;
  /** 并排行里的第几格、格子里的第几个块（D-331）；没有时指整个块。 */
  cell?: number;
  item?: number;
}

const inRow = (at: DocRef) => at.cell !== undefined && at.item !== undefined;

/** 指到的块：页里的块，或者并排行格子里的块。 */
export function blockAt(doc: DocDoc, at: DocRef): DocBlock | undefined {
  const block = doc.pages[at.page]?.blocks[at.block];
  if (!inRow(at)) return block;
  return block?.kind === 'row' ? block.cells[at.cell!]?.blocks[at.item!] : undefined;
}

function replaceBlock(doc: DocDoc, at: DocRef, next: DocBlock | null): DocDoc {
  const page = doc.pages[at.page]!;
  const row = page.blocks[at.block];
  let value: DocBlock | null = next;
  if (inRow(at) && row?.kind === 'row') {
    const cells = row.cells.map((cell, c) =>
      c !== at.cell
        ? cell
        : {
            ...cell,
            blocks:
              next === null
                ? cell.blocks.filter((_, i) => i !== at.item)
                : cell.blocks.map((b, i) => (i === at.item ? (next as DocLeaf) : b)),
          },
    );
    value = cells.some((c) => c.blocks.length) ? { ...row, cells } : null;
  }
  return {
    ...doc,
    pages: doc.pages.map((pg, p) =>
      p !== at.page
        ? pg
        : {
            ...pg,
            blocks:
              value === null
                ? pg.blocks.filter((_, b) => b !== at.block)
                : pg.blocks.map((block, b) => (b === at.block ? value : block)),
          },
    ),
  };
}

/** 一个块在编辑框里的文字：段落是它的文字，列表一行一项；表格和图片没有。 */
export function blockText(block: DocBlock): string | null {
  if (block.kind === 'paragraph') return block.text;
  if (block.kind === 'list') return block.items.join('\n');
  return null;
}

/** 改一个段落或列表的文字（列表按行分项，空行去掉；改成空的就删掉这个块）。没变时返回原来的 doc。 */
export function setBlockText(doc: DocDoc, at: DocRef, text: string): DocDoc {
  const block = blockAt(doc, at);
  if (!block || blockText(block) === text) return doc;
  if (block.kind === 'paragraph') {
    // 整段换了字：原来按字分的样式（D-465）对不上了，不要。
    const { runs: _runs, ...rest } = block;
    return replaceBlock(doc, at, text.trim() ? { ...rest, text } : null);
  }
  if (block.kind === 'list') {
    const items = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const { itemRuns: _runs, ...rest } = block;
    return replaceBlock(doc, at, items.length ? { ...rest, items } : null);
  }
  return doc;
}

/** 剪原图时在字的框外面多留的边（原图像素）：签名、印章的笔画常常比认出来的字的框大。 */
export function originalBox(box: Box, page: { width: number; height: number }): Box {
  const pad = Math.max(8, Math.round(box.height * 0.25));
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(page.width - x, box.width + 2 * pad),
    height: Math.min(page.height - y, box.height + 2 * pad),
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const sameBox = (a: Box, b: Box) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * 「用原图」（D-467、D-468）要剪的范围：这几块字的框合起来，四周多留一点；碰到这一页已经是图片的块
 * （之前换成原图的、剪好的印章）就把它也包进来，剪成一张：一个签名被认成几行字时，分几次换也只得到一张图
 * （2026-11-06 三星真机：签名被切成了好几份）。
 */
export function originalArea(doc: DocDoc, page: number, boxes: readonly Box[]): Box | null {
  const pg = doc.pages[page];
  if (!pg || !boxes.length) return null;
  let area = boxes.map((b) => originalBox(b, pg)).reduce(union);
  const images = leafBlocks(pg).filter((b) => b.kind === 'image');
  for (let grew = true; grew;) {
    grew = false;
    for (const image of images) {
      const next = overlaps(image.box, area) ? union(area, image.box) : area;
      if (!sameBox(next, area)) {
        area = next;
        grew = true;
      }
    }
  }
  return area;
}

/**
 * 把这一页里框是 boxes 的段落、列表，和碰到 image.box 的图片块，换成一张剪好的原图（放在它们里面第一块的位置）。
 * 一块都没找到时返回原来的 doc。
 */
export function swapToOriginal(
  doc: DocDoc,
  page: number,
  boxes: readonly Box[],
  image: { src: string; box: Box },
): DocDoc {
  const pg = doc.pages[page];
  if (!pg) return doc;
  const picture: DocImage = { kind: 'image', box: image.box, src: image.src };
  let placed = false;
  const goes = (leaf: DocLeaf) =>
    ((leaf.kind === 'paragraph' || leaf.kind === 'list') &&
      boxes.some((b) => sameBox(b, leaf.box))) ||
    (leaf.kind === 'image' && overlaps(leaf.box, image.box));
  const keep = (leaves: readonly DocLeaf[]): DocLeaf[] =>
    leaves.flatMap((leaf) => {
      if (!goes(leaf)) return [leaf];
      if (placed) return [];
      placed = true;
      return [picture];
    });
  const blocks: DocBlock[] = pg.blocks.flatMap((block): DocBlock[] => {
    if (block.kind !== 'row') return keep([block]);
    const cells = block.cells.map((cell) => ({ ...cell, blocks: keep(cell.blocks) }));
    return cells.some((c) => c.blocks.length) ? [{ ...block, cells }] : [];
  });
  if (!placed) return doc;
  return { ...doc, pages: doc.pages.map((p, i) => (i === page ? { ...p, blocks } : p)) };
}

export function deleteBlock(doc: DocDoc, at: DocRef): DocDoc {
  if (!blockAt(doc, at)) return doc;
  return replaceBlock(doc, at, null);
}

/** 表格块换成转 Excel 编辑页能打开的 TableDoc（一页、只有这一张表）。 */
export function tableDocOf(doc: DocDoc, at: DocRef, name: string): TableDoc | null {
  const page = doc.pages[at.page];
  const block = blockAt(doc, at);
  if (!page || block?.kind !== 'table') return null;
  return {
    version: 3,
    scope: 'tables',
    pages: [
      {
        name,
        source: page.source,
        width: page.width,
        height: page.height,
        lineHeight: Math.round(page.height / 60),
        colWidths: block.colWidths,
        blocks: [block.table],
      },
    ],
  };
}

/** 编辑页改过的 TableDoc 换回表格块；表被删光了就删掉这个块。 */
export function setTableFrom(doc: DocDoc, at: DocRef, edited: TableDoc): DocDoc {
  const block = blockAt(doc, at);
  const page = edited.pages[0];
  if (block?.kind !== 'table' || !page) return doc;
  const table = page.blocks.find((b): b is TableBlock => b.kind === 'table');
  if (!table) return replaceBlock(doc, at, null);
  const next: DocTable = {
    ...block,
    table: { ...table, col: 0 },
    colWidths: page.colWidths.slice(table.col, table.col + table.cols),
  };
  return replaceBlock(doc, at, next);
}

/**
 * 在文档里直接改一张表（file-room R2，D-366）：表格块换成只有这张表的 TableDoc，交给转 Excel 的编辑函数
 * （改格子、插删行列，edit.ts），再换回来；不再弹出一个只有这张表的编辑页。没变时返回原来的 doc。
 */
export function editDocTable(doc: DocDoc, at: DocRef, fn: (table: TableDoc) => TableDoc): DocDoc {
  const before = tableDocOf(doc, at, '');
  if (!before) return doc;
  const after = fn(before);
  return after === before ? doc : setTableFrom(doc, at, after);
}

/** DocDoc 的 JSON 读回来时检查一下大概的形状（文件是自己写的，只防坏文件）。 */
export function parseDocDoc(json: string): DocDoc | null {
  try {
    const doc = JSON.parse(json) as DocDoc;
    if (doc?.version !== 1 || !Array.isArray(doc.pages)) return null;
    if (!doc.pages.every((p) => Array.isArray(p?.blocks))) return null;
    return doc;
  } catch {
    return null;
  }
}
