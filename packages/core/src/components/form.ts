import { z } from 'zod';

import { fieldDefinition } from '../fields';
import { t } from '../messages';
import { isRecordToolUse, ToolUseSchema } from '../record-ops-schema';
import { collectionName, type LookDefinitionOf, defineLook, duplicates } from './define';

const shape = {
  /** inline 直接在页面上填；sheet（D-352）页面右下角一个「+」，点了从底部弹出添加框。 */
  show: z.strictObject({ mode: z.enum(['inline', 'sheet']) }),
  /** 一个 {as: "submit", label, do: "create", table, ask: [字段], values?, smartDate?}。 */
  tools: z.array(ToolUseSchema).min(1).max(1),
};

/** smartDate 能填的字段（D-344）。 */
export const SMART_DATE_TYPES: readonly string[] = ['date', 'datetime', 'schedule'];

/** 添加表单（原 recordForm inline / sheet）：表单是容器，提交是就地的 create 工具（ask = 表单里的字段）。 */
export const formComponent: LookDefinitionOf<'form', typeof shape> = defineLook({
  look: 'form',
  shape,
  kind: 'container',
  layer: 'record',
  reads: 'none',
  writes: true,
  tools: { as: ['submit'], do: ['create'], max: 1 },
  refs: { 'tools.0.table': { to: 'table' } },
  check: (c, { config, collection, page, parent }) => {
    const problems: string[] = [];
    const tool = c.tools[0]!;
    if (!isRecordToolUse(tool) || tool.do !== 'create' || tool.as !== 'submit') {
      return ['a form has one tool {as: "submit", label, do: "create", table, ask: [fields]}'];
    }
    if (!tool.label) problems.push('the submit tool of a form needs a label');
    // 用配置里原来的表：查找、汇总在检查别的块时换成了它们显示的那种字段（D-287）。
    const table = config.data.tables.find((x) => x.id === tool.table) ?? collection!;
    const ask = tool.ask;
    if (!Array.isArray(ask)) return [...problems, 'a form asks a list of fields: ask: [field ids]'];
    for (const id of ask) {
      const f = table.fields.find((x) => x.id === id);
      if (!f) problems.push(`form field ${id} does not exist`);
      // 公式是算出来的（D-188）：表单里填不了（字段定义的 inForm）。附件可以在表单里选（D-263）。
      else if (fieldDefinition(f.type).inForm === false)
        problems.push(`form field ${id} is a ${f.type} field and cannot be filled in a form`);
    }
    for (const id of duplicates(ask)) problems.push(`form field ${id} is listed twice`);
    const values = typeof tool.values === 'object' ? tool.values : {};
    if (Object.keys(values).length > 10) problems.push('a form has at most 10 preset values');
    for (const id of Object.keys(values))
      if (ask.includes(id))
        problems.push(`${id} is both asked and in values; a preset value is not shown`);
    // D-352：浮动的「+」放在页面右下角，一页一个，不能放进分组。
    if (c.show.mode === 'sheet') {
      if (parent)
        problems.push(
          'a form with mode "sheet" floats over the page; put it on the page itself, not in a group',
        );
      const sheets = page.blocks.filter(
        (x) => x.look === 'form' && (x as { show?: { mode?: string } }).show?.mode === 'sheet',
      );
      if (sheets.length > 1 && sheets[0]!.id !== c.id)
        problems.push(
          `page ${page.id} already has a floating add button (${sheets[0]!.id}); one per page`,
        );
    }
    return problems;
  },
  describe: (c, config, ctx) => {
    const tool = c.tools[0]!;
    const table = isRecordToolUse(tool) ? tool.table : '';
    return t(ctx.locale, 'describe_form_f4ef1', { v0: collectionName(table, config) });
  },
  edit: { text: [], style: ['tone'] },
  ai: {
    doc: 'show {mode: "inline"|"sheet" (rule 64)}, tools: [{as: "submit", label, do: "create", table, ask: [field ids, 1-10], values? (preset values not shown; rule 59), smartDate? {from: a text field in ask, to: a date|datetime|schedule field} (rule 60)}]: "inline" adds records right on the page; "sheet" is a floating "+" (one per page, not in a group). Formula fields can\'t be asked; a file field lets the user add photos and files. A button that opens the full editor is a button with tools [{do: "create", table, ask: "all"}].',
  },
  example: {
    show: { mode: 'inline' },
    tools: [
      {
        as: 'submit',
        label: 'Add',
        do: 'create',
        table: 'expenses',
        ask: ['amount', 'category', 'note'],
      },
    ],
  },
});
