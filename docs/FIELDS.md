# Adding a field type

Each table field type (text, amount, single choice, link, …) has exactly one definition: `packages/core/src/fields/<type>.ts`. Structure, writing and reading, display, CSV, printed reports, formulas, filtering and sorting, statistics and charts, change descriptions and the description sent to the AI are all read from that definition. On the app side, how to fill it in is in `FIELD_EDITORS` in `apps/mobile/src/renderer/data.tsx`. The example below is the link field `link` (D-250); the code is abridged from `packages/core/src/fields/link.ts`, which is authoritative (the linked table is called `table` in the field). For adding a page component, see `docs/COMPONENTS.md`.

## 1. Definition file: `packages/core/src/fields/link.ts`

```ts
const schema = z.strictObject({ ...fieldBase, type: z.literal('link'), table: IdSchema });

export const linkField: FieldDefinitionOf<'link', typeof schema> = defineField({
  type: 'link',
  schema,
  label: ['引用', 'link to another table'],
  read: (_f, raw) => (isRecordId(raw) ? raw : undefined),
  write: (_f, input) => (isRecordId(input) ? { value: input } : { issue: 'invalid' }),
  format: (f, v, locale, links) =>
    links ? (links(f.table, v as string) ?? t(locale, 'linkDeleted')) : '',
  filter: { is: isText, emptyOnly: true },
  sort: false,
  check: (f, { config, collection }) => /* the linked table must exist */ [],
  ai: { doc: '{table} (picks one entry of another table, …)', docAfter: 'formula' },
  example: { id: 'parent', name: 'Parent', type: 'link', table: 'expenses' },
  exampleValue: 'r1',
});
```

What each entry means (types and comments are in `fields/define.ts`):

- **schema**: the structure of the field definition, including `...fieldBase` (id, name, required). Only allowlisted values.
- **label**: the type name used in change descriptions, as `[Chinese, English]` (here the Chinese is `'引用'`, "link"); French uses the mapping of the English one in `french-pairs.ts` (add an entry if there is none).
- **read**: tolerant reading. If the value does not match the current definition (the type changed after restoring an old version, an option was deleted), return `undefined`; it is simply not shown and must never raise an error.
- **write**: form input → stored value, strictly validated, returning `{ value }` or `{ issue: 'invalid' | 'tooLong' }`. If absent, no value is stored (formula). **initial**: the default value of a new record (if absent, the `default` in the definition is used). **emptyNew**: what to store when a new record has no value (for a checkbox it is `false`).
- **format**: the display text (lists, record pages, export and reports all use it). **csv**: only write it when CSV needs a more machine-readable form (an amount with two decimals). **formatAmount**: how totals and averages are displayed (amounts with currency, numbers with units). **print**: whether it is a right-aligned number column in reports and whether the receipt total uses it.
- **formula**: whether a formula can reference it, and whether it counts as `number` or `date`. **numeric**: whether statistics and charts can sum and average it. **inForm: false**: it cannot be filled in the record form.
- **filter**: what filtering supports: `is` (whether the value matches), `contains`, `compare` (`number` or `date`), `period`, `emptyOnly` (can only check whether there is a value), `schedule` (filter by due, for the schedule field, D-294). **sort: false** means it cannot be sorted; you can also give a function to sort in its own order (single choice sorts by option order).
- **titleRank**: which field is used as the title when referenced (smaller number first). **convertGroup**: types in the same group can be converted into each other (text and long text, number and amount).
- **check**: checks on the field definition itself (the linked table must exist, options must not repeat); the issue text is sent to the AI.
- **ai.doc**: the segment of the `Field = …` line in the prompt (the part after the type name, in English). **docAfter** is only written to avoid changing the order of the existing prompt.
- **example / exampleValue**: a working field and a value, which the generic tests use to write, read, display and filter. For a linked table write `expenses`, and formulas use the `weight` field.

Then add it to `FIELDS` in `fields/index.ts` **at the end** (the order is the order in the config JSON Schema).

## 2. App: `apps/mobile/src/renderer/data.tsx`

Add an entry to `FIELD_EDITORS`: `input` is the control in the form (called as a function; anything that needs a hook is written as its own component, for example `LinkInput`); `toForm` turns the record's value into the form's value (a number is text while being edited); `inline` puts the label and the control on the same line; `computed` means it cannot be filled in and only shows the computed value. Lists, record pages and export all use core's `format`, with nothing more to write.

## 3. Copy, eval, baseline

- Text used for display goes into `en.ts`, `zh.ts` and `fr.ts` in `packages/core/src/messages/`, as complete sentences; for copy with a count, write the singular as AGENTS.md says, and run `npm run check:locales`.
- In `packages/core/src/ai/eval-cases.ts`, add one or two cases following `LK1`; if the prompt changed, run only the affected cases with Haiku.
- The config JSON Schema (`core/src/__snapshots__/baseline.test.ts.snap`) and the prompt (`planner/src/__snapshots__/system-prompt.txt`) will change: confirm the difference is only the new type, then update with `-u`. The `fields-baseline` snapshot locks the output of existing types and should not change when a new type is added.
- Tests that cover a new type automatically: `core/src/fields.test.ts` (structure, write/read/display/export, filtering, forms, sorting, statistics and formulas all match the definition), `planner/src/prompt-baseline.test.ts` (the prompt contains its description) and `mobile/src/__tests__/field-registry-test.tsx` (it can be filled in and displayed in all three languages). Write separate tests for the field's own behavior.

## 4. DECISIONS and version number

Adding a field type changes the existing table structure, so per D-254 `CURRENT_SCHEMA_VERSION` must be raised: add a migration that only raises the version number, with a test, in `migrate.ts`; and write clearly in `docs/DECISIONS.md` and `docs/DATA_DESIGN.md` how the value is stored and what the AI can do.

## 5. Simulator

Add this field to a table and look at all three languages and dark mode: a new record (no value), with a value, and edge cases (very long or very large value, mismatch after restoring an old version); go through the record page, list, statistics, filtering, CSV export and PDF generation.
