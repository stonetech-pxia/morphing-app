// fonts 套件：字体、字号、粗体和下划线、标题、对齐。
import { aligned, custom, heading, leaves, table } from '../lib/checks';
import type { Case } from '../lib/case';
import {
  allRuns,
  anyRun,
  fitsOneLine,
  indentLeft,
  jcOf,
  sameSize,
  sizeOf,
  sizeRatio,
  xmlPara,
  xmlParas,
} from '../lib/layout-checks';

/** 这处文字所在段的左缩进（twip）；没有这段时 NaN。 */
const indentOf = (c: Parameters<Parameters<typeof custom>[1]>[0], text: string) => {
  const p = xmlPara(c, text);
  return p ? indentLeft(p) : NaN;
};

export const FONTS: Case[] = [
  {
    id: 'run-fonts-and-sizes',
    suite: 'fonts',
    fix: '440f8d12 D-330; d8c87ca5 D-335',
    what: 'A plain serif notice: runs used to rely on the style defaults (serif, 12 pt in Apple Preview); every run must name Arial / Microsoft YaHei and carry the page size, and every paragraph mark a size.',
    checks: [
      custom('every run names Arial / Microsoft YaHei and a size', (c) => {
        const runs = [...c.xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].filter((r) =>
          /<w:t[ >]/.test(r[1]!),
        );
        const bad = runs.filter(
          (r) =>
            !/<w:rFonts [^>]*w:ascii="Arial"[^>]*w:eastAsia="Microsoft YaHei"/.test(r[1]!) ||
            !/<w:sz w:val="\d+"/.test(r[1]!),
        );
        return runs.length && !bad.length ? null : `${bad.length}/${runs.length} runs without`;
      }),
      custom('every paragraph mark carries a size', (c) => {
        const bad = xmlParas(c).filter(
          (p) => p.text.trim() && !/<w:pPr>[\s\S]*<w:rPr>[\s\S]*<w:sz /.test(p.xml),
        );
        return bad.length ? `${bad.length} paragraphs, e.g. "${bad[0]!.text.slice(0, 40)}"` : null;
      }),
      custom('body runs are written at the page body size', (c) => {
        const want = c.doc.pages[0]!.bodySize;
        const got = sizeOf(c, 'Traffic will be diverted through Mill Street');
        return got === want ? null : `${got} pt, page body ${want} pt`;
      }),
    ],
  },
  {
    id: 'heading-false-positives',
    suite: 'fonts',
    fix: '440f8d12 D-330; 5f61ae5e D-473 ⑨',
    what: 'Book page with larger lines that are not headings: a quoted line of dialogue and a full sentence (D-330) and a line of numbers and symbols (D-473 ⑨) used to become headings.',
    checks: [
      heading('Chapter Seven'),
      heading('Why not tonight, then', false),
      heading('The last boat of the season left the harbour', false),
      heading('47 %', false),
    ],
  },
  {
    id: 'form-size-proportional',
    suite: 'fonts',
    fix: 'd8c87ca5 D-335; 5f61ae5e D-473 ⑧',
    what: 'Dense order form printed at 6 pt: the body used to be clamped to 9–12 pt so the one-page form grew to two or three pages; it must stay small (form pages go down to 6 pt).',
    checks: [
      custom('page body size ≤ 8 pt', (c) => {
        const s = c.doc.pages[0]!.bodySize;
        return s <= 8 ? null : `${s} pt`;
      }),
      custom('text outside the table ≤ 8 pt', (c) => {
        const s = sizeOf(c, 'DELIVERY TO RECEPTION');
        return s <= 8 ? null : `${s} pt`;
      }),
      custom('table text ≤ 8 pt', (c) => {
        const s = sizeOf(c, 'Whiteboard markers');
        return s <= 8 ? null : `${s} pt`;
      }),
    ],
  },
  {
    id: 'table-longest-word',
    suite: 'fonts',
    fix: 'd8c87ca5 D-335; 261a67d4 D-533',
    what: 'Ruled 9 pt table under 13 pt prose whose longest words (RÉFRIGÉRATEUR, LAVE-VAISSELLE) barely fit their columns: the table used to take the body size and break words mid-word; it gets its own size, shrunk until the longest word fits, and never larger than its source size.',
    checks: [
      table({ rows: 5, cols: 6, containing: ['RÉFRIGÉRATEUR', 'LAVE-VAISSELLE'] }),
      custom('table text has one size, smaller than the prose', (c) => {
        const t = leaves(c.doc).find((l) => l.leaf.kind === 'table')?.leaf;
        if (!t || t.kind !== 'table') return 'no table';
        const at = c.xml.indexOf('LAVE-VAISSELLE');
        const tbl = c.xml.slice(c.xml.lastIndexOf('<w:tbl>', at), c.xml.indexOf('</w:tbl>', at));
        const sizes = new Set(
          [...tbl.matchAll(/<w:r>[\s\S]*?<w:sz w:val="(\d+)"[\s\S]*?<\/w:r>/g)].map(
            (m) => Number(m[1]) / 2,
          ),
        );
        const body = sizeOf(c, 'Inventaire des appareils');
        const [s] = [...sizes];
        if (sizes.size !== 1) return `sizes ${[...sizes].join('/')}`;
        if (!(s! < body)) return `table ${s} pt, prose ${body} pt`;
        return t.size !== undefined && s! > t.size ? `${s} pt > source ${t.size} pt` : null;
      }),
      ...['RÉFRIGÉRATEUR', 'LAVE-VAISSELLE', 'SÈCHE-LINGE', 'THERMOSTAT', 'BUANDERIE'].map(
        fitsOneLine,
      ),
    ],
  },
  {
    id: 'prescription',
    suite: 'fonts',
    fix: '0fcb9def D-463',
    what: 'Prescription set in one font (fictional): sizes from letter widths (body lines one size, smaller and larger lines in the source ratio), header address lines not headings, an underline as long as the title becomes w:u while a longer signature rule does not, and the page-centered title is centered although the text around it is lopsided.',
    checks: [
      sameSize(
        '14 allée des Tilleuls',
        '71990 Vallon-sur-Brume',
        'Docteur Claire FONTAINE',
        'Ophtalmologiste',
        'Vallon le 11/05/2026',
        'Signature et cachet',
      ),
      sizeRatio('Une paire de lunettes avec monture', '14 allée des Tilleuls', 9.6 / 11.5),
      sizeRatio('Simple foyer', '14 allée des Tilleuls', 14.4 / 11.5),
      heading('71990 Vallon-sur-Brume', false),
      heading('Tél', false),
      custom('the title is underlined', (c) => {
        const p = xmlPara(c, 'ORDONNANCE DE LUNETTES');
        return !p ? 'missing' : allRuns(p, /<w:u w:val="single"\/>/) ? null : 'not underlined';
      }),
      custom('text above a longer rule is not underlined', (c) => {
        const p = xmlPara(c, 'Signature et cachet');
        return !p ? 'missing' : anyRun(p, /<w:u /) ? 'underlined' : null;
      }),
      aligned('ORDONNANCE DE LUNETTES', 'center'),
      custom('the centered title has w:jc center and no left indent', (c) => {
        const p = xmlPara(c, 'ORDONNANCE DE LUNETTES');
        if (!p) return 'missing';
        return jcOf(p) === 'center' && !indentLeft(p)
          ? null
          : `jc ${jcOf(p)}, left ${indentLeft(p)}`;
      }),
      aligned('Ancienne assistante des hôpitaux', 'left'),
    ],
  },
  {
    id: 'caps-heading-size',
    suite: 'fonts',
    fix: '0fcb9def D-463 (regressed by 261a67d4 D-533)',
    what: 'An all-capitals 16.3 pt title over 11.5 pt text on known A4 paper must keep its source size ratio (D-463 headings carry their own estimated size).',
    checks: [sizeRatio('ORDONNANCE DE LUNETTES', '14 allée des Tilleuls', 16.3 / 11.5)],
  },
  {
    id: 'narrow-receipt',
    suite: 'fonts',
    fix: '261a67d4 D-533; 18b816a7 D-534',
    what: '80 mm wide receipt PDF: fonts used to be calibrated to an A4 width and come out about 2.6× too large; they follow the physical paper, the two-line heading keeps its ratio to the body and stays centered.',
    checks: [
      custom('body ≈ 8 pt (±1)', (c) => {
        const s = sizeOf(c, 'Paid by card');
        return s >= 7 && s <= 9 ? null : `${s} pt`;
      }),
      sizeRatio('Harbour Cafe', 'Paid by card', 13 / 8, 0.15),
      aligned('Harbour Cafe', 'center'),
      custom('heading paragraph has w:jc center', (c) => {
        const p = xmlPara(c, 'Harbour Cafe');
        return !p ? 'missing' : jcOf(p) === 'center' ? null : `jc ${jcOf(p)}`;
      }),
    ],
  },
  {
    id: 'outside-formatting',
    suite: 'fonts',
    fix: '0539689b D-535',
    what: 'NIST CSF page with a labelled native diagram: removing the figure labels from the editable text changed the page statistics, so paragraphs outside the figure changed size or boldness; they keep one body size and stay regular.',
    recall: 0.85,
    checks: [
      sameSize(
        'This section defines the concepts',
        'describes an organization',
        'Every Organizational Profile includes',
        'The steps shown in Fig. 3',
      ),
      custom('body paragraphs outside the figure are not bold', (c) => {
        const bold = [
          'This section defines the concepts',
          'Every Organizational Profile includes',
          'The steps shown in Fig. 3',
        ].filter((t) => {
          const p = xmlPara(c, t);
          return !p || anyRun(p, /<w:b\/>/);
        });
        return bold.length ? `bold or missing: ${bold.join(', ')}` : null;
      }),
      heading('3.1. CSF Profiles'),
    ],
  },
  {
    id: 'align-within-column',
    suite: 'fonts',
    fix: '039c4f36 D-528',
    what: 'Two-column article: alignment used to be judged against the whole page, so the left-aligned "2 Results" heading and references in the right column came out centered or right-aligned.',
    checks: [
      aligned('2 Results', 'left'),
      aligned('References', 'left'),
      aligned('[1] Martin, E. Document analysis', 'left'),
      aligned('F1 = 2PR', 'left'),
      custom('right-column paragraphs have no w:jc', (c) => {
        const bad = ['2 Results', 'References', '[1] Martin', 'F1 = 2PR'].filter((t) => {
          const p = xmlPara(c, t);
          return !p || jcOf(p) !== 'left';
        });
        return bad.length ? bad.join(', ') : null;
      }),
    ],
  },
  {
    id: 'left-indent-snap',
    suite: 'fonts',
    fix: '5f61ae5e D-473 ③',
    what: 'Scanned block of paragraphs sharing one left edge (starting with W, J, T, 1, Y, A): their OCR boxes differ by a few pixels and used to get slightly different left indents, a jagged edge in Word.',
    checks: [
      custom('the indented paragraphs share one left indent', (c) => {
        const block = [
          'Wednesday 18 November',
          'Journey time',
          'The guided walk',
          'pupils still owe',
          'Your questions can be sent',
          'All costs are paid',
        ].map((t) => indentOf(c, t));
        const outer = indentOf(c, 'The trip is part of the biology course');
        if (new Set(block).size !== 1) return `indents ${block.join(', ')}`;
        return block[0]! > outer + 400 ? null : `block ${block[0]} vs outer ${outer}`;
      }),
    ],
  },
  {
    id: 'skewed-scan-long-lines',
    suite: 'fonts',
    fix: '6de41568; EU sample 050',
    what: 'A scan with a slight residual skew: the boxes of the longest lines (a 9 pt footer across the page, a centred thank-you sentence) are taller than their text by width × slope, so the footer came out at 18 pt and the sentence as a 15 pt heading.',
    lang: 'deu',
    checks: [
      heading('Wir bedanken uns', false),
      sizeRatio('Hotel am See | Seestraße', 'Anreise', 0.86, 0.06),
      sizeRatio('Wir bedanken uns', 'Anreise', 1, 0.1),
    ],
  },
];
