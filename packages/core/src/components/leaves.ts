import { z } from 'zod';

import { actionComponent } from './action';
import { buttonComponent } from './button';
import { chartComponent } from './chart';
import { dividerComponent } from './divider';
import { entryComponent } from './entry';
import { filesComponent } from './files';
import { formComponent } from './form';
import { headerComponent } from './header';
import { imageComponent } from './image';
import { libraryComponent } from './library';
import { noticeComponent } from './notice';
import { numberComponent } from './number';
import { packagesComponent } from './packages';
import { pickerComponent } from './picker';
import {
  boardComponent,
  calendarComponent,
  cardsComponent,
  checklistComponent,
  listComponent,
  tilesComponent,
} from './records';
import { spacerComponent } from './spacer';
import { textComponent } from './text';

/** 可以放进分组的外观（22 种，加上 group 本身共 23 种）。新外观加在最后（顺序就是 JSON Schema 里的顺序）。 */
export const LEAF_COMPONENTS = [
  headerComponent,
  textComponent,
  noticeComponent,
  imageComponent,
  dividerComponent,
  spacerComponent,
  buttonComponent,
  entryComponent,
  actionComponent,
  pickerComponent,
  listComponent,
  cardsComponent,
  checklistComponent,
  tilesComponent,
  boardComponent,
  calendarComponent,
  numberComponent,
  chartComponent,
  formComponent,
  filesComponent,
  libraryComponent,
  packagesComponent,
] as const;

type Schemas<D extends readonly { schema: unknown }[]> = {
  -readonly [K in keyof D]: D[K]['schema'];
};

export const LeafComponentSchema = z.discriminatedUnion(
  'look',
  LEAF_COMPONENTS.map((d) => d.schema) as Schemas<typeof LEAF_COMPONENTS>,
);
