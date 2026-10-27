import { z } from 'zod';

import { buttonComponent } from './button';
import { catalogLinkComponent } from './catalogLink';
import { chartComponent } from './chart';
import { dividerComponent } from './divider';
import { fileListComponent } from './fileList';
import { filePickComponent } from './filePick';
import { headerComponent } from './header';
import { imageComponent } from './image';
import { noticeComponent } from './notice';
import { quickActionListComponent } from './quickActionList';
import { recordFormComponent } from './recordForm';
import { recordListComponent } from './recordList';
import { shortcutComponent } from './shortcut';
import { spacerComponent } from './spacer';
import { statComponent } from './stat';
import { textComponent } from './text';
import { toolCardComponent } from './toolCard';
import { toolGridComponent } from './toolGrid';
import { workflowRunnerComponent } from './workflowRunner';

/** 可以放进分组的组件。新组件加在最后（顺序就是配置 JSON Schema 里的顺序）。 */
export const LEAF_COMPONENTS = [
  filePickComponent,
  headerComponent,
  textComponent,
  toolCardComponent,
  toolGridComponent,
  catalogLinkComponent,
  fileListComponent,
  workflowRunnerComponent,
  quickActionListComponent,
  buttonComponent,
  shortcutComponent,
  noticeComponent,
  imageComponent,
  dividerComponent,
  spacerComponent,
  recordListComponent,
  recordFormComponent,
  statComponent,
  chartComponent,
] as const;

type Schemas<D extends readonly { schema: unknown }[]> = {
  -readonly [K in keyof D]: D[K]['schema'];
};

export const LeafComponentSchema = z.discriminatedUnion(
  'type',
  LEAF_COMPONENTS.map((d) => d.schema) as Schemas<typeof LEAF_COMPONENTS>,
);
