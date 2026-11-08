# Adding a page component

Each **look** of a block on a page (title, record list, chart, …) has exactly one definition: `packages/core/src/components/<look>.ts`, written with `defineLook`. Structure validation, reference checks, change descriptions, long-press editing and the prompt sent to the AI are all read from that definition. On the app side, each look has one way to draw it in `RENDERERS` in `apps/mobile/src/renderer/registry.tsx`.

A block has a fixed set of keys (since v34, see the comment at the top of `components/define.ts`): `look` (how to draw it), `show` (the options of this look), `source` (which table to read, read-only), `tools` (every operation that writes data hangs here), `opens` (where a tap goes, navigation only), `children` (groups only). A block stores no user data, only the IDs of tables, fields, pages and tools (invariant 14).

## 1. Definition file: `packages/core/src/components/<look>.ts`

The smallest one (it is the same code as `components/docs-example.test.ts`, which is type-checked and run; if you change how `defineLook` is written, change that file first, then this one):

```ts
const shape = {
  show: z.strictObject({ title: boundedText(1, 60) }),
  source: z.strictObject({ table: IdSchema }),
};

export const exampleComponent: LookDefinitionOf<'example', typeof shape> = defineLook({
  look: 'example',
  shape,
  kind: 'container',
  layer: 'table',
  reads: 'table',
  writes: false,
  refs: { 'source.table': { to: 'table' } },
  describe: (c, _config, ctx) => t(ctx.locale, 'describeChart', { v0: c.show.title }),
  edit: { text: [{ prop: 'title', max: 60 }], style: ['tone'] },
  ai: { doc: 'show {title}, source {table}: one number per entry of the table' },
  example: { show: { title: 'Spending' }, source: { table: 'expenses' } },
});
```

For a real example with the full usage of `check`, grouping, time ranges and so on, see `components/chart.ts` (chart, D-249). What each entry means (types and comments are in `components/define.ts`):

- **look / shape**: `look` is the look name (the `look` in the block JSON). `shape` is the zod structure of every key other than `id`, `hidden`, `style`, `showIf` and `pin` (`show`, `source`, `tools`, `opens`, …). Always use `boundedText(min, max)` or `richText(max)` for text, and give numbers and lists lower and upper bounds. Only allowlisted values are accepted, with no expressions or executable content. Write `LookDefinitionOf<'look name', typeof shape>` (the callbacks use the config's types, and TypeScript cannot infer them if you leave it out).
- **kind / layer / reads / writes / tools**: where this look sits among "data · containers · tools" (relation rules 1–6): whether it reads a table (`reads`), whether write tools can hang on it (`writes`), and which kinds (`tools`). The block itself is read-only; an operation that writes data can only be a tool hung in `tools`.
- **refs**: which keys of the block refer to what in the config. The generic check examines them. The key is a path (`source.table`, `source.filter`, `show.title`, …) and the value is `table` (the table must exist), `field` (the field of this table must exist; `types` restricts the field type, and `role` is the name used in the issue text), `filter` (a filter condition), `target` (a page, system entry or tool) or `package` (`installed` or `catalog`). Blocks that read a table are listed under "Data components" in the prompt and are removed together with the table when it is deleted.
- **check**: rules beyond the generic check that only this look has; it returns issue text. The text is sent to the AI so it can fix the problem: say which key and what it should be. References that depend on other keys (for example `choiceField` is only needed when `group` is `choice`) go here.
- **describe**: how change descriptions refer to it (for example "chart “Monthly spending”"). The copy goes in `messages/` (step 3).
- **edit**: the text that long-press editing can change (`prop` is a key in `show`, and `max` must equal the limit in the structure) and the look settings that can be adjusted (`tone`, `align`, `size`). List only the looks the renderer actually shows; data blocks usually get only `tone`. When the block has a file the user picked, write `asset: 'file'` and long-press editing then offers "Choose a file / Replace file / Remove file" (file entry `fileSlot`, D-257). For a card with a background color, write `backdrop: true` so an image can replace the background color (`style.backdrop`, D-258): the renderer passes `style.backdrop` to `Card`, and the text color uses `onPicture(palette, backdrop)`.
- **ai.doc**: one line of the look list in the prompt (the part after the `look` name, in English). Follow the existing lines for how keys are written (`?` means optional; list the allowed values and ranges), and give the usage in one sentence after the colon. **ai.rule**: a usage that needs to be taught to the AI separately is written as one rule; `n` is the number of the current last rule plus 1.
- **example**: a working example (without `id` and `look`), which tests use to validate and render. Refer only to things in the sample config: the table `expenses` (the bookkeeping template's `amount`, `category`, `date`, `note`), the added tool `pdf`, and the quick action `pdf-merge`.

Then add it to `LEAF_COMPONENTS` in `components/leaves.ts` **at the end** (blocks that can go in a group; the order is the order in the config JSON Schema, so do not insert it in the middle).

## 2. Drawing: `apps/mobile/src/renderer/`

- Write a component file (for example `Chart.tsx`). Records are read on the device with `useRecords` / `useComputedRecords` and never go into the config.
- Add a line to `RENDERERS` in `registry.tsx`. The key is the look name (`look`), and the arguments are the block (`c.show`, `c.source`, `c.style`) and `env`: `chart: (c, env) => <Chart block={c} env={env} tone={c.style?.tone} />`. This is called as a function, so hooks cannot be used directly; put anything that needs a hook in its own component.
- A record value that does not match the current definition (missing, wrong type, option deleted) is simply not shown and must never crash the page (DATA_DESIGN.md).
- Tappable parts must be wired to `env.onLongPress` (long-press editing) and `env.locked` (viewable but not usable in a draft, D-190).

## 3. Copy: `packages/core/src/messages/`

Change descriptions (`describe`) and the text shown in the component all go into `messages/en.ts`, `zh.ts` and `fr.ts`, with complete sentences in all three languages (the keys in the three files must be identical; a missing one fails to compile). Copy with a count needs the singular form added to `enSingular` and `frSingular`, and `PLURAL_COUNT_VARIABLE` in `messages.ts` must say which parameter decides it (default `n`; in French both 0 and 1 use the singular). Do not use `Intl.PluralRules`. Run `npm run check:locales` when done.

## 4. Eval cases: `packages/core/src/ai/eval-cases.ts`

(The eval set is not exported from the main `@morph/core` entry; scripts and tests use `@morph/core/src/eval`.)

Add one or two cases following `CH1` and `CH2`: what the user says, that the expected ops contain this component, and that the key properties are right. Cases run only when the prompt changed, only with Haiku, and only the affected ones: `npm run eval -- --model claude-haiku-5-5 --cases CH1,CH2`.

## 5. Baseline snapshots

Adding a component changes two deliberately locked outputs. Update them only after confirming the difference is just the new component:

- The config JSON Schema: `packages/core/src/__snapshots__/baseline.test.ts.snap` (`cd packages/core && npx vitest run src/baseline.test.ts -u`).
- The prompt: `packages/planner/src/__snapshots__/system-prompt.txt` (`cd packages/planner && npx vitest run src/prompt-baseline.test.ts -u`). If the prompt changed, run the eval from step 4.

Tests that need no change: `core/src/components.test.ts` (the example passes validation in all three languages, has a change description, the `edit` limits match the structure, the AI description is not empty), `planner/src/prompt-baseline.test.ts` (the prompt contains its `ai.doc` and rules, and rule numbers are consecutive) and `mobile/src/__tests__/component-registry-test.tsx` (it can be drawn in all three languages; data components also get three cases: no records, some records, many or irregular records) cover the new component automatically. Write separate tests for the component's own behavior (for example how a chart groups).

## 6. DECISIONS and version number

Add an entry to `docs/DECISIONS.md` (check the largest D number on main first), saying clearly what the properties are and what the AI can and cannot do. Adding just one new look does **not** raise `CURRENT_SCHEMA_VERSION` (D-254): old configs still read fine, and an app that has not been updated keeps it as is and shows "needs a newer version of this app". Changing an existing structure (adding a property to an existing component, adding a field type, changing a value range) still requires raising the version and writing a migration in `migrate.ts`. A new use of a data component is also written into `docs/DATA_DESIGN.md`.

## 7. Simulator

Unit tests cannot prove it draws correctly on a phone. Before merging, on the simulator:

- Use the AI or a template to add the component to a page, and look at three states: a new user (no records), with data, and edge cases (many records, missing values, very long text, inside a group on a narrow screen).
- Long press: the text and look settings that can be changed are all there, and changing and undoing both work; dragging can move it into and out of a group.
- In a draft (D-190) it can be viewed but not used; check preview, dark mode and larger font size.
- Switch to English and French and go through it from a fresh install.
