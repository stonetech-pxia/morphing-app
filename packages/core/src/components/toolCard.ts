import { z } from 'zod';

import { localize } from '../localization';
import { t } from '../messages';
import { IdSchema } from '../schema-base';
import { ALL_STYLES, type ComponentDefinitionOf, defineComponent, EntryLookSchema } from './define';

const props = z.strictObject({ toolId: IdSchema, look: EntryLookSchema.optional() });

export const toolCardComponent: ComponentDefinitionOf<'toolCard', typeof props> = defineComponent({
  type: 'toolCard',
  props,
  refs: { toolId: { to: 'tool', in: 'installed' } },
  describe: (c, _config, ctx) => {
    const name =
      localize(ctx.registry.tools.get(c.props.toolId)?.name, ctx.locale) ?? c.props.toolId;
    return t(ctx.locale, 'describe_tool_card_80198', { v0: name });
  },
  edit: { text: [], style: ALL_STYLES },
  ai: { doc: '{toolId, look?: "row"|"tile"}: entry to an installed tool\'s page' },
});
