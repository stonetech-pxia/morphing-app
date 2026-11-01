import { z } from 'zod';

import { t } from '../messages';
import { richText } from '../schema-base';
import { ALL_STYLES, type LookDefinitionOf, defineLook } from './define';

const shape = { show: z.strictObject({ text: richText(1500) }) };

export const textComponent: LookDefinitionOf<'text', typeof shape> = defineLook({
  look: 'text',
  shape,
  kind: 'container',
  reads: 'none',
  writes: false,
  describe: (_c, _config, ctx) => t(ctx.locale, 'describe_description_text_fccd4'),
  edit: { text: [{ prop: 'text', max: 1500, multiline: true, rich: true }], style: ALL_STYLES },
  ai: { doc: 'show {text}: rich text (see below), up to 1500 characters' },
  example: { show: { text: 'Keep **receipts** for a year.' } },
});
