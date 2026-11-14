// tables 套件：带线表格的识别和结构（一张表的边界、表头、合并格、该不该当表），
// 没有线的表格和按行对齐（一项的名称和金额在同一排）。
import {
  apart,
  custom,
  differentTables,
  images,
  inRow,
  leaves,
  norm,
  noTables,
  notInTable,
  order,
  table,
  times,
  together,
  type Check,
  type Converted,
} from '../lib/checks';
import type { Case } from '../lib/case';
import { sizeOf } from '../lib/layout-checks';

/** docx 里每张最外层表的 w:tblPr（按文档顺序；嵌套的表也算）。 */
const tblPrs = (xml: string) =>
  [...xml.matchAll(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g)].map((m) => m[1]!);

/** docx 里每一格（w:tc）的 XML 片段和它的字。 */
const tcs = (xml: string) =>
  [...xml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((m) => ({
    xml: m[1]!,
    text: [...m[1]!.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
  }));

/** 编辑页里某张表中含这处文字的格。 */
const cellWith = (c: Converted, text: string) => {
  for (const l of leaves(c.doc)) {
    if (l.leaf.kind !== 'table') continue;
    const cell = l.leaf.table.cells.find((x) => norm(x.text).includes(norm(text)));
    if (cell) return { table: l.leaf, cell };
  }
  return null;
};

/** 每个词都完整地在某一段里（没有被列线切成两格）。 */
const wordsWhole = (...words: string[]): Check[] => words.map((w) => together(w));

export const TABLES: Case[] = [
  {
    id: 'tbl-separate-grids-not-chained',
    suite: 'tables',
    fix: 'b40da4fa, 719ecd10 · D-272',
    what: 'Ruled boxes and tables of the same width, one under another (text between, or only 2 mm apart; a three-line table under a grid) used to be chained into one big table that swallowed the text between them.',
    checks: [
      differentTables('Counted by', 'Site Lyon North'),
      notInTable('The count covers both sites'),
      differentTables('Count started', 'Differences 3'),
      differentTables('Steel brackets', 'Rhône Express'),
      notInTable('Carrier returns'),
      // 列数按每排的格子数：整页共用列线（D-272），上面网格的列线也算在这张表的 gridCol 里，格子跨过去。
      table({ containing: ['Carrier', 'Savoie Logistique'], rows: 4 }),
      custom('the three-line table has 3 cells in every row', (c) => {
        const t = leaves(c.doc)
          .map((l) => l.leaf)
          .find((b) => b.kind === 'table' && b.table.cells.some((x) => /Savoie/.test(x.text)));
        if (!t || t.kind !== 'table') return 'no table';
        const counts = Array.from(
          { length: t.table.rows },
          (_, r) => t.table.cells.filter((x) => x.row === r).length,
        );
        return counts.every((n) => n === 3) ? null : `cells per row: ${counts.join(', ')}`;
      }),
    ],
  },
  {
    id: 'tbl-bold-strokes-and-short-rows',
    suite: 'tables',
    fix: '719ecd10 · D-272',
    what: 'A scanned order form ruled only by column lines, with heavy bold labels and rows about 30 px high: bold strokes used to be taken for column lines (words cut into cells) and the short column lines were missed.',
    checks: [
      table({ containing: ['Reference', 'HW-6630'], rows: 7, cols: 5 }),
      inRow('HW-1182', 'WHEELBARROW galvanised', '2', 'pcs', '178.00'),
      inRow('HW-4471', 'MEMBRANE roofing roll', '3', 'rolls', '211.20'),
      inRow('HW-6630', 'NUMBERS brass house set', '4', 'sets', '58.00'),
    ],
  },
  {
    id: 'tbl-frame-and-header-column-lines',
    suite: 'tables',
    fix: '719ecd10 · D-272',
    what: 'A table inside a page frame, with a shaded header whose column lines only start below it and a title row straddling a column line: the frame used to split from the table, the header lost its columns and the title was cut in two.',
    checks: [
      inRow('Registration', 'Make and model', 'Colour', 'Permit zone'),
      inRow('VD 11907', 'Škoda Fabia', 'Blue', 'Zone B'),
      custom('title whole in one merged cell', (c) => {
        const at = cellWith(c, 'Vehicles registered at this address');
        if (!at) return 'title not in a table cell';
        return at.cell.colSpan >= 2 ? null : `title cell spans ${at.cell.colSpan} column`;
      }),
    ],
  },
  {
    id: 'tbl-multiline-form-cell',
    suite: 'tables',
    fix: '5332f69c, 72a8e481 · D-333 (D-315)',
    what: 'A box with one column line and no row lines whose left cell holds seven lines and right cell two: each text line used to become its own table row, and in Word the lines of one cell were run together into one line.',
    checks: [
      table({ containing: ['Dwelling', 'Address: 27 Rue des Tanneurs'], maxRows: 2, cols: 2 }),
      custom('cell keeps one line per source line', (c) => {
        const at = cellWith(c, 'Dwelling');
        if (!at) return 'not in a table';
        const n = at.cell.text.split('\n').length;
        if (n < 7) return `cell has ${n} lines`;
        const text = c.paras.map((p) => p.text).join('\n');
        const a = text.indexOf('second floor');
        const b = text.indexOf('Certificate no');
        if (a < 0 || b < 0) return 'missing in the docx';
        return text.slice(a, b).includes('\n') ? null : 'joined into one line in the docx';
      }),
    ],
  },
  {
    id: 'tbl-underlined-bold-title-not-table',
    suite: 'tables',
    fix: '0fcb9def · D-463',
    what: 'A scanned prescription with a centred bold, underlined title: letter strokes and the underline used to look like a one-row grid, giving a table with one letter per cell.',
    checks: [
      noTables(),
      together('ORDONNANCE DE LUNETTES'),
      order('ORDONNANCE DE LUNETTES', 'Une paire de lunettes'),
    ],
  },
  {
    id: 'tbl-large-layout-grid-rejected',
    suite: 'tables',
    fix: '5f61ae5e · D-473 ④',
    what: 'IRS Form W-9 page 1, whose ruling is a page layout grid: the whole page used to become one giant table with the instructions crammed into cells.',
    checks: [
      notInTable('Check the appropriate box for federal tax classification'),
      notInTable('Under penalties of perjury'),
      notInTable('Section references are to the Internal Revenue Code'),
      notInTable('Give form to the requester'),
    ],
  },
  {
    id: 'tbl-small-sparse-decorative-grid',
    suite: 'tables',
    fix: 'ca14ef0b · D-532',
    what: 'A certificate inside a decorative double frame: the frame used to be read as a small sparse table, squeezing the title and text into tiny cells.',
    // 圆章剪成图片，章里的两个词不在 Word 的字里。
    recall: 0.95,
    checks: [
      noTables(),
      apart('CERTIFICATE OF ACHIEVEMENT', 'This certificate is proudly presented'),
      order('CERTIFICATE OF ACHIEVEMENT', 'Amara Nwosu-Fischer', 'Certificate No'),
    ],
  },
  {
    id: 'tbl-bounded-text-table-recovery',
    suite: 'tables',
    fix: 'ca14ef0b, 6e18d4ab · D-532',
    what: 'Meeting minutes: the action table with faint borders used to fall apart into column paragraphs (owner, due date and status listed under their headings), and the agenda rows released from a rejected false grid were merged into one paragraph.',
    checks: [
      table({
        containing: ['Publish revised roadmap', 'Draft 2027 hiring plan'],
        rows: 5,
        cols: 5,
      }),
      inRow('Publish revised roadmap to the wiki', 'L. Chen', '2026-11-13', 'Open'),
      inRow('Set up pricing test dashboard', 'M. Okoro', '2026-11-18', 'In progress'),
      inRow('Draft 2027 hiring plan', 'P. Raman', '2026-12-01', 'Open'),
      apart('Approval of previous minutes', 'Q4 roadmap status'),
      apart('Q4 roadmap status', 'Pricing experiment results'),
      apart('Hiring plan for 2027', 'Any other business'),
      notInTable('Q4 roadmap status'),
      notInTable('Next meeting'),
    ],
  },
  {
    id: 'tbl-merged-table-empty-shared-columns',
    suite: 'tables',
    fix: '46abc3ba · D-532',
    what: 'IRS Schedule D page 1: its real merged data tables have wholly empty columns from page-shared column positions and used to be rejected as sparse layout grids.',
    checks: [
      table({ containing: ['Short-Term Capital Gains', '1a Totals', '3 Totals'], minRows: 8 }),
      table({ containing: ['8a Totals', '10 Totals'], minRows: 8 }),
    ],
  },
  {
    id: 'tbl-dark-header-band',
    suite: 'tables',
    fix: '0d784e7c · D-501 ① ②',
    what: 'A scanned payslip whose tables have dark header bands with white text, column lines starting below the band, and a summary table joined under the detail table by its own band: the band used to be discarded with its column lines, and the two tables merged into one with a mixed grid.',
    checks: [
      // 底条里的白字表头现在成了表上面的一排段落（修的时候也是这样），这里不考。
      inRow('Old-age pension', '2 977.96', '6.9000', '205.48', '255.50'),
      inRow('Gross pay', 'Total deductions', 'Taxable income', 'Net pay'),
      inRow('324.90', '2 712.33', '2 653.06'),
      differentTables('Base salary', 'Gross pay'),
    ],
  },
  {
    id: 'tbl-footer-over-bottom-line',
    suite: 'tables',
    fix: '0d784e7c, 374e6b7a · D-501 ③',
    what: 'A scanned table with a large footer line printed over its bottom rule and across its column lines: the footer used to be chopped into cells, then dropped, then written twice (in a cell and as a paragraph).',
    checks: [
      table({ containing: ['Building', "Caretaker's lodge"], rows: 6, cols: 4 }),
      times('Readings taken by the caretaker', 1),
      notInTable('Readings taken by the caretaker'),
      order("Caretaker's lodge", 'Readings taken by the caretaker'),
    ],
  },
  {
    id: 'tbl-totals-row-under-last-line',
    suite: 'tables',
    fix: '374e6b7a · D-501',
    what: 'An invoice whose totals row touches the table’s last rule, one value per column: pulling that text out of the table left the table sparse and it was dropped as a layout grid.',
    checks: [
      table({ containing: ['Description', 'Cushion covers', 'Total', '672.40'], cols: 4 }),
      inRow('Total', '15', '672.40'),
      times('672.40', 1),
    ],
  },
  {
    id: 'tbl-empty-ruled-part-not-barcode',
    suite: 'tables',
    fix: '0d784e7c · D-501 ④',
    what: 'A scanned 21-column ruled table with a tall empty row: the parallel column lines of the empty part used to be cropped out as a barcode image.',
    checks: [images({ max: 0 }), table({ containing: ['Meter', 'Laundry', 'Total'], cols: 21 })],
  },
  {
    id: 'tbl-chopped-word-grid-rejected',
    suite: 'tables',
    fix: '094cc2a8 · D-502 ②',
    what: 'A ruled grid whose column lines run through the middle of words: words used to be split across neighbouring cells.',
    checks: [
      noTables(),
      ...wordsWhole(
        'Marquetry',
        'beginners',
        'veneers',
        'patterns',
        'Upholstery',
        'stretching',
        'attaching',
        'Woodturning',
        'sharpening',
        'candlesticks',
        'preparing',
        'burnishing',
        'Restoration',
        'repairing',
        'dovetails',
      ),
    ],
  },
  {
    id: 'tbl-horizontal-position',
    suite: 'tables',
    fix: '472354eb · D-525',
    what: 'A narrow receipt printed in the middle of an A4 page: its item table used to be written at the left margin instead of at its own horizontal position.',
    checks: [
      table({ containing: ['Baguette', 'Pain de seigle'], cols: 3 }),
      custom('table indented to its source position, inside the page', (c) => {
        const pr = tblPrs(c.xml)[0];
        if (!pr) return 'no table';
        const ind = Number(/<w:tblInd w:w="(-?\d+)"/.exec(pr)?.[1] ?? 0);
        // 原件：小票表格左边在 66 mm，正文左边 15 mm，差约 2900 twips。
        if (ind < 2000) return `tblInd ${ind}`;
        const grid = c.xml.slice(c.xml.indexOf(pr));
        const cols = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(grid)?.[1] ?? '';
        const width = [...cols.matchAll(/w:w="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0);
        const page = Number(/<w:pgSz w:w="(\d+)"/.exec(c.xml)?.[1]);
        const left = Number(/<w:pgMar [^>]*w:left="(\d+)"/.exec(c.xml)?.[1]);
        const right = Number(/<w:pgMar [^>]*w:right="(\d+)"/.exec(c.xml)?.[1]);
        return ind + width <= page - left - right ? null : `ends at ${ind + width}`;
      }),
    ],
  },
  {
    id: 'tbl-explicit-cell-margins',
    suite: 'tables',
    fix: '9bdb8020 · D-527',
    what: 'A data table with tight header words in narrow columns: the writer relied on the default table style’s cell padding (wider in LibreOffice than the 4 pt it budgeted), so “Amount” wrapped.',
    checks: [
      table({ containing: ['Unit price', 'Amount', 'Sample bags'], cols: 5 }),
      custom('every table writes 80-twip left/right cell margins', (c) => {
        const all = tblPrs(c.xml);
        if (!all.length) return 'no table';
        const bad = all.filter((pr) => {
          const mar = /<w:tblCellMar>([\s\S]*?)<\/w:tblCellMar>/.exec(pr)?.[1] ?? '';
          return !/<w:left w:w="80"/.test(mar) || !/<w:right w:w="80"/.test(mar);
        });
        return bad.length ? `${bad.length} of ${all.length} tables without them` : null;
      }),
    ],
  },
  {
    id: 'tbl-rotated-table-direction',
    suite: 'tables',
    fix: '261a67d4, 18b816a7 · D-533, D-534',
    what: 'A landscape invoice printed rotated 90° on the page: its data table used to come out as vertical crops on a portrait page; it must stay editable text in the source direction on a landscape page.',
    // 表外的竖排字照旧剪成图片（D-533），这些字不在 Word 的文字里。
    recall: 0.5,
    checks: [
      table({ containing: ['Printer ink', 'Storage boxes', '170.10'] }),
      custom('landscape page', (c) => {
        const m = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(c.xml);
        return m && Number(m[1]) > Number(m[2]) ? null : `pgSz ${m?.[0] ?? 'missing'}`;
      }),
      custom('table cells keep the vertical writing direction', (c) => {
        const cell = tcs(c.xml).find((x) => x.text.includes('Printer ink'));
        if (!cell) return '"Printer ink" is not in a Word table cell';
        return /<w:textDirection w:val="tbRl"\/>/.test(cell.xml) ? null : 'no tbRl text direction';
      }),
    ],
  },
  {
    id: 'tbl-full-cell-fill',
    suite: 'tables',
    fix: '27a87737 · D-535',
    what: 'A digital form whose input fields are light-blue filled cells: the fill used to be painted only as paragraph shading on the text stripe instead of as the cell’s shading.',
    checks: [
      custom('filled field cells carry the source fill as cell shading', (c) => {
        for (const value of ['Elena Martin', 'APP-2026-047']) {
          const cell = tcs(c.xml).find((x) => x.text.includes(value));
          if (!cell) return `"${value}" is not in a Word table cell`;
          const fill =
            /<w:tcPr>[\s\S]*?<w:shd [^>]*w:fill="([0-9A-Fa-f]{6})"[\s\S]*?<\/w:tcPr>/.exec(
              cell.xml,
            )?.[1];
          if (!fill || /^f{6}$/i.test(fill)) return `"${value}" cell has no fill`;
        }
        return null;
      }),
    ],
  },
  {
    id: 'tbl-receipt-local-tilt',
    suite: 'tables',
    fix: 'bf491a83 · D-471 ① ②',
    what: 'A photo of a bent till receipt (straight at the top, the right side rising towards the bottom) with articles, quantities and amounts aligned in columns without rules: amounts used to jump to the previous article, and the columns were mixed in paragraphs instead of a borderless table.',
    checks: [
      table({ containing: ['Pomodori ramati', 'Biscotti al burro'], rows: 9, cols: 3 }),
      inRow('Pomodori ramati', '1.2', '3.58'),
      inRow('Parmigiano 24 mesi', '0.3', '7.47'),
      inRow('Caffè macinato', '2', '8.38'),
      inRow('Biscotti al burro', '1', '2.19'),
      custom('borderless table', (c) => {
        const at = cellWith(c, 'Pomodori ramati');
        if (!at) return 'not in a table';
        return at.table.borderless ? null : 'table has borders';
      }),
    ],
  },
  {
    id: 'tbl-far-numeric-columns',
    suite: 'tables',
    fix: '094cc2a8 · D-502 ①',
    what: 'A payslip body without table lines, item names on the left and up to three amount columns far to the right: the labels used to become one column paragraph and the numbers separate paragraphs no longer level with them; two address blocks side by side must not become a table.',
    checks: [
      inRow('Base salary', '151.67', '14.2100', '2 155.23'),
      inRow('Subtotal gross salary', '163.67', '2 368.38'),
      inRow('Paid leave allowance', '318.40'),
      inRow('Transport allowance', '42.10'),
      notInTable('Fabrique Lemaire'),
      notInTable('Tomasz Wiśniewski'),
    ],
  },
  {
    id: 'tbl-shifted-amounts-guard',
    suite: 'tables',
    fix: 'b982d025 · D-506 (narrows 094cc2a8, D-502)',
    what: 'A digital invoice whose item rows have only faint underlines and whose totals sit under the right-hand columns: the “numbers without a label” guard used to reject the whole item table, leaving item names in one paragraph and each number column in another.',
    checks: [
      table({ containing: ['Item', 'Unit price', 'Desk organiser'], rows: 5, cols: 4 }),
      inRow('A4 copy paper, 5 reams', '4', '£21.50', '£86.00'),
      inRow('Toner cartridge HP 59A', '2', '£64.90', '£129.80'),
      inRow('Desk organiser', '1', '£18.75', '£18.75'),
      times('£129.80', 1),
      times('£326.10', 1),
    ],
  },
  {
    id: 'tbl-two-column-list-two-pass',
    suite: 'tables',
    fix: 'a57953bc · D-503 ①',
    what: 'A receipt whose two-column totals list (label, far amount) sits right above a three-column GST summary: the list used to take the summary’s rows and squeeze them into two columns.',
    checks: [
      inRow('GST Summary', 'Amount', 'Tax'),
      inRow('SR @ 6%', '5.57', '0.33'),
      inRow('ZR @ 0%', '0.00', '0.00'),
      inRow('Total After Adj Incl GST', '5.90'),
    ],
  },
  {
    id: 'tbl-summary-joins-table',
    suite: 'tables',
    fix: 'a57953bc · D-503 ②',
    what: 'A receipt whose GST summary (one header row straddling two columns, one row of numbers) sits right under a three-column item table: the two summary rows used to stay loose text because they cannot form a table alone.',
    checks: [
      inRow('001697', '5.00 1.00', '5.00 SR'),
      inRow('GST Summary', 'Amount(RM)', 'GST (RM)'),
      inRow('SR = 6 %', '30.85', '1.85'),
    ],
  },
  {
    id: 'tbl-narrow-column-font',
    suite: 'tables',
    fix: '2493f8ae; EU sample 020, 018, 016',
    what: 'A ruled 10 pt table with one very narrow "%" column: the narrowest cell set the scale of the whole table, and the 8 pt cell padding left almost nothing of that column, so every cell (long descriptions included) was written at the 5 pt floor.',
    checks: [
      table({ containing: ['Składnik', 'Opis', 'Netto', 'Brutto'], rows: 3, cols: 5 }),
      custom('the description column stays ≥ 8.5 pt', (c) => {
        const got = sizeOf(c, 'opłata za energię czynną pobraną');
        return got >= 8.5 ? null : `${got} pt`;
      }),
      custom('the narrow column keeps "23" on one line and ≥ 7 pt', (c) => {
        const got = sizeOf(c, '23');
        return got >= 7 ? null : `${got} pt`;
      }),
    ],
  },
  {
    id: 'tbl-dashed-double-rule',
    suite: 'tables',
    fix: 'fd28491f; EU sample 020',
    what: 'Scanned utility-bill table drawn with dashed rules and a doubled dashed line under the header: OCR reads the dashes of the double rule as "==" text (with a stray letter), which ended up in the header cells or as a junk row between the header and the first item.',
    // 识别把挨着的「0,00」「23」读成一行「0,0023」，表把它按列线分开：多出来的是这些，不是重复。
    extra: 0.03,
    checks: [
      table({ containing: ['Składnik opłat', 'Netto', 'Brutto', 'abonament'], minRows: 8 }),
      custom('no cell holds "==" read from the dashed rule', (c) => {
        const junk = leaves(c.doc).flatMap((l) =>
          l.leaf.kind === 'table' ? l.leaf.table.cells.filter((x) => /[=_~]{2,}/.test(x.text)) : [],
        );
        return junk.length ? junk.map((x) => JSON.stringify(x.text)).join(', ') : null;
      }),
    ],
  },
  {
    id: 'tbl-header-bar-top-edge',
    suite: 'tables',
    fix: '07a2f1f8; EU sample 024',
    what: "Three timetables whose blue header bar sits right on the first row with no ink rule between them, and only one vertical (the hour column rule): the bar was not taken as the table top, so the 5 o'clock row fell outside the table and its minutes merged into the 6 o'clock cell (wrong data).",
    lang: 'deu',
    checks: [
      table({
        containing: ['montags', '33 43 53'],
        rows: 20,
        cols: 2,
        cells: [
          { row: 1, col: 0, text: '5' },
          { row: 1, col: 1, text: '33 43 53' },
          { row: 19, col: 0, text: '23' },
        ],
      }),
      table({
        containing: ['samstags', '47 57'],
        rows: 20,
        cols: 2,
        cells: [
          { row: 1, col: 0, text: '5' },
          { row: 1, col: 1, text: '47 57' },
          { row: 19, col: 0, text: '23' },
        ],
      }),
      table({
        containing: ['sonn', '11 31 51'],
        rows: 20,
        cols: 2,
        cells: [
          { row: 1, col: 0, text: '5' },
          { row: 2, col: 1, text: '11 31 51' },
          { row: 19, col: 0, text: '23' },
        ],
      }),
    ],
  },
  {
    id: 'tbl-framed-prose-callout',
    suite: 'tables',
    fix: 'EU sample 038',
    what: 'A framed bold notice (one thin frame around a justified paragraph, no inner rules) became a bordered table with one row per text line, so the paragraph could not reflow; it must be one framed cell holding one paragraph.',
    lang: 'fra',
    checks: [
      table({
        containing: ['En utilisant ce formulaire', 'conditions de droit commun'],
        rows: 1,
        cols: 1,
      }),
      together('En utilisant ce formulaire', 'pendant lesquels', 'conditions de droit commun'),
      notInTable('Complétez les rubriques'),
    ],
  },
];
