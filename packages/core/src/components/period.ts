import { z } from 'zod';

import { t } from '../messages';
import { PAGE_PERIODS } from '../schema-primitives';
import { type LookDefinitionOf, defineLook } from './define';

// 时间范围（D-440，创始人 2026-11-05 定）：页面上的一排选项，用户点一个，同一页里 source.period 是 "page" 的图表和数字卡
// 都按它画。选项由配置决定（Tink 能改），不是 Expensify 那十几种；custom 多一个「自定义」，点了选起止日期。
// 选了什么只在页面画着的时候有，什么都不写（底线 15）；没有任何东西自己运行。

const shape = {
  show: z.strictObject({
    /** 能选的时间段，按这个顺序排；第一个是默认的（除非写了 default）。 */
    options: z
      .array(z.enum(PAGE_PERIODS))
      .min(1)
      .max(PAGE_PERIODS.length)
      .refine((list) => new Set(list).size === list.length, 'options must be different'),
    default: z.enum(PAGE_PERIODS).optional(),
    /** 多一个「自定义」：用户自己选起止日期。 */
    custom: z.literal(true).optional(),
  }),
};

export const periodComponent: LookDefinitionOf<'period', typeof shape> = defineLook({
  look: 'period',
  shape,
  kind: 'container',
  layer: 'record',
  reads: 'none',
  writes: false,
  check: (c, ctx) => {
    const problems: string[] = [];
    if (c.show.default !== undefined && !c.show.options.includes(c.show.default))
      problems.push(`show.default ${c.show.default} must be one of show.options`);
    if (ctx.parent) problems.push('a period block sits on the page itself, not inside a group');
    if (ctx.page.blocks.filter((b) => b.look === 'period').length > 1)
      problems.push(`page ${ctx.page.id} has more than one period block; keep one`);
    return problems;
  },
  describe: (c, _config, ctx) =>
    t(ctx.locale, 'describe_period', { n: c.show.options.length + (c.show.custom ? 1 : 0) }),
  edit: { text: [], style: [] },
  ai: {
    doc: 'show {options: [1-8 of "today"|"thisWeek"|"thisMonth"|"thisYear"|"last7days"|"last30days"|"last90days"|"last365days"] (the choices, in this order), default? (one of the options; the first when not set), custom?: true (adds "Custom": the user picks a start and end date)}: a row of time range choices on a page. Charts and number blocks on the same page with source.period: "page" follow what the user picks (rule 56). The choice is temporary and never written.',
    rule: {
      n: 56,
      text: 'Time range on a page: when the user wants to switch what a page covers ("本周 / 本月 看一下", "let me pick this week or this month", "加一个日期范围"), add ONE period block with only the choices they name (fewer is better: "本月 本星期" → options ["thisMonth", "thisWeek"]; add custom: true for "自定义" or "pick my own dates") and set source.period: "page" on EVERY chart and number block already on that page (all of them follow unless the user says one should stay fixed, e.g. "全年合计不用跟着变"); a chart or number block you add later to a page that has a period block gets source.period: "page" too. addContainer {page, block} for the period block; updateContainer {page, block, changes: {source: {...}}} for each chart or number (to take one off the range, set source.period to null). Never leave the existing charts out and only offer to do it later: the user asked for the page to switch, so the charts switch. Changing the choices is updateContainer on the period block with changes {show: {options: [...]}}. A chart that follows the range ignores group.unit and last and picks day, week or month by the length of the range; with compare: "previous" it is drawn against the stretch right before (this week against last week, this month against last month); a number that follows ignores the inPeriod in its filter. Lists have their own show.browse.period (rule 38); this block is not for lists. A page has at most one period block. Pin it with pin: "top" if the user wants it to stay in view.',
    },
    docAfter: 'chart',
  },
  example: { show: { options: ['thisWeek', 'thisMonth'], custom: true } },
});
