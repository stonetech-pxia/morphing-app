// text-flow 套件：段落、分栏和阅读顺序、标题、列表。
import {
  aligned,
  apart,
  custom,
  firstLineIndent,
  flowing,
  images,
  leaves,
  norm,
  notInRow,
  order,
  sideBySide,
  table,
  times,
  together,
} from '../lib/checks';
import type { Case } from '../lib/case';

/** 原始 PDF 里的图留在它那一栏里、图注之前（不被挪到并排行外面、整页最后）。 */
const figureInColumn = (caption: string) =>
  custom(`the figure stays in its column before ${JSON.stringify(caption)}`, (c) => {
    const ls = leaves(c.doc);
    const img = ls.findIndex((l) => l.leaf.kind === 'image' && !l.leaf.background);
    const cap = ls.findIndex(
      (l) => l.leaf.kind === 'paragraph' && norm(l.leaf.text).includes(norm(caption)),
    );
    if (img < 0 || cap < 0) return img < 0 ? 'no image' : 'no caption';
    const [i, k] = [ls[img]!, ls[cap]!];
    if (!i.row) return 'image is outside the side-by-side row';
    if (i.row.block !== k.row?.block || i.row.cell !== k.row.cell)
      return 'not in the caption column';
    return img < cap ? null : 'image comes after its caption';
  });

export const TEXT_FLOW: Case[] = [
  {
    id: 'two-column-prose',
    suite: 'text-flow',
    fix: 'b29d8d16',
    what: 'Two-column article under a full-width title: the left column is read before the right one.',
    checks: [
      order('Left column starts here', 'end of the left column', 'Right column starts here'),
      apart('end of the left column', 'Right column starts here'),
      together('Left column starts here', 'end of the left column'),
    ],
  },
  {
    id: 'academic-columns',
    suite: 'text-flow',
    fix: '039c4f36 D-528; 0bbb0c6f D-529',
    what: 'Two-column paper: isolated left-column paragraphs and their trailing "payment." lines fell out of the column scope or became separate paragraphs, and the wrapped reference range "pp. 12-" / "18." became a numbered item.',
    checks: [
      sideBySide('The service begins on 15 October', '2 Results'),
      notInRow('Elena Martin'),
      custom('each complete left-column paragraph is one paragraph', (c) => {
        const n = c.paras.filter(
          (p) =>
            norm(p.text).includes(norm('The service begins on 15 October')) &&
            norm(p.text).includes(norm('must appear on every payment')),
        ).length;
        return n >= 4 ? null : `${n} of 4 paragraphs hold both their first and last line`;
      }),
      together('Document analysis', 'pp. 12-18.'),
      flowing('pp. 12-18.'),
      custom('no paragraph is just "18."', (c) =>
        c.paras.some((p) => p.text.trim() === '18.') ? 'found a "18." paragraph' : null,
      ),
    ],
  },
  {
    id: 'side-by-side-blocks',
    suite: 'text-flow',
    fix: '3a582e41 D-331',
    what: 'An address block beside a date block, and three small tables side by side, were stacked in one column.',
    lang: 'fra',
    checks: [
      sideBySide('Verger des Collines', 'Vienne, le 4 avril 2026'),
      sideBySide('Reinette', 'Septembre'),
      sideBySide('Septembre', 'Condrieu'),
      table({ containing: ['Variété', 'Gala'], rows: 4, cols: 2 }),
      table({ containing: ['Marché', 'Condrieu'], rows: 4, cols: 2 }),
      notInRow('La récolte a commencé'),
    ],
  },
  {
    id: 'two-column-sections',
    suite: 'text-flow',
    fix: '5f61ae5e D-473 ⑦; 039c4f36 D-528',
    what: 'Two-column report whose section headings line up across the columns: the bands became several stacked two-column rows, so reading alternated left/right section by section (D-473 merged some of them; the whole page reads column by column since D-528).',
    checks: [
      order(
        'Left column opens here',
        'Bank erosion',
        'The left column closes here',
        'Right column opens here',
        'Water quality',
        'The right column closes here',
      ),
      sideBySide('Left column opens here', 'Right column opens here'),
      sideBySide('The left column closes here', 'Right column opens here'),
    ],
  },
  {
    id: 'receipt-one-region',
    suite: 'text-flow',
    fix: 'bf491a83 D-471 ④⑤',
    what: 'Scanned receipt that the layout model sees as one large text region: top and bottom were joined and the order scrambled; the amounts "7.29" / "-7.29" under the barcode were taken as list numbers.',
    lang: 'fra',
    checks: [
      order('EPICERIE DU PORT', 'Pain de campagne', 'TOTAL EUR', '7.29', 'Merci de votre visite'),
      apart('EPICERIE DU PORT', 'Merci de votre visite'),
      custom('"7.29" is not a list item', (c) =>
        leaves(c.doc).some((l) => l.leaf.kind === 'list' && l.leaf.items.join(' ').includes('7.29'))
          ? 'in a list'
          : null,
      ),
      custom('"7.29" and "-7.29" are written out', (c) => {
        const all = c.paras.map((p) => p.text).join('\n');
        return /(^|[^-\d])7\.29/.test(all) && all.includes('-7.29') ? null : 'missing';
      }),
    ],
  },
  {
    id: 'columns-with-figure',
    suite: 'text-flow',
    fix: 'b29d8d16, c5ac5a4e D-535',
    what: 'Two-column page with a native vector chart in the right column: isolating the figure re-arranged the whole page from leaf blocks and lost the column reading order.',
    checks: [
      order(
        'Rural libraries open fewer hours',
        'The left column ends with this sentence',
        'The right column begins',
        'Figure 1. Visits per quarter',
        'The right column ends with this sentence',
      ),
      sideBySide('Rural libraries open fewer hours', 'The right column begins'),
      sideBySide('Winter brings the most visitors', 'Summer is the quietest season'),
      images({ min: 1, max: 1 }),
      figureInColumn('Figure 1. Visits per quarter'),
    ],
  },
  {
    id: 'first-line-indent',
    suite: 'text-flow',
    fix: '440f8d12 D-330',
    what: 'Book page whose paragraphs start with a first-line indent: the indent was dropped.',
    checks: [
      firstLineIndent('The ferry left the harbour'),
      firstLineIndent('Her brother had promised'),
      firstLineIndent('When the island finally appeared'),
      apart('The ferry left the harbour', 'Her brother had promised'),
    ],
  },
  {
    id: 'ragged-right',
    suite: 'text-flow',
    fix: '5f61ae5e D-473 ②; 0bbb0c6f D-529',
    what: 'Left-aligned prose with a ragged right edge: a line that stopped short only because the next (long) word did not fit ended the paragraph (D-473), and the first line, outside the layout region, stayed apart (D-529); short label rows stay one per paragraph.',
    checks: [
      together('common pastures', 'Gemeindeweidenutzungsordnungsakten'),
      together('Ragged paragraph begins here', 'Ragged paragraph ends here'),
      flowing('Ragged paragraph begins here'),
      apart('Ragged paragraph ends here', 'A second paragraph follows'),
      apart('Signed at', 'Mayor of the commune'),
      apart('Mayor of the commune', 'Date'),
    ],
  },
  {
    id: 'centered-letterhead',
    suite: 'text-flow',
    fix: '0fcb9def D-463',
    what: 'Letterhead of centered lines (centres aligned, left edges not) was joined into one wrapped paragraph.',
    checks: [
      apart('Dr. med. Lena Hartmann', 'Lindenstraße 14'),
      apart('Lindenstraße 14', 'Telefon 0761'),
      apart('Telefon 0761', 'Sprechzeiten'),
      aligned('Lindenstraße 14', 'center'),
      aligned('Sprechzeiten', 'center'),
      together('Ibuprofen 400 mg', 'new appointment at the practice'),
    ],
  },
  {
    id: 'stray-margin-mark',
    suite: 'text-flow',
    fix: 'cda9704a D-334',
    what: 'Scan with a smudge in the top-left margin that OCR reads as "00": the mark was written into the document; short real text such as "Ok" must stay.',
    // 「00」本来就该丢掉，所以识别出的字少一个。
    recall: 0.95,
    checks: [
      times('00', 0),
      custom('"Ok" is kept', (c) =>
        leaves(c.doc).some((l) => l.leaf.kind === 'paragraph' && /\bOk\b/.test(l.leaf.text))
          ? null
          : 'missing',
      ),
      order('General Conditions', 'The tenant shall keep', 'Subletting is not permitted'),
      // 两个短句各自成段：栏比这两行宽，「Inventory」放得下却换了行（5f61ae5e 起接成了一段）。
      apart('Subletting is not permitted', 'Inventory checked'),
    ],
  },
  {
    id: 'short-lines-not-page-numbers',
    suite: 'text-flow',
    fix: 'EU sample 005, 010',
    what: 'The layout model labels a centred "Art. 1" and a lone value "n.a." as page numbers, and page-number regions were dropped whole: the text was lost. Only text that reads like a page number ("1/3") may go.',
    lang: 'ita',
    checks: [
      times('Art. 1', 1),
      custom('"n.a." is kept', (c) =>
        c.paras.some((p) => p.text.trim() === 'n.a.') ? null : 'missing',
      ),
      order('Decreta:', 'Art. 1'),
      order('5.2 Accesso a ulteriori studi', 'n.a.', '5.3 Status professionale'),
    ],
  },
  {
    id: 'decorative-markers-not-bullets',
    suite: 'text-flow',
    fix: 'EU sample 003, 004, 005',
    what: 'Headings framed by asterisks or dashes ("*** TESTO INTEGRALE ***", "– Anmeldebestätigung –", "*****RECHNUNG*****") became bullet items: one asterisk was eaten and the next line was joined into the item. A real dash list must stay a list.',
    lang: 'deu',
    checks: [
      custom('decorated headings stay plain paragraphs with their marks', (c) => {
        const want = [
          '*** TESTO INTEGRALE ***',
          '– Anmeldebestätigung –',
          '*********RECHNUNG**********',
        ];
        const texts = leaves(c.doc).flatMap((l) =>
          l.leaf.kind === 'paragraph' ? [l.leaf.text.trim()] : [],
        );
        // 只比字和符号的种类（识别会把「–」认成「—」、丢空格）：整段就是这一行，符号都还在。
        const key = (t: string) => t.replace(/\s+/g, '').replace(/[–—]/g, '-');
        const missing = want.filter((w) => !texts.some((t) => key(t) === key(w)));
        return missing.length ? `not a plain paragraph: ${missing.join(' | ')}` : null;
      }),
      apart('*********RECHNUNG**********', 'Tisch: 42'),
      custom('the list items are exactly the three dash items', (c) => {
        const items = leaves(c.doc).flatMap((l) => (l.leaf.kind === 'list' ? l.leaf.items : []));
        return items.length === 3 && items.every((t) => !/RECHNUNG|TESTO|Anmeldebest/.test(t))
          ? null
          : JSON.stringify(items);
      }),
    ],
  },
];
