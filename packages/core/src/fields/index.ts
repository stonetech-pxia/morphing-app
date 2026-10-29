import { z } from 'zod';

import type { FieldValue, LinkResolver } from '../field-values';
import type { FormulaType } from '../formula';
import type { Locale } from '../schema-primitives';
import { checkboxField } from './checkbox';
import { choiceField } from './choice';
import { dateField } from './date';
import { datetimeField } from './datetime';
import type { Coerced, FieldCheckContext } from './define';
import { durationField } from './duration';
import { fileField } from './file';
import { formulaField } from './formula';
import { linkField } from './link';
import { moneyField } from './money';
import { noteField } from './note';
import { numberField } from './number';
import { ratingField } from './rating';
import { textField } from './text';
import { timeField } from './time';

export * from './define';
export { ChoiceOptionSchema } from './choice';

/** 全部字段类型。新类型加在最后（顺序就是配置 JSON Schema 里的顺序）。 */
export const FIELDS = [
  textField,
  noteField,
  numberField,
  moneyField,
  checkboxField,
  dateField,
  choiceField,
  ratingField,
  fileField,
  linkField,
  formulaField,
  timeField,
  datetimeField,
  durationField,
] as const;

type Schemas<D extends readonly { schema: unknown }[]> = {
  -readonly [K in keyof D]: D[K]['schema'];
};

export const FieldSchema = z.discriminatedUnion(
  'type',
  FIELDS.map((d) => d.schema) as Schemas<typeof FIELDS>,
);
export type Field = z.infer<typeof FieldSchema>;
export type FieldType = Field['type'];
export type FieldOf<T extends FieldType> = Extract<Field, { type: T }>;

/** 登记表里的一份定义，回调的参数统一成 Field（按类型取出来以后用）。 */
export interface FieldDefinition {
  type: FieldType;
  label: [string, string];
  read(field: Field, raw: unknown): FieldValue | undefined;
  shown?(field: Field, raw: unknown): FieldValue | undefined;
  write?(field: Field, input: unknown): Coerced;
  initial?(field: Field, now: Date, today: string): FieldValue | undefined;
  emptyNew?: FieldValue;
  format(field: Field, value: FieldValue, locale: Locale, links?: LinkResolver): string;
  csv?(field: Field, value: FieldValue): string;
  formatAmount?(field: Field, n: number, locale: Locale): string;
  print?: {
    numeric?: true;
    total?: { rank: number; format(field: Field, sum: number, locale: Locale): string };
  };
  formula?: FormulaType;
  numeric?: true;
  inForm?: false;
  filter: {
    is(field: Field, value: unknown): boolean;
    contains?: true;
    compare?: 'number' | 'date' | 'time';
    period?: true;
    emptyOnly?: true;
  };
  day?(field: Field, value: FieldValue): string;
  sort?: false | ((field: Field, value: FieldValue) => FieldValue);
  titleRank?: number;
  convertGroup?: string;
  check?(field: Field, ctx: FieldCheckContext): { code: string; message: string }[];
  ai: { doc: string; docAfter?: string };
  example: Field;
  exampleValue?: FieldValue;
  schema: z.ZodObject;
}

const BY_TYPE = new Map<string, FieldDefinition>(
  FIELDS.map((d) => [d.type, d as unknown as FieldDefinition]),
);

/** 这种字段的定义。 */
export function fieldDefinition(type: FieldType): FieldDefinition {
  return BY_TYPE.get(type)!;
}

/** 统计和图表能求和、平均的字段类型。 */
export const NUMERIC_FIELD_TYPES: readonly string[] = FIELDS.filter((d) => d.numeric).map(
  (d) => d.type,
);
