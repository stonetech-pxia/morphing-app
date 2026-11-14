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
    fix: '43ffdafc, 8580c2a2; EU sample 021, 030',
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
  {
    id: 'open-blank-grids',
    suite: 'forms',
    fix: 'd1bebd26; EU sample 031',
    what: 'Two blank "Lfd. Nr. / Datum von / Datum bis / Kalendertag(e)" grids side by side, with only horizontal rules and inner column lines (no outer verticals) and the header above the first rule: they were taken for form ruling, so the header became loose lines and the rows a two-column number list that swallowed the footer; each must be a fillable 12×4 table.',
    lang: 'deu',
    checks: [
      table({ containing: ['Lfd.', 'Datum von', 'Kalender', '1', '11'], rows: 12, cols: 4 }),
      table({ containing: ['Lfd.', 'Datum bis', '12', '22'], rows: 12, cols: 4 }),
      notInTable('Seite 2 von 3'),
    ],
  },
  {
    id: 'answer-lines-gap',
    suite: 'forms',
    fix: '22fea454, 0a2aa82e; EU sample 041',
    what: 'Two runs of evenly spaced grey answer lines (a label under each) with a bold "erteile hiermit Vollmacht an" between them, and a last lone line far below a section of clauses: all were chained into one rules-only table that swallowed the bold line, the section heading and the clauses, one bordered row per text line.',
    lang: 'deu',
    checks: [
      notInTable('erteile hiermit Vollmacht an'),
      notInTable('Aufenthalt und Wohnungsangelegenheiten'),
      notInTable('Sie darf meinen Aufenthalt bestimmen.'),
      notInTable('Wohnungsmietvertrag'),
      order(
        'Ich,',
        'Name, Vorname',
        'erteile hiermit Vollmacht an',
        'Aufenthalt und Wohnungs',
        'Formular Vollmacht',
      ),
    ],
  },
  {
    id: 'framed-row-last-fill',
    suite: 'forms',
    fix: '204ab1d3; EU sample 046',
    what: 'Rows of a framed form section ("Localidad …… C.P. …… Provincia ……") whose last dotted fill-in line runs into the right side of the frame: that line was taken for an edge of the frame and dropped, so the row ended in a bare label and was joined with the next row.',
    lang: 'spa',
    checks: [
      custom('every label is followed by its fill-in line', (c) => {
        const want = [
          /Nombre\/Razón Social _{4,} DNI\/NIE\/PAS _{4,}/,
          /Localidad _{4,} C\.P\. _{4,} Provincia _{4,}/,
          /Teléfono móvil _{4,} E-mail _{4,}/,
        ];
        const texts = c.paras.map((p) => p.text);
        const missing = want.filter((re) => texts.filter((t) => re.test(t)).length < 2);
        return missing.length ? `no two paragraphs match ${missing.join(', ')}` : null;
      }),
      apart('Provincia', 'Teléfono móvil'),
      apart('DNI/NIE/PAS', 'Domicilio de residencia'),
    ],
  },
  {
    id: 'yes-no-answer-column',
    suite: 'forms',
    fix: '29f0d2ff; EU sample 041',
    what: 'Clauses of 1–3 lines with a "○ ja ○ nein" pair beside the last line of each, two of them one-line clauses 1 line apart: the clauses and the answers became one side-by-side row whose answer cell drifted away from its clauses in Word, and two answer pairs were joined into one heading-size paragraph.',
    lang: 'deu',
    checks: [
      custom('each answer pair is its own paragraph in the row of its clause', (c) => {
        const ls = leaves(c.doc).filter((l) => l.leaf.kind === 'paragraph');
        const answers = ls.filter((l) => l.leaf.kind === 'paragraph' && /nein/.test(l.leaf.text));
        if (answers.length !== 6) return `${answers.length} answer paragraphs, want 6`;
        // 条款可能是段落，也可能是列表项（补回了「■」记号）。
        const clauseOf = (re: RegExp) =>
          leaves(c.doc).find(
            (l) =>
              (l.leaf.kind === 'paragraph' && re.test(l.leaf.text)) ||
              (l.leaf.kind === 'list' && l.leaf.items.some((t) => re.test(t))),
          );
        const want: [RegExp, number][] = [
          [/Patientenverfügung/, 0],
          [/Schweigepflicht/, 1],
          [/Unterbringung/, 2],
          [/Bettgitter/, 3],
          [/Zwangsmaßnahmen \(§ ?1832 Absatz 1/, 4],
          [/Verbringung/, 5],
        ];
        for (const [re, k] of want) {
          const clause = clauseOf(re);
          if (!clause?.row) return `${re} is not in a side-by-side row`;
          if (answers[k]!.row?.block !== clause.row.block)
            return `answer ${k + 1} is not in the row of ${re}`;
        }
        return null;
      }),
    ],
  },
  {
    id: 'framed-header-row-answer-lines',
    suite: 'forms',
    fix: 'e082ade1; EU sample 016 p3 (regression after 43ffdafc)',
    what: 'A framed contribution form with the column captions "CONCEPTO  BASE  TIPO  APORTACIÓN EMPRESA" over items with answer lines: with the frame not kept as a table, the right-hand captions had no text below them and were read as a column after all the items.',
    lang: 'spa',
    checks: [
      order(
        'CONCEPTO',
        'BASE',
        'TIPO',
        'APORTACIÓN',
        '1. Contingencias comunes',
        'TOTAL',
        '4. Base sujeta',
      ),
    ],
  },
  {
    id: 'ruled-field-boxes',
    suite: 'forms',
    fix: '209af9e5, 85746143; EU sample 062',
    what: 'A fully ruled blank application form (like the Polish PIT-37): every row splits into boxes at different places and most boxes are empty below a short label, so the page-wide grid was rejected as form ruling; the boxes vanished, leaving nowhere to type, and the labels became numbered list items.',
    checks: [
      inRow('10. Nazwisko', '11. Pierwsze imię', '12. Data urodzenia'),
      inRow('16. Gmina', '17. Ulica', '18. Nr domu', '19. Nr lokalu'),
      inRow('25. Gmina', '26. Ulica', '27. Nr domu', '28. Nr lokalu'),
      differentTables('10. Nazwisko', '22. Kraj'),
      notInTable('mieszkasz w gminie co najmniej od roku'),
      notInTable('korekta złożona na wezwanie urzędu'),
      order(
        'B.1. Dane wnioskodawcy',
        '10. Nazwisko',
        '20. Miejscowość',
        'B.2. Adres korespondencyjny',
        '22. Kraj',
      ),
    ],
  },
  {
    id: 'label-frame',
    suite: 'forms',
    fix: 'EU sample 061 (regression after 42115fb8)',
    what: 'A framed insurance box of short labels and values whose inner rules were not found (only its outer frame): the plain-frame rule for letters took it for framed text and dropped the table, so the labels became loose lines.',
    lang: 'deu',
    checks: [table({ containing: ['Krankenkasse bzw. Kostenträger', 'AOK Rheinland/Hamburg'] })],
  },
  {
    id: 'inline-underscore-blanks',
    suite: 'forms',
    fix: 'EU sample 095',
    what: 'Contract template with underscore blanks inside its sentences ("(DNI/NIE ______),"): the blanks are drawn as rules on the text baseline, and where their ends happened to line up down the page they were chained into a tall rules-only table at the right margin that pulled in pieces of the sentences around it.',
    lang: 'spa',
    checks: [
      notInTable('DNI/NIE'),
      notInTable('exclusivamente'),
      notInTable('contacto'),
      order(
        'ARRENDADOR/A',
        'ARRENDATARIO/A',
        'AVALISTA',
        'EXPONEN',
        'OBJETO Y DESTINO',
        'exclusivamente',
        'DURACIÓN',
      ),
    ],
  },
];
