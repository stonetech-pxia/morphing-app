// forms 套件：标签和值、表单栏位、填写框。
import {
  aligned,
  apart,
  custom,
  differentTables,
  exactParagraph,
  leaves,
  notInRow,
  inRow,
  notInTable,
  order,
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
    fix: 'ecdb14ce; EU sample 006',
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
  {
    id: 'blank-invoice-grids',
    suite: 'forms',
    fix: '85529b71; EU samples 001, 006',
    what: 'Blank invoice template: the empty item grid (headers printed above it) vanished, leaving only the header words over a gap, and the label | empty answer box table lost its answer column, so there was nothing left to fill in.',
    lang: 'fra',
    checks: [
      table({
        containing: ['RÉFÉRENCE', 'DÉSIGNATION', 'QTÉ', 'PRIX UNITAIRE', 'TOTAL HT'],
        rows: 9,
        cells: [{ row: 0, col: 0, text: 'RÉFÉRENCE' }],
      }),
      custom('the item grid has 5 cells in every row, all empty below the header', (c) => {
        const t = leaves(c.doc)
          .map((l) => l.leaf)
          .find((b) => b.kind === 'table' && b.table.cells.some((x) => /DÉSIGNATION/.test(x.text)));
        if (!t || t.kind !== 'table') return 'no item table';
        const rows = Array.from({ length: t.table.rows }, (_, r) =>
          t.table.cells.filter((x) => x.row === r),
        );
        if (rows.some((r) => r.length !== 5)) return `cells per row: ${rows.map((r) => r.length)}`;
        return rows.slice(1).some((r) => r.some((x) => x.text.trim())) ? 'body not empty' : null;
      }),
      custom('each label keeps an empty answer cell beside it', (c) => {
        const t = leaves(c.doc)
          .map((l) => l.leaf)
          .find(
            (b) => b.kind === 'table' && b.table.cells.some((x) => /Nom du client/.test(x.text)),
          );
        if (!t || t.kind !== 'table') return 'no label table';
        if (t.table.rows !== 3) return `${t.table.rows} rows`;
        for (let r = 0; r < 3; r++) {
          const row = t.table.cells.filter((x) => x.row === r).sort((a, b) => a.col - b.col);
          if (row.length !== 2 || !row[0]!.text.trim() || row[1]!.text.trim())
            return `row ${r}: ${JSON.stringify(row.map((x) => x.text))}`;
        }
        return null;
      }),
      notInTable('Complétez les champs ci-dessous'),
      notInTable('Veuillez libeller votre chèque'),
    ],
  },
  {
    id: 'stacked-form-subtables',
    suite: 'forms',
    fix: '9f3747d6; EU sample 004',
    what: 'A registration form whose person tables share one outer frame chained into one page-wide grid, rejected as form ruling: the row numbers 1–4 of every sub-table were printed first in one column and the column headers afterwards, with nowhere to fill in.',
    lang: 'deu',
    checks: [
      table({
        containing: ['Lfd. Nr.', 'Familienname', 'Frühere Namen', 'Vorname(n)', '4'],
        rows: 5,
      }),
      table({
        containing: ['Doktorgrad', 'Geburtsdatum', 'Geschlecht', 'Geburtsort', '4'],
        rows: 5,
      }),
      table({
        containing: ['Staatsangehörigkeit', 'Familienstand', 'Religionsgesellschaft'],
        rows: 5,
      }),
      differentTables('Familienname', 'Doktorgrad'),
      order('Familienname', 'Doktorgrad', 'Staatsangehörigkeit', 'Mit Ihrer Unterschrift'),
      notInTable('Mit Ihrer Unterschrift versichern Sie'),
    ],
  },
  {
    id: 'framed-section-checkboxes',
    suite: 'forms',
    fix: 'guard for 85529b71, 9f3747d6 (batch-02 problem 1 shape)',
    what: 'Guard: framed form sections (a cerfa-like vehicle transfer form) with checkboxes, fill-in field boxes with end ticks and a SIRET comb must stay text; checkbox sides, comb ticks and field-box edges must not become the columns of a fake grid. This page does not reproduce the 37×3 grid of EU sample 014; three-framed-sections does.',
    lang: 'fra',
    checks: [
      custom('no table with more than 3 columns', (c) => {
        const wide = leaves(c.doc)
          .map((l) => l.leaf)
          .filter((b) => b.kind === 'table' && b.table.cols > 3);
        return wide.length
          ? `tables: ${wide.map((t) => (t.kind === 'table' ? `${t.table.rows}×${t.table.cols}` : '')).join(', ')}`
          : null;
      }),
      together(
        "Que ce véhicule n'a pas subi de transformation notable",
        "l'actuel certificat d'immatriculation",
      ),
      order(
        'Ancien propriétaire',
        'Personne physique',
        'Je soussigné',
        'Je certifie en outre',
        'Nouveau propriétaire',
      ),
    ],
  },
  {
    id: 'three-framed-sections',
    suite: 'forms',
    fix: 'ed970802; EU sample 014',
    what: 'Three stacked framed sections (cerfa-like vehicle transfer form) whose top rules are broken by the section titles: the frames were not grids, but their three full-width bottom rules (and three fill-in underlines with aligned ends) chained into one horizontal-rules-only table, so two whole sections became one page-tall grid with one row per text line.',
    lang: 'fra',
    checks: [
      notInTable('Je certifie en outre'),
      notInTable('Avoir été informé de la situation administrative'),
      together(
        "Que ce véhicule n'a pas subi de transformation notable",
        "l'actuel certificat d'immatriculation",
      ),
      order('LE VÉHICULE', 'Ancien propriétaire', 'Je certifie en outre', 'Nouveau propriétaire'),
    ],
  },
  {
    id: 'fill-in-lines',
    suite: 'forms',
    fix: 'EU sample 021, 030',
    what: 'A form whose fields are dotted leaders (inside and after labels, and stand-alone dotted lines) and L-bracket answer lines and a comb: OCR does not read them, so every field was lost, labels ran together, and the emptied space made the centred captions a second column that came out before the labels.',
    checks: [
      order(
        'ZAŚWIADCZENIE',
        'Stwierdza się',
        '(imię i nazwisko pracownika)',
        'imiona rodziców',
        'urodzony',
        '(data urodzenia)',
        'był zatrudniony',
        '(pracodawca)',
        'w okresie od',
        'Ulica i numer domu',
        'Numer PESEL',
      ),
      apart('imiona rodziców', 'urodzony'),
      apart('Stwierdza się', '(imię i nazwisko pracownika)'),
      custom('dotted leaders stay after their labels and inside the lines', (c) => {
        const want = [
          /Stwierdza się, że \.{20,}/,
          /imiona rodziców \.{20,}/,
          /był zatrudniony \.{20,}/,
          /w okresie od \.{4,} do \.{4,} w wymiarze \.{4,}/,
        ];
        const texts = c.paras.map((p) => p.text);
        const missing = want.filter((re) => !texts.some((t) => re.test(t)));
        return missing.length ? `no paragraph matches ${missing.join(', ')}` : null;
      }),
      custom('the stand-alone dotted line is kept', (c) =>
        c.paras.some((p) => /^\s*\.{20,}\s*$/.test(p.text)) ? null : 'missing',
      ),
      custom('each answer line follows its label', (c) => {
        const labels = [
          'Ulica i numer domu',
          'Kod pocztowy',
          'Kraj',
          'Telefon',
          'Adres e-mail',
          'Numer PESEL',
        ];
        const bad = labels.filter(
          (l) => !c.paras.some((p) => new RegExp(`${l} _{8,}`).test(p.text)),
        );
        return bad.length ? `no field after ${bad.join(', ')}` : null;
      }),
      notInTable('Ulica i numer domu'),
      // 接了点线的整行宽的行不按左右各空一点算成居中。
      aligned('imiona rodziców', 'left'),
      aligned('urodzony', 'left'),
    ],
  },
];
