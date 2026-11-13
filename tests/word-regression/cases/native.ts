// native 套件：数字 PDF 的原生绘图（pdfview 的 graphics，D-534/D-535）：装饰底图、内嵌图、表头色带、图章、退回识别。
import {
  anchoredDrawings,
  backgrounds,
  custom,
  images,
  imageBefore,
  imageCovers,
  mediaTypesMatch,
  nativeGraphics,
  table,
  textVisible,
  times,
} from '../lib/checks';
import type { Case } from '../lib/case';

/** 含这处字的每个表格格子都有深色底，字是白的（白字没有留在白纸上）。 */
const whiteOnFill = (text: string) =>
  custom(`"${text}" is white text on a filled cell`, (c) => {
    const cells = [...c.xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].filter((m) =>
      m[0].includes(`>${text}<`),
    );
    if (!cells.length) return 'not in a table cell';
    for (const [cell] of cells) {
      const fill = /w:fill="([0-9A-Fa-f]{6})"/.exec(cell)?.[1];
      if (!fill || /^F{6}$/i.test(fill)) return `cell has no dark fill (${fill ?? 'none'})`;
      if (!/<w:color w:val="FFFFFF"/i.test(cell)) return 'text is not white';
    }
    return null;
  });

export const NATIVE: Case[] = [
  {
    id: 'flyer-background',
    suite: 'native',
    fix: '202a26be, 18b816a7 D-534; 5796eb7f D-535',
    what: 'Digital flyer with full-page artwork, a text-shadowed white headline, yellow info cards and a QR code: the artwork used to be lost (only the QR kept) and the headline shadow left a blurred copy; only the verified decoration may sit behind the reflowed, editable, white text.',
    checks: [
      backgrounds({ min: 1, max: 1 }),
      anchoredDrawings(1),
      times('Autumn Lights Festival', 1),
      custom('headline is white', (c) => {
        const p = /<w:p\b(?:(?!<\/w:p>)[\s\S])*?Autumn Lights Festival[\s\S]*?<\/w:p>/.exec(c.xml);
        return p && /<w:color w:val="FFFFFF"/.test(p[0]) ? null : 'headline is not white';
      }),
      images({ min: 1, max: 1 }),
      imageCovers({ x: 0.83, y: 0.87, width: 0.08, height: 0.055 }),
      mediaTypesMatch(),
      textVisible(),
    ],
  },
  {
    id: 'figures-inline',
    suite: 'native',
    fix: '5796eb7f D-535',
    what: 'Digital arXiv page (2304.03373 p3): the figure used to be painted in a page-fixed background under reflowed text; it must be an inline picture that owns only its own labels, with the caption after it.',
    recall: 0.95,
    checks: [
      anchoredDrawings(0),
      backgrounds({ max: 0 }),
      images({ min: 1, max: 1 }),
      nativeGraphics(true),
      imageCovers({ x: 0.51, y: 0.095, width: 0.36, height: 0.17 }),
      imageBefore('Figure 2: An overview', 0.3),
      times('Denoiser Network', 0),
      mediaTypesMatch(),
    ],
  },
  {
    id: 'dark-header-table',
    suite: 'native',
    fix: '5796eb7f D-535',
    what: 'Digital invoice whose ruled tables have dark header bands with white text: the rules and bands used to be painted in the page background under Word tables (double rules, white text on white paper); now the band is the cell fill and its text stays white.',
    checks: [
      anchoredDrawings(0),
      backgrounds({ max: 0 }),
      table({
        containing: ['Leistung', 'Menge', 'Einzelpreis', 'Betrag', 'Anfahrt'],
        minRows: 5,
        minCols: 4,
      }),
      table({ containing: ['Zahlungsart', 'Fällig am', 'Überweisung'] }),
      whiteOnFill('Leistung'),
      whiteOnFill('Betrag'),
      whiteOnFill('Zahlungsart'),
      textVisible(),
    ],
  },
  {
    id: 'stamp-lettering',
    suite: 'native',
    fix: '202a26be D-534',
    what: 'Digital certificate with a ring seal lettered "OFFICIAL SEAL 2026": the graphics-only render used to strip the lettering out of the seal; the seal picture keeps its lettering and it is not repeated as text.',
    recall: 0.95,
    checks: [
      times('OFFICIAL SEAL', 0),
      imageCovers({ x: 0.725, y: 0.635, width: 0.13, height: 0.175 }),
      times('Amara Nwosu-Fischer', 1),
      anchoredDrawings(1),
    ],
  },
  {
    id: 'invisible-ocr-scan',
    suite: 'native',
    fix: '202a26be, 18b816a7 D-534',
    what: 'Scanned PDF with an invisible OCR text layer: the scan must not be taken for decorative art behind the body; the page falls back to the plain OCR conversion.',
    checks: [
      nativeGraphics(false),
      backgrounds({ max: 0 }),
      anchoredDrawings(0),
      images({ max: 0 }),
      table({ containing: ['Description', 'Qty', 'Unit price', 'Amount'] }),
    ],
  },
  {
    id: 'rotated-landscape',
    suite: 'native',
    fix: '18b816a7 D-534',
    what: 'Landscape PDF page whose native words are mostly rotated: native drawing must not be used (no page-fixed background, no native crops); the page falls back to OCR.',
    recall: 0.5,
    checks: [nativeGraphics(false), backgrounds({ max: 0 }), anchoredDrawings(0)],
  },
  {
    id: 'chart-label-run',
    suite: 'native',
    fix: 'probe (D-534/D-535 ownership rules)',
    what: 'Digital page (pdf-lib, one Tj) whose bar chart is a bitmap and whose axis labels Q1–Q4 are written in the same PDF text run as a note to the right of the chart: the labels must end up either in the chart picture or as editable text.',
    checks: [
      times('Q1', 1),
      times('Q4', 1),
      times('Counted at the entrance gates, all four quarters', 1),
      images({ min: 1, max: 1 }),
    ],
  },
];
