import { z } from 'zod';

import { FILES_TABLE } from '../files-table';
import { t } from '../messages';
import { boundedText, filterSchema, SortSchema } from '../schema-base';
import { type LookDefinitionOf, defineLook } from './define';

const shape = {
  show: z.strictObject({ title: boundedText(1, 60) }),
  /** 读系统表 $files（Q2）；不写 sort 是创建时间从新到旧（同今天）。 */
  source: z.strictObject({
    table: z.literal(FILES_TABLE),
    filter: filterSchema().optional(),
    sort: SortSchema.optional(),
    limit: z.number().int().min(1).max(50),
  }),
};

/** 文件列表（原 fileList）：用户文件里的一类（筛选 $files 的 kind 等自动字段）。 */
export const filesComponent: LookDefinitionOf<'files', typeof shape> = defineLook({
  look: 'files',
  shape,
  kind: 'container',
  layer: 'file',
  reads: 'files',
  writes: false,
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_file_list_a11dd', { v0: c.show.title }),
  edit: { text: [{ prop: 'title', max: 60 }], style: [] },
  ai: {
    doc: 'show {title}, source {table: "$files", filter? (on name, kind: "image"|"pdf"|"video"|"audio"|"sheet"|"doc"|"other", size, source, createdAt), sort?, limit (1-50)}: the user\'s files of that kind; for "their documents" filter kind isNot "image" (photos used in image blocks are not listed). You never see file names or contents.',
  },
  example: {
    show: { title: 'Recent PDFs' },
    source: {
      table: '$files',
      filter: [{ field: 'kind', op: 'is', value: 'pdf' }],
      limit: 5,
    },
  },
});
