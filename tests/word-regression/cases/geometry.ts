// geometry 套件：纸张大小、位置和缩进、栏宽、表格行高、图片大小。
import { custom, leaves, sideBySide, table } from '../lib/checks';
import type { Case } from '../lib/case';
import {
  fitsOneLine,
  indentLeft,
  pictures,
  sections,
  spaceBefore,
  xmlPara,
} from '../lib/layout-checks';

/** 1 毫米 = 56.69 twip。 */
const MM = 1440 / 25.4;

export const GEOMETRY: Case[] = [
  {
    id: 'position-indent-and-gaps',
    suite: 'geometry',
    fix: '0fcb9def D-463',
    what: 'Prescription (fictional) with a doctor block on the left, date and patient on the right and large white gaps: every block used to be crowded at the left margin in the top half; left indents follow the source left edges and space-before follows the source gaps.',
    checks: [
      custom('date indent − body indent ≈ 58 mm (source x offsets)', (c) => {
        const date = xmlPara(c, 'Vallon le 11/05/2026');
        const body = xmlPara(c, 'Une paire de lunettes');
        if (!date || !body) return 'missing';
        const got = indentLeft(date) - indentLeft(body);
        return Math.abs(got / (58 * MM) - 1) <= 0.12 ? null : `${got} twips`;
      }),
      custom('lines centered inside the left block keep their own indents', (c) => {
        const [wide, doctor, title] = [
          'Ancienne assistante',
          'Docteur Claire FONTAINE',
          'Ophtalmologiste',
        ].map((t) => {
          const p = xmlPara(c, t);
          return p ? indentLeft(p) : NaN;
        });
        return wide! > 0 && wide! < doctor! && doctor! < title!
          ? null
          : `indents ${wide}, ${doctor}, ${title}`;
      }),
      custom('space before follows the source gaps (27 mm vs 16 mm, ±25 %)', (c) => {
        const big = xmlPara(c, 'Une paire de lunettes');
        const mid = xmlPara(c, 'ORDONNANCE DE LUNETTES');
        const small = xmlPara(c, '71990 Vallon-sur-Brume');
        if (!big || !mid || !small) return 'missing';
        const ratio = spaceBefore(big) / spaceBefore(mid);
        if (spaceBefore(mid) < 4 * spaceBefore(small) || spaceBefore(mid) < 400)
          return `title gap ${spaceBefore(mid)}, address gap ${spaceBefore(small)}`;
        return Math.abs(ratio / (27 / 16) - 1) <= 0.25
          ? null
          : `${spaceBefore(big)} / ${spaceBefore(mid)} = ${ratio.toFixed(2)}`;
      }),
    ],
  },
  {
    id: 'last-column-spare-width',
    suite: 'geometry',
    fix: '472354eb D-525',
    what: '"Bill to: Elena Martin" alone in the last column of a header row: the cell used to be its ink width and the name wrapped; the last column borrows the spare width to its right.',
    checks: [
      sideBySide('From: Northfield Studio', 'Bill to: Elena Martin'),
      fitsOneLine('Bill to: Elena Martin'),
      custom('layout grid fits the content width', (c) => {
        const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(c.xml)?.[1] ?? '';
        const sum = [...grid.matchAll(/w:w="(\d+)"/g)].reduce((n, m) => n + Number(m[1]), 0);
        const s = sections(c)[0]!;
        return sum <= s.width - s.left - s.right ? null : `grid ${sum}`;
      }),
    ],
  },
  {
    id: 'last-column-cjk-heading',
    suite: 'geometry',
    fix: '9bdb8020 D-527',
    what: 'Chinese two-column article: short headings "2结果" and "参考文献" in the last column used to wrap ("2结 / 果") because cell padding and the export font were not budgeted.',
    lang: 'chi_sim',
    locale: 'zh',
    checks: [fitsOneLine('2结果'), fitsOneLine('参考文献')],
  },
  {
    id: 'short-label-width',
    suite: 'geometry',
    fix: '3805edea D-532; c5ac5a4e D-535',
    what: 'Exam page with short right-aligned marks ("[6]", "[3]") beside prose rows that must shrink to the page: the label used to wrap; its unbreakable width plus padding is reserved.',
    checks: [fitsOneLine('[6]'), fitsOneLine('[3]'), fitsOneLine('[2]')],
  },
  {
    id: 'landscape-paper-size',
    suite: 'geometry',
    fix: '261a67d4 D-533',
    what: 'Landscape A4 certificate: every page used to be written as portrait A4; the section takes the source paper size and orientation.',
    recall: 0.94,
    checks: [
      custom('one section, landscape A4 (±2 pt)', (c) => {
        const s = sections(c);
        if (s.length !== 1) return `${s.length} sections`;
        const { width, height, landscape } = s[0]!;
        return landscape && Math.abs(width - 16838) <= 40 && Math.abs(height - 11906) <= 40
          ? null
          : `${width}×${height}${landscape ? ' landscape' : ''}`;
      }),
    ],
  },
  {
    id: 'table-row-height-budget',
    suite: 'geometry',
    fix: '18b816a7 D-534; 5796eb7f, 0539689b D-535',
    what: 'One-page IRS Schedule B: table rows, separators and borders used to add up so the last rows spilled onto a second page; rows keep their source heights on the vertical paper scale and separators are one point high.',
    checks: [
      custom('separator paragraphs after tables are one point high', (c) => {
        const after = [...c.xml.matchAll(/<\/w:tbl>(<w:p>[\s\S]*?<\/w:p>)/g)].map((m) => m[1]!);
        const bad = after.filter(
          (p) => !/<w:t[ >]/.test(p) && !/w:line="20" w:lineRule="exact"/.test(p),
        );
        return after.length && !bad.length ? null : `${bad.length}/${after.length} not 1 pt`;
      }),
      custom('row heights add up to the source table height (±10 %)', (c) => {
        const t = leaves(c.doc).find((l) => l.leaf.kind === 'table')?.leaf;
        if (!t) return 'no table';
        const page = c.doc.pages[0]!;
        const want = (t.box.height / page.height) * (page.paper?.height ?? 842) * 20;
        const at = c.xml.indexOf('List name of payer');
        const body = c.xml.slice(c.xml.lastIndexOf('<w:tbl>', at), c.xml.indexOf('</w:tbl>', at));
        const got = [...body.matchAll(/<w:trHeight w:val="(\d+)"/g)].reduce(
          (n, m) => n + Number(m[1]),
          0,
        );
        return Math.abs(got / want - 1) <= 0.1
          ? null
          : `rows ${got} twips, source ${Math.round(want)}`;
      }),
    ],
  },
  {
    id: 'picture-fit-policy',
    suite: 'geometry',
    fix: 'b29d8d16, 0539689b, 27a87737 D-535',
    what: 'arXiv page 4 (figure images re-encoded to stay small) with two figures over dense two-column text: pictures must not be shrunk to about a quarter when shrinking cannot make the page fit; they keep their source size.',
    recall: 0.9,
    checks: [
      custom('pictures keep their source width (±5 %)', (c) => {
        const page = c.doc.pages[0]!;
        const src = leaves(c.doc)
          .map((l) => l.leaf)
          .filter((b) => b.kind === 'image' && !b.background)
          .map((b) => (b.box.width / page.width) * (page.paper?.width ?? 595.3));
        const got = pictures(c).map((p) => p.width);
        if (got.length !== src.length || !src.length)
          return `${got.length} pictures for ${src.length} images`;
        const bad = got.filter((w, i) => Math.abs(w / src[i]! - 1) > 0.05);
        return bad.length
          ? `widths ${got.map((w) => w.toFixed(0)).join('/')} pt, source ${src.map((w) => w.toFixed(0)).join('/')} pt`
          : null;
      }),
    ],
  },
  {
    id: 'oversized-scan-paper',
    suite: 'geometry',
    fix: 'EU sample 009',
    what: 'A scan stored as a PDF at one point per pixel (MediaBox 2481 × 3508 pt, 87 × 124 cm): the Word page copied that paper size, so the body text was a tiny 7.5 pt cluster on a giant page. Paper larger than A3 is fitted to A4 width with the same proportions.',
    lang: 'fra',
    checks: [
      custom('one section, A4 width (±2 pt) and the source proportions', (c) => {
        const s = sections(c);
        if (s.length !== 1) return `${s.length} sections`;
        const { width, height } = s[0]!;
        return Math.abs(width - 11906) <= 40 && Math.abs(height / width - 3508 / 2481) < 0.01
          ? null
          : `${width}×${height}`;
      }),
      custom('body text is at least 9 pt', (c) =>
        c.doc.pages[0]!.bodySize >= 9 ? null : `body ${c.doc.pages[0]!.bodySize} pt`,
      ),
      table({ rows: 3, cols: 3, containing: ['Forfait mobile 20 Go', '12,99 €'] }),
    ],
  },
  {
    id: 'short-edge-cell-one-line',
    suite: 'geometry',
    fix: 'EU sample 005, 010',
    what: 'Header and footer rows wider than the content area with a short text at the right page edge ("Page 2 of 5", "Rev. 4b"; EU samples: "1/3", "AUTRE TOTAL"): the last cell was only as wide as its source ink, so the text wrapped one or two characters per line; it borrows the unused width of the cell to its left.',
    checks: [
      fitsOneLine('Page 2 of 5'),
      fitsOneLine('Rev. 4b'),
      fitsOneLine('Diploma Supplement – Specimen'),
      fitsOneLine('http://www.example.org/atti/stampa/serie_generale/originario'),
    ],
  },
];
