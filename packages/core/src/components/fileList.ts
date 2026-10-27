import { z } from 'zod';

import { t } from '../messages';
import { boundedText } from '../schema-base';
import { type ComponentDefinitionOf, defineComponent } from './define';

const props = z.strictObject({
  title: boundedText(1, 60),
  limit: z.number().int().min(1).max(50),
  /** 只列出这一类文件：PDF，或者某一大类（image/*、video/*、audio/*，D-140）。 */
  mimeType: z.enum(['application/pdf', 'image/*', 'video/*', 'audio/*']).optional(),
});

export const fileListComponent: ComponentDefinitionOf<'fileList', typeof props> = defineComponent({
  type: 'fileList',
  props,
  describe: (c, _config, ctx) => t(ctx.locale, 'describe_file_list_a11dd', { v0: c.props.title }),
});
