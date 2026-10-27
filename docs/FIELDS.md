# 新增一种字段类型

数据表的字段（文字、金额、单选、引用……）每种只有一份定义：`packages/core/src/fields/<type>.ts`。结构、写入和读取、显示、CSV、打印报表、公式、筛选和排序、统计和图表、修改说明、发给 AI 的说明都从这份定义读；App 端怎么填写在 `apps/mobile/src/renderer/data.tsx` 的 `FIELD_EDITORS`。下面以引用字段 `link`（D-250）为例。新增页面组件见 `docs/COMPONENTS.md`。

## 1. 定义文件：`packages/core/src/fields/link.ts`

```ts
const schema = z.strictObject({ ...fieldBase, type: z.literal('link'), collectionId: IdSchema });

export const linkField: FieldDefinitionOf<'link', typeof schema> = defineField({
  type: 'link',
  schema,
  label: ['引用', 'link to another table'],
  read: (_f, raw) => (isRecordId(raw) ? raw : undefined),
  write: (_f, input) => (isRecordId(input) ? { value: input } : { issue: 'invalid' }),
  format: (f, v, locale, links) =>
    links ? (links(f.collectionId, v as string) ?? t(locale, 'linkDeleted')) : '',
  filter: { is: isText, emptyOnly: true },
  sort: false,
  check: (f, { config, collection }) => /* 引用的表要存在 */ [],
  ai: { doc: '{collectionId} (picks one entry of another table, …)', docAfter: 'formula' },
  example: { id: 'parent', name: 'Parent', type: 'link', collectionId: 'expenses' },
  exampleValue: 'r1',
});
```

每一项的意思（类型和注释见 `fields/define.ts`）：

- **schema**：字段定义的结构，带上 `...fieldBase`（id、name、required）。只有白名单里的取值。
- **label**：修改说明里的类型名 `[中文, 英文]`；法语用英文那一个在 `french-pairs.ts` 里的对照（没有就加一条）。
- **read**：宽容读取。值和当前定义对不上（恢复旧版本后类型变了、选项删了）就返回 `undefined`，只是不显示，绝不报错。
- **write**：表单输入 → 存的值，严格校验，返回 `{ value }` 或 `{ issue: 'invalid' | 'tooLong' }`。不写就是不存值（公式）。**initial**：新记录的默认值（不写用定义里的 `default`）；**emptyNew**：新记录没有值时存什么（勾选框是 `false`）。
- **format**：显示文字（列表、记录页、导出、报表都用它）。**csv**：CSV 里要更机器可读的写法时才写（金额两位小数）。**formatAmount**：合计、平均怎么显示（金额带货币、数字带单位）。**print**：报表里是不是靠右的数字列、收据合计用不用它。
- **formula**：公式里能不能引用、当作 `number` 还是 `date`。**numeric**：统计和图表能不能求和、平均。**inForm: false**：记录表单里不能填。
- **filter**：筛选支持什么：`is`（值对不对得上）、`contains`、`compare`（`number` 或 `date`）、`period`、`emptyOnly`（只能看有没有值）。**sort: false** 不能排序；也可以给一个函数按自己的顺序排（单选按选项顺序）。
- **titleRank**：被引用时用哪个字段当标题（数字小的优先）。**convertGroup**：同一组的类型可以互相改（文字和长文本、数字和金额）。
- **check**：字段定义本身的检查（引用的表要存在、选项不重复），问题文字会发给 AI。
- **ai.doc**：提示词里 `Field = …` 那一行的一段（类型名后面的部分，英文）；**docAfter** 只有为了不改动已有提示词的顺序才写。
- **example / exampleValue**：一个能用的字段和一个值，通用测试拿它们写入、读出、显示、筛选。引用的表写 `expenses`，公式用 `weight` 字段。

然后加到 `fields/index.ts` 的 `FIELDS` **最后**（顺序就是配置 JSON Schema 里的顺序）。

## 2. App：`apps/mobile/src/renderer/data.tsx`

在 `FIELD_EDITORS` 里加一项：`input` 是表单里的控件（按函数调用，要用 hook 的写成自己的组件，例如 `LinkInput`）；`toForm` 是记录的值换成表单里的值（数字编辑时是文字）；`inline` 是标签和控件在同一行；`computed` 是不能填、只显示算出来的值。列表、记录页、导出都用 core 的 `format`，不用另写。

## 3. 文案、评测、基线

- 显示用到的文字进 `packages/core/src/messages.ts`，en / zh / fr 写完整的句子，带数量的照 AGENTS.md 写单数，跑 `npm run check:locales`。
- 在 `packages/core/src/ai/eval-cases.ts` 照 `LK1` 加一两个用例；提示词变了，只用 Haiku 跑受影响的用例。
- 配置 JSON Schema（`core/src/__snapshots__/baseline.test.ts.snap`）和提示词（`planner/src/__snapshots__/system-prompt.txt`）会变：确认差异只是新类型，再用 `-u` 更新。`fields-baseline` 的快照锁住已有类型的输出，加新类型时它不应该变。
- 自动覆盖新类型的测试：`core/src/fields.test.ts`（结构、写入读出显示导出、筛选、表单、排序、统计、公式都和定义一致）、`planner/src/prompt-baseline.test.ts`（提示词里有它的说明）、`mobile/src/__tests__/field-registry-test.tsx`（三种语言都能填、能显示）。这种字段自己的行为另写测试。

## 4. DECISIONS 和版本号

新增字段类型改了已有的数据表结构，按 D-254 要提升 `CURRENT_SCHEMA_VERSION`，在 `migrate.ts` 加一个只提升版本号的迁移和测试；在 `docs/DECISIONS.md` 和 `docs/DATA_DESIGN.md` 写清楚值怎么存、AI 能做什么。

## 5. 模拟器

在一张表里加上这种字段，三种语言、深色模式各看一遍：新记录（没有值）、有值、边界（值很长、很大、恢复旧版本后对不上）；记录页、列表、统计、筛选、导出 CSV、生成 PDF 都走一遍。
