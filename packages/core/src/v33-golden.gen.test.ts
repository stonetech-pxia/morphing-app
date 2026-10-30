// 一次性的生成器（v34 迁移前，在 v33 的代码上跑一次）：把 v33 的模版、样板、默认配置、评测 setup 存成 JSON，
// 再按渲染器今天的读法算出每个块的派生数据（列表行、分段、看板、月历、统计、图表、提醒、汇总字段），
// 存进 fixtures/v33/。v34 的等价测试拿这些和迁移后的结果比。v34 的代码上不能再跑（v33 已经删掉）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { it } from 'vitest';

import { buildSetup, type EvalSetup } from './ai/eval-cases';
import { boardColumns, boardField, MAX_TILES } from './board-view';
import { DEFAULT_CALENDAR, type Calendar } from './calendar';
import { chartDateField, chartSeries } from './chart';
import { previousFilter } from './compare';
import {
  aggregateRecords,
  filterRecords,
  groupRecords,
  sortRecords,
  type Aggregate,
  type DataRecord,
  type LinkedGroups,
} from './data';
import { createDefaultWorkspace } from './defaults';
import { listGroups } from './list-groups';
import { currentMonth, monthDays } from './month-view';
import { applyOps } from './ops';
import { bindRecord } from './record-pages';
import { computeRecords, expandCollection } from './related';
import { planNotifications } from './reminders';
import { SAMPLE_APPS, sampleOps } from './samples';
import { isSequenceAggregate } from './sequence-text';
import { sequenceValue } from './sequence';
import { minusValue } from './stat-minus';
import { createStarterWorkspace, homeFileEntryOps } from './starter';
import { DATA_TEMPLATES, templateOps } from './templates';
import {
  allComponents,
  type Collection,
  type Component,
  type Locale,
  type WorkspaceConfig,
} from './schema';
import { registry } from './test-helpers';

const OUT = join(__dirname, 'fixtures', 'v33');
const NOW = new Date(2026, 9, 22, 9, 0);

/** 确定的伪随机数（按表 ID 播种）。 */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayString = (offset: number) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'kappa', 'sigma'];

/** 每张表 30 条记录；引用字段指向被引用的表的记录（ID 是 <表>-<序号>）。 */
export function sampleRecords(collections: readonly Collection[]): Map<string, DataRecord[]> {
  const out = new Map<string, DataRecord[]>();
  for (const c of collections) {
    const r = rng(c.id);
    const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
    const list: DataRecord[] = [];
    for (let i = 0; i < 30; i++) {
      const values: Record<string, unknown> = {};
      for (const f of c.fields) {
        if (r() < 0.12 && !f.required) continue;
        switch (f.type) {
          case 'text':
          case 'note':
            values[f.id] = `${pick(WORDS)} ${i}`;
            break;
          case 'number':
          case 'money':
            values[f.id] = Math.round(r() * 2000) / 10;
            break;
          case 'rating':
            values[f.id] = 1 + Math.floor(r() * 5);
            break;
          case 'duration':
            values[f.id] = Math.floor(r() * 300);
            break;
          case 'checkbox':
            values[f.id] = r() < 0.5;
            break;
          case 'date':
            values[f.id] = dayString(Math.floor(r() * 70) - 50);
            break;
          case 'time':
            values[f.id] = `${pad(Math.floor(r() * 24))}:${pad(Math.floor(r() * 60))}`;
            break;
          case 'datetime':
            values[f.id] =
              NOW.getTime() - Math.floor(r() * 50 * 86400000) + Math.floor(r() * 5 * 86400000);
            break;
          case 'choice':
            values[f.id] = pick(f.options).id;
            break;
          case 'link':
            values[f.id] = `${f.collectionId}-${Math.floor(r() * 30)}`;
            break;
          case 'schedule':
            values[f.id] = pick([
              { repeat: 'daily' },
              { repeat: 'once', date: dayString(Math.floor(r() * 20) - 5) },
              { repeat: 'once' },
              { repeat: 'weekdays', days: [1, 3, 5] },
              { repeat: 'interval', every: 3, unit: 'day' },
            ]);
            break;
          default:
            break;
        }
      }
      const created = NOW.getTime() - Math.floor(r() * 60 * 86400000);
      list.push({
        id: `${c.id}-${i}`,
        collectionId: c.id,
        values,
        createdAt: created,
        updatedAt: created + Math.floor(r() * 5 * 86400000),
      });
    }
    out.set(c.id, list);
  }
  return out;
}

const ids = (list: readonly DataRecord[]) => list.map((x) => x.id);

/** 一个配置的派生数据：每个块按渲染器今天的读法算。 */
export function derive(config: WorkspaceConfig, locale: Locale) {
  const cal: Calendar = { ...DEFAULT_CALENDAR, ...(config.calendar ?? {}) } as Calendar;
  const stored = sampleRecords(config.collections);
  const computed = new Map<string, DataRecord[]>();
  for (const c of config.collections)
    computed.set(c.id, computeRecords(config.collections, c.id, stored, NOW, cal));
  const table = (id: string) => config.collections.find((c) => c.id === id);
  const view = (id: string) => expandCollection(config.collections, table(id)!);
  const linkedOf = (v: Collection, fieldId: string | undefined): LinkedGroups | undefined => {
    const f = v.fields.find((x) => x.id === fieldId);
    if (f?.type !== 'link') return undefined;
    return { collection: table(f.collectionId)!, records: computed.get(f.collectionId)!, locale };
  };
  const blocks: Record<string, unknown> = {};
  for (const page of config.pages) {
    const recordId = page.recordOf ? `${page.recordOf}-0` : null;
    for (const raw of allComponents(page)) {
      const c = (recordId ? bindRecord(raw, recordId) : raw) as Component & {
        type: string;
        props: Record<string, any>;
      };
      const key = `${page.id}/${c.id}`;
      const p = c.props;
      if (c.type === 'recordList') {
        if (!table(p.collectionId)) continue;
        const v = view(p.collectionId);
        const records = computed.get(p.collectionId)!;
        const sorted = sortRecords(
          filterRecords(records, v, p.filter, NOW, cal),
          v,
          p.sort,
          NOW,
          cal,
        );
        if (p.display === 'board') {
          const field = boardField(v, p.groupField);
          const all = linkedOf(v, p.groupField);
          const linked = all && {
            ...all,
            records: filterRecords(all.records, all.collection, p.groupFilter, NOW, cal),
          };
          blocks[key] = field
            ? boardColumns(field, sorted, p.limit, linked).map((col) => ({
                option: col.option,
                label: col.label,
                ids: ids(col.records),
              }))
            : null;
        } else if (p.display === 'calendar') {
          const dateRef = chartDateField(v, p);
          const { days, max } = monthDays(
            filterRecords(records, v, p.filter, NOW, cal),
            v,
            { dateField: dateRef, colorField: p.colorField },
            currentMonth(NOW, cal),
            NOW,
            cal,
          );
          blocks[key] = {
            max,
            days: [...days.entries()].map(([d, x]) => ({
              day: d,
              count: x.count,
              optionId: x.optionId,
              ids: ids(x.records),
            })),
          };
        } else if (p.display === 'tiles') {
          blocks[key] = ids(sorted.slice(0, Math.min(p.limit, MAX_TILES)));
        } else if (p.groupBy) {
          blocks[key] = listGroups(sorted, v, p.groupBy, {
            locale,
            now: NOW,
            cal,
            unit: p.groupUnit,
            linked: linkedOf(v, p.groupBy),
            showEmpty: p.showEmpty,
          }).map((g) => ({
            key: g.key,
            label: g.label,
            preset: g.preset,
            ids: ids(g.records.slice(0, p.limit)),
          }));
        } else blocks[key] = ids(sorted.slice(0, p.limit));
      } else if (c.type === 'stat') {
        if (!table(p.collectionId)) continue;
        const v = view(p.collectionId);
        const records = computed.get(p.collectionId)!;
        const matched = filterRecords(records, v, p.filter, NOW, cal);
        const seq = isSequenceAggregate(p.aggregate)
          ? {
              spec: {
                aggregate: p.aggregate,
                unit: p.unit,
                perUnit: p.perUnit,
                skip:
                  p.skipField && p.skipOption
                    ? { fieldId: p.skipField, optionId: p.skipOption }
                    : undefined,
              },
              ctx: { dateField: chartDateField(v, p), now: NOW, cal },
            }
          : null;
        const valueOf = (list: DataRecord[]) =>
          seq
            ? sequenceValue(list, v, seq.spec, seq.ctx)
            : { value: aggregateRecords(list, v, p.aggregate as Aggregate, p.fieldId) };
        const minusOf = (value: number | null) =>
          p.minus && table(p.minus.collectionId)
            ? minusValue(
                value,
                p.minus,
                view(p.minus.collectionId),
                computed.get(p.minus.collectionId)!,
                NOW,
                cal,
              )
            : value;
        const previous = p.compare ? previousFilter(p.filter, NOW, cal) : null;
        const before = previous
          ? valueOf(filterRecords(records, v, previous.filter, NOW, cal))
          : null;
        const total = valueOf(matched);
        blocks[key] = {
          value: minusOf(total.value),
          best: 'best' in total ? total.best : undefined,
          previous: before?.value,
          groups: p.groupBy
            ? groupRecords(matched, v, p.groupBy, 'none', linkedOf(v, p.groupBy)).map((g) => ({
                optionId: g.optionId,
                label: g.label,
                count: g.count,
                value: valueOf(g.records).value,
              }))
            : undefined,
        };
      } else if (c.type === 'chart') {
        if (!table(p.collectionId)) continue;
        const v = view(p.collectionId);
        const matched = filterRecords(computed.get(p.collectionId)!, v, p.filter, NOW, cal);
        blocks[key] = chartSeries(
          matched,
          v,
          {
            aggregate: p.aggregate,
            fieldId: p.fieldId,
            group: p.group,
            dateField: p.dateField,
            choiceField: p.choiceField,
            periods: p.periods,
          },
          NOW,
          'none',
          cal,
          linkedOf(v, p.choiceField),
        );
      }
    }
  }
  const computedValues: Record<string, unknown> = {};
  for (const c of config.collections) {
    const fields = c.fields.filter((f) =>
      ['lookup', 'rollup', 'previous', 'formula'].includes(f.type),
    );
    if (fields.length === 0) continue;
    computedValues[c.id] = computed
      .get(c.id)!
      .map((r) => [r.id, ...fields.map((f) => r.values[f.id] ?? null)]);
  }
  const reminders = planNotifications(config, stored, NOW, locale).map((n) => ({
    ...n,
  }));
  return { blocks, computed: computedValues, reminders };
}

const write = (name: string, value: unknown) =>
  writeFileSync(join(OUT, name), `${JSON.stringify(value)}\n`);

it('writes the v33 fixtures', () => {
  mkdirSync(join(OUT, 'derived'), { recursive: true });
  const configs: Record<string, { config: WorkspaceConfig; locale: Locale }> = {};
  for (const locale of ['en', 'zh', 'fr'] as const) {
    configs[`default-${locale}`] = { config: createDefaultWorkspace(locale), locale };
    if (locale === 'fr') continue;
    const starter = createStarterWorkspace(locale, registry);
    configs[`starter-${locale}`] = { config: starter, locale };
    const files = applyOps(starter, homeFileEntryOps(starter), { registry, locale });
    if (files.ok) configs[`starter-files-${locale}`] = { config: files.config, locale };
  }
  const zh = createDefaultWorkspace('zh');
  for (const t of DATA_TEMPLATES) {
    const r = applyOps(zh, templateOps(t, zh, 'zh'), { registry, locale: 'zh' });
    if (!r.ok) throw new Error(r.error);
    configs[`template-${t}`] = { config: r.config, locale: 'zh' };
  }
  for (const s of SAMPLE_APPS) {
    for (const locale of ['zh'] as const) {
      const base = createStarterWorkspace(locale, registry);
      const plan = sampleOps(s, base, locale);
      if (!plan.ok) throw new Error(plan.message);
      const r = applyOps(base, plan.ops, { registry, locale });
      if (!r.ok) throw new Error(r.error);
      configs[`sample-${s}-${locale}`] = { config: r.config, locale };
    }
  }
  const setups: EvalSetup[] = [
    'pdf',
    'pdfBelowFiles',
    'budget',
    'visa',
    'visaHomeScreen',
    'habits',
    'linked',
    'oneTap',
    'views',
    'boards',
    'scheduled',
    'envelopes',
    'todos',
  ];
  for (const s of setups) {
    for (const locale of ['zh'] as const)
      configs[`setup-${s}-${locale}`] = { config: buildSetup(s, locale, registry), locale };
  }
  for (const [name, { config, locale }] of Object.entries(configs)) {
    write(`${name}.json`, config);
    if (config.collections.length > 0) write(`derived/${name}.json`, derive(config, locale));
  }
});
