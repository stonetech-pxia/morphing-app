import { z } from 'zod';

import { fieldDefinition } from '../fields';
import { t } from '../messages';
import { RecordActionValueSchema } from '../record-ops-schema';
import { boundedText, IdSchema } from '../schema-base';
import { collectionName, type ComponentDefinitionOf, defineComponent, duplicates } from './define';

const props = z.strictObject({
  collectionId: IdSchema,
  fieldIds: z.array(IdSchema).min(1).max(10),
  submitLabel: boundedText(1, 30),
  mode: z.enum(['inline', 'button']),
  /**
   * 不在表单里显示、保存时一起填上的值（D-333），写法同一键操作的预设值（D-301）；给一条记录用的页面上
   * 引用字段可以是 "$record"（D-332）。
   */
  values: z
    .record(IdSchema, RecordActionValueSchema)
    .refine((v) => Object.keys(v).length <= 10, 'at most 10 preset values')
    .optional(),
  /**
   * 在本机认出文字里说的日期（D-334）：from 是表单里的一个文字字段，to 是日期、日期时间或日程字段。
   * 认出来的部分高亮、可以点掉；保存时从文字里去掉，填进 to（用户自己填了 to 时不动）。只给 inline 用。
   */
  smartDate: z.strictObject({ from: IdSchema, to: IdSchema }).optional(),
});

/** smartDate 能填的字段（D-334）。 */
export const SMART_DATE_TYPES: readonly string[] = ['date', 'datetime', 'schedule'];

/** 快速添加表单：inline 直接在页面上填，button 打开完整的记录编辑页。 */
export const recordFormComponent: ComponentDefinitionOf<'recordForm', typeof props> =
  defineComponent({
    type: 'recordForm',
    props,
    refs: { collectionId: { to: 'collection' } },
    check: (c, { config, collection }) => {
      const problems: string[] = [];
      // 用配置里原来的表：查找、汇总在检查别的组件时换成了它们显示的那种字段（D-287）。
      const table = config.collections.find((x) => x.id === c.props.collectionId) ?? collection!;
      for (const id of c.props.fieldIds) {
        const f = table.fields.find((x) => x.id === id);
        if (!f) problems.push(`form field ${id} does not exist`);
        // 公式是算出来的（D-188）：表单里填不了（字段定义的 inForm）。附件可以在表单里选（D-263）。
        else if (fieldDefinition(f.type).inForm === false)
          problems.push(`form field ${id} is a ${f.type} field and cannot be filled in a form`);
      }
      for (const id of duplicates(c.props.fieldIds))
        problems.push(`form field ${id} is listed twice`);
      const smart = c.props.smartDate;
      if (smart) {
        const from = table.fields.find((x) => x.id === smart.from);
        const to = table.fields.find((x) => x.id === smart.to);
        if (c.props.mode !== 'inline') problems.push('smartDate only works with mode "inline"');
        if (from?.type !== 'text' || !c.props.fieldIds.includes(smart.from))
          problems.push(`smartDate.from ${smart.from} must be a text field listed in fieldIds`);
        if (!to || !SMART_DATE_TYPES.includes(to.type))
          problems.push(
            `smartDate.to ${smart.to} must be a date, datetime or schedule field of ${table.id}`,
          );
      }
      for (const id of Object.keys(c.props.values ?? {}))
        if (c.props.fieldIds.includes(id))
          problems.push(`${id} is in both fieldIds and values; a preset value is not shown`);
      return problems;
    },
    describe: (c, config, ctx) =>
      t(ctx.locale, 'describe_form_f4ef1', { v0: collectionName(c.props.collectionId, config) }),
    edit: { text: [], style: ['tone'] },
    ai: {
      doc: '{collectionId, fieldIds (1-10), submitLabel, mode: "inline"|"button", values? (preset values not shown, like a create action\'s; rule 59), smartDate? {from: text field in fieldIds, to: date|datetime|schedule field} (inline only; rule 60)}: "inline" adds records right on the page; "button" opens the full editor; formula fields can\'t be in fieldIds; a file field lets the user add photos and files',
    },
    example: {
      props: {
        collectionId: 'expenses',
        fieldIds: ['amount', 'category', 'note'],
        submitLabel: 'Add',
        mode: 'inline',
      },
    },
  });
