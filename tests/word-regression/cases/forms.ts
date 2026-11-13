// forms 套件：标签和值、表单栏位、填写框。
import {
  apart,
  custom,
  exactParagraph,
  leaves,
  notInRow,
  inRow,
  pairedRows,
  sideBySide,
  table,
  together,
} from '../lib/checks';
import type { Case } from '../lib/case';

export const FORMS: Case[] = [
  {
    id: 'label-value-pairs',
    suite: 'forms',
    fix: '7e2f35e3 D-332',
    what: 'Payslip header: a column of short labels and their values far to the right became two blocks (all labels, then all values) instead of one label/value pair per row.',
    lang: 'fra',
    checks: [
      pairedRows(
        ['DÉBUT DE PÉRIODE', '1 MARS 2026'],
        ['FIN DE PÉRIODE', '31 MARS 2026'],
        ["DATE D'ENTRÉE", '2 MAI 2021'],
        ['NUMÉRO DE SÉCURITÉ SOCIALE', '123 058'],
      ),
      apart('DÉBUT DE PÉRIODE', 'FIN DE PÉRIODE'),
    ],
  },
  {
    id: 'irs-w4-label-column',
    suite: 'forms',
    fix: '5f61ae5e D-473 ⑥; d937db44',
    what: 'IRS W-4: the narrow "Step N:" label column was merged into the content lines it labels; labels and content must sit side by side, with the full-width instructions outside the rows.',
    checks: [
      apart('Step 2:', 'Complete this step if you'),
      sideBySide('Step 2:', 'Complete this step if you'),
      sideBySide('Step 3:', 'If your total income will be'),
      sideBySide('Adjustments', 'If you want tax withheld for other income'),
      notInRow('Complete Steps 2–4 ONLY if they apply to you'),
    ],
    // ca14ef0b 曾让 Step 3 变成 5×3 的表、Step 4 整块丢失；d937db44 的按行守恒修好了。
  },
  {
    id: 'invoice-zh-header-rows',
    suite: 'forms',
    fix: '472354eb D-525',
    what: 'Chinese invoice header: after the layout regions were merged, the issuer field "开票方：北方工作室" was joined onto the date line above it.',
    lang: 'chi_sim',
    checks: [
      exactParagraph('开票方：北方工作室'),
      apart('2026-10-15', '开票方'),
      apart('开票方', '收件人'),
    ],
  },
  {
    id: 'form-field-labels',
    suite: 'forms',
    fix: '5796eb7f D-535',
    what: 'Form labels printed below short writing-field dividers were cut into wrong table cells at the divider positions; labels must stay whole, and the parallel header blocks stay side by side.',
    lang: 'fra',
    checks: [
      together("Numéro d'immatriculation actuel", "port d'attache"),
      together('Date de première', "mise à l'eau"),
      together('Numéro de coque du constructeur', 'catégorie de conception du bateau'),
      apart('Si le bateau est neuf', 'Numéro de coque'),
      apart("Numéro d'identification du moteur", 'Puissance nominale'),
      sideBySide('SERVICE DES', 'Articles 4 et 5'),
    ],
  },
  {
    id: 'irs-w9-header',
    suite: 'forms',
    fix: '5f61ae5e D-473 ⑨',
    what: 'IRS W-9 header: the large "Form W-9" mark was paired with the small print to its right as label<TAB>value rows (and written at the small print size).',
    checks: [
      custom('"W-9" is not paired with the small print beside it', (c) => {
        const p = leaves(c.doc).find(
          (l) =>
            l.leaf.kind === 'paragraph' &&
            l.leaf.text.includes('W-9') &&
            l.leaf.text.includes('\t'),
        );
        return p && p.leaf.kind === 'paragraph' ? `paired: ${JSON.stringify(p.leaf.text)}` : null;
      }),
      apart('W-9', 'Give form to the'),
    ],
  },
  {
    id: 'light-grey-ruled-table',
    suite: 'forms',
    fix: 'TBD; EU sample 006',
    what: "A table ruled with light grey lines (as in digital invoice and letter templates) was not seen as a table at all: the lines are lighter than the line finder's threshold on white paper, so the label/value rows fell apart into loose lines.",
    lang: 'fra',
    checks: [
      table({
        containing: ['Titulaire du compte', 'Atelier Brunel SARL', 'BNPAFRPPXXX'],
        rows: 4,
        cols: 2,
      }),
      inRow('IBAN', 'FR76 3000 4000 0312 3456 7890 143'),
      inRow('Référence à rappeler', 'FAC-2026-0415'),
    ],
  },
];
