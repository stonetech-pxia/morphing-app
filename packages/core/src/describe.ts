import { localize } from './localization';
import { t, pairText, type StringKey } from './messages';
import { SYSTEM_TARGET_LABELS } from './defaults';
import { plainText } from './richtext';
import { shownInToolGrid, type ApplyNote, type Op } from './ops';
import { THEME_PRESETS } from './presets';
import { QUICK_ACTION_CATEGORIES } from './quick-actions';
import type { Registry } from './registry';
import { describeParams } from './workflow/format';
import {
  FIELDS,
  allComponents,
  componentDefinition,
  isKnownComponent,
  pageIdOf,
  type Backdrop,
  type BackdropPatch,
  type Component,
  type Locale,
  type NavTarget,
  type Reminder,
  type Theme,
  type WorkspaceConfig,
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
  return config.pages.find((p) => p.id === pageId)?.title ?? pageId;
}

export function componentLabel(
  c: Component,
  config: WorkspaceConfig,
  ctx: DescribeContext,
): string {
  if (!isKnownComponent(c)) return t(ctx.locale, 'describeUnknownComponent');
  return componentDefinition(c.type).describe(c, config, ctx);
}

/** 提醒什么时候响（修改说明用）。 */
export function reminderWhen(r: Reminder, config: WorkspaceConfig, locale: Locale): string {
  if (r.schedule === 'daily') return t(locale, 'reminderWhenDaily', { time: r.time });
  if (r.schedule === 'weekly') {
    const days = [...new Set(r.weekdays ?? [])]
      .sort()
      .map((d) => t(locale, `weekday${d}` as StringKey))
      .join(t(locale, 'separatorList'));
    return t(locale, 'reminderWhenWeekly', { days, time: r.time });
  }
  const collection = config.collections.find((c) => c.id === r.collectionId);
  const field = collection?.fields.find((f) => f.id === r.fieldId);
  return t(locale, 'reminderWhenDate', {
    field: field?.name ?? String(r.fieldId),
    table: collection?.name ?? String(r.collectionId),
    n: r.daysBefore ?? 0,
    time: r.time,
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
  // 同一次修改里新建的数据表也要能用名字称呼。
  const addedCollections = ops.flatMap((op) => (op.op === 'addCollection' ? [op.collection] : []));
  // 同一次修改里新建的页面也一样（例如新建页面后把它放进导航栏）。
  const addedPages = ops.flatMap((op) => (op.op === 'addPage' ? [op.page] : []));
  const known: WorkspaceConfig = {
    ...before,
    pages: [...before.pages, ...addedPages],
    collections: [...before.collections, ...addedCollections],
  };
  const page = (id: string) => known.pages.find((p) => p.id === id);
  const pageName = (id: string) => page(id)?.title ?? id;
  // 同一次修改里新加的组件（例如先加分组再把卡片移进去）也要能用名字称呼。
  const added = ops.flatMap((op) => (op.op === 'addComponent' ? [op.component] : []));
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
  const toolName = (id: string) => localize(ctx.registry.tools.get(id)?.name, ctx.locale) ?? id;
  // 同一次修改里新建的工作流也要能找到名字（新建后接着加步骤）。
  const addedWorkflows = ops.flatMap((o) => (o.op === 'addWorkflow' ? [o.workflow] : []));
  const wf = (id: string) =>
    before.workflows.find((w) => w.id === id) ?? addedWorkflows.find((w) => w.id === id);
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

  const coll = (id: string) => known.collections.find((c) => c.id === id);
  const collName = (id: string) => coll(id)?.name ?? id;
  const fieldName = (collectionId: string, fieldId: string) =>
    coll(collectionId)?.fields.find((f) => f.id === fieldId)?.name ?? fieldId;
  const typeName = (type: unknown) =>
    FIELD_TYPE_NAMES[String(type)]
      ? pairText(ctx.locale, [
          FIELD_TYPE_NAMES[String(type)]![1],
          FIELD_TYPE_NAMES[String(type)]![0],
        ])
      : String(type);
  const list = (items: string[]) => items.join(t(ctx.locale, 'separatorList'));

  const lines: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'addCollection':
        lines.push(
          t(ctx.locale, 'describe_Add_data_table_f79c6', {
            v0: op.collection.name,
            v1: list(op.collection.fields.map((f) => f.name)),
          }),
        );
        break;
      case 'updateCollection':
        if (op.name !== undefined)
          lines.push(
            t(ctx.locale, 'describe_Rename_data_table_to_c585f', {
              v0: collName(op.collectionId),
              v1: op.name,
            }),
          );
        if (op.icon !== undefined)
          lines.push(
            t(ctx.locale, 'describe_Change_the_icon_of_9c456', { v0: collName(op.collectionId) }),
          );
        break;
      case 'addField':
        lines.push(
          t(ctx.locale, 'describe_Add_field_to_b8810', {
            v0: op.field.name,
            v1: typeName(op.field.type),
            v2: collName(op.collectionId),
          }),
        );
        break;
      case 'updateField': {
        const name = fieldName(op.collectionId, op.fieldId);
        const parts: string[] = [];
        if (typeof op.changes.name === 'string')
          parts.push(t(ctx.locale, 'describe_rename_to_08deb', { v0: op.changes.name }));
        if (op.changes.type !== undefined)
          parts.push(t(ctx.locale, 'describe_type_7382b', { v0: typeName(op.changes.type) }));
        if (Array.isArray(op.changes.options)) {
          const labels = (op.changes.options as { label?: unknown }[]).map((o) => String(o.label));
          parts.push(t(ctx.locale, 'describe_options_64e79', { v0: list(labels) }));
        }
        if (parts.length === 0) parts.push(t(ctx.locale, 'describe_update_settings_2aaf6'));
        lines.push(
          t(ctx.locale, 'describeFieldChange', {
            collection: collName(op.collectionId),
            name,
            changes: parts.join(t(ctx.locale, 'separatorComma')),
          }),
        );
        break;
      }
      case 'moveField':
        lines.push(
          t(ctx.locale, 'describe_Move_field_of_to_position_aa798', {
            v0: fieldName(op.collectionId, op.fieldId),
            v1: collName(op.collectionId),
            v2: op.toIndex + 1,
          }),
        );
        break;
      case 'removeField':
        lines.push(
          t(ctx.locale, 'describe_Hide_field_of_existing_data_is_kept_4f9d1', {
            v0: fieldName(op.collectionId, op.fieldId),
            v1: collName(op.collectionId),
          }),
        );
        break;
      case 'addReminder':
        lines.push(
          t(ctx.locale, 'describeAddReminder', {
            title: op.reminder.title,
            when: reminderWhen(op.reminder, known, ctx.locale),
          }),
        );
        break;
      case 'updateReminder': {
        const r = known.reminders?.find((x: Reminder) => x.id === op.reminderId);
        lines.push(t(ctx.locale, 'describeUpdateReminder', { title: r?.title ?? op.reminderId }));
        break;
      }
      case 'removeReminder': {
        const r = known.reminders?.find((x: Reminder) => x.id === op.reminderId);
        lines.push(t(ctx.locale, 'describeRemoveReminder', { title: r?.title ?? op.reminderId }));
        break;
      }
      case 'setCalendar':
        if (op.dayStartHour !== undefined)
          lines.push(t(ctx.locale, 'describeDayStart', { hour: op.dayStartHour ?? 0 }));
        if (op.weekStart !== undefined)
          lines.push(
            t(
              ctx.locale,
              op.weekStart === 'sunday' ? 'describeWeekStartSunday' : 'describeWeekStartMonday',
            ),
          );
        if (op.twoWeekStart !== undefined)
          lines.push(
            op.twoWeekStart === null
              ? t(ctx.locale, 'describeTwoWeekStartReset')
              : t(ctx.locale, 'describeTwoWeekStart', { date: op.twoWeekStart }),
          );
        break;
      case 'removeCollection':
        lines.push(
          t(ctx.locale, 'describe_Remove_data_table_from_the_app_records_1a3d2', {
            v0: collName(op.collectionId),
          }),
        );
        break;
      case 'setTheme': {
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
      case 'applyThemePreset': {
        const name = localize(THEME_PRESETS[op.preset].name, ctx.locale);
        lines.push(
          t(ctx.locale, 'describe_Switch_the_style_to_colors_fonts_corne_60590', { v0: name }),
        );
        break;
      }
      case 'resetTheme':
        lines.push(t(ctx.locale, 'describe_Reset_the_style_to_the_default_colors__162af'));
        break;
      case 'setNavItems':
        lines.push(
          t(ctx.locale, 'describe_Navigation_was_7f9d5', {
            v0: navList(op.items),
            v1: navList(before.shell.nav),
          }),
        );
        break;
      case 'setFloatingItems':
        lines.push(
          op.items.length === 0
            ? t(ctx.locale, 'describe_Remove_all_floating_buttons_0029b')
            : t(ctx.locale, 'describe_Floating_buttons_d071d', { v0: navList(op.items) }),
        );
        break;
      case 'setPageBackdrop':
        lines.push(
          t(ctx.locale, 'describePageBackdrop', {
            page: pageName(op.pageId),
            change: backdropChange(op.backdrop, page(op.pageId)?.backdrop, ctx.locale),
          }),
        );
        break;
      case 'setPageIcon':
        lines.push(
          t(ctx.locale, 'describePageIcon', {
            page: pageName(op.pageId),
            icon: op.icon
              ? t(ctx.locale, 'describeNewIcon', { icon: op.icon })
              : t(ctx.locale, 'describeNoIcon'),
          }),
        );
        break;
      case 'addPage':
        lines.push(
          t(ctx.locale, 'describe_Add_page_blocks_80d1f', {
            v0: op.page.title,
            v1: op.page.components.length,
          }),
        );
        break;
      case 'removePage':
        lines.push(
          t(ctx.locale, 'describe_Remove_page_files_are_not_affected_5abad', {
            v0: pageName(op.pageId),
          }),
        );
        break;
      case 'setPageTitle':
        lines.push(
          t(ctx.locale, 'describe_Rename_page_to_5e2cc', { v0: pageName(op.pageId), v1: op.title }),
        );
        break;
      case 'moveComponent':
        lines.push(
          t(ctx.locale, 'describe_Move_to_position_in_7eb22', {
            v0: comp(op.pageId, op.componentId),
            v1: op.toIndex + 1,
            v2: where(op.pageId, op.parentId),
          }),
        );
        break;
      case 'setComponentProps': {
        const propNames: Record<string, import('./schema').Localized> = {
          title: { zh: '标题', en: 'title', fr: 'titre' },
          subtitle: { zh: '副标题', en: 'subtitle', fr: 'sous-titre' },
          text: { zh: '文字', en: 'text', fr: 'texte' },
          label: { zh: '文字', en: 'label', fr: 'texte' },
          layout: { zh: '排列方式', en: 'layout', fr: 'disposition' },
          columns: { zh: '列数', en: 'columns', fr: 'colonnes' },
          icon: { zh: '图标', en: 'icon', fr: 'icône' },
          target: { zh: '打开的页面', en: 'target', fr: 'page ouverte' },
          variant: { zh: '样式', en: 'variant', fr: 'variante' },
          aspect: { zh: '比例', en: 'aspect', fr: 'proportions' },
          fit: { zh: '填充方式', en: 'fit', fr: 'mode d’ajustement' },
          caption: { zh: '说明', en: 'caption', fr: 'légende' },
          placeholder: { zh: '提示', en: 'placeholder', fr: 'texte indicatif' },
          hint: { zh: '提示', en: 'hint', fr: 'indication' },
          look: { zh: '样子', en: 'look', fr: 'apparence' },
          kind: { zh: '类别', en: 'category', fr: 'catégorie' },
        };
        // 取值也写成人话（D-230）。
        const propValues: Record<string, Record<string, import('./schema').Localized>> = {
          look: {
            row: {
              zh: '一行（右边有箭头）',
              en: 'a row with an arrow',
              fr: 'une ligne avec flèche',
            },
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
          kind: Object.fromEntries(
            Object.entries(QUICK_ACTION_CATEGORIES).map(([k, v]) => [k, v.name]),
          ),
        };
        const changes = Object.entries(op.props)
          .map(([k, v]) => {
            if (k === 'assetId') {
              if (findComp(op.pageId, op.componentId)?.type === 'fileSlot')
                return t(ctx.locale, v ? 'describeNewFile' : 'describeFileRemoved');
              return v
                ? t(ctx.locale, 'describe_new_picture_bf924')
                : t(ctx.locale, 'describe_picture_removed_4fb32');
            }
            const name = localize(propNames[k], ctx.locale) ?? k;
            if (v === null) return t(ctx.locale, 'describe_removed_d5c25', { v0: name });
            const named = typeof v === 'string' ? localize(propValues[k]?.[v], ctx.locale) : null;
            if (named) return t(ctx.locale, 'describe__41054', { v0: name, v1: named });
            // 富文本显示成纯文字，太长时截断。
            const shown = typeof v === 'string' && k === 'text' ? truncate(plainText(v)) : v;
            const value =
              typeof shown === 'string'
                ? t(ctx.locale, 'describe__441c2', { v0: shown })
                : JSON.stringify(shown);
            return t(ctx.locale, 'describe__41054', { v0: name, v1: value });
          })
          .join(t(ctx.locale, 'separatorComma'));
        lines.push(
          t(ctx.locale, 'describe_Update_75049', {
            v0: comp(op.pageId, op.componentId),
            v1: changes,
          }),
        );
        break;
      }
      case 'setComponentStyle': {
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
        const current = findComp(op.pageId, op.componentId);
        const backdrop = op.style.backdrop;
        const changes = (Object.entries(op.style) as [string, string | null | undefined][])
          .filter((e): e is [string, string | null] => e[1] !== undefined && e[0] !== 'backdrop')
          .map(([k, v]) => {
            const shown =
              v === null
                ? t(ctx.locale, 'describe_default_9ef5c')
                : values[v]
                  ? pairText(ctx.locale, [values[v]![1], values[v]![0]])
                  : v;
            return t(ctx.locale, 'describeStyleChange', {
              name: pairText(ctx.locale, [names[k]![1], names[k]![0]]),
              value: shown,
            });
          })
          .concat(
            backdrop === undefined
              ? []
              : [
                  backdropChange(
                    backdrop,
                    current && isKnownComponent(current) ? current.style?.backdrop : undefined,
                    ctx.locale,
                  ),
                ],
          )
          .join(zh ? '，' : ', ');
        lines.push(
          t(ctx.locale, 'describe_Restyle_0b6e5', {
            v0: comp(op.pageId, op.componentId),
            v1: changes,
          }),
        );
        break;
      }
      case 'setComponentHidden':
        lines.push(
          t(ctx.locale, op.hidden ? 'describeHideComponent' : 'describeShowComponent', {
            component: comp(op.pageId, op.componentId),
          }),
        );
        break;
      case 'addComponent':
        lines.push(
          t(ctx.locale, 'describe_Add_to_f2026', {
            v0: componentLabel(op.component, known, ctx),
            v1: where(op.pageId, op.parentId),
          }),
        );
        break;
      case 'removeComponent':
        lines.push(
          t(ctx.locale, 'describe_Remove_from_c2717', {
            v0: comp(op.pageId, op.componentId),
            v1: pageName(op.pageId),
          }),
        );
        break;
      case 'installTool':
        // 工具箱里已经有这个工具时不再往首页放入口（D-181）。
        lines.push(
          shownInToolGrid(known, op.toolId, [...ctx.registry.tools.keys()])
            ? t(ctx.locale, 'describe_Add_the_tool_adds_its_page_7a595', {
                v0: toolName(op.toolId),
              })
            : t(ctx.locale, 'describe_Add_the_tool_adds_its_page_and_a_home__ec774', {
                v0: toolName(op.toolId),
              }),
        );
        break;
      case 'updateTool':
        // 说明在 notes 里（列出新增的功能）。
        break;
      case 'uninstallTool':
        lines.push(
          t(ctx.locale, 'describe_Remove_the_tool_removes_its_card_page__2fb97', {
            v0: toolName(op.toolId),
          }),
        );
        break;
      case 'setStepParams': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        const step = stepLabel(op.workflowId, op.stepId);
        const action = ctx.registry.actions.get(
          wf(op.workflowId)?.steps.find((s) => s.id === op.stepId)?.action ?? '',
        );
        const params =
          op.params && action ? describeParams(action, op.params, ctx.locale, ctx.now) : '';
        if (params) {
          lines.push(t(ctx.locale, 'describe__3ca25', { v0: name, v1: step, v2: params }));
        } else if (op.params) {
          lines.push(t(ctx.locale, 'describe_Update_c2f66', { v0: name, v1: step }));
        }
        if (op.ask !== undefined) {
          const asked =
            action && op.ask.length > 0
              ? action.fields
                  .filter((f) => op.ask!.includes(f.key))
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
        break;
      }
      case 'addWorkflow': {
        const from = op.workflow.presetId ? t(ctx.locale, 'describe_ready_made_61047') : '';
        lines.push(
          t(ctx.locale, 'describe_New_quick_action_b4026', {
            v0: op.workflow.name,
            v1: from,
            v2: stepChain(op.workflow.steps),
          }),
        );
        break;
      }
      case 'removeWorkflow': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        lines.push(
          t(ctx.locale, 'describe_Delete_the_quick_action_files_are_kept_deaf1', { v0: name }),
        );
        break;
      }
      case 'renameWorkflow': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        lines.push(
          t(ctx.locale, 'describe_Rename_the_quick_action_to_e45a1', { v0: name, v1: op.name }),
        );
        break;
      }
      case 'setWorkflowHomeScreen': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        lines.push(
          t(ctx.locale, op.homeScreen ? 'describeHomeScreenOn' : 'describeHomeScreenOff', { name }),
        );
        break;
      }
      case 'addWorkflowStep': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        const action = ctx.registry.actions.get(op.step.action);
        const params = action ? describeParams(action, op.step.params, ctx.locale, ctx.now) : '';
        const label = actionLabel(op.step.action);
        lines.push(
          t(ctx.locale, 'describeAddStep', {
            name,
            label,
            params: params ? t(ctx.locale, 'describeStepParameters', { params }) : '',
          }),
        );
        break;
      }
      case 'moveWorkflowStep': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        lines.push(
          t(ctx.locale, 'describe_Move_to_step_in_885bf', {
            v0: stepLabel(op.workflowId, op.stepId),
            v1: op.toIndex + 1,
            v2: name,
          }),
        );
        break;
      }
      case 'updateWorkflow': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        if (op.name !== undefined && op.name !== name) {
          lines.push(t(ctx.locale, 'describe_Rename_to_decb3', { v0: name, v1: op.name }));
        }
        if (op.steps) {
          lines.push(
            t(ctx.locale, 'describe_Steps_of_591ff', {
              v0: op.name ?? name,
              v1: stepChain(op.steps),
            }),
          );
        }
        break;
      }
      case 'removeWorkflowStep': {
        const name = wf(op.workflowId)?.name ?? op.workflowId;
        lines.push(
          t(ctx.locale, 'describe_Remove_step_from_8750c', {
            v0: stepLabel(op.workflowId, op.stepId),
            v1: name,
          }),
        );
        break;
      }
    }
  }
  for (const note of notes) {
    if (note.kind === 'movedToFloating') {
      const label = navTargetLabel(note.target, before, ctx.locale);
      lines.push(
        t(ctx.locale, 'describe_can_t_be_removed_it_holds_the_AI_and_C_e58da', { v0: label }),
      );
    } else if (note.kind === 'updatedTool') {
      const def = ctx.registry.tools.get(note.toolId);
      const names = def
        ? def
            .createWorkflows(ctx.locale)
            .filter((w) => note.workflowIds.includes(w.id))
            .map((w) => w.name)
        : note.workflowIds;
      lines.push(
        names.length === 0
          ? t(ctx.locale, 'describe_Update_the_tool_to_the_latest_version__b20b4', {
              v0: toolName(note.toolId),
            })
          : t(ctx.locale, 'describeUpdatedTool', {
              tool: toolName(note.toolId),
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
          v1: collName(note.collectionId),
        }),
      );
    } else if (note.kind === 'removedWorkflowLinks') {
      lines.push(
        t(ctx.locale, 'describe_Also_removes_button_s_or_shortcut_s_th_d4dc1', {
          v0: note.count,
          v1: known.workflows.find((w) => w.id === note.workflowId)?.name ?? note.workflowId,
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
  const beforeTools = new Set(before.tools.map((t) => t.toolId));
  const afterTools = new Set(after.tools.map((t) => t.toolId));
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
  const tables = (c: WorkspaceConfig) => new Set(c.collections.map((x) => x.id));
  const [beforeTables, afterTables] = [tables(before), tables(after)];
  for (const c of before.collections) {
    if (!afterTables.has(c.id)) {
      lines.push(
        t(ctx.locale, 'describe_The_table_leaves_the_app_its_entries_s_29282', { v0: c.name }),
      );
    }
  }
  for (const c of after.collections) {
    if (!beforeTables.has(c.id)) {
      lines.push(t(ctx.locale, 'describe_The_table_comes_back_dd301', { v0: c.name }));
    }
  }
  lines.push(
    before.collections.length + after.collections.length > 0
      ? t(ctx.locale, 'describe_Your_files_and_entries_are_not_affecte_c87ef')
      : t(ctx.locale, 'describe_Your_files_are_not_affected_3c83c'),
  );
  return lines;
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
