import { strToU8, zipSync, type Zippable } from 'fflate';

import type { DocBlock, DocDoc, DocList, DocPage, DocParagraph, DocStyle, DocTable } from './doc';
import { cleanXmlText } from './xlsx';

// 写 docx（D-310）：自己写最少的 OOXML，用 fflate 的同步 API 打包（和写 xlsx 一样，D-272）。
// 无衬线的默认字体（D-312），段落（标题用加粗的 Heading1 / Heading2 样式，首行缩进）、run 的粗体 / 颜色 / 字号、编号列表（numbering.xml）、
// 表格（gridSpan / vMerge 合并）、图片（内嵌 JPG）。A4 纵向，每页原图之间分页。

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A4（twip，1/20 磅）和页边距（2 厘米）。 */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1134;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const CONTENT_H = PAGE_H - 2 * MARGIN;
/** 1 twip = 635 EMU。 */
const EMU_PER_TWIP = 635;
/** 分段的空隙写成段前间距（twip）。 */
const SPACED_BEFORE = 160;

/**
 * 默认字体（D-312）：无衬线，和 CamScanner 一样。西文 Arial，中文微软雅黑（Windows 和 Mac 版 Office 都带）；
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

/** 一段文字的 run：换行写成 <w:br/>，前后的空格保留。 */
function runXml(text: string, style: DocStyle, bodySize: number): string {
  const props =
    RUN_FONTS +
    (style.bold ? '<w:b/><w:bCs/>' : '') +
    (style.color ? `<w:color w:val="${style.color}"/>` : '') +
    (style.size && style.size !== bodySize
      ? `<w:sz w:val="${Math.round(style.size * 2)}"/><w:szCs w:val="${Math.round(style.size * 2)}"/>`
      : '');
  const rPr = `<w:rPr>${props}</w:rPr>`;
  return text
    .split('\n')
    .map(
      (part, i) =>
        `<w:r>${rPr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`,
    )
    .join('');
}

function paragraphXml(
  text: string,
  style: DocStyle,
  bodySize: number,
  extra: {
    styleId?: string;
    spaced?: boolean;
    numId?: number;
    pageBreak?: boolean;
    /** 首行缩进（twip）。 */
    indent?: number;
  } = {},
): string {
  const pPr =
    (extra.styleId ? `<w:pStyle w:val="${extra.styleId}"/>` : '') +
    (extra.pageBreak ? '<w:pageBreakBefore/>' : '') +
    (extra.numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${extra.numId}"/></w:numPr>` : '') +
    (extra.spaced ? `<w:spacing w:before="${SPACED_BEFORE}"/>` : '') +
    (extra.indent ? `<w:ind w:firstLine="${extra.indent}"/>` : '') +
    (style.align && style.align !== 'left'
      ? `<w:jc w:val="${style.align === 'center' ? 'center' : 'right'}"/>`
      : '');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runXml(text, style, bodySize)}</w:p>`;
}

/** 原图像素 → twip：整页宽度按 A4 宽算，放不下时按内容区等比缩小。 */
function tableXml(block: DocTable, page: DocPage, bodySize: number): string {
  const { table, colWidths } = block;
  const raw = colWidths.map((w) => (w / page.width) * PAGE_W);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const k = Math.min(1, CONTENT_W / total);
  const widths = raw.map((w) => Math.max(200, Math.round(w * k)));
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
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`);
        c++;
        continue;
      }
      const span = Math.max(1, Math.min(cell.colSpan, table.cols - c));
      const w = widths.slice(c, c + span).reduce((a, b) => a + b, 0);
      const first = cell.row === r;
      const tcPr =
        `<w:tcW w:w="${w}" w:type="dxa"/>` +
        (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') +
        (cell.rowSpan > 1 ? (first ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '');
      const style = cell.align ? { align: cell.align } : {};
      const body = first
        ? cell.text
            .split('\n')
            .map((line) => paragraphXml(line, style, bodySize))
            .join('')
        : '<w:p/>';
      cells.push(`<w:tc><w:tcPr>${tcPr}</w:tcPr>${body || '<w:p/>'}</w:tc>`);
      c += span;
    }
    rows.push(`<w:tr>${cells.join('')}</w:tr>`);
  }
  const border = (side: string) =>
    `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') +
    '</w:tblBorders></w:tblPr><w:tblGrid>' +
    widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    `</w:tblGrid>${rows.join('')}</w:tbl>`
  );
}

function imageXml(rid: string, id: number, cx: number, cy: number): string {
  return (
    '<w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
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
    heading('Heading1', 'heading 1', Math.round(sz * 1.6)) +
    heading('Heading2', 'heading 2', Math.round(sz * 1.3)) +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
    '<w:basedOn w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
    '<w:tblPr><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>'
  );
}

/**
 * 写 docx。images 按图片块的 src 给剪好的图片字节；没有的图片块跳过。
 * 整篇的正文字号用第一页的（每页的正文字号差不多，单独不同的段落写自己的字号）。
 */
export function writeDocx(
  doc: DocDoc,
  images: ReadonlyMap<string, DocxImage> = new Map(),
): Uint8Array {
  const bodySize = doc.pages[0]?.bodySize ?? 11;
  const lists: DocList[] = [];
  const media: { name: string; rid: string; bytes: Uint8Array }[] = [];
  const body: string[] = [];
  doc.pages.forEach((page, p) => {
    let first = p > 0;
    const pageBreak = () => {
      const b = first;
      first = false;
      return b;
    };
    page.blocks.forEach((block: DocBlock) => {
      switch (block.kind) {
        case 'paragraph': {
          const para = block as DocParagraph;
          body.push(
            paragraphXml(para.text, para, bodySize, {
              ...(para.heading ? { styleId: `Heading${para.heading}` } : {}),
              ...(para.indent ? { indent: Math.round((para.indent / page.width) * PAGE_W) } : {}),
              ...(para.spaced ? { spaced: true } : {}),
              ...(pageBreak() ? { pageBreak: true } : {}),
            }),
          );
          break;
        }
        case 'list': {
          lists.push(block);
          const numId = lists.length;
          block.items.forEach((item, i) =>
            body.push(
              paragraphXml(item, block, bodySize, {
                styleId: 'ListParagraph',
                numId,
                ...(i === 0 && block.spaced ? { spaced: true } : {}),
                ...(i === 0 && pageBreak() ? { pageBreak: true } : {}),
              }),
            ),
          );
          break;
        }
        case 'table':
          if (pageBreak()) body.push(paragraphXml('', {}, bodySize, { pageBreak: true }));
          body.push(tableXml(block, page, bodySize));
          // 两张表紧挨着时 Word 会把它们并成一张：后面补一个空段落。
          body.push('<w:p/>');
          break;
        case 'image': {
          const image = block.src ? images.get(block.src) : undefined;
          if (!image) break;
          if (pageBreak()) body.push(paragraphXml('', {}, bodySize, { pageBreak: true }));
          const n = media.length + 1;
          const rid = `rIdImg${n}`;
          media.push({ name: `image${n}.jpg`, rid, bytes: image.bytes });
          // 大小按它在原图里占的宽度，放不下时等比缩小。
          let w = (block.box.width / page.width) * PAGE_W;
          let h = (w * image.height) / Math.max(1, image.width);
          const k = Math.min(1, CONTENT_W / w, (CONTENT_H * 0.9) / h);
          w *= k;
          h *= k;
          body.push(imageXml(rid, n, Math.round(w * EMU_PER_TWIP), Math.round(h * EMU_PER_TWIP)));
          break;
        }
      }
    });
  });
  const documentXml =
    `${HEAD}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:body>${body.join('')}` +
    `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/>` +
    '</w:sectPr></w:body></w:document>';
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="jpg" ContentType="image/jpeg"/>' +
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
    'word/styles.xml': strToU8(stylesXml(bodySize)),
    'word/numbering.xml': strToU8(numberingXml(lists)),
    'word/fontTable.xml': strToU8(fontTableXml()),
    ...Object.fromEntries(media.map((m) => [`word/media/${m.name}`, [m.bytes, { level: 0 }]])),
  };
  return zipSync(files, { level: 6 });
}
