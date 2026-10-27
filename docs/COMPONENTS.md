# 新增一种页面组件

页面组件（标题、记录列表、图表……）每种只有一份定义：`packages/core/src/components/<type>.ts`。结构校验、引用检查、修改说明、长按编辑、发给 AI 的提示词都从这份定义读；App 端每种组件在 `apps/mobile/src/renderer/registry.tsx` 的 `RENDERERS` 里有一个画法。下面以图表 `chart`（D-249）为例。

## 1. 定义文件：`packages/core/src/components/chart.ts`

```ts
const props = z.strictObject({
  collectionId: IdSchema,
  kind: z.enum(['bar', 'line', 'pie']),
  aggregate: z.enum(['count', 'sum', 'avg']),
  fieldId: IdSchema.optional(),
  group: z.enum(['day', 'week', 'month', 'choice']),
  dateField: FieldRefSchema.optional(),
  choiceField: IdSchema.optional(),
  periods: z.number().int().min(2).max(31).optional(),
  filter: z.array(ConditionSchema).max(5).optional(),
  title: boundedText(1, 60),
});

export const chartComponent: ComponentDefinitionOf<'chart', typeof props> = defineComponent({
  type: 'chart',
  props,
  refs: { collectionId: { to: 'collection' }, filter: { to: 'filter' } },
  check: (c, { collection }) => [/* 饼图只能按单选分，等等 */],
  describe: (c, _config, ctx) => t(ctx.locale, 'describeChart', { v0: c.props.title }),
  edit: { text: [{ prop: 'title', max: 60 }], style: ['tone'] },
  ai: {
    doc: '{collectionId, kind: "bar"|"line"|"pie", …, title}: a pie chart needs group "choice"',
    rule: { n: 35, text: 'Charts (…) → …' },
  },
  example: {
    props: {
      collectionId: 'expenses',
      kind: 'bar',
      aggregate: 'sum',
      fieldId: 'amount',
      group: 'month',
      dateField: 'date',
      title: 'Spending by month',
    },
  },
});
```

每一项的意思（类型和注释见 `components/define.ts`）：

- **props**：属性的结构。文字一律用 `boundedText(min, max)` 或 `richText(max)`，数字、列表都写上下限；只有白名单里的取值，不能有表达式或可执行的内容。
- **refs**：属性引用了配置里的什么，通用检查会查它：`collection`（数据表要存在）、`field`（这张表的字段要存在；`types` 限定字段类型，`role` 是问题文字里的名字）、`filter`（筛选条件）、`target`（页面或系统入口）、`tool`（`installed` 或 `catalog`）、`workflow`。引用了数据表的组件在提示词里列在「Data components」下，删除数据表时会被一起移出。
- **check**：通用检查以外、只有这种组件才有的规则，返回问题文字。文字会发给 AI 让它改正：写清楚哪个属性、应该是什么。要看别的属性才知道该不该查的引用（例如 `group` 是 `choice` 时才要 `choiceField`）写在这里。
- **describe**：修改说明里怎么称呼它（例如「图表“每月花费”」），文案进 `messages.ts`（第 3 步）。
- **edit**：长按编辑能改的文字属性（`max` 必须和结构里的上限一样）和能调的外观（`tone`、`align`、`size`）。只列渲染器真的会显示的外观；数据组件一般只给 `tone`。组件有用户选的文件（`assetId`）时写 `asset: 'file'`，长按编辑里就有「选择 / 更换 / 移除文件」（文件入口 `fileSlot`，D-257）。有底色的卡片写 `backdrop: true`，就能用图片代替底色（`style.backdrop`，D-258）：渲染器把 `style.backdrop` 传给 `Card`，文字颜色用 `onPicture(palette, backdrop)`。
- **ai.doc**：提示词里组件列表的一行（类型名后面的部分，英文）：属性写法照着已有的行（`?` 表示可以不写，列出可选值和范围），冒号后面一句话说用法。**ai.rule**：需要单独教 AI 的用法写成一条规则，`n` 取现在最后一条规则的编号加 1。
- **example**：一个能用的例子，测试拿它校验和渲染。只引用样例配置里有的：数据表 `expenses`（记账模版的 `amount`、`category`、`date`、`note`）、已添加的工具 `pdf`、快捷操作 `pdf-merge`。

然后把它加到 `components/leaves.ts` 的 `LEAF_COMPONENTS` **最后**（能放进分组的组件；顺序就是配置 JSON Schema 里的顺序，不要插在中间）。

## 2. 画法：`apps/mobile/src/renderer/`

- 写一个组件文件（例如 `Chart.tsx`），记录在本机用 `useRecords` 读，不进配置。
- 在 `registry.tsx` 的 `RENDERERS` 里加一行：`chart: (c, env) => <Chart props={c.props} env={env} tone={c.style?.tone} />`。这里按函数调用，不能直接用 hook；要用 hook 的放进自己的组件里。
- 读到和当前定义对不上的记录值（缺值、类型不对、选项已删掉）只是不显示，不能让页面崩溃（DATA_DESIGN.md）。
- 可点按的部分要接 `env.onLongPress`（长按编辑）和 `env.locked`（草稿里能看不能用，D-190）。

## 3. 文案：`packages/core/src/messages.ts`

修改说明（`describe`）和组件里显示的文字都进 `messages.ts`，en / zh / fr 三种语言都写完整的句子。带数量的文案要有单数写法，写明用哪个参数判断（法语里 0 和 1 都用单数），不要用 `Intl.PluralRules`。写完跑 `npm run check:locales`。

## 4. 评测用例：`packages/core/src/ai/eval-cases.ts`

照着 `CH1`、`CH2` 加一两个用例：用户怎么说、期望的 ops 里有这个组件、关键属性对。用例只在改了提示词时跑，只用 Haiku，只跑受影响的：`npm run eval -- --model claude-haiku-5-5 --cases CH1,CH2`。

## 5. 基线快照

加组件会改变两份有意锁住的输出，确认差异只是新组件之后再更新：

- 配置的 JSON Schema：`packages/core/src/__snapshots__/baseline.test.ts.snap`（`cd packages/core && npx vitest run src/baseline.test.ts -u`）。
- 提示词：`packages/planner/src/__snapshots__/system-prompt.txt`（`cd packages/planner && npx vitest run src/prompt-baseline.test.ts -u`）。提示词变了就要跑第 4 步的评测。

不用改的测试：`core/src/components.test.ts`（example 在三种语言下通过校验、有修改说明、`edit` 的上限和结构一致、AI 说明不为空）、`planner/src/prompt-baseline.test.ts`（提示词里有它的 `ai.doc` 和规则，规则编号连续）、`mobile/src/__tests__/component-registry-test.tsx`（三种语言都能画出来；数据组件再加没有记录、有记录、记录很多或不规整三种情况）会自动覆盖新组件。组件自己的行为（例如图表怎么分组）另写测试。

## 6. DECISIONS 和版本号

在 `docs/DECISIONS.md` 加一条（先查 main 上最大的 D 编号），写清楚属性、AI 能做什么、不能做什么。只新增一种组件**不提升** `CURRENT_SCHEMA_VERSION`（D-254）：老配置照样能读；还没更新的 App 读到它时原样保留、显示「需要更新 App」。改已有的结构（给已有组件加属性、加字段类型、改取值范围）仍要提升版本号并在 `migrate.ts` 写迁移。数据组件的新用法同时写进 `docs/DATA_DESIGN.md`。

## 7. 模拟器

单元测试证明不了手机上能画对。合并前在模拟器上：

- 用 AI 或模版把组件加到一个页面上，三种状态各看一遍：新用户（没有记录）、有数据、边界（记录很多、值缺失、文字很长、窄屏的分组里）。
- 长按：能改的文字和外观都在，改完、撤销都对；拖动能移进、移出分组。
- 草稿里（D-190）能看不能用；预览、深色模式、字号放大都看一遍。
- 切成英文和法语，从新装开始走一遍。
