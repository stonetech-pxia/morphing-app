import { z } from 'zod';

import type { LayoutMemory } from './memory';
import { MAX_LEARNED_LABELS, type FieldPick } from './rank';

// 版式记忆的存储、导出和恢复（D-244）：每张表一组版式，存在本机 app_meta 的一个键里。
// 「设置 → 数据」能一键清空、导出成文件（也是备份），再从这个文件恢复。
// 文件里是标签文字、位置、写法和商家名，没有金额和日期的值；读文件时逐项校验，坏的丢掉。
// 第 2 版起还有新记录表单里点过的候选（D-394，另一个键 prefill:picks）：每张表每个字段一个
// 标签和位置，同样不记值。第 3 版起每个字段还有学过的标签（只有标签文字），旧文件照常读。

export const LAYOUT_STORE_KEY = 'prefill:layouts';
export const LAYOUT_FILE_FORMAT = 'morph-prefill-memory';
const FILE_VERSION = 3;
/** 每张表最多记几个版式：超出时丢掉最早学的。 */
export const MAX_LAYOUTS_PER_TABLE = 50;

const FIELD_TYPES = [
  'text',
  'note',
  'number',
  'money',
  'checkbox',
  'date',
  'choice',
  'rating',
  'file',
  'link',
  'formula',
] as const;

const hits = z.number().int().min(0).max(9);
const HabitSchema = z.union([
  z.strictObject({
    kind: z.enum(['amount', 'date']),
    label: z.string().max(200),
    offset: z.union([z.literal(0), z.literal(1)]),
    position: z.number().min(0).max(1),
    format: z.string().max(40),
    hits,
    needs: hits.optional(),
  }),
  z.strictObject({
    kind: z.literal('constant'),
    value: z.string().min(1).max(200),
    hits,
    needs: hits.optional(),
  }),
]);

const LayoutSchema = z.strictObject({
  id: z.string().min(1).max(64),
  anchors: z.array(z.string().max(200)).max(40),
  fieldTypes: z.record(z.string().max(64), z.enum(FIELD_TYPES)),
  fields: z.record(z.string().max(64), HabitSchema),
});

/** 表 ID → 这张表的版式（按学的先后）。 */
export type LayoutStore = Record<string, LayoutMemory[]>;

/** 逐个版式校验，坏的丢掉（存的东西被改坏、旧版本留下的，都不让它影响预填）。 */
function cleanStore(raw: unknown): LayoutStore {
  const out: LayoutStore = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [table, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const layouts = list
      .map((l) => LayoutSchema.safeParse(l))
      .filter((r) => r.success)
      .map((r) => r.data as LayoutMemory)
      .slice(-MAX_LAYOUTS_PER_TABLE);
    if (layouts.length > 0) out[table] = layouts;
  }
  return out;
}

/** 读 app_meta 里存的；没有或者坏了都是空的。 */
export function parseLayoutStore(raw: string | null): LayoutStore {
  if (!raw) return {};
  try {
    return cleanStore(JSON.parse(raw));
  } catch {
    return {};
  }
}

export const serializeLayoutStore = (store: LayoutStore): string => JSON.stringify(store);

/** 一共记了几个版式。 */
export const layoutCount = (store: LayoutStore): number =>
  Object.values(store).reduce((n, list) => n + list.length, 0);

/** 保存一次以后更新这张表的一个版式（同 ID 的换掉，新的放最后，超出上限丢最早的）。 */
export function putLayout(store: LayoutStore, table: string, memory: LayoutMemory): LayoutStore {
  const list = (store[table] ?? []).filter((m) => m.id !== memory.id);
  return { ...store, [table]: [...list, memory].slice(-MAX_LAYOUTS_PER_TABLE) };
}

/** 导出的文件（也是备份）：带格式名和版本，恢复时认得出。 */
export function layoutStoreFile(store: LayoutStore, now: Date, picks: PickStore = {}): string {
  return JSON.stringify(
    {
      format: LAYOUT_FILE_FORMAT,
      version: FILE_VERSION,
      exportedAt: now.toISOString(),
      tables: store,
      picks,
    },
    null,
    2,
  );
}

function readFile(text: string): { tables?: unknown; picks?: unknown } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const file = data as { format?: unknown; version?: unknown; tables?: unknown; picks?: unknown };
  if (file.format !== LAYOUT_FILE_FORMAT || typeof file.version !== 'number') return null;
  if (file.version > FILE_VERSION) return null;
  return file;
}

/** 读导出的文件：不是这个格式时为 null；格式对但有坏的版式时只留好的。 */
export function readLayoutStoreFile(text: string): LayoutStore | null {
  const file = readFile(text);
  return file && cleanStore(file.tables);
}

// ---- 点过的候选（D-394） ----

export const PICK_STORE_KEY = 'prefill:picks';

const PickSchema = z.strictObject({
  label: z.string().max(200),
  relY: z.number().min(0).max(1),
  order: z.enum(['DMY', 'MDY']).optional(),
  labels: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(200),
        order: z.enum(['DMY', 'MDY']).optional(),
        rejected: z.literal(true).optional(),
      }),
    )
    .max(MAX_LEARNED_LABELS)
    .optional(),
});

/** 表 ID → 字段 ID → 上次点的候选在哪里。 */
export type PickStore = Record<string, Record<string, FieldPick>>;

function cleanPicks(raw: unknown): PickStore {
  const out: PickStore = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [table, fields] of Object.entries(raw)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const kept: Record<string, FieldPick> = {};
    for (const [field, pick] of Object.entries(fields).slice(0, 200)) {
      const r = PickSchema.safeParse(pick);
      if (r.success && field.length <= 64) kept[field] = r.data as FieldPick;
    }
    if (Object.keys(kept).length > 0) out[table] = kept;
  }
  return out;
}

/** 读 app_meta 里存的；没有或者坏了都是空的。 */
export function parsePickStore(raw: string | null): PickStore {
  if (!raw) return {};
  try {
    return cleanPicks(JSON.parse(raw));
  } catch {
    return {};
  }
}

export const serializePickStore = (store: PickStore): string => JSON.stringify(store);

/** 一共记了几个字段。 */
export const pickCount = (store: PickStore): number =>
  Object.values(store).reduce((n, fields) => n + Object.keys(fields).length, 0);

/** 用户点了一个候选：这张表这个字段记下这一次（换掉上一次）。 */
export function putPick(
  store: PickStore,
  table: string,
  field: string,
  pick: FieldPick,
): PickStore {
  return { ...store, [table]: { ...store[table], [field]: pick } };
}

/** 读导出的文件里点过的候选：不是这个格式时为 null；第 1 版的文件没有，是空的。 */
export function readPickStoreFile(text: string): PickStore | null {
  const file = readFile(text);
  return file && cleanPicks(file.picks);
}
