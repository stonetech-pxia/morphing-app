import { localize } from './localization';
import { t, pairText, type StringKey } from './messages';
import { SYSTEM_TARGET_LABELS } from './defaults';
import { plainText } from './richtext';
import { shownInToolGrid, type ApplyNote } from './ops';
import type { BlockChanges, Op } from './ops-schema';
import { THEME_PRESETS } from './presets';
import { QUICK_ACTION_CATEGORIES } from './quick-actions';
import type { Registry } from './registry';
import { describeParams } from './workflow/format';
import {
  FIELDS,
  allComponents,
  componentDefinition,
  isFileTarget,
  isKnownComponent,
  pageIdOf,
  quickActionsOf,
  remindersOf,
  type Backdrop,
  type BackdropPatch,
  type Component,
  type Locale,
  type Localized,
  type NavTarget,
  type OpenTarget,
  type Page,
  type QuickAction,
  type Reminder,
  type Theme,
  type WorkspaceConfig,
  type WorkflowStep,
} from './schema';

// 把修改操作翻译成用户能看懂的说明（§4：将新增、删除或调整哪些页面/操作）。
// 描述基于修改前的配置，这样被删除或改名的对象仍能用原来的名字称呼。

export interface DescribeContext {
  registry: Registry;
  locale: Locale;
  /** 用于展示命名模板示例。 */
  now: Date;
}

export function navTargetLabel(target: NavTarget, config: WorkspaceConfig, locale: Locale): string {
  const pageId = pageIdOf(target);
  if (pageId === null)
    return localize(SYSTEM_TARGET_LABELS[target as keyof typeof SYSTEM_TARGET_LABELS], locale);
  return config.containers.pages.find((p) => p.id === pageId)?.title ?? pageId;
}

export function componentLabel(
  c: Component,
  config: WorkspaceConfig,
  ctx: DescribeContext,
): string {
  if (!isKnownComponent(c)) return t(ctx.locale, 'describeUnknownComponent');
  return componentDefinition(c.look).describe(c, config, ctx);
}

/** 提醒什么时候响（修改说明用）。 */
export function reminderWhen(r: Reminder, config: WorkspaceConfig, locale: Locale): string {
  const when = r.when;
  if ('every' in when && when.every === 'day')
    return t(locale, 'reminderWhenDaily', { time: when.at });
  if ('every' in when) {
    const days = [...new Set(when.days)]
      .sort()
      .map((d) => t(locale, `weekday${d}` as StringKey))
      .join(t(locale, 'separatorList'));
    return t(locale, 'reminderWhenWeekly', { days, time: when.at });
  }
  const on = 'each' in when ? when.each : when.before;
  const table = config.data.tables.find((c) => c.id === on.table);
  const field = table?.fields.find((f) => f.id === on.field);
  if ('each' in when)
    return t(locale, 'reminderWhenSchedule', {
      field: field?.name ?? on.field,
      table: table?.name ?? on.table,
      time: when.at,
    });
  return t(locale, 'reminderWhenDate', {
    field: field?.name ?? on.field,
    table: table?.name ?? on.table,
    n: when.days,
    time: when.at,
  });
}

const truncate = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** 字段类型在修改说明里的名字（字段定义的 label）。 */
const FIELD_TYPE_NAMES: Record<string, [string, string]> = Object.fromEntries(
  FIELDS.map((d) => [d.type, d.label]),
);

type ThemeTokenKey = Exclude<keyof Theme, 'primaryColor' | 'mode' | 'colors' | 'darkColors'>;

/** 主题 token 的名字和取值说明。 */
function describeToken(key: ThemeTokenKey, value: unknown, locale: Locale): string {
  const values: Record<string, Record<string, [string, string]>> = {
    font: {
      clay: ['默认字体（Sora + Karla）', 'the default fonts (Sora + Karla)'],
      system: ['系统字体', 'the system font'],
      serif: ['衬线字体', 'a serif font'],
      mono: ['等宽字体', 'a monospaced font'],
    },
    density: {
      compact: ['紧凑', 'compact'],
      comfortable: ['适中', 'comfortable'],
      spacious: ['宽松', 'spacious'],
    },
    cardStyle: {
      shadow: ['阴影', 'shadow'],
      outline: ['描边', 'outline'],
      flat: ['无阴影无描边', 'flat'],
      brutal: ['粗边框 + 硬阴影（新粗野）', 'bold outline with a hard shadow (neubrutalist)'],
      soft: ['柔和浮雕（新拟物）', 'soft embossed (neumorphic)'],
      puffy: ['鼓起的黏土质感', 'puffy clay'],
      glass: ['毛玻璃', 'frosted glass'],
      glow: ['霓虹发光', 'neon glow'],
      chrome: ['金属质感（Y2K）', 'chrome (Y2K)'],
    },
    backdrop: {
      plain: ['纯色', 'a solid color'],
      gradient: ['渐变', 'a gradient'],
      aurora: ['极光', 'aurora'],
    },
    navStyle: {
      iconLabel: ['图标 + 文字', 'icons and labels'],
      label: ['只显示文字', 'labels only'],
      icon: ['只显示图标', 'icons only'],
    },
    iconStyle: {
      solid: ['实色底', 'solid'],
      tint: ['浅色底', 'light tint'],
    },
  };
  const names: Record<ThemeTokenKey, [string, string]> = {
    font: ['字体', 'Font'],
    fontScale: ['字号', 'Text size'],
    radius: ['圆角', 'Corner radius'],
    density: ['间距', 'Spacing'],
    cardStyle: ['卡片样式', 'Card style'],
    navStyle: ['导航栏样式', 'Navigation bar'],
    backdrop: ['页面背景', 'Page background'],
    iconStyle: ['图标底色', 'Icon background'],
  };
  const pick = ([a, b]: [string, string]) => pairText(locale, [b, a]);
  let shown: string;
  if (key === 'fontScale') shown = `${Math.round(Number(value) * 100)}%`;
  else if (key === 'radius') shown = String(value);
  else shown = pick(values[key]?.[String(value)] ?? [String(value), String(value)]);
  return t(locale, 'describe__41054', { v0: pick(names[key]), v1: shown });
}

export function describeChange(
  ops: readonly Op[],
  before: WorkspaceConfig,
  notes: readonly ApplyNote[],
  ctx: DescribeContext,
): string[] {
  const zh = ctx.locale === 'zh';
  // 同一次修改里新建的数据表、页面也要能用名字称呼（例如新建页面后把它放进导航栏）。
  const addedTables = ops.flatMap((op) =>
    op.op === 'addData' && typeof op.table !== 'string' ? [op.table] : [],
  );
  const addedPages = ops.flatMap((op) =>
    op.op === 'addContainer' && typeof op.page === 'object' ? [op.page as Page] : [],
  );
  // 同一次修改里新建的快捷操作、提醒也要能找到名字（新建后接着加步骤）。
  const addedTools = ops.flatMap((op) =>
    op.op === 'addTool' && typeof op.tool !== 'string' ? [op.tool] : [],
  );
  const known: WorkspaceConfig = {
    ...before,
    data: { ...before.data, tables: [...before.data.tables, ...addedTables] },
    containers: { ...before.containers, pages: [...before.containers.pages, ...addedPages] },
    tools: [...before.tools, ...addedTools],
  };
  const page = (id: string) => known.containers.pages.find((p) => p.id === id);
  const pageName = (id: string) => page(id)?.title ?? id;
  // 同一次修改里新加的块（例如先加分组再把卡片移进去）也要能用名字称呼。
  const added = ops.flatMap((op) =>
    op.op === 'addContainer' && op.block ? [op.block as Component] : [],
  );
  const findComp = (pageId: string, id: string) => {
    const p = page(pageId);
    return (
      (p ? allComponents(p).find((x) => x.id === id) : undefined) ?? added.find((x) => x.id === id)
    );
  };
  const comp = (pageId: string, id: string) => {
    const c = findComp(pageId, id);
    return c ? componentLabel(c, known, ctx) : id;
  };
  const deskBlock = (id: string) => {
    const desk = known.containers.desk;
    const c = [...(desk?.above ?? []), ...(desk?.below ?? []), ...added].find((x) => x.id === id);
    return c ? componentLabel(c as Component, known, ctx) : id;
  };
  const toolName = (id: string) => localize(ctx.registry.tools.get(id)?.name, ctx.locale) ?? id;
  const wf = (id: string): QuickAction | undefined =>
    quickActionsOf(known).find((w) => w.id === id);
  const reminder = (id: string): Reminder | undefined =>
    remindersOf(known).find((r) => r.id === id);
  const actionLabel = (action: string) =>
    localize(ctx.registry.actions.get(action)?.label, ctx.locale) ?? action;
  const stepLabel = (wfId: string, stepId: string) => {
    const action = wf(wfId)?.steps.find((s) => s.id === stepId)?.action;
    return action ? actionLabel(action) : stepId;
  };
  const stepChain = (steps: readonly { action: string }[]) =>
    steps.map((st) => actionLabel(st.action)).join(' → ');
  const navList = (items: readonly NavTarget[]) =>
    items.map((t) => navTargetLabel(t, known, ctx.locale)).join(t(ctx.locale, 'separatorList'));
  const modeLabel = {
    light: t(ctx.locale, 'describe_light_57222'),
    dark: t(ctx.locale, 'describe_dark_12552'),
    system: t(ctx.locale, 'describe_system_84963'),
  };

  const colorNames = {
    background: t(ctx.locale, 'describe_Background_639fc'),
    surface: t(ctx.locale, 'describe_Card_color_cb523'),
    text: t(ctx.locale, 'describe_Text_color_af4a8'),
    secondary: t(ctx.locale, 'describe_Secondary_color_844c7'),
    tertiary: t(ctx.locale, 'describe_Tertiary_color_dec1a'),
  };
  const where = (pageId: string, parentId: string | undefined) => {
    if (parentId === undefined) return t(ctx.locale, 'describe__441c2', { v0: pageName(pageId) });
    return t(ctx.locale, 'describe_on_43dea', { v0: comp(pageId, parentId), v1: pageName(pageId) });
  };

  const coll = (id: string) => known.data.tables.find((c) => c.id === id);
  const collName = (id: string) => coll(id)?.name ?? id;
  const fieldName = (tableId: string, fieldId: string) =>
    coll(tableId)?.fields.find((f) => f.id === fieldId)?.name ?? fieldId;
  const typeName = (type: unknown) =>
    FIELD_TYPE_NAMES[String(type)]
      ? pairText(ctx.locale, [
          FIELD_TYPE_NAMES[String(type)]![1],
          FIELD_TYPE_NAMES[String(type)]![0],
        ])
      : String(type);
  const list = (items: string[]) => items.join(t(ctx.locale, 'separatorList'));

  /** 改了快捷操作的一步：参数（合并）、每次问什么（整个换）。 */
  const describeStep = (
    wfId: string,
    stepId: string,
    params: Record<string, unknown> | undefined,
    ask: string[] | undefined,
  ) => {
    const name = wf(wfId)?.name ?? wfId;
    const step = stepLabel(wfId, stepId);
    const action = ctx.registry.actions.get(
      wf(wfId)?.steps.find((s) => s.id === stepId)?.action ?? '',
    );
    const shown = params && action ? describeParams(action, params, ctx.locale, ctx.now) : '';
    if (shown) {
      lines.push(t(ctx.locale, 'describe__3ca25', { v0: name, v1: step, v2: shown }));
    } else if (params) {
      lines.push(t(ctx.locale, 'describe_Update_c2f66', { v0: name, v1: step }));
    }
    if (ask !== undefined) {
      const asked =
        action && ask.length > 0
          ? action.fields
              .filter((f) => ask.includes(f.key))
              .map((f) => localize(f.label, ctx.locale))
              .join(t(ctx.locale, 'separatorList'))
          : '';
      lines.push(
        asked
          ? t(ctx.locale, 'describe_asks_for_on_every_run_708a8', { v0: name, v1: asked })
          : t(ctx.locale, 'describe_no_longer_asks_it_uses_the_saved_setti_a3369', {
              v0: name,
              v1: step,
            }),
      );
    }
  };

  /** 块的 show / source / tools / opens 的修改（原 setComponentProps：一个属性一段）。 */
  const blockChanges = (pageId: string, blockId: string, changes: BlockChanges): string[] => {
    const current = findComp(pageId, blockId);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(changes.show ?? {})) {
      if (k === 'asset') {
        parts.push(
          v
            ? t(ctx.locale, 'describe_new_picture_bf924')
            : t(ctx.locale, 'describe_picture_removed_4fb32'),
        );
        continue;
      }
      parts.push(propChange(k, v));
    }
    for (const [k, v] of Object.entries(changes.source ?? {})) parts.push(propChange(k, v));
    if (changes.tools !== undefined)
      parts.push(
        changes.tools === null
          ? t(ctx.locale, 'describe_removed_d5c25', {
              v0: localize(PROP_NAMES.tools!, ctx.locale),
            })
          : t(ctx.locale, 'v34descToolsChanged'),
      );
    if (changes.opens !== undefined) {
      const opens = changes.opens as OpenTarget | null;
      const wasFile =
        current && isKnownComponent(current) && 'opens' in current
          ? isFileTarget(current.opens as OpenTarget)
          : false;
      if ((opens !== null && isFileTarget(opens)) || (opens === null && wasFile))
        parts.push(
          t(
            ctx.locale,
            opens !== null && isFileTarget(opens) && opens.file
              ? 'describeNewFile'
              : 'describeFileRemoved',
          ),
        );
      else parts.push(propChange('opens', opens));
    }
    return parts;
  };
  /** 一个属性改成什么（名字、取值都写成人话，D-230；富文本显示成纯文字，太长时截断）。 */
  const propChange = (k: string, v: unknown) => {
    const name = localize(PROP_NAMES[k], ctx.locale) ?? k;
    if (v === null) return t(ctx.locale, 'describe_removed_d5c25', { v0: name });
    const named = typeof v === 'string' ? localize(PROP_VALUES[k]?.[v], ctx.locale) : null;
    if (named) return t(ctx.locale, 'describe__41054', { v0: name, v1: named });
    const shown = typeof v === 'string' && k === 'text' ? truncate(plainText(v)) : v;
    const value =
      typeof shown === 'string'
        ? t(ctx.locale, 'describe__441c2', { v0: shown })
        : JSON.stringify(shown);
    return t(ctx.locale, 'describe__41054', { v0: name, v1: value });
  };

  const lines: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      // ---- 数据 ----
      case 'addData':
        if (typeof op.table !== 'string')
          lines.push(
            t(ctx.locale, 'describe_Add_data_table_f79c6', {
              v0: op.table.name,
              v1: list(op.table.fields.map((f) => f.name)),
            }),
          );
        else if (op.field)
          lines.push(
            t(ctx.locale, 'describe_Add_field_to_b8810', {
              v0: op.field.name,
              v1: typeName(op.field.type),
              v2: collName(op.table),
            }),
          );
        break;
      case 'updateData': {
        if (op.calendar) {
          const c = op.calendar;
          if (c.dayStartHour !== undefined)
            lines.push(t(ctx.locale, 'describeDayStart', { hour: c.dayStartHour ?? 0 }));
          if (c.weekStart !== undefined)
            lines.push(
              t(
                ctx.locale,
                c.weekStart === 'sunday' ? 'describeWeekStartSunday' : 'describeWeekStartMonday',
              ),
            );
          if (c.twoWeekStart !== undefined)
            lines.push(
              c.twoWeekStart === null
                ? t(ctx.locale, 'describeTwoWeekStartReset')
                : t(ctx.locale, 'describeTwoWeekStart', { date: c.twoWeekStart }),
            );
          break;
        }
        const table = op.table!;
        const changes = op.changes ?? {};
        if (op.field === undefined) {
          if (typeof changes.name === 'string')
            lines.push(
              t(ctx.locale, 'describe_Rename_data_table_to_c585f', {
                v0: collName(table),
                v1: changes.name,
              }),
            );
          if (changes.icon !== undefined)
            lines.push(t(ctx.locale, 'describe_Change_the_icon_of_9c456', { v0: collName(table) }));
          break;
        }
        const name = fieldName(table, op.field);
        const parts: string[] = [];
        if (typeof changes.name === 'string')
          parts.push(t(ctx.locale, 'describe_rename_to_08deb', { v0: changes.name }));
        if (changes.type !== undefined)
          parts.push(t(ctx.locale, 'describe_type_7382b', { v0: typeName(changes.type) }));
        if (Array.isArray(changes.options)) {
          const labels = (changes.options as { label?: unknown }[]).map((o) => String(o.label));
          parts.push(t(ctx.locale, 'describe_options_64e79', { v0: list(labels) }));
        }
        if (parts.length === 0) parts.push(t(ctx.locale, 'describe_update_settings_2aaf6'));
        lines.push(
          t(ctx.locale, 'describeFieldChange', {
            collection: collName(table),
            name,
            changes: parts.join(t(ctx.locale, 'separatorComma')),
          }),
        );
        break;
      }
      case 'removeData':
        lines.push(
          op.field === undefined
            ? t(ctx.locale, 'describe_Remove_data_table_from_the_app_records_1a3d2', {
                v0: collName(op.table),
              })
            : t(ctx.locale, 'describe_Hide_field_of_existing_data_is_kept_4f9d1', {
                v0: fieldName(op.table, op.field),
                v1: collName(op.table),
              }),
        );
        break;
      case 'moveData':
        lines.push(
          t(ctx.locale, 'describe_Move_field_of_to_position_aa798', {
            v0: fieldName(op.table, op.field),
            v1: collName(op.table),
            v2: op.toIndex + 1,
          }),
        );
        break;

      // ---- 容器 ----
      case 'addContainer':
        if (op.desk !== undefined && op.block)
          lines.push(
            t(ctx.locale, op.desk === 'above' ? 'v34descDeskAddAbove' : 'v34descDeskAddBelow', {
              v0: componentLabel(op.block as Component, known, ctx),
            }),
          );
        else if (typeof op.page === 'object' && op.page !== null)
          lines.push(
            t(ctx.locale, 'describe_Add_page_blocks_80d1f', {
              v0: op.page.title,
              v1: op.page.blocks.length,
            }),
          );
        else if (typeof op.page === 'string' && op.block)
          lines.push(
            t(ctx.locale, 'describe_Add_to_f2026', {
              v0: componentLabel(op.block as Component, known, ctx),
              v1: where(op.page, op.parent),
            }),
          );
        break;
      case 'updateContainer': {
        if (op.nav) {
          const nav = op.nav;
          if (nav.bar)
            lines.push(
              t(ctx.locale, 'describe_Navigation_was_7f9d5', {
                v0: navList(nav.bar),
                v1: navList(before.nav.bar),
              }),
            );
          if (nav.floating)
            lines.push(
              nav.floating.length === 0
                ? t(ctx.locale, 'describe_Remove_all_floating_buttons_0029b')
                : t(ctx.locale, 'describe_Floating_buttons_d071d', { v0: navList(nav.floating) }),
            );
          if (nav.phoneHomeScreen) {
            // 整个列表：多出来的放上手机桌面，少了的拿掉（D-271）。
            const was = before.nav.phoneHomeScreen ?? [];
            for (const id of nav.phoneHomeScreen)
              if (!was.includes(id))
                lines.push(t(ctx.locale, 'describeHomeScreenOn', { name: wf(id)?.name ?? id }));
            for (const id of was)
              if (!nav.phoneHomeScreen.includes(id))
                lines.push(t(ctx.locale, 'describeHomeScreenOff', { name: wf(id)?.name ?? id }));
          }
          break;
        }
        if (op.desk) {
          lines.push(t(ctx.locale, 'v34descDeskLayout'));
          break;
        }
        const pageId = op.page!;
        if (op.block === undefined) {
          const changes = (op.changes ?? {}) as {
            title?: string;
            icon?: string | null;
            backdrop?: BackdropPatch | null;
          };
          if (changes.title !== undefined)
            lines.push(
              t(ctx.locale, 'describe_Rename_page_to_5e2cc', {
                v0: pageName(pageId),
                v1: changes.title,
              }),
            );
          if (changes.icon !== undefined)
            lines.push(
              t(ctx.locale, 'describePageIcon', {
                page: pageName(pageId),
                icon: changes.icon
                  ? t(ctx.locale, 'describeNewIcon', { icon: changes.icon })
                  : t(ctx.locale, 'describeNoIcon'),
              }),
            );
          if (changes.backdrop !== undefined)
            lines.push(
              t(ctx.locale, 'describePageBackdrop', {
                page: pageName(pageId),
                change: backdropChange(changes.backdrop, page(pageId)?.backdrop, ctx.locale),
              }),
            );
          break;
        }
        const changes = (op.changes ?? {}) as BlockChanges;
        const label = comp(pageId, op.block);
        if (changes.hidden !== undefined)
          lines.push(
            t(ctx.locale, changes.hidden ? 'describeHideComponent' : 'describeShowComponent', {
              component: label,
            }),
          );
        if (changes.style) {
          const current = findComp(pageId, op.block);
          lines.push(
            t(ctx.locale, 'describe_Restyle_0b6e5', {
              v0: label,
              v1: styleChanges(
                changes.style,
                current && isKnownComponent(current) ? current.style?.backdrop : undefined,
                ctx.locale,
                zh,
              ),
            }),
          );
        }
        const parts = blockChanges(pageId, op.block, changes);
        if (parts.length > 0)
          lines.push(
            t(ctx.locale, 'describe_Update_75049', {
              v0: label,
              v1: parts.join(t(ctx.locale, 'separatorComma')),
            }),
          );
        break;
      }
      case 'removeContainer':
        if (op.desk !== undefined)
          lines.push(t(ctx.locale, 'v34descDeskRemove', { v0: deskBlock(op.block!) }));
        else if (op.block === undefined)
          lines.push(
            t(ctx.locale, 'describe_Remove_page_files_are_not_affected_5abad', {
              v0: pageName(op.page!),
            }),
          );
        else
          lines.push(
            t(ctx.locale, 'describe_Remove_from_c2717', {
              v0: comp(op.page!, op.block),
              v1: pageName(op.page!),
            }),
          );
        break;
      case 'moveContainer':
        lines.push(
          t(ctx.locale, 'describe_Move_to_position_in_7eb22', {
            v0: comp(op.page, op.block),
            v1: op.toIndex + 1,
            v2: where(op.page, op.parent),
          }),
        );
        break;

      // ---- 工具 ----
      case 'addTool': {
        if (typeof op.tool === 'string') {
          const step = op.step as WorkflowStep;
          const name = wf(op.tool)?.name ?? op.tool;
          const action = ctx.registry.actions.get(step.action);
          const params = action ? describeParams(action, step.params, ctx.locale, ctx.now) : '';
          lines.push(
            t(ctx.locale, 'describeAddStep', {
              name,
              label: actionLabel(step.action),
              params: params ? t(ctx.locale, 'describeStepParameters', { params }) : '',
            }),
          );
        } else if (op.tool.kind === 'reminder') {
          lines.push(
            t(ctx.locale, 'describeAddReminder', {
              title: op.tool.title,
              when: reminderWhen(op.tool, known, ctx.locale),
            }),
          );
        } else {
          const from = op.tool.preset ? t(ctx.locale, 'describe_ready_made_61047') : '';
          lines.push(
            t(ctx.locale, 'describe_New_quick_action_b4026', {
              v0: op.tool.name,
              v1: from,
              v2: stepChain(op.tool.steps),
            }),
          );
        }
        break;
      }
      case 'updateTool': {
        const changes = op.changes;
        if (op.step !== undefined) {
          describeStep(
            op.tool,
            op.step,
            changes.params as Record<string, unknown> | undefined,
            changes.ask as string[] | undefined,
          );
          break;
        }
        const r = reminder(op.tool);
        if (r) {
          lines.push(t(ctx.locale, 'describeUpdateReminder', { title: r.title }));
          break;
        }
        const name = wf(op.tool)?.name ?? op.tool;
        const newName = typeof changes.name === 'string' ? changes.name : undefined;
        const steps = changes.steps as { action: string }[] | undefined;
        if (steps) {
          // 整体换步骤（原 updateWorkflow：快捷操作编辑页保存、恢复预设）。
          if (newName !== undefined && newName !== name)
            lines.push(t(ctx.locale, 'describe_Rename_to_decb3', { v0: name, v1: newName }));
          lines.push(
            t(ctx.locale, 'describe_Steps_of_591ff', { v0: newName ?? name, v1: stepChain(steps) }),
          );
        } else if (newName !== undefined) {
          lines.push(
            t(ctx.locale, 'describe_Rename_the_quick_action_to_e45a1', { v0: name, v1: newName }),
          );
        } else if (changes.icon !== undefined) {
          lines.push(t(ctx.locale, 'v34descQuickActionIcon', { name }));
        }
        break;
      }
      case 'removeTool': {
        if (op.step !== undefined) {
          lines.push(
            t(ctx.locale, 'describe_Remove_step_from_8750c', {
              v0: stepLabel(op.tool, op.step),
              v1: wf(op.tool)?.name ?? op.tool,
            }),
          );
          break;
        }
        const r = reminder(op.tool);
        lines.push(
          r
            ? t(ctx.locale, 'describeRemoveReminder', { title: r.title })
            : t(ctx.locale, 'describe_Delete_the_quick_action_files_are_kept_deaf1', {
                v0: wf(op.tool)?.name ?? op.tool,
              }),
        );
        break;
      }
      case 'moveTool':
        lines.push(
          t(ctx.locale, 'describe_Move_to_step_in_885bf', {
            v0: stepLabel(op.tool, op.step),
            v1: op.toIndex + 1,
            v2: wf(op.tool)?.name ?? op.tool,
          }),
        );
        break;

      // ---- 主题 ----
      case 'setTheme': {
        if (op.preset) {
          const name = localize(THEME_PRESETS[op.preset].name, ctx.locale);
          lines.push(
            t(ctx.locale, 'describe_Switch_the_style_to_colors_fonts_corne_60590', { v0: name }),
          );
          break;
        }
        if (op.reset) {
          lines.push(t(ctx.locale, 'describe_Reset_the_style_to_the_default_colors__162af'));
          break;
        }
        if (op.primaryColor)
          lines.push(t(ctx.locale, 'describe_Theme_color_8ee07', { v0: op.primaryColor }));
        if (op.mode)
          lines.push(t(ctx.locale, 'describe_Appearance_b422e', { v0: modeLabel[op.mode] }));
        const colorChanges = [
          ...Object.entries(op.colors ?? {}).map(([k, v]) => [k, v, ''] as const),
          ...Object.entries(op.darkColors ?? {}).map(
            ([k, v]) => [k, v, t(ctx.locale, 'describe_Dark_mode_74033')] as const,
          ),
        ];
        for (const [key, value, prefix] of colorChanges) {
          if (value === undefined) continue;
          const label = colorNames[key as keyof typeof colorNames];
          // 法语不能拼成「Mode sombre arrière-plan」：整句按语言写在 describe_dark_color 里。
          const name = prefix
            ? t(ctx.locale, 'describe_dark_color', {
                v0: ctx.locale === 'en' ? label.toLowerCase() : label,
              })
            : label;
          lines.push(
            value === null
              ? t(ctx.locale, 'describe_default_82b64', { v0: name })
              : t(ctx.locale, 'describe__072d2', { v0: name, v1: value }),
          );
        }
        for (const key of [
          'font',
          'fontScale',
          'radius',
          'density',
          'cardStyle',
          'navStyle',
          'backdrop',
          'iconStyle',
        ] as const) {
          if (op[key] !== undefined) lines.push(describeToken(key, op[key], ctx.locale));
        }
        break;
      }

      // ---- 工具包（界面上叫「工具」）----
      case 'setPackage':
        if (op.do === 'add')
          // 工具箱里已经有这个工具时不再往首页放入口（D-181）。
          lines.push(
            shownInToolGrid(known, op.package, [...ctx.registry.tools.keys()])
              ? t(ctx.locale, 'describe_Add_the_tool_adds_its_page_7a595', {
                  v0: toolName(op.package),
                })
              : t(ctx.locale, 'describe_Add_the_tool_adds_its_page_and_a_home__ec774', {
                  v0: toolName(op.package),
                }),
          );
        else if (op.do === 'remove')
          lines.push(
            t(ctx.locale, 'describe_Remove_the_tool_removes_its_card_page__2fb97', {
              v0: toolName(op.package),
            }),
          );
        // update：说明在 notes 里（列出新增的功能）。
        break;
    }
  }
  for (const note of notes) {
    if (note.kind === 'movedToFloating') {
      const label = navTargetLabel(note.target, before, ctx.locale);
      lines.push(
        t(ctx.locale, 'describe_can_t_be_removed_it_holds_the_AI_and_C_e58da', { v0: label }),
      );
    } else if (note.kind === 'updatedTool') {
      const def = ctx.registry.tools.get(note.package);
      const names = def
        ? def
            .createWorkflows(ctx.locale)
            .filter((w) => note.tools.includes(w.id))
            .map((w) => w.name)
        : note.tools;
      lines.push(
        names.length === 0
          ? t(ctx.locale, 'describe_Update_the_tool_to_the_latest_version__b20b4', {
              v0: toolName(note.package),
            })
          : t(ctx.locale, 'describeUpdatedTool', {
              tool: toolName(note.package),
              names: names.join(t(ctx.locale, 'separatorList')),
            }),
      );
    } else if (note.kind === 'removedRunners') {
      lines.push(
        t(ctx.locale, 'describe_Also_removes_card_s_that_ran_this_quic_5d29f', { v0: note.count }),
      );
    } else if (note.kind === 'removedReminders') {
      lines.push(
        t(ctx.locale, 'describeRemovedReminders', {
          names: note.titles.join(t(ctx.locale, 'separatorList')),
        }),
      );
    } else if (note.kind === 'removedDataComponents') {
      lines.push(
        t(ctx.locale, 'describe_Also_removes_block_s_that_showed_a7a30', {
          v0: note.count,
          v1: collName(note.table),
        }),
      );
    } else if (note.kind === 'addedEntryForm') {
      lines.push(t(ctx.locale, 'describeAddedEntryForm', { table: collName(note.table) }));
    } else if (note.kind === 'removedRecordActions') {
      lines.push(t(ctx.locale, 'describeRemovedRecordActions', { n: note.count }));
    } else if (note.kind === 'removedWorkflowLinks') {
      lines.push(
        t(ctx.locale, 'describe_Also_removes_button_s_or_shortcut_s_th_d4dc1', {
          v0: note.count,
          v1: wf(note.tool)?.name ?? note.tool,
        }),
      );
    } else {
      lines.push(
        t(ctx.locale, 'describe_Also_removes_button_s_or_shortcut_s_th_d4dc1', {
          v0: note.count,
          v1: pageName(note.pageId),
        }),
      );
    }
  }
  return lines;
}

/** 恢复历史版本时的说明（§7E）：哪些会回到当时的样子、工具入口如何变化、文件不受影响。 */
export function describeRestore(
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  revision: { id: number; summary: string },
  ctx: Pick<DescribeContext, 'registry' | 'locale'>,
): string[] {
  const toolName = (id: string) => localize(ctx.registry.tools.get(id)?.name, ctx.locale) ?? id;
  const beforeTools = new Set(before.packages.map((t) => t.id));
  const afterTools = new Set(after.packages.map((t) => t.id));
  const lines = [
    t(ctx.locale, 'describe_Go_back_to_when_happened_pages_navigat_cbdc3', {
      v0: revision.summary,
    }),
  ];
  for (const id of beforeTools) {
    if (!afterTools.has(id)) {
      lines.push(
        t(ctx.locale, 'describe_The_tool_s_card_and_quick_actions_will_a857b', {
          v0: toolName(id),
        }),
      );
    }
  }
  for (const id of afterTools) {
    if (!beforeTools.has(id)) {
      lines.push(t(ctx.locale, 'describe_The_tool_comes_back_205fb', { v0: toolName(id) }));
    }
  }
  const tables = (c: WorkspaceConfig) => new Set(c.data.tables.map((x) => x.id));
  const [beforeTables, afterTables] = [tables(before), tables(after)];
  for (const c of before.data.tables) {
    if (!afterTables.has(c.id)) {
      lines.push(
        t(ctx.locale, 'describe_The_table_leaves_the_app_its_entries_s_29282', { v0: c.name }),
      );
    }
  }
  for (const c of after.data.tables) {
    if (!beforeTables.has(c.id)) {
      lines.push(t(ctx.locale, 'describe_The_table_comes_back_dd301', { v0: c.name }));
    }
  }
  lines.push(
    before.data.tables.length + after.data.tables.length > 0
      ? t(ctx.locale, 'describe_Your_files_and_entries_are_not_affecte_c87ef')
      : t(ctx.locale, 'describe_Your_files_are_not_affected_3c83c'),
  );
  return lines;
}

/** 块的 show / source 里的键在修改说明里的名字（原组件 props 的名字；look → shape，target → opens）。 */
const PROP_NAMES: Record<string, Localized> = {
  title: { zh: '标题', en: 'title', fr: 'titre' },
  subtitle: { zh: '副标题', en: 'subtitle', fr: 'sous-titre' },
  text: { zh: '文字', en: 'text', fr: 'texte' },
  label: { zh: '文字', en: 'label', fr: 'texte' },
  layout: { zh: '排列方式', en: 'layout', fr: 'disposition' },
  columns: { zh: '列数', en: 'columns', fr: 'colonnes' },
  icon: { zh: '图标', en: 'icon', fr: 'icône' },
  opens: { zh: '打开的页面', en: 'target', fr: 'page ouverte' },
  variant: { zh: '样式', en: 'variant', fr: 'variante' },
  aspect: { zh: '比例', en: 'aspect', fr: 'proportions' },
  fit: { zh: '填充方式', en: 'fit', fr: 'mode d’ajustement' },
  caption: { zh: '说明', en: 'caption', fr: 'légende' },
  placeholder: { zh: '提示', en: 'placeholder', fr: 'texte indicatif' },
  hint: { zh: '提示', en: 'hint', fr: 'indication' },
  shape: { zh: '样子', en: 'look', fr: 'apparence' },
  kind: { zh: '类别', en: 'category', fr: 'catégorie' },
  tools: { zh: '一键按钮', en: 'one-tap buttons', fr: 'boutons en un geste' },
};

/** 取值也写成人话（D-230）。 */
const PROP_VALUES: Record<string, Record<string, Localized>> = {
  shape: {
    row: { zh: '一行（右边有箭头）', en: 'a row with an arrow', fr: 'une ligne avec flèche' },
    tile: { zh: '大图标块', en: 'a large icon tile', fr: 'une grande tuile' },
    card: {
      zh: '卡片加「运行」按钮',
      en: 'a card with a Run button',
      fr: 'une carte avec bouton Exécuter',
    },
  },
  variant: {
    filled: { zh: '实心', en: 'filled', fr: 'plein' },
    outline: { zh: '描边', en: 'outlined', fr: 'contour' },
    text: { zh: '只有文字', en: 'text only', fr: 'texte seul' },
    icon: { zh: '只显示图标', en: 'icon only', fr: 'icône seule' },
  },
  kind: Object.fromEntries(Object.entries(QUICK_ACTION_CATEGORIES).map(([k, v]) => [k, v.name])),
};

/** 块的样式修改（对齐、颜色、大小、图片背景）怎么说。 */
function styleChanges(
  style: NonNullable<BlockChanges['style']>,
  before: Backdrop | undefined,
  locale: Locale,
  zh: boolean,
): string {
  const names: Record<string, [string, string]> = {
    align: ['对齐', 'alignment'],
    tone: ['颜色', 'color'],
    size: ['大小', 'size'],
  };
  const values: Record<string, [string, string]> = {
    start: ['靠左', 'left'],
    center: ['居中', 'centered'],
    default: ['默认', 'default'],
    primary: ['主色', 'primary'],
    secondary: ['辅助色', 'secondary'],
    tertiary: ['第三色', 'tertiary'],
    muted: ['弱化', 'muted'],
    small: ['小', 'small'],
    medium: ['中', 'medium'],
    large: ['大', 'large'],
  };
  const backdrop = style.backdrop;
  return (Object.entries(style) as [string, string | null | undefined][])
    .filter((e): e is [string, string | null] => e[1] !== undefined && e[0] !== 'backdrop')
    .map(([k, v]) => {
      const shown =
        v === null
          ? t(locale, 'describe_default_9ef5c')
          : values[v]
            ? pairText(locale, [values[v]![1], values[v]![0]])
            : v;
      return t(locale, 'describeStyleChange', {
        name: pairText(locale, [names[k]![1], names[k]![0]]),
        value: shown,
      });
    })
    .concat(backdrop === undefined ? [] : [backdropChange(backdrop, before, locale)])
    .join(zh ? '，' : ', ');
}

/** 图片背景的一次修改（D-258）怎么说。 */
function backdropChange(
  patch: BackdropPatch | null,
  before: Backdrop | undefined,
  locale: Locale,
): string {
  if (patch === null) return t(locale, 'describeBackdropOff');
  const parts: string[] = [];
  if (!before && !patch.assetId) parts.push(t(locale, 'describeBackdropOn'));
  if (patch.assetId) parts.push(t(locale, 'describeBackdropPicture'));
  else if (patch.assetId === null) parts.push(t(locale, 'describeBackdropPictureRemoved'));
  if (patch.overlay && patch.overlay !== before?.overlay)
    parts.push(
      t(locale, 'describeBackdropOverlay', { level: t(locale, `overlay_${patch.overlay}`) }),
    );
  return parts.join(t(locale, 'separatorComma')) || t(locale, 'describeBackdropPicture');
}
