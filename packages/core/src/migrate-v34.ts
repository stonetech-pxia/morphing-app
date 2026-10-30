// v33 → v34（NEW_FORMAT_DRAFT §8，创始人 2026-10-30 定）：「数据 · 容器 · 工具」。
// ID 一律不改（表、字段、选项、页面、块、快捷操作；提醒只在和快捷操作撞号时改，M1）。
// 只吃 v33 的形状（M13：更早的版本先经过前面的迁移）。纯 JSON 进、JSON 出，不依赖 v34 的结构定义，
// 这样下载的工具包页面（tool-download.ts）、模版和样板（templates/、samples/）也能用同一套转换。

type Json = Record<string, any>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 去掉值是 undefined 的键（迁移结果和手写的 JSON 一样干净）。 */
function clean<T extends Json>(o: T): T {
  const out: Json = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

const nonEmpty = <T>(list: T[] | undefined): T[] | undefined =>
  list && list.length > 0 ? list : undefined;

/** v33 的组件类型（D-254：别的都是更新的 App 加的，迁移成 look "$unknown"）。 */
const V33_TYPES = new Set([
  'header',
  'text',
  'notice',
  'divider',
  'spacer',
  'image',
  'group',
  'button',
  'shortcut',
  'catalogLink',
  'toolCard',
  'fileSlot',
  'fileList',
  'filePick',
  'workflowRunner',
  'quickActionList',
  'toolGrid',
  'recordList',
  'recordForm',
  'stat',
  'chart',
]);

/** 迁移时要知道的表结构（"row" 只在引用字段上换成 "$row"、汇总按哪个日期筛）。 */
export interface V33Tables {
  find(id: string): Json | undefined;
}

export const v33Tables = (collections: readonly Json[]): V33Tables => ({
  find: (id) => collections.find((c) => c.id === id),
});

/** workflow:<id> → tool:<id>（打开快捷操作，只摆出来不运行）。 */
const target = (t: unknown): unknown =>
  typeof t === 'string' && t.startsWith('workflow:') ? `tool:${t.slice('workflow:'.length)}` : t;

/** 一个值：v33 的 "row"（这一行）只在引用字段上是「这一行」，换成 "$row"；单选的 row 选项不动（M5）。 */
function value(v: unknown, table: Json | undefined, fieldId: string): unknown {
  if (v !== 'row') return v;
  const field = (table?.fields as Json[] | undefined)?.find((f) => f.id === fieldId);
  return field?.type === 'link' ? '$row' : v;
}

function values(vs: unknown, table: Json | undefined): Json | undefined {
  if (!isObject(vs)) return undefined;
  return Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, value(v, table, k)]));
}

/** 汇总按哪个日期（related.ts 的 rollupDate = chartDateField）：dateField，第一个日期、日期时间字段，创建时间。 */
function defaultDate(table: Json | undefined, dateField: unknown): string {
  if (typeof dateField === 'string') return dateField;
  const fields = (table?.fields as Json[] | undefined) ?? [];
  return (
    fields.find((f) => f.type === 'date')?.id ??
    fields.find((f) => f.type === 'datetime')?.id ??
    'createdAt'
  );
}

/** 按日子算的参数（stat、rollup 各写一遍的 5 个）→ days 块。 */
function days(o: Json): Json | undefined {
  const skip =
    o.skipField !== undefined || o.skipOption !== undefined
      ? clean({ field: o.skipField, option: o.skipOption })
      : undefined;
  const d = clean({ date: o.dateField, unit: o.unit, perUnit: o.perUnit, skip });
  return Object.keys(d).length > 0 ? d : undefined;
}

/** 字段（键名统一，Q5；rollup 的 period 迁移成 filter 末尾的一条 inPeriod，M3）。 */
export function migrateFieldV33(f: Json, tables: V33Tables): Json {
  switch (f.type) {
    case 'link': {
      const { collectionId, ...rest } = f;
      return { ...rest, table: collectionId };
    }
    case 'lookup': {
      const { linkField, fieldId, ...rest } = f;
      return { ...rest, via: linkField, field: fieldId };
    }
    case 'previous': {
      const { fieldId, dateField, groupBy, ...rest } = f;
      return clean({ ...rest, field: fieldId, date: dateField, within: groupBy });
    }
    case 'rollup': {
      const {
        collectionId,
        linkField,
        fieldId,
        filter,
        period,
        dateField,
        unit,
        perUnit,
        skipField,
        skipOption,
        ...rest
      } = f;
      const conditions = [...((filter as Json[] | undefined) ?? [])];
      if (period !== undefined)
        conditions.push({
          field: defaultDate(tables.find(collectionId), dateField),
          op: 'inPeriod',
          value: period,
        });
      return clean({
        ...rest,
        table: collectionId,
        via: linkField,
        field: fieldId,
        filter: nonEmpty(conditions),
        days: days({ dateField, unit, perUnit, skipField, skipOption }),
      });
    }
    default:
      return f;
  }
}

export function migrateTableV33(c: Json, tables: V33Tables): Json {
  return { ...c, fields: (c.fields as Json[]).map((f) => migrateFieldV33(f, tables)) };
}

/** 一键记录操作 → 就地的一键记录工具（v33 的 create / set / toggle / increment / setAll / open）。 */
function recordTool(a: Json, listTable: string | undefined, tables: V33Tables): Json {
  switch (a.do) {
    case 'create': {
      const table = tables.find(a.collectionId);
      return clean({
        do: 'create',
        table: a.collectionId,
        values: values(a.values, table),
        ask: a.form ? 'all' : undefined,
      });
    }
    case 'open':
      // 按钮上的 open = 新记录的表单（行上的 open 是导航，见 rowTool）。
      return { do: 'create', table: a.collectionId, ask: 'all' };
    case 'setAll': {
      const table = tables.find(a.collectionId);
      return clean({
        do: 'setAll',
        table: a.collectionId,
        filter: a.filter,
        field: a.fieldId,
        value: value(a.value, table, a.fieldId),
      });
    }
    case 'set':
      return {
        do: 'set',
        table: listTable,
        field: a.fieldId,
        value: value(a.value, tables.find(listTable ?? ''), a.fieldId),
      };
    case 'toggle':
      return { do: 'toggle', table: listTable, field: a.fieldId };
    case 'increment':
      return { do: 'increment', table: listTable, field: a.fieldId, by: a.by };
    default:
      return a;
  }
}

/** 行上的操作 → 就地工具：tiles 上是 tap（点一下），其余是 button；open 是导航到这一条的编辑页。 */
function rowTool(a: Json, as: 'tap' | 'button', listTable: string, tables: V33Tables): Json {
  const use = clean({ as, label: a.label, when: a.when });
  if (a.do === 'open') return { ...use, opens: 'record' };
  const { label: _l, when: _w, ...action } = a;
  return { ...use, ...recordTool(action, listTable, tables) };
}

function block(base: Json, rest: Json): Json {
  return clean({ ...base, ...rest });
}

/** 一个 v33 组件 → v34 块（NEW_FORMAT §8.1 的表）。不认识的组件包成 look "$unknown"（M8）。 */
export function migrateComponentV33(c: Json, tables: V33Tables): Json {
  if (!isObject(c) || typeof c.type !== 'string' || !V33_TYPES.has(c.type)) {
    return clean({ id: c?.id, look: '$unknown', hidden: c?.hidden, raw: c });
  }
  const base = clean({ id: c.id, hidden: c.hidden, style: c.style });
  const p = (c.props ?? {}) as Json;
  switch (c.type) {
    case 'header':
    case 'text':
    case 'notice':
    case 'spacer':
      return block(base, { look: c.type, show: p });
    case 'divider':
      return block(base, { look: 'divider' });
    case 'image': {
      const { assetId, ...show } = p;
      return block(base, { look: 'image', show: clean({ asset: assetId, ...show }) });
    }
    case 'group':
      return block(base, {
        look: 'group',
        show: p,
        children: ((c.children as Json[] | undefined) ?? []).map((x) =>
          migrateComponentV33(x, tables),
        ),
      });
    case 'button': {
      const { target: opens, action, ...show } = p;
      return block(base, {
        look: 'button',
        show,
        opens: target(opens),
        tools: action ? [recordTool(action, undefined, tables)] : undefined,
      });
    }
    case 'shortcut':
      return block(base, {
        look: 'entry',
        show: clean({ title: p.title, subtitle: p.subtitle, icon: p.icon, shape: p.look }),
        opens: target(p.target),
      });
    case 'catalogLink':
      // 渲染器给 catalogLink 画的是主色标题、加号图标、默认大块（M7）。
      return block(base, {
        look: 'entry',
        show: { title: p.title, icon: 'plus', shape: p.look ?? 'tile', accent: true },
        opens: 'tools',
      });
    case 'toolCard':
      // 标题、图标、说明按工具包现取（换语言跟着变）；默认是大块（ToolCard 的 look ?? 'tile'）。
      return block(base, {
        look: 'entry',
        show: { shape: p.look ?? 'tile' },
        opens: `package:${p.toolId}`,
      });
    case 'fileSlot':
      return block(base, {
        look: 'entry',
        show: clean({ title: p.title, hint: p.hint, icon: p.icon, shape: p.look }),
        opens: { file: p.assetId ?? null },
      });
    case 'fileList': {
      // FileList.tsx：mimeType 是一大类时按前缀筛，不写时列出不是图片的文件。
      const kind: Record<string, Json> = {
        'application/pdf': { field: 'kind', op: 'is', value: 'pdf' },
        'image/*': { field: 'kind', op: 'is', value: 'image' },
        'video/*': { field: 'kind', op: 'is', value: 'video' },
        'audio/*': { field: 'kind', op: 'is', value: 'audio' },
      };
      const condition = p.mimeType
        ? kind[p.mimeType as string]
        : { field: 'kind', op: 'isNot', value: 'image' };
      return block(base, {
        look: 'files',
        show: { title: p.title },
        source: { table: '$files', filter: [condition], limit: p.limit },
      });
    }
    case 'filePick':
      return block(base, {
        look: 'picker',
        tools: [{ tool: p.source === 'files' ? '$pick.files' : '$pick.media' }],
      });
    case 'workflowRunner':
      return block(base, {
        look: 'action',
        show: p.look ? { shape: p.look } : undefined,
        tools: [{ tool: p.workflowId }],
      });
    case 'quickActionList':
      return block(base, {
        look: 'library',
        show: p.title ? { title: p.title } : undefined,
        source: clean({ catalog: 'quickActions', kind: p.kind }),
      });
    case 'toolGrid':
      return block(base, {
        look: 'packages',
        show: p.title ? { title: p.title } : undefined,
        source: clean({ catalog: 'packages', ids: p.toolIds }),
      });
    case 'recordList':
      return block(base, recordList(p, tables));
    case 'recordForm': {
      const table = tables.find(p.collectionId);
      if (p.mode === 'button') {
        // v33 的按钮模式忽略 values（data.tsx 的 openEditor 不带预填），v34 预填（Q6，当成修 bug）。
        // fieldIds、smartDate 在按钮模式下本来就不起作用（打开的是完整表单），丢掉。
        return block(base, {
          look: 'button',
          show: { label: p.submitLabel, variant: 'filled' },
          tools: [
            clean({
              do: 'create',
              table: p.collectionId,
              ask: 'all',
              values: values(p.values, table),
            }),
          ],
        });
      }
      return block(base, {
        look: 'form',
        show: { mode: p.mode },
        tools: [
          clean({
            as: 'submit',
            label: p.submitLabel,
            do: 'create',
            table: p.collectionId,
            ask: p.fieldIds,
            values: values(p.values, table),
            smartDate: p.smartDate,
          }),
        ],
      });
    }
    case 'stat': {
      const minus = isObject(p.minus)
        ? clean({
            table: p.minus.collectionId,
            aggregate: p.minus.aggregate,
            field: p.minus.fieldId,
            filter: p.minus.filter,
          })
        : undefined;
      return block(base, {
        look: 'number',
        show: { label: p.label },
        source: clean({
          table: p.collectionId,
          aggregate: p.aggregate,
          field: p.fieldId,
          filter: p.filter,
          days: days(p),
          group: p.groupBy !== undefined ? { by: p.groupBy } : undefined,
          goal: p.goal,
          compare: p.compare,
          minus,
        }),
      });
    }
    case 'chart': {
      const byChoice = p.group === 'choice';
      const group = byChoice
        ? clean({ by: p.choiceField })
        : clean({ by: p.dateField, unit: p.group, last: p.periods });
      return block(base, {
        look: 'chart',
        show: { kind: p.kind, title: p.title },
        source: clean({
          table: p.collectionId,
          aggregate: p.aggregate,
          field: p.fieldId,
          filter: p.filter,
          // 按单选分组时 distinctDays 仍按 dateField 数日子。
          days: byChoice && p.dateField !== undefined ? { date: p.dateField } : undefined,
          group,
        }),
      });
    }
    default:
      return c;
  }
}

function recordList(p: Json, tables: V33Tables): Json {
  const table = p.collectionId as string;
  const tools: Json[] = [];
  let group: Json | undefined;
  if (p.display === 'checklist' && p.checkField !== undefined)
    tools.push({ as: 'check', do: 'toggle', table, field: p.checkField });
  // 非 checklist 上的 checkField 渲染器不用（data.tsx 第 1035 行），丢掉（B6 #24）。
  if (p.display === 'board' && p.groupField !== undefined) {
    group = clean({ by: p.groupField, filter: p.groupFilter });
    // v33 的看板总能拖动：拖动是一个改分栏字段的 set。
    tools.push({ as: 'drag', do: 'set', table, field: p.groupField, value: '$group' });
  } else if (p.display === 'calendar') {
    group = clean({ by: p.dateField, unit: 'day' });
  } else if (p.groupBy !== undefined) {
    group = clean({ by: p.groupBy, unit: p.groupUnit, showEmpty: p.showEmpty });
  }
  const as = p.display === 'tiles' ? 'tap' : 'button';
  for (const a of (p.rowActions as Json[] | undefined) ?? [])
    tools.push(rowTool(a, as, table, tables));
  if (p.addHere) tools.push({ as: 'addHere', do: 'create', table, ask: 'all', values: '$here' });
  return {
    look: p.display,
    source: clean({ table, filter: p.filter, sort: p.sort, limit: p.limit, group }),
    show: clean({
      title: p.titleField,
      subtitles: p.subtitleFields,
      trailing: p.trailingField,
      format: p.trailingFormat,
      color: p.colorField,
      emptyText: p.emptyText,
    }),
    tools: nonEmpty(tools),
    opens: p.opens,
  };
}

/** v33 页面 → v34 页面（toolId → package，recordOf → of，components → blocks）。 */
export function migratePageV33(page: Json, tables: V33Tables): Json {
  const { toolId, recordOf, components, ...rest } = page;
  return clean({
    ...rest,
    package: toolId,
    of: recordOf,
    blocks: ((components as Json[] | undefined) ?? []).map((c) => migrateComponentV33(c, tables)),
  });
}

/** v33 工作流 → v34 快捷操作（toolId → package，presetId → preset；homeScreen 挪进 nav）。 */
export function migrateWorkflowV33(w: Json): Json {
  const { toolId, presetId, homeScreen: _home, id, name, icon, steps, ...rest } = w;
  return clean({
    id,
    kind: 'quickAction',
    name,
    icon,
    package: toolId,
    preset: presetId,
    ...rest,
    steps,
  });
}

/** v33 提醒 → v34 提醒（schedule + time + weekdays + collectionId + fieldId + daysBefore → when）。 */
export function migrateReminderV33(r: Json, tables: V33Tables): Json {
  const at = r.time;
  const on = { table: r.collectionId, field: r.fieldId };
  const when =
    r.schedule === 'daily'
      ? { every: 'day', at }
      : r.schedule === 'weekly'
        ? { every: 'week', days: r.weekdays, at }
        : r.schedule === 'dateField'
          ? { before: on, days: r.daysBefore ?? 0, at }
          : { each: on, at };
  const table = tables.find(r.collectionId);
  const done = isObject(r.done)
    ? r.done.do === 'create'
      ? clean({
          do: 'create',
          table: r.done.collectionId,
          values: values(r.done.values, tables.find(r.done.collectionId)),
        })
      : r.done.do === 'set'
        ? {
            do: 'set',
            table: r.collectionId,
            field: r.done.fieldId,
            value: value(r.done.value, table, r.done.fieldId),
          }
        : { do: 'increment', table: r.collectionId, field: r.done.fieldId, by: r.done.by }
    : undefined;
  const unless = isObject(r.unless)
    ? clean({
        table: r.unless.collectionId,
        within: r.unless.within,
        filter: r.unless.filter,
        date: r.unless.dateField,
        link: r.unless.link,
      })
    : undefined;
  return clean({
    id: r.id,
    kind: 'reminder',
    title: r.title,
    enabled: r.enabled,
    when,
    opens: target(r.opens),
    done,
    snoozeMinutes: r.snoozeMinutes,
    unless,
  });
}

/** 房间布局：上下的组件按块转，工具栏的 {workflowId} → 快捷操作 ID。 */
function desk(d: unknown, tables: V33Tables): Json | undefined {
  if (!isObject(d)) return undefined;
  const slot = (list: unknown) =>
    Array.isArray(list) ? list.map((c) => migrateComponentV33(c as Json, tables)) : undefined;
  const tools = isObject(d.tools)
    ? Object.fromEntries(
        Object.entries(d.tools).map(([kind, groups]) => [
          kind,
          (groups as Json[]).map((g) => ({
            ...g,
            items: (g.items as Json[]).map((i) =>
              isObject(i) && 'workflowId' in i ? i.workflowId : i,
            ),
          })),
        ]),
      )
    : undefined;
  return clean({ ...d, above: slot(d.above), below: slot(d.below), tools });
}

/** 撞号时给提醒换一个不重复的 ID（M1：快捷操作的 ID 被运行记录、上次结果、使用习惯引用得更多）。 */
function uniqueReminderId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) {
    const next = `${id}-reminder${n === 2 ? '' : `-${n}`}`.slice(0, 48);
    if (!taken.has(next)) return next;
  }
}

export function migrateV33toV34(config: Json): Json {
  const collections = ((config.collections as Json[] | undefined) ?? []) as Json[];
  const tables = v33Tables(collections);
  const workflows = ((config.workflows as Json[] | undefined) ?? []) as Json[];
  const taken = new Set(workflows.map((w) => w.id as string));
  const reminders = ((config.reminders as Json[] | undefined) ?? []).map((r) => {
    const id = uniqueReminderId(r.id as string, taken);
    taken.add(id);
    return migrateReminderV33({ ...r, id }, tables);
  });
  const shell = (config.shell ?? {}) as Json;
  const homeScreen = workflows.filter((w) => w.homeScreen === true).map((w) => w.id as string);
  const data = clean({
    tables: collections.map((c) => migrateTableV33(c, tables)),
    calendar: config.calendar,
  });
  return {
    schemaVersion: 34,
    theme: config.theme,
    nav: clean({
      bar: shell.nav,
      floating: shell.floating,
      phoneHomeScreen: nonEmpty(homeScreen),
    }),
    data,
    containers: clean({
      pages: ((config.pages as Json[] | undefined) ?? []).map((p) => migratePageV33(p, tables)),
      desk: desk(config.desk, tables),
    }),
    tools: [...workflows.map(migrateWorkflowV33), ...reminders],
    packages: ((config.tools as Json[] | undefined) ?? []).map((t) => ({
      id: t.toolId,
      version: t.version,
      page: t.pageId,
    })),
  };
}
