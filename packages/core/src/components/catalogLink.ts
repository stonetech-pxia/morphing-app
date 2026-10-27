import { z } from 'zod';

import { t } from '../messages';
import { boundedText } from '../schema-base';
import { ALL_STYLES, type ComponentDefinitionOf, defineComponent, EntryLookSchema } from './define';

const props = z.strictObject({ title: boundedText(1, 60), look: EntryLookSchema.optional() });

export const catalogLinkComponent: ComponentDefinitionOf<'catalogLink', typeof props> =
  defineComponent({
    type: 'catalogLink',
    props,
    describe: (c, _config, ctx) => t(ctx.locale, 'describe_link_941e3', { v0: c.props.title }),
    edit: { text: [{ prop: 'title', max: 60 }], style: ALL_STYLES },
    ai: { doc: '{title, look?: "row"|"tile"}: entry to the tool catalog' },
    example: { props: { title: 'More tools' } },
  });
