import { strToU8, zipSync, type Zippable } from 'fflate';

import {
  leafBlocks,
  textEm,
  type DocBlock,
  type DocDoc,
  type DocLeaf,
  type DocList,
  type DocPage,
  type DocRun,
  type DocStyle,
  type DocTable,
} from './doc';
import { splitRuns } from './doc-runs';
import { imageExt } from './docx-import';
import { cleanXmlText } from './xlsx';

// 写 docx（D-328）：自己写最少的 OOXML，用 fflate 的同步 API 打包（和写 xlsx 一样，D-272）。
// 无衬线的默认字体（D-330），段落（标题用加粗的 Heading1 / Heading2 样式，首行缩进）、run 的粗体 / 颜色 / 字号、编号列表（numbering.xml）、
// 表格（gridSpan / vMerge 合并）、图片（内嵌 JPG）、并排行（无边框的排版表格，D-331）。A4 纵向，每页原图之间分页。
// 位置（D-463，对标 CamScanner）：都是普通段落，不用文本框；段落的左缩进按它在原图里的左边，段前距按它和上一块之间原来空着的高度。

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A4（twip，1/20 磅）和页边距（2 厘米）。 */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1134;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const TABLE_FONT_PAGE_SHARE = CONTENT_W / PAGE_W;
/** 1 twip = 635 EMU。 */
const EMU_PER_TWIP = 635;
/** 所有表格每格左右的边距（twip）；文件里的实际值和量字预算共用。 */
const CELL_PAD = 80;

function cellMarginsXml(): string {
  return `<w:tblCellMar><w:left w:w="${CELL_PAD}" w:type="dxa"/><w:right w:w="${CELL_PAD}" w:type="dxa"/></w:tblCellMar>`;
}
/** 分段的空隙写成段前间距（twip）：块没有可用的位置（文字转 Word 的占位框）时用。 */
const SPACED_BEFORE = 160;
/** 一行字在 Word 里的高度 ≈ 字号的这么多倍（D-463）：Arial 的上下伸出 1.117 × 默认行距 1.15。 */
const LINE_HEIGHT = 1.28;
/** 不到这么多（twip：6 磅、3 磅）的左缩进、段前距不写：识别框的抖动，字的左边和页边距差一点。 */
const MIN_INDENT = 120;
const MIN_BEFORE = 60;
/** 一行的段落在 Word 里可能比原图宽一点（字体不同）：缩进留出这么多余量，不让它折到下一行。 */
/** 左边差不到这么多个字宽的块对齐到同一个位置。 */
const SNAP_EM = 0.7;
const WIDTH_SLACK = 1.1;

/**
 * 默认字体（D-330）：无衬线，和 CamScanner 一样。西文 Arial，中文微软雅黑（Windows 和 Mac 版 Office 都带）；
 * 字体表写明是无衬线（swiss），没有这个字体的电脑换成别的无衬线字体（Mac 上是 Helvetica、苹方）。
 */
const LATIN_FONT = 'Arial';
const CJK_FONT = 'Microsoft YaHei';
/** 每个 run 也写一遍字体：苹果的预览（Mac、iPhone 的「文件」）不读默认样式里的字体，只认 run 上的。 */
const RUN_FONTS = `<w:rFonts w:ascii="${LATIN_FONT}" w:hAnsi="${LATIN_FONT}" w:eastAsia="${CJK_FONT}" w:cs="${LATIN_FONT}"/>`;

function fontTableXml(): string {
  return (
    `${HEAD}<w:fonts xmlns:w="${W_NS}">` +
    `<w:font w:name="${LATIN_FONT}"><w:altName w:val="Helvetica"/><w:charset w:val="00"/>` +
    '<w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>' +
    `<w:font w:name="${CJK_FONT}"><w:altName w:val="PingFang SC"/><w:charset w:val="86"/>` +
    '<w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>' +
    '</w:fonts>'
  );
}

/** 一张剪好的图片：JPG 字节和像素大小。 */
export interface DocxImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const escapeXml = (text: string) =>
  cleanXmlText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 标题样式比正文大多少（Heading1、Heading2）。 */
const HEADING_SCALE: Record<string, number> = { Heading1: 1.6, Heading2: 1.3 };

/**
 * 一段文字的 run：换行写成 <w:br/>，制表符写成 <w:tab/>（D-332），前后的空格保留。
 * 每个 run 都写字号（D-335）：苹果的预览不读默认样式里的字号（一律当 12 磅），只认 run 上的；
 * 没有自己字号的用标题样式或正文的字号。
 */
function sizeXml(style: DocStyle, bodySize: number, styleId?: string): string {
  const body = Math.round(bodySize * 2);
  const half = style.size
    ? Math.round(style.size * 2)
    : styleId && HEADING_SCALE[styleId]
      ? Math.round(body * HEADING_SCALE[styleId])
      : body;
  return `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`;
}

function runXml(text: string, style: DocStyle, bodySize: number, styleId?: string): string {
  const props =
    RUN_FONTS +
    (style.bold ? '<w:b/><w:bCs/>' : '') +
    (style.italic ? '<w:i/><w:iCs/>' : '') +
    (style.underline ? '<w:u w:val="single"/>' : '') +
    (style.color ? `<w:color w:val="${style.color}"/>` : '') +
    sizeXml(style, bodySize, styleId);
  const rPr = `<w:rPr>${props}</w:rPr>`;
  return text
    .split('\n')
    .map(
      (part, i) =>
        `<w:r>${rPr}${i ? '<w:br/>' : ''}` +
        part
          .split('\t')
          .map((seg) => `<w:t xml:space="preserve">${escapeXml(seg)}</w:t>`)
          .join('<w:tab/>') +
        '</w:r>',
    )
    .join('');
}

/** 一段的字：样式不同的几截（D-465）各自写成 run，没写的跟着整段。 */
function runsXml(
  text: string | readonly DocRun[] | undefined,
  style: DocStyle,
  bodySize: number,
  styleId?: string,
): string {
  if (typeof text === 'string' || !text) return runXml(text ?? '', style, bodySize, styleId);
  return text
    .map(({ text: part, ...own }) => runXml(part, { ...style, ...own }, bodySize, styleId))
    .join('');
}

function paragraphXml(
  text: string | readonly DocRun[] | undefined,
  style: DocStyle,
  bodySize: number,
  extra: {
    styleId?: string;
    spaced?: boolean;
    /** 段前距（twip，D-463）：有时代替 spaced；标题也写段后 0（不用标题样式的段前段后）。 */
    before?: number;
    numId?: number;
    pageBreak?: boolean;
    /** 首行缩进（twip）。 */
    indent?: number;
    /** 左缩进（twip，D-463）：原图里的左边。 */
    left?: number;
  } = {},
): string {
  const spacing =
    extra.before !== undefined
      ? extra.before >= MIN_BEFORE || extra.styleId?.startsWith('Heading')
        ? `<w:spacing w:before="${extra.before >= MIN_BEFORE ? extra.before : 0}"${extra.styleId?.startsWith('Heading') ? ' w:after="0"' : ''}/>`
        : ''
      : extra.spaced
        ? `<w:spacing w:before="${SPACED_BEFORE}"/>`
        : '';
  // 列表项的左缩进加在编号的缩进（420）上，悬挂缩进不变。
  const left = extra.left ? (extra.numId ? 420 + extra.left : extra.left) : 0;
  const ind =
    left || extra.indent
      ? `<w:ind${left ? ` w:left="${left}"` : ''}${left && extra.numId ? ' w:hanging="420"' : ''}${extra.indent ? ` w:firstLine="${extra.indent}"` : ''}/>`
      : '';
  const pPr =
    (extra.styleId ? `<w:pStyle w:val="${extra.styleId}"/>` : '') +
    (extra.pageBreak ? '<w:pageBreakBefore/>' : '') +
    (extra.numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${extra.numId}"/></w:numPr>` : '') +
    spacing +
    ind +
    (style.align && style.align !== 'left'
      ? `<w:jc w:val="${style.align === 'center' ? 'center' : 'right'}"/>`
      : '') +
    // 段落标记的字号（D-335）：空段落、空格子的高度按它算。
    `<w:rPr>${sizeXml(style, bodySize, extra.styleId)}</w:rPr>`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${runsXml(text, style, bodySize, extra.styleId)}</w:p>`;
}

/** 空段落（表格后面的分隔、空格子）：段落标记也写字号（D-335），不然按默认样式（苹果的预览按 12 磅）撑高。 */
function blankXml(size: number): string {
  return `<w:p><w:pPr><w:rPr>${sizeXml({}, size)}</w:rPr></w:pPr></w:p>`;
}

/** 表格格子左右的边距加起来（磅），和写入每张表的值一致。 */
const TABLE_CELL_PAD_PT = (2 * CELL_PAD) / 20;
/** 表里的字为了放下最长的词最多缩到这么小（磅，D-335）。 */
const TABLE_MIN_SIZE = 5;

/**
 * 一个词在 Arial 里大概多宽（以字号为单位，D-335）：大写字母约 0.7，小写约 0.52，数字 0.56，
 * 中日韩的字 1（每个字都能断行，单独算一个词），其他符号 0.35。宁可估宽一点（宽了只是字小一点，窄了会把词拆开）。
 */
function longestWordEm(text: string): number {
  let best = 0;
  let cur = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      cur = 0;
      continue;
    }
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFF00-\uFFEF]/u.test(
        ch,
      )
    ) {
      cur = 0;
      best = Math.max(best, 1);
      continue;
    }
    cur += /[A-Z\u00C0-\u00DE]/.test(ch)
      ? 0.7
      : /[a-z\u00DF-\u00FF]/.test(ch)
        ? 0.52
        : /\d/.test(ch)
          ? 0.56
          : 0.35;
    best = Math.max(best, cur);
  }
  return best;
}

/**
 * 原图像素 → twip：整页宽度按 A4 宽算，放不下时按内容区等比缩小。表里的字号（D-335）按表自己的字号跟着一起缩小，
 * 哪一格最长的词放不下时整张表再一起缩小，最小 5 磅（取到半磅）。
 */
function tableXml(
  block: DocTable,
  page: DocPage,
  bodySize: number,
  maxWidth = CONTENT_W,
  left = 0,
  fontMaxWidth = maxWidth,
): string {
  const { table, colWidths } = block;
  const raw = colWidths.map(
    (w) => (w / page.width) * (page.paper ? Math.round(page.paper.width * 20) : PAGE_W),
  );
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const k = Math.min(1, maxWidth / total);
  const widths = raw.map((w) => Math.max(200, Math.round(w * k)));
  const sourceSize = block.size ?? bodySize;
  let scale = Math.min(k, fontMaxWidth / total);
  for (const cell of table.cells) {
    const em = longestWordEm(cell.text);
    if (!em) continue;
    const span = Math.max(1, Math.min(cell.colSpan, table.cols - cell.col));
    const cross = widths.slice(cell.col, cell.col + span).reduce((a, b) => a + b, 0) / 20;
    const w =
      block.direction && cell.box
        ? (cell.box.height / page.width) * (page.paper?.width ?? PAGE_W / 20)
        : cross;
    if (block.direction)
      scale = Math.min(
        scale,
        (cross - TABLE_CELL_PAD_PT) / LINE_HEIGHT / (cell.size ?? sourceSize),
      );
    scale = Math.min(scale, (w - TABLE_CELL_PAD_PT) / em / (cell.size ?? sourceSize));
  }
  const size = Math.max(TABLE_MIN_SIZE, Math.floor(sourceSize * scale * 2) / 2);
  // 每个位置属于哪一格（合并格子的左上角以外的位置写成 vMerge 的续格）。
  const at = new Map<string, number>();
  table.cells.forEach((c, i) => {
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let col = c.col; col < c.col + c.colSpan; col++) at.set(`${r},${col}`, i);
  });
  const rows: string[] = [];
  for (let r = 0; r < table.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < table.cols;) {
      const i = at.get(`${r},${c}`);
      const cell = i === undefined ? undefined : table.cells[i];
      if (!cell) {
        // 网格里没有格子的位置（编辑出错的文件）：补一个空格子。
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/></w:tcPr>${blankXml(size)}</w:tc>`,
        );
        c++;
        continue;
      }
      const span = Math.max(1, Math.min(cell.colSpan, table.cols - c));
      const w = widths.slice(c, c + span).reduce((a, b) => a + b, 0);
      const first = cell.row === r;
      const tcPr =
        `<w:tcW w:w="${w}" w:type="dxa"/>` +
        (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') +
        (cell.rowSpan > 1 ? (first ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '') +
        (block.direction ? '<w:textDirection w:val="tbRl"/>' : '');
      const ownSize =
        cell.size === undefined
          ? size
          : Math.max(TABLE_MIN_SIZE, Math.floor(cell.size * scale * 2) / 2);
      const style = { size: ownSize, ...(cell.align ? { align: cell.align } : {}) };
      const body = first
        ? cell.text
            .split('\n')
            .map((line) => paragraphXml(line, style, bodySize))
            .join('')
        : blankXml(size);
      cells.push(`<w:tc><w:tcPr>${tcPr}</w:tcPr>${body || blankXml(size)}</w:tc>`);
      c += span;
    }
    const rowHeight = block.direction
      ? Math.round(
          (Math.max(
            0,
            ...table.cells
              .filter((c) => c.row === r && c.box)
              .map((c) => c.box!.height / c.rowSpan),
          ) /
            page.width) *
            (page.paper?.width ?? PAGE_W / 20) *
            20,
        )
      : 0;
    rows.push(
      `<w:tr>${rowHeight ? `<w:trPr><w:trHeight w:val="${rowHeight}" w:hRule="atLeast"/></w:trPr>` : ''}${cells.join('')}</w:tr>`,
    );
  }
  // 原图里没有线、按列对齐认出来的表（D-471）不画边框。
  const border = (side: string) =>
    block.borderless
      ? `<w:${side} w:val="nil"/>`
      : `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
    (left ? `<w:tblInd w:w="${left}" w:type="dxa"/>` : '') +
    '<w:tblLayout w:type="fixed"/><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') +
    `</w:tblBorders>${cellMarginsXml()}</w:tblPr><w:tblGrid>` +
    widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    `</w:tblGrid>${rows.join('')}</w:tbl>`
  );
}

/** 列宽放不下时等比缩小，每列至少 200 twip。 */
function fitWidths(raw: readonly number[], maxWidth: number): number[] {
  const k = Math.min(1, maxWidth / (raw.reduce((a, b) => a + b, 0) || 1));
  return raw.map((w) => Math.max(200, Math.round(w * k)));
}

/** 无边框的排版表格（D-331、D-332）：rows 是每行每格里的 XML 片段；每格以段落结尾（Word 要求）。 */
function layoutTableXml(
  widths: readonly number[],
  rows: readonly (readonly string[])[],
  size: number,
): string {
  const none = (side: string) => `<w:${side} w:val="nil"/>`;
  const tr = (cells: readonly string[]) =>
    '<w:tr>' +
    cells
      .map((inner, i) => {
        const ends = inner.endsWith('</w:p>');
        return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>${inner}${ends ? '' : blankXml(size)}</w:tc>`;
      })
      .join('') +
    '</w:tr>';
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    '<w:tblLayout w:type="fixed"/><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(none).join('') +
    `</w:tblBorders>${cellMarginsXml()}</w:tblPr><w:tblGrid>` +
    widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    `</w:tblGrid>${rows.map(tr).join('')}</w:tbl>`
  );
}

function imageXml(
  rid: string,
  id: number,
  cx: number,
  cy: number,
  pPr = '',
  background = false,
): string {
  return (
    `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${background ? '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>' : ''}<w:drawing>` +
    (background
      ? '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="0" allowOverlap="1">' +
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:wrapNone/>`
      : `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`) +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic>' +
    (background ? '</wp:anchor>' : '</wp:inline>') +
    '</w:drawing></w:r></w:p>'
  );
}

/** 列表的编号定义（每个列表一个，编号从它自己的第一项开始）。 */
function numberingXml(lists: readonly DocList[]): string {
  const abstracts = lists.map((list, i) => {
    const fmt = !list.ordered
      ? 'bullet'
      : list.format === '%1' && list.start !== undefined
        ? 'decimalEnclosedCircle'
        : 'decimal';
    const text = list.ordered ? (list.format ?? '%1.') : '•';
    return (
      `<w:abstractNum w:abstractNumId="${i}"><w:multiLevelType w:val="singleLevel"/>` +
      `<w:lvl w:ilvl="0"><w:start w:val="${list.start ?? 1}"/><w:numFmt w:val="${fmt}"/>` +
      `<w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="left"/>` +
      '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum>'
    );
  });
  const nums = lists.map(
    (_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i}"/></w:num>`,
  );
  return `${HEAD}<w:numbering xmlns:w="${W_NS}">${abstracts.join('')}${nums.join('')}</w:numbering>`;
}

function stylesXml(bodySize: number): string {
  const sz = Math.round(bodySize * 2);
  const heading = (id: string, name: string, size: number) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
    `<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>` +
    `<w:outlineLvl w:val="${id === 'Heading1' ? 0 : 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return (
    `${HEAD}<w:styles xmlns:w="${W_NS}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    RUN_FONTS +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading('Heading1', 'heading 1', Math.round(sz * HEADING_SCALE.Heading1!)) +
    heading('Heading2', 'heading 2', Math.round(sz * HEADING_SCALE.Heading2!)) +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
    '<w:basedOn w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
    `<w:tblPr>${cellMarginsXml()}</w:tblPr></w:style>` +
    '</w:styles>'
  );
}

/**
 * 写 docx。images 按图片块的 src 给剪好的图片字节；没有的图片块跳过。
 * 默认样式的正文字号用第一页的；每个 run 都写自己那一页的字号（D-335）。
 */
export function writeDocx(
  doc: DocDoc,
  images: ReadonlyMap<string, DocxImage> = new Map(),
): Uint8Array {
  const docSize = doc.pages[0]?.bodySize ?? 11;
  const lists: DocList[] = [];
  const media: { name: string; rid: string; bytes: Uint8Array }[] = [];
  const body: string[] = [];
  const sections = doc.pages.some((p) => p.paper);
  const geometry = (page?: DocPage) => {
    const width = page?.paper ? Math.round(page.paper.width * 20) : PAGE_W;
    const height = page?.paper ? Math.round(page.paper.height * 20) : PAGE_H;
    const maxMargin = Math.min(MARGIN, Math.floor(width / 4), Math.floor(height / 4));
    const margins = Object.fromEntries(
      ['top', 'right', 'bottom', 'left'].map((side) => [
        side,
        Math.max(
          0,
          Math.min(
            maxMargin,
            page?.margins
              ? Math.round(page.margins[side as keyof NonNullable<DocPage['margins']>] * 20)
              : maxMargin,
          ),
        ),
      ]),
    ) as Record<'top' | 'right' | 'bottom' | 'left', number>;
    return { width, height, margins };
  };
  const sectionXml = (page?: DocPage, next = false) => {
    const { width, height, margins: m } = geometry(page);
    return (
      '<w:sectPr>' +
      (next ? '<w:type w:val="nextPage"/>' : '') +
      `<w:pgSz w:w="${width}" w:h="${height}"${width > height ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="${Math.min(567, m.top)}" w:footer="${Math.min(567, m.bottom)}" w:gutter="0"/></w:sectPr>`
    );
  };
  doc.pages.forEach((page, p) => {
    const { width: PAGE_W, height: PAGE_H, margins } = geometry(page);
    const CONTENT_W = PAGE_W - margins.left - margins.right;
    const CONTENT_H = PAGE_H - margins.top - margins.bottom;
    if (sections && p > 0)
      body.push(
        `<w:p><w:pPr>${sectionXml(doc.pages[p - 1], true)}<w:spacing w:line="1" w:lineRule="exact"/></w:pPr></w:p>`,
      );
    const pageStart = body.length;
    // 每页的字按这一页的正文字号写（D-335：表单页和正文页的正文字号可能差很多）。
    const bodySize = page.bodySize ?? docSize;
    let first = p > 0 && !sections;
    const pageBreak = () => {
      const b = first;
      first = false;
      return b;
    };
    const twip = (px: number) => Math.round((px / page.width) * PAGE_W);
    // 位置（D-463）：左缩进从 A4 的左页边距算起（原图的字更靠左时从最左的字算起），
    // 段前距是原图里和上一块之间空着的高度；字和空白加起来在 Word 里比 A4 的内容区还高、只靠字又放得下一页时，
    // 段前距按比例缩小，原件一页还是一页（字本身就超过一页的正文页不缩，段落之间照样空开）。
    const marginPx = (margins.top / PAGE_W) * page.width;
    const foreground = page.blocks.filter((b) => !(b.kind === 'image' && b.background));
    const leaves = leafBlocks({ blocks: foreground });
    const base = Math.min((margins.left / PAGE_W) * page.width, ...leaves.map((b) => b.box.x));
    // 左边对齐的块左边只差一点（认字框的左边总有几个像素的抖动）时对齐到同一个位置：
    // 不然每段的缩进都差几磅，Word 里左边是锯齿。差不到 0.7 个字宽的归为一组，取这一组最左的。
    const emPx = (bodySize / (PAGE_W / 20)) * page.width;
    const snap = new Map<number, number>();
    let anchor = -Infinity;
    for (const x of [...new Set(leaves.map((b) => b.box.x))].sort((a, b) => a - b)) {
      if (x - anchor > SNAP_EM * emPx) anchor = x;
      snap.set(x, anchor);
    }
    let fit = 1;
    // 已知纸张尺寸的页需要把默认 Arial 行框的上/下伸留量算足；字高不是整行高度。
    const leading = page.paper ? 1.34 : LINE_HEIGHT;
    const blankHeight = Math.round(LINE_HEIGHT * bodySize * 20);
    /**
     * 上一块：上边、下边（原图像素）和它在 Word 里占的高度（twip，连同后面补的空段落）。
     * 段前距按上边到上边算（识别框的下边随 p、g 这些往下伸的字母变，上边稳一些）。
     */
    interface Flow {
      top: number;
      bottom: number;
      height: number;
    }
    // 一块在 Word 里大概多高：文字按原图里有几行 × 行高，表格、图片按原图里的高。
    const heightOf = (block: DocBlock, maxWidth = CONTENT_W): number => {
      const h = twip(block.box.height);
      const wrapped = (text: string, size: number, width: number) =>
        text
          .split('\n')
          .reduce(
            (n, line) =>
              n +
              Math.max(1, Math.ceil((textEm(line) * size * 20 * WIDTH_SLACK) / Math.max(1, width))),
            0,
          );
      if (block.kind === 'paragraph' && !block.tab) {
        const size = block.size || bodySize;
        const one = leading * size * 20;
        return Math.max(1, Math.round(h / one), wrapped(block.text, size, maxWidth)) * one;
      }
      if (block.kind === 'list') {
        const one = leading * (block.size || bodySize) * 20;
        const lines = block.items.reduce(
          (n, item) => n + wrapped(item, block.size || bodySize, maxWidth - 420),
          0,
        );
        return Math.max(lines, Math.round(h / one)) * one;
      }
      if (page.paper && block.kind === 'row') {
        const widths = fitWidths(
          block.cells.map((c) => twip(c.width)),
          maxWidth,
        );
        const measured = block.cells.map((cell, i) => {
          const flow: Flow = { top: block.box.y, bottom: block.box.y, height: 0 };
          let total = 0;
          for (const child of cell.blocks) {
            const height = heightOf(child, Math.max(1, widths[i]! - 2 * CELL_PAD));
            total += (beforeOf(child, flow) ?? 0) + height;
            flow.top = child.box.y;
            flow.bottom = child.box.y + child.box.height;
            flow.height = height;
          }
          return total;
        });
        return Math.max(h, ...measured) + LINE_HEIGHT * 20;
      }
      if (block.kind === 'space') return h;
      return block.kind === 'image' ? h + (page.paper ? bodySize * 6 : 0) : h + LINE_HEIGHT * 20;
    };
    // 段前距（twip）；在上一块上面、和它重叠（位置用不了，例如文字转 Word 的占位框）时没有，按 spaced 写。
    // 一页（一格）的第一块离上边不到一行时不空（字的上边和页边距差一点）。
    const beforeOf = (block: DocBlock, flow: Flow): number | undefined => {
      if (block.box.y < flow.bottom) return page.paper ? 0 : undefined;
      const v = (twip(block.box.y - flow.top) - flow.height) * fit;
      if (!flow.height && v < blankHeight) return 0;
      return Math.max(0, Math.round(v / 10) * 10);
    };
    const advance = (flow: Flow, block: DocBlock) => {
      flow.top = block.box.y;
      flow.bottom = block.box.y + block.box.height;
      flow.height = heightOf(block);
    };
    // 左缩进（twip）：居中、靠右的段落没有；一行的段落放得下才缩进（不让它折到下一行）。
    const leftOf = (block: DocLeaf, from: number, maxWidth: number): number => {
      if (block.kind === 'paragraph' && block.tab) return 0;
      if (
        block.kind !== 'image' &&
        block.kind !== 'table' &&
        block.kind !== 'space' &&
        block.align &&
        block.align !== 'left'
      )
        return 0;
      const room = maxWidth - twip(block.box.width) * (block.kind === 'table' ? 1 : WIDTH_SLACK);
      const v = Math.min(twip((snap.get(block.box.x) ?? block.box.x) - from), Math.max(0, room));
      return v >= MIN_INDENT ? Math.round(v / 10) * 10 : 0;
    };
    // 表格前面的空白：一个 1 磅的空段落带着段前距。
    const spacerXml = (before: number | undefined) =>
      before !== undefined && before >= MIN_BEFORE
        ? `<w:p><w:pPr><w:spacing w:before="${before}" w:line="240" w:lineRule="auto"/>` +
          '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>'
        : '';
    interface Place {
      before?: number;
      left: number;
    }
    // 一个块的 XML；maxWidth 是能放的宽（twip）：整页的内容区，或者并排行的一格。
    const leafXml = (
      block: DocLeaf,
      maxWidth: number,
      place: Place,
      fontMaxWidth = maxWidth,
    ): string[] => {
      const { before, left } = place;
      switch (block.kind) {
        case 'paragraph':
          if (block.tab) {
            // 表单的标签和值（D-332）：两列无边框的表，一行一对（制表位在标签比原图长时会跳到下一个制表位、把值挤到下一行）。
            // 标签一列按原图里值的位置（最多六成），值一列占到能放的右边。
            const label = Math.round(Math.min(twip(block.tab), 0.6 * maxWidth));
            const widths = [label, Math.max(200, maxWidth - label)];
            const rows = splitRuns(block.runs ?? [{ text: block.text }], '\n').map((line) => {
              const [label = [], ...rest] = splitRuns(line, '\t');
              const value = rest.flatMap((part, i) => (i ? [{ text: ' ' }, ...part] : part));
              return [label, value].map((t) => paragraphXml(t, block, bodySize));
            });
            return [
              ...(pageBreak() ? [paragraphXml('', {}, bodySize, { pageBreak: true })] : []),
              spacerXml(before),
              layoutTableXml(widths, rows, bodySize),
              blankXml(1),
            ];
          }
          return [
            paragraphXml(block.runs ?? block.text, block, bodySize, {
              ...(block.heading ? { styleId: `Heading${block.heading}` } : {}),
              ...(block.indent ? { indent: twip(block.indent) } : {}),
              ...(before !== undefined ? { before } : block.spaced ? { spaced: true } : {}),
              ...(left ? { left } : {}),
              ...(pageBreak() ? { pageBreak: true } : {}),
            }),
          ];
        case 'list': {
          lists.push(block);
          const numId = lists.length;
          return block.items.map((item, i) =>
            paragraphXml(block.itemRuns?.[i] ?? item, block, bodySize, {
              styleId: 'ListParagraph',
              numId,
              ...(i === 0 && before !== undefined
                ? { before }
                : i === 0 && block.spaced
                  ? { spaced: true }
                  : {}),
              ...(left ? { left } : {}),
              ...(i === 0 && pageBreak() ? { pageBreak: true } : {}),
            }),
          );
        }
        case 'table':
          return [
            ...(pageBreak() ? [paragraphXml('', {}, bodySize, { pageBreak: true })] : []),
            spacerXml(before),
            tableXml(
              block,
              page,
              bodySize,
              maxWidth - left,
              left,
              Math.max(200, fontMaxWidth - left),
            ),
            // 两张表紧挨着时 Word 会把它们并成一张：后面补一个空段落。
            blankXml(1),
          ];
        case 'space':
          return [
            `<w:p><w:pPr><w:spacing w:before="${before ?? 0}" w:after="0" w:line="${Math.max(1, twip(block.box.height))}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`,
          ];
        case 'image': {
          const image = block.src ? images.get(block.src) : undefined;
          if (!image) return [];
          const n = media.length + 1;
          const rid = `rIdImg${n}`;
          // 剪下来的是 JPG；外来的 docx 读进来的图片（D-509）也可能是 PNG、GIF、BMP，按文件开头认。
          const ext = imageExt(image.bytes) ?? 'jpg';
          media.push({ name: `image${n}.${ext}`, rid, bytes: image.bytes });
          if (block.background)
            return [
              imageXml(
                rid,
                n,
                Math.round(PAGE_W * EMU_PER_TWIP),
                Math.round(PAGE_H * EMU_PER_TWIP),
                '<w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>',
                true,
              ),
            ];
          const out = pageBreak() ? [paragraphXml('', {}, bodySize, { pageBreak: true })] : [];
          // 大小按它在原图里占的宽度，放不下时等比缩小。
          let w = (block.box.width / page.width) * PAGE_W;
          let h = (w * image.height) / Math.max(1, image.width);
          const k = Math.min(1, maxWidth / w, (CONTENT_H * 0.9) / h);
          w *= k;
          h *= k;
          const pPr =
            (before !== undefined && before >= MIN_BEFORE
              ? `<w:spacing w:before="${before}"/>`
              : '') + (left ? `<w:ind w:left="${left}"/>` : '');
          out.push(
            imageXml(rid, n, Math.round(w * EMU_PER_TWIP), Math.round(h * EMU_PER_TWIP), pPr),
          );
          return out;
        }
      }
    };
    {
      const dry: Flow = { top: marginPx, bottom: marginPx, height: 0 };
      let gaps = 0;
      let heights = 0;
      for (const block of foreground) {
        const before = beforeOf(block, dry);
        gaps += before ?? 0;
        heights += heightOf(block);
        advance(dry, block);
      }
      if (gaps > 0 && heights + gaps > CONTENT_H && (page.paper || heights < CONTENT_H))
        fit = Math.max(0, (CONTENT_H - heights) / gaps);
    }
    const flow: Flow = { top: marginPx, bottom: marginPx, height: 0 };
    for (const block of foreground) {
      const before = beforeOf(block, flow);
      advance(flow, block);
      if (block.kind !== 'row') {
        body.push(
          ...leafXml(
            block,
            CONTENT_W,
            {
              ...(before !== undefined ? { before } : {}),
              left: leftOf(block, base, CONTENT_W),
            },
            Math.min(CONTENT_W, PAGE_W * TABLE_FONT_PAGE_SHARE),
          ),
        );
        continue;
      }
      // 并排行（D-331）：无边框的排版表格，一行，每格的宽按原图位置，放不下时等比缩小。
      if (pageBreak()) body.push(paragraphXml('', {}, bodySize, { pageBreak: true }));
      body.push(spacerXml(before));
      const widths = fitWidths(
        block.cells.map((c) => twip(c.width)),
        CONTENT_W,
      );
      // 页边距修复只扩展列宽，不顺带放大已经识别好的表格字体。
      const fontWidths = fitWidths(
        block.cells.map((c) => twip(c.width)),
        Math.min(CONTENT_W, PAGE_W * TABLE_FONT_PAGE_SHARE),
      );
      // 最后一栏的原图宽只到文字的右边，不一定是可用空间的右边。
      // 原图单行的左对齐段落、居中标题按导出字号量字宽、加内边距，借用右侧空白；前面的栏不动。
      const last = block.cells.at(-1)!;
      const from = Math.min(...last.blocks.map((b) => b.box.x));
      let needed = widths.at(-1)!;
      for (const b of last.blocks) {
        if (b.kind !== 'paragraph' || b.tab || /[\n\t]/.test(b.text)) continue;
        const centeredHeading = b.heading !== undefined && b.align === 'center';
        if (b.align && b.align !== 'left' && !centeredHeading) continue;
        const size =
          b.size ?? (b.heading ? bodySize * HEADING_SCALE[`Heading${b.heading}`]! : bodySize);
        // 新增的居中标题只放宽可信的一行；不把原本多行的标题拉成一行，原有左对齐路径保持原样。
        if (twip(b.box.height) > (centeredHeading ? 1 : 1.5) * LINE_HEIGHT * size * 20) continue;
        const runs = b.runs ?? [{ text: b.text }];
        const textWidth = runs.reduce(
          // textEm 默认去首尾空白；run 之间的空格也占宽，用两端的字保住它们。
          (sum, r) => sum + (textEm(`|${r.text}|`) - 2 * textEm('|')) * (r.size ?? size) * 20,
          0,
        );
        needed = Math.max(
          needed,
          Math.ceil(
            textWidth * WIDTH_SLACK + 2 * CELL_PAD + twip(b.box.x - from + (b.indent ?? 0)),
          ),
        );
      }
      const spare = Math.max(0, CONTENT_W - widths.reduce((a, b) => a + b, 0));
      widths[widths.length - 1]! += Math.min(spare, needed - widths.at(-1)!);
      // 整行被缩小时，右侧一个不可断开的短标签也要留够字宽和内边距。
      // 只从前一栏可折行的正文借最少的宽度，不扩大页面，也不压缩标题、表格或图片。
      const labels = last.blocks.filter((b) => b.kind === 'paragraph');
      const previousCell = block.cells.at(-2);
      const prose = previousCell?.blocks.filter((b) => b.kind === 'paragraph') ?? [];
      if (
        labels.length > 0 &&
        labels.length === last.blocks.length &&
        labels.every((b) => b.align === 'right' && !b.heading && !b.tab && !/\s/.test(b.text)) &&
        previousCell &&
        prose.length === previousCell.blocks.length &&
        prose.every((b) => !b.heading && !b.tab) &&
        prose.some((b) => /\s/.test(b.text))
      ) {
        const minimum = (b: (typeof labels)[number]) =>
          Math.ceil(longestWordEm(b.text) * (b.size ?? bodySize) * 20 * WIDTH_SLACK + 2 * CELL_PAD);
        const labelWidth = Math.max(...labels.map(minimum));
        const proseWidth = Math.max(...prose.map(minimum));
        if (labelWidth <= CONTENT_W / 5) {
          const borrowed = Math.max(
            0,
            Math.min(labelWidth - widths.at(-1)!, widths[widths.length - 2]! - proseWidth),
          );
          widths[widths.length - 1]! += borrowed;
          widths[widths.length - 2]! -= borrowed;
        }
      }
      // 格子里留一点边距，里面的表格、图片按格子的宽缩小；格子里的位置从这一格的左上角算。
      const cells = block.cells.map((cell, i) => {
        const inner: Flow = { top: block.box.y, bottom: block.box.y, height: 0 };
        const from = Math.min(...cell.blocks.map((b) => b.box.x));
        const max = widths[i]! - 2 * CELL_PAD;
        return cell.blocks
          .flatMap((b) => {
            const before = beforeOf(b, inner);
            advance(inner, b);
            return leafXml(
              b,
              max,
              {
                ...(before !== undefined ? { before } : {}),
                left: leftOf(b, from, max),
              },
              fontWidths[i]! - 2 * CELL_PAD,
            );
          })
          .join('');
      });
      body.push(layoutTableXml(widths, [cells], bodySize), blankXml(1));
    }
    // 锚点寄存在已有正文段落里，不能多添一行把刚好放满的页挤出一个空白尾页。
    const drawings = page.blocks
      .filter((b) => b.kind === 'image' && b.background)
      .flatMap((b) => {
        if (b.kind !== 'image') return [];
        return leafXml(b, CONTENT_W, { left: 0 }).map((xml) =>
          xml.slice(xml.indexOf('<w:r>'), xml.lastIndexOf('</w:p>')),
        );
      })
      .join('');
    if (drawings) {
      const at = body.findIndex((xml, i) => i >= pageStart && xml.includes('</w:p>'));
      if (at >= 0) body[at] = body[at]!.replace('</w:p>', drawings + '</w:p>');
      else
        body.push(
          `<w:p><w:pPr>${pageBreak() ? '<w:pageBreakBefore/>' : ''}<w:spacing w:line="1" w:lineRule="exact"/></w:pPr>${drawings}</w:p>`,
        );
    }
  });
  const documentXml =
    `${HEAD}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:body>${body.join('')}` +
    sectionXml(doc.pages.at(-1)) +
    '</w:body></w:document>';
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="jpg" ContentType="image/jpeg"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="gif" ContentType="image/gif"/>' +
        '<Default Extension="bmp" ContentType="image/bmp"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rId3" Type="${R_NS}/fontTable" Target="fontTable.xml"/>` +
        media
          .map((m) => `<Relationship Id="${m.rid}" Type="${R_NS}/image" Target="media/${m.name}"/>`)
          .join('') +
        '</Relationships>',
    ),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml(docSize)),
    'word/numbering.xml': strToU8(numberingXml(lists)),
    'word/fontTable.xml': strToU8(fontTableXml()),
    ...Object.fromEntries(media.map((m) => [`word/media/${m.name}`, [m.bytes, { level: 0 }]])),
  };
  return zipSync(files, { level: 6 });
}
