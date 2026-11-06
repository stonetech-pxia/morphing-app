import {
  A4_WIDTH_PT,
  leafBlocks,
  type DocBlock,
  type DocDoc,
  type DocLeaf,
  type DocList,
  type DocPage,
  type DocParagraph,
  type DocRun,
} from '@morph/tool-office';

// 桌上的 Word 整页直接改（D-465，创始人 2026-11-06：「可以自由在文档里面移动光标……就像截图里的一样
// （CamScanner），而不是被一个框限制住，同时还可以变换字体大小，加粗，下划线，斜体」）：
// 每页是网页里一张可编辑的纸（contenteditable），块按原件的位置排（D-464），
// 光标能在整页里随便放、选中跨段的字。每改一下，页面里的脚本把每一块的样子交回来（EditedPage，按 ref 对回原来的块），
// 由 mergeEdited 合回 DocDoc。页面是我们自己生成的固定 HTML，不联网、不加载别的地址。

/** 字号按原件占页宽的比例（D-464，和 CamScanner 一样）；太小时不小于这么多点。 */
const MIN_PX = 7;

/** 字号（磅）在宽 pageWidth 点的一页上画多大（点）。 */
const fontPx = (size: number, pageWidth: number) =>
  Math.max(MIN_PX, Math.round((size * pageWidth) / A4_WIDTH_PT));

/** 段落、列表整块的字画多大（点）：识别出字号的标题照它的大小（D-463）；没有字号时（旧的结果）照旧放大。 */
function blockFontPx(block: DocLeaf, page: DocPage, pageWidth: number): number {
  const px = fontPx(('size' in block ? block.size : undefined) ?? page.bodySize, pageWidth);
  if (block.kind === 'paragraph' && block.heading && !block.size) {
    return Math.max(px, block.heading === 1 ? 22 : 18);
  }
  return px;
}

/** 纸上的字是深色（纸是白的，不跟着主题）。 */
const INK = '#1A1A1A';
/** 第一块离纸的上边最多这么多点（原件的上边空白）。 */
const TOP_MAX = 40;
/** 块的上下边界重叠时（位置用不了）块之间空这么多点。 */
const PLAIN_GAP = 6;
/** 编辑页两边至少留这么多点（原件的左边空白太小时）。 */
const SIDE_MIN = 8;

/** 一整块（不分截时）画成的样子：编辑页交回来和它一样的不写进 runs。 */
export function blockBase(block: DocParagraph | DocList, page: DocPage, pageWidth: number) {
  return {
    size: blockFontPx(block, page, pageWidth) / ptPx(pageWidth),
    docSize: block.size ?? page.bodySize,
    bold: !!(block.bold || (block.kind === 'paragraph' && block.heading)),
    italic: !!block.italic,
    underline: !!block.underline,
  };
}

/** 编辑页宽 width 点时，纸有多宽（两边各空 10 点）。 */
export const paperWidth = (width: number) => width - 20;

/** 1 磅在宽 pageWidth 点的一页上是多少点（按 A4 的宽换算）。 */
const ptPx = (pageWidth: number) => pageWidth / A4_WIDTH_PT;

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textHtml = (s: string) => escape(s).replace(/\n/g, '<br>');

/** 一截字：粗体、斜体、下划线写成标签，字号和整块不同时写成 span（页面里的脚本按同样的写法读回来）。 */
function runsHtml(
  runs: readonly DocRun[],
  base: { bold: boolean; italic: boolean; underline: boolean; docSize: number },
  px: number,
  pageWidth: number,
): string {
  return runs
    .map((run) => {
      let html = textHtml(run.text);
      if (run.underline ?? base.underline) html = `<u>${html}</u>`;
      if (run.italic ?? base.italic) html = `<i>${html}</i>`;
      if (run.bold ?? base.bold) html = `<b>${html}</b>`;
      if (run.size !== undefined) {
        // 比整段大几磅就画大几磅（整段按整点画，和文档里的字号差一点，读回来时按差多少算，见 mergeEdited）。
        const own = Math.round((px + (run.size - base.docSize) * ptPx(pageWidth)) * 10) / 10;
        if (own !== px) html = `<span style="font-size:${own}px">${html}</span>`;
      }
      return html;
    })
    .join('');
}

/** 空段落里放一个换行，光标才放得进去。 */
const orBreak = (html: string) => html || '<br>';

function leafHtml(
  block: DocLeaf,
  ref: string,
  page: DocPage,
  pageWidth: number,
  k: number,
  place: { top: number; left: number },
  images: Readonly<Record<string, string>>,
  listClass: (block: DocList) => string,
): string {
  const margin = `margin-top:${place.top}px;margin-left:${place.left}px`;
  switch (block.kind) {
    case 'paragraph': {
      const px = blockFontPx(block, page, pageWidth);
      const base = blockBase(block, page, pageWidth);
      const style = [
        margin,
        `font-size:${px}px`,
        ...(block.color ? [`color:#${block.color}`] : []),
        ...(block.align && block.align !== 'left' ? [`text-align:${block.align}`] : []),
        // 表单的标签和值（D-332）：值从原图里的位置开始。
        ...(block.tab ? [`tab-size:${Math.round(block.tab * k)}px`] : []),
      ].join(';');
      const html = runsHtml(block.runs ?? [{ text: block.text }], base, px, pageWidth);
      return `<p data-ref="${ref}" style="${style}">${orBreak(html)}</p>`;
    }
    case 'list': {
      const px = blockFontPx(block, page, pageWidth);
      const base = blockBase(block, page, pageWidth);
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items
        .map(
          (item, i) =>
            `<li>${orBreak(runsHtml(block.itemRuns?.[i] ?? [{ text: item }], base, px, pageWidth))}</li>`,
        )
        .join('');
      const color = block.color ? `;color:#${block.color}` : '';
      const start = block.ordered ? `;counter-reset:n ${(block.start ?? 1) - 1}` : '';
      return `<${tag} data-ref="${ref}" class="${listClass(block)}" style="${margin};font-size:${px}px${color}${start}">${items}</${tag}>`;
    }
    case 'table': {
      const { table, colWidths } = block;
      const total = colWidths.reduce((a, b) => a + b, 0) || 1;
      const px = fontPx(block.size ?? page.bodySize, pageWidth);
      const rows = Array.from({ length: table.rows }, (_, r) => {
        const cells = table.cells
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => c.row === r)
          .map(({ c, i }) => {
            const w =
              (colWidths.slice(c.col, c.col + c.colSpan).reduce((a, b) => a + b, 0) / total) * 100;
            const span =
              (c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '') +
              (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '');
            const align = c.align && c.align !== 'left' ? `;text-align:${c.align}` : '';
            return `<td data-i="${i}"${span} style="width:${w.toFixed(2)}%${align}">${orBreak(textHtml(c.text))}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table data-ref="${ref}" style="margin-top:${place.top}px;font-size:${px}px"><tbody>${rows}</tbody></table>`;
    }
    case 'image': {
      // 按原来占页宽的比例。图片不能在页面上改，只能连同它所在的地方一起删掉。
      const width = Math.min(100, (block.box.width / page.width) * 100);
      const src = block.src ? images[block.src] : undefined;
      const inner = src
        ? `<img src="${src}" style="width:100%">`
        : `<div class="noimg" style="aspect-ratio:${block.box.width}/${Math.max(1, block.box.height)}"></div>`;
      return `<div data-ref="${ref}" data-kind="image" contenteditable="false" style="${margin};width:${width.toFixed(2)}%">${inner}</div>`;
    }
  }
}

/** 一块离上一块多远（点）：按原图里空着的高度；重叠时空一点。 */
function gapOf(block: DocBlock, previous: DocBlock | undefined, k: number, top: number): number {
  if (!previous) return Math.min(TOP_MAX, Math.max(0, (block.box.y - top) * k));
  const bottom = previous.box.y + previous.box.height;
  return Math.round(block.box.y >= bottom ? (block.box.y - bottom) * k : PLAIN_GAP);
}

const leftAligned = (block: DocLeaf) =>
  block.kind === 'image' ||
  block.kind === 'list' ||
  (block.kind === 'paragraph' && !block.tab && (!block.align || block.align === 'left'));

/** 整份文档的编辑页（一个完整的 HTML）：width 是网页的宽（点），images 是图片块的 src → data: 地址。 */
export function wordPageHtml(
  doc: DocDoc,
  width: number,
  images: Readonly<Record<string, string>> = {},
): string {
  const lists: string[] = [];
  const listClass = (block: DocList) => {
    if (!block.ordered) return '';
    // 编号的写法（「%1.」「%1、」「(%1)」）：每个列表一条 CSS，回车新加的项跟着这个列表编号。
    const [pre = '', post = ''] = (block.format ?? '%1.').split('%1');
    const name = `l${lists.length}`;
    lists.push(
      `.${name}>li::before{content:"${escape(pre)}" counter(n) "${escape(post)}"}`.replace(
        /&quot;/g,
        '\\"',
      ),
    );
    return name;
  };
  // 纸的宽；纸里两边留出原件的空白（不小于 SIDE_MIN）。
  const pageWidth = paperWidth(width);
  const pages = doc.pages
    .map((page, p) => {
      const k = pageWidth / Math.max(1, page.width);
      const leaves = leafBlocks(page);
      const minX = Math.min(...leaves.map((b) => b.box.x), page.width);
      const side = Math.max(SIDE_MIN, Math.round(minX * k));
      const top = Math.min(...page.blocks.map((b) => b.box.y), page.height);
      const inner = pageWidth - 2 * side;
      const place = (block: DocLeaf, gap: number) => ({
        top: gap,
        left: leftAligned(block)
          ? Math.round(
              Math.max(0, Math.min((block.box.x - minX) * k, inner - block.box.width * k * 1.1)),
            )
          : 0,
      });
      const blocks = page.blocks
        .map((block, b) => {
          const gap = gapOf(block, page.blocks[b - 1], k, top);
          if (block.kind !== 'row') {
            return leafHtml(
              block,
              `${p}-${b}`,
              page,
              pageWidth,
              k,
              place(block, gap),
              images,
              listClass,
            );
          }
          const total = block.cells.reduce((a, c) => a + c.width, 0) || 1;
          const cells = block.cells
            .map((cell, c) => {
              const items = cell.blocks
                .map((leaf, i) =>
                  leafHtml(
                    leaf,
                    `${p}-${b}-${c}-${i}`,
                    page,
                    pageWidth,
                    k,
                    { top: 0, left: 0 },
                    images,
                    listClass,
                  ),
                )
                .join('');
              return `<div class="cell" style="width:${((cell.width / total) * 100).toFixed(2)}%">${items || '<p><br></p>'}</div>`;
            })
            .join('');
          return `<div data-ref="${p}-${b}" data-kind="row" style="margin-top:${gap}px">${cells}</div>`;
        })
        .join('');
      return `<div class="paper" contenteditable="true" data-page="${p}" style="padding:16px ${side}px 24px">${blocks || '<p><br></p>'}</div>`;
    })
    .join('');
  const config = JSON.stringify({ ptPx: ptPx(pageWidth) });
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;background:transparent;-webkit-text-size-adjust:100%}
body{padding:10px;font-family:-apple-system,"Helvetica Neue",Roboto,sans-serif;-webkit-user-select:text;user-select:text}
.paper{background:#fff;color:${INK};border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.12);margin-bottom:24px;outline:none;line-height:1.3;word-wrap:break-word;caret-color:#0B8F7A}
.paper p{margin:0;white-space:pre-wrap;min-height:1em}
.paper ol,.paper ul{margin:0;padding-left:1.8em}
.paper ol{list-style:none}
.paper ol>li{counter-increment:n;position:relative}
.paper ol>li::before{position:absolute;right:100%;margin-right:.35em;white-space:nowrap}
.paper table{border-collapse:collapse;width:100%;table-layout:fixed}
.paper td{border:1px solid #9A9A9A;padding:3px;vertical-align:top;white-space:pre-wrap;word-break:break-word}
[data-kind=row]{display:flex;align-items:flex-start}
.cell{padding-right:6px;box-sizing:border-box}
.noimg{width:100%;background:#EEE}
${lists.join('\n')}
</style></head><body>${pages}
<script>window.WORD=${config};${WORD_PAGE_SCRIPT}</script></body></html>`;
}

/**
 * 页面里的脚本：把每一块读回来交给 App（EditedPage），执行工具栏的命令（加粗、斜体、下划线、字号、对齐），
 * 光标在哪里、选中的字是什么样式也告诉 App（工具栏按钮亮不亮、要不要显示表格的操作）。
 * 读样式只看标签和写在元素上的 style（不看算出来的样式），离谁近听谁的。
 */
export const WORD_PAGE_SCRIPT = String.raw`
(function () {
  var PT = (window.WORD && window.WORD.ptPx) || 1;
  function send(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

  function weight(el) {
    if (el.tagName === 'B' || el.tagName === 'STRONG') return true;
    var w = el.style && el.style.fontWeight;
    if (!w) return null;
    if (w === 'bold' || w === 'bolder') return true;
    if (w === 'normal' || w === 'lighter') return false;
    var n = parseInt(w, 10);
    return isNaN(n) ? null : n >= 600;
  }
  function slant(el) {
    if (el.tagName === 'I' || el.tagName === 'EM') return true;
    var s = el.style && el.style.fontStyle;
    if (!s) return null;
    return s === 'italic' || s === 'oblique';
  }
  function line(el) {
    if (el.tagName === 'U') return true;
    var d = el.style && (el.style.textDecorationLine || el.style.textDecoration);
    if (!d) return null;
    return d.indexOf('underline') >= 0 ? true : d.indexOf('none') >= 0 ? false : null;
  }
  function px(el) {
    var s = el.style && el.style.fontSize;
    if (!s || s.slice(-2) !== 'px') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function nearest(el, stop, read, fallback) {
    for (var e = el; e; e = e.parentElement) {
      var v = read(e);
      if (v !== null) return v;
      if (e === stop) break;
    }
    return fallback;
  }
  function styleAt(el, stop) {
    return {
      size: Math.round((nearest(el, stop, px, 11 * PT) / PT) * 100) / 100,
      bold: nearest(el, stop, weight, false),
      italic: nearest(el, stop, slant, false),
      underline: nearest(el, stop, line, false),
    };
  }
  function same(a, b) {
    return a.size === b.size && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;
  }
  function runs(block, stop) {
    var out = [];
    stop = stop || block;
    function push(text, el) {
      if (!text) return;
      var st = styleAt(el, stop);
      var last = out[out.length - 1];
      if (last && same(last, st)) { last.text += text; return; }
      st.text = text;
      out.push(st);
    }
    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) push(c.data.replace(/​/g, '').replace(/ /g, ' '), node);
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') push('\n', node);
          else if (c.getAttribute('contenteditable') === 'false') continue;
          else {
            // 段落里又出现的块（粘贴进来的）：前面换一行。
            var blockish = /^(P|DIV|LI|H[1-6])$/.test(c.tagName);
            if (blockish && out.length && !/\n$/.test(out[out.length - 1].text)) push('\n', node);
            walk(c);
          }
        }
      }
    }
    walk(block);
    // 浏览器在段落末尾放的换行（让空段落、最后一行能放光标）不算字。
    var last = out[out.length - 1];
    if (last && /\n$/.test(last.text)) {
      last.text = last.text.slice(0, -1);
      if (!last.text) out.pop();
    }
    return out;
  }
  function text(el) {
    return runs(el).map(function (r) { return r.text; }).join('');
  }
  function alignOf(el) {
    var a = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
    return a === 'center' || a === 'right' ? a : 'left';
  }
  function leaf(el) {
    var ref = el.getAttribute && el.getAttribute('data-ref');
    var kind = el.getAttribute && el.getAttribute('data-kind');
    if (kind === 'image') return { kind: 'image', ref: ref };
    if (el.tagName === 'TABLE') {
      var cells = [];
      var tds = el.querySelectorAll('td[data-i]');
      for (var i = 0; i < tds.length; i++) cells.push({ i: Number(tds[i].getAttribute('data-i')), text: text(tds[i]) });
      return { kind: 'table', ref: ref, cells: cells };
    }
    if (el.tagName === 'OL' || el.tagName === 'UL') {
      var items = [];
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) items.push(runs(c, el));
      return { kind: 'list', ref: ref || undefined, items: items };
    }
    return { kind: 'paragraph', ref: ref || undefined, runs: runs(el), align: alignOf(el) };
  }
  function blocksOf(container) {
    var out = [];
    var loose = null;
    for (var c = container.firstChild; c; c = c.nextSibling) {
      // 直接打在纸上、不在任何段落里的字：接成一段。
      if (c.nodeType === 3 || (c.nodeType === 1 && /^(SPAN|B|I|U|FONT|BR|STRONG|EM)$/.test(c.tagName))) {
        if (!loose) { loose = document.createElement('p'); }
        loose.appendChild(c.cloneNode(true));
        continue;
      }
      if (loose) { out.push(leaf(loose)); loose = null; }
      if (c.nodeType !== 1) continue;
      if (c.getAttribute('data-kind') === 'row') {
        var cells = [];
        for (var cell = c.firstElementChild; cell; cell = cell.nextElementSibling) cells.push(blocksOf(cell));
        out.push({ kind: 'row', ref: c.getAttribute('data-ref'), cells: cells });
      } else out.push(leaf(c));
    }
    if (loose) out.push(leaf(loose));
    return out;
  }
  function pages() {
    var list = document.querySelectorAll('.paper');
    var out = [];
    for (var i = 0; i < list.length; i++) out.push({ blocks: blocksOf(list[i]) });
    return out;
  }
  window.__wordPages = pages;
  function post() { send({ type: 'doc', pages: pages() }); }

  function blockOf(node) {
    for (var e = node.nodeType === 1 ? node : node.parentElement; e; e = e.parentElement) {
      if (e.classList && e.classList.contains('paper')) return null;
      if (/^(P|LI|TD|DIV)$/.test(e.tagName) && !e.classList.contains('cell')) return e;
    }
    return null;
  }
  function bump(el, d) {
    var now = px(el);
    if (now === null) return;
    el.style.fontSize = Math.max(4, Math.round((now + d * PT) * 10) / 10) + 'px';
  }
  function size(d) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) {
      // 没选中字：整段变大、变小。
      var b = blockOf(range.startContainer);
      if (!b) return;
      var target = b.tagName === 'LI' ? b.parentElement : b;
      if (px(target) === null) target.style.fontSize = parseFloat(getComputedStyle(target).fontSize) + 'px';
      bump(target, d);
      var inner = target.querySelectorAll('[style*="font-size"]');
      for (var i = 0; i < inner.length; i++) bump(inner[i], d);
      return;
    }
    // 选中了字：每一截字按它现在的大小各自变大、变小（不用浏览器的 fontSize 命令：WebKit 会拿掉段落自己的字号，
    // 而且只有 1–7 七档）。先在选区的两头把字切开，再把选区里的每一截字包进写明字号的 span。
    var sc = range.startContainer, so = range.startOffset, ec = range.endContainer, eo = range.endOffset;
    if (ec.nodeType === 3 && eo < ec.length) ec.splitText(eo);
    if (sc.nodeType === 3 && so > 0) {
      var rest = sc.splitText(so);
      if (ec === sc) ec = rest;
      sc = rest;
    }
    var r2 = document.createRange();
    if (sc.nodeType === 3) r2.setStartBefore(sc); else r2.setStart(sc, so);
    if (ec.nodeType === 3) r2.setEndAfter(ec); else r2.setEnd(ec, eo);
    var root = r2.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentNode;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var texts = [];
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.data && r2.intersectsNode(n)) texts.push(n);
    }
    var first = null, last = null;
    for (var j = 0; j < texts.length; j++) {
      var t = texts[j];
      var now = parseFloat(getComputedStyle(t.parentElement).fontSize);
      var span = document.createElement('span');
      span.style.fontSize = Math.max(4, Math.round((now + d * PT) * 10) / 10) + 'px';
      t.parentNode.insertBefore(span, t);
      span.appendChild(t);
      if (!first) first = span;
      last = span;
    }
    if (first) {
      var r = document.createRange();
      r.setStartBefore(first);
      r.setEndAfter(last);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
  window.__wordCommand = function (name) {
    if (name === 'bigger') size(1);
    else if (name === 'smaller') size(-1);
    else if (name === 'left') document.execCommand('justifyLeft');
    else if (name === 'center') document.execCommand('justifyCenter');
    else if (name === 'right') document.execCommand('justifyRight');
    else if (name === 'blur') { if (document.activeElement) document.activeElement.blur(); return; }
    else document.execCommand(name);
    post();
    state();
  };

  function state() {
    var sel = window.getSelection();
    var node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var paper = el && el.closest ? el.closest('.paper') : null;
    if (!paper || document.activeElement !== paper) { send({ type: 'state', focus: false }); return; }
    var td = el.closest('td[data-i]');
    var table = td && td.closest('table[data-ref]');
    var b = blockOf(node);
    send({
      type: 'state',
      focus: true,
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      align: b ? alignOf(b.tagName === 'LI' ? b.parentElement : b) : 'left',
      cell: table ? { ref: table.getAttribute('data-ref'), i: Number(td.getAttribute('data-i')) } : null,
    });
  }
  document.addEventListener('input', post);
  document.addEventListener('selectionchange', state);
  document.addEventListener('focusin', state);
  document.addEventListener('focusout', function () { setTimeout(state, 0); });
})();
`;

/** 图片的字节 → data: 地址（编辑页不读文件，图片直接写进页面）。 */
export function jpegDataUrl(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += chars[a >> 2]! + chars[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : chars[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : chars[c & 63]!;
  }
  return `data:image/jpeg;base64,${out}`;
}
