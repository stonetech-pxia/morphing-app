import { z } from 'zod';

import { fieldDefinition } from '../fields';
import { t } from '../messages';
import { boundedText, IdSchema } from '../schema-base';
import { collectionName, type ComponentDefinitionOf, defineComponent, duplicates } from './define';

const props = z.strictObject({
  collectionId: IdSchema,
  fieldIds: z.array(IdSchema).min(1).max(10),
  submitLabel: boundedText(1, 30),
  mode: z.enum(['inline', 'button']),
});

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
      return problems;
    },
    describe: (c, config, ctx) =>
      t(ctx.locale, 'describe_form_f4ef1', { v0: collectionName(c.props.collectionId, config) }),
    edit: { text: [], style: ['tone'] },
    ai: {
      doc: '{collectionId, fieldIds (1-10), submitLabel, mode: "inline"|"button"}: "inline" adds records right on the page; "button" opens the full editor; formula fields can\'t be in fieldIds; a file field lets the user add photos and files',
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
