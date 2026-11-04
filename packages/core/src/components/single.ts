import { z } from 'zod';

import { t } from '../messages';
import { ToolUseSchema } from '../record-ops-schema';
import { FieldRefSchema, IdSchema } from '../schema-base';
import { collectionName, type LookDefinitionOf, defineLook } from './define';

// 只显示一张表的一条记录（最早加的那条，D-424）：几个字段、一个「编辑」，可以再加这条记录的 vCard 二维码。
// 配置里只有表和字段的引用；二维码画的时候现算，不存（底线 14）。

const shape = {
  source: z.strictObject({ table: IdSchema }),
  show: z.strictObject({
    fields: z.array(FieldRefSchema).min(1).max(8),
    /** 画这条记录的 vCard 二维码。 */
    qr: z.literal(true).optional(),
  }),
  /** 一个按钮，运行收记录的快捷操作，把这一条交给它（D-428）。 */
  tools: z.array(ToolUseSchema).min(1).max(1).optional(),
};

export const singleComponent: LookDefinitionOf<'single', typeof shape> = defineLook({
  look: 'single',
  shape,
  kind: 'container',
  layer: 'record',
  reads: 'table',
  writes: false,
  refs: {
    'source.table': { to: 'table' },
    'show.fields': { to: 'field', role: 'show.fields' },
  },
  describe: (c, config, ctx) =>
    t(ctx.locale, 'describeSingle', { table: collectionName(c.source.table, config) }),
  tools: { as: ['self'], ref: ['quickAction'], max: 1 },
  edit: { text: [], style: ['tone'] },
  ai: {
    doc: 'source {table}, show {fields (1-8 field ids), qr?: true}: one entry of a table (the oldest), its fields and an Edit button that opens the entry form; tools? [{tool: <a quick action taking records>}] adds one button that hands it this entry (rule 54); qr also draws a QR code of its contact card (vCard), computed on the device. For "my card" or "my profile"; pair it with showIf',
  },
  example: {
    source: { table: 'expenses' },
    show: { fields: ['category', 'amount'], qr: true },
  },
});
