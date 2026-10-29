import { createDefaultWorkspace } from '../defaults';
import { applyOps, type Op } from '../ops';
import type { Registry } from '../registry';
import {
  allComponents,
  type Collection,
  type Component,
  type Field,
  type Locale,
  type WorkspaceConfig,
} from '../schema';
import { parseRichText } from '../richtext';
import { createStarterWorkspace } from '../starter';
import { templateOps } from '../templates';
import { THEME_PRESETS } from '../presets';
import { CLAY, contrast, isDark, resolveColors } from '../theme';
import { presetById, presetWorkflow } from '../workflows/presets';
import { prepareOps, type PreparedChange } from '../change';
import { functionFirst, hasFunctionOps } from './kinds';
import type { AIProvider, Plan, PlanAbout, PlanEarlier, RejectReason } from './types';

/** 结构相同即可（校验后对象的键顺序可能变）。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

// AI 评测集（§7F、§14）：mock AI 与真实模型用同一组用例衡量。
// ID 与 docs/MOCK_AI_PHRASES.md 对应；P* 是只有真实模型才需要理解的改写说法。

/** starter：新用户的第一个版本（精简首页 + 工具箱，D-181、D-182）。 */
/** visaHomeScreen：visa 再把签证照片放到手机桌面（D-271）。 */
/** habits：一张打卡表（习惯、完成 / 跳过、日期）和显示它的页面（D-284）。 */
/** views：心情、上下班（开始和结束的日期时间）、喝水三张表，每张一个列表页面（D-302–D-305）。 */
/** linked：互相引用的表（习惯 ← 打卡、工作 ← 工时、客户 ← 订单）和一张加油表，每张一个页面（D-287–D-289）。 */
export type EvalSetup =
  | 'default'
  | 'pdf'
  | 'pdfBelowFiles'
  | 'budget'
  | 'visa'
  | 'visaHomeScreen'
  | 'starter'
  | 'habits'
  | 'linked'
  | 'views';

export type OpsPlan = Extract<Plan, { kind: 'ops' }>;

export type EvalExpectation =
  | {
      kind: 'ops';
      check: (after: WorkspaceConfig) => string | null;
      /** 检查计划本身（notes、homeEntry）。 */
      plan?: (plan: OpsPlan) => string | null;
    }
  | { kind: 'restorePrevious' }
  | { kind: 'reject'; reason?: RejectReason; message?: (message: string) => string | null };

export interface EvalCase {
  id: string;
  input: string;
  locale: Locale;
  setup: EvalSetup;
  expect: EvalExpectation;
  /** mock AI 是否应当通过（改写说法只要求真实模型通过）。 */
  mock: boolean;
  /** 从哪里打开的 AI（D-124）：一个快捷操作，或分享进来的文件。 */
  about?: PlanAbout;
  /**
   * 先做功能、再接着做外观（D-191）：第一句只能是功能，计划里要有 next；照着 next 再问一次，
   * check 检查两步之后的样子（用户点了「接着改」）。
   */
  next?: boolean;
  /**
   * 草稿聊天框里之前说过的话（D-207）：有 ops 的是做了的一步（先套在 setup 上，回复是它的说明），
   * 有 notDone 的是没做的一句和原因。
   */
  earlier?: EvalEarlier[];
}

export type EvalEarlier = { input: string; ops: Op[] } | { input: string; notDone: string };

export function buildSetup(setup: EvalSetup, locale: Locale, registry: Registry): WorkspaceConfig {
  if (setup === 'starter') return createStarterWorkspace(locale, registry);
  const ops: Op[] = [];
  if (setup === 'visa' || setup === 'visaHomeScreen') {
    ops.push({ op: 'installTool', toolId: 'pdf' });
    ops.push({
      op: 'addWorkflow',
      workflow: presetWorkflow(presetById('visa-photo')!, locale, 'visa-photo'),
    });
    if (setup === 'visaHomeScreen')
      ops.push({ op: 'setWorkflowHomeScreen', workflowId: 'visa-photo', homeScreen: true });
  } else if (setup === 'budget') {
    ops.push(...templateOps('budget', createDefaultWorkspace(locale), locale));
  } else if (setup === 'habits') {
    ops.push(...habitOps(locale));
  } else if (setup === 'linked') {
    ops.push(...linkedOps(locale));
  } else if (setup === 'views') {
    ops.push(...viewOps(locale));
  } else if (setup !== 'default') ops.push({ op: 'installTool', toolId: 'pdf' });
  if (setup === 'pdfBelowFiles') {
    ops.push({ op: 'moveComponent', pageId: 'home', componentId: 'card-pdf', toIndex: 3 });
  }
  const base = createDefaultWorkspace(locale);
  if (ops.length === 0) return base;
  const result = applyOps(base, ops, { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
}

/** 打卡表和它的页面（三种语言的名字）。 */
function habitOps(locale: Locale): Op[] {
  const names: Record<Locale, Record<'table' | 'habit' | 'run' | 'read' | 'status', string>> = {
    zh: { table: '打卡', habit: '习惯', run: '跑步', read: '读书', status: '状态' },
    en: { table: 'Check-ins', habit: 'Habit', run: 'Run', read: 'Read', status: 'Status' },
    fr: { table: 'Pointages', habit: 'Habitude', run: 'Course', read: 'Lecture', status: 'État' },
  };
  const more: Record<Locale, Record<'done' | 'skip' | 'date' | 'page', string>> = {
    zh: { done: '完成', skip: '跳过', date: '日期', page: '习惯' },
    en: { done: 'Done', skip: 'Skipped', date: 'Date', page: 'Habits' },
    fr: { done: 'Fait', skip: 'Sauté', date: 'Date', page: 'Habitudes' },
  };
  const { table, habit, run, read, status } = names[locale];
  const { done, skip, date, page } = more[locale];
  return [
    {
      op: 'addCollection',
      collection: {
        id: 'checkins',
        name: table,
        fields: [
          {
            id: 'habit',
            name: habit,
            type: 'choice',
            options: [
              { id: 'run', label: run },
              { id: 'read', label: read },
            ],
          },
          {
            id: 'status',
            name: status,
            type: 'choice',
            options: [
              { id: 'done', label: done },
              { id: 'skip', label: skip },
            ],
            default: 'done',
          },
          { id: 'date', name: date, type: 'date', default: 'today' },
        ],
      },
    },
    {
      op: 'addPage',
      page: {
        id: 'habits',
        title: page,
        components: [
          {
            id: 'list',
            type: 'recordList',
            props: { collectionId: 'checkins', display: 'list', titleField: 'habit', limit: 20 },
          },
        ],
      },
    },
  ];
}

/** 心情、上下班、喝水三张表，每张一个列表页面（名字按语言，ID 都一样）。 */
function viewOps(locale: Locale): Op[] {
  const n = {
    zh: [
      '心情日记',
      '心情',
      '开心',
      '一般',
      '难过',
      '日期',
      '备注',
      '上下班',
      '工作',
      '上班',
      '下班',
      '喝水',
      '杯数',
    ],
    en: [
      'Mood journal',
      'Mood',
      'Happy',
      'OK',
      'Sad',
      'Date',
      'Note',
      'Shifts',
      'Job',
      'Clock in',
      'Clock out',
      'Water',
      'Cups',
    ],
    fr: [
      'Journal d’humeur',
      'Humeur',
      'Content',
      'Moyen',
      'Triste',
      'Date',
      'Note',
      'Services',
      'Travail',
      'Arrivée',
      'Départ',
      'Eau',
      'Verres',
    ],
  }[locale] as string[];
  const [journal, mood, happy, ok, sad, date, note, shifts, job, clockIn, clockOut, water, cups] =
    n as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
  const tables: Collection[] = [
    {
      id: 'mood',
      name: journal,
      fields: [
        {
          id: 'feel',
          name: mood,
          type: 'choice',
          options: [
            { id: 'happy', label: happy },
            { id: 'ok', label: ok },
            { id: 'sad', label: sad },
          ],
        },
        { id: 'date', name: date, type: 'date', default: 'today' },
        { id: 'note', name: note, type: 'text' },
      ],
    },
    {
      id: 'shifts',
      name: shifts,
      fields: [
        { id: 'job', name: job, type: 'text' },
        { id: 'in', name: clockIn, type: 'datetime', default: 'now' },
        { id: 'out', name: clockOut, type: 'datetime' },
      ],
    },
    {
      id: 'water',
      name: water,
      fields: [
        { id: 'cups', name: cups, type: 'number' },
        { id: 'date', name: date, type: 'date', default: 'today' },
      ],
    },
  ];
  const title = { mood: 'feel', shifts: 'job', water: 'cups' } as const;
  return tables.flatMap((collection): Op[] => [
    { op: 'addCollection', collection },
    {
      op: 'addPage',
      page: {
        id: collection.id,
        title: collection.name,
        components: [
          {
            id: 'list',
            type: 'recordList',
            props: {
              collectionId: collection.id,
              display: 'list',
              titleField: title[collection.id as keyof typeof title],
              limit: 30,
            },
          },
        ],
      },
    },
  ]);
}

/** 互相引用的几张表，每张一个列表页面（名字按语言，ID 都一样）。 */
function linkedOps(locale: Locale): Op[] {
  const names = {
    zh: [
      '习惯',
      '打卡',
      '日期',
      '工作',
      '时薪',
      '工时',
      '小时',
      '客户',
      '订单',
      '金额',
      '加油',
      '车',
      '里程',
      '名字',
    ],
    en: [
      'Habits',
      'Check-ins',
      'Date',
      'Jobs',
      'Hourly rate',
      'Shifts',
      'Hours',
      'Clients',
      'Orders',
      'Amount',
      'Fuel',
      'Car',
      'Odometer',
      'Name',
    ],
    fr: [
      'Habitudes',
      'Pointages',
      'Date',
      'Emplois',
      'Taux horaire',
      'Heures travaillées',
      'Heures',
      'Clients',
      'Commandes',
      'Montant',
      'Pleins',
      'Voiture',
      'Kilométrage',
      'Nom',
    ],
  }[locale];
  const [
    habits,
    checkins,
    date,
    jobs,
    rate,
    shifts,
    hours,
    clients,
    orders,
    amount,
    fuel,
    car,
    odometer,
    name,
  ] = names as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const currency = locale === 'zh' ? 'CNY' : locale === 'fr' ? 'EUR' : 'USD';
  const tables: Collection[] = [
    { id: 'habits', name: habits, fields: [{ id: 'name', name, type: 'text' }] },
    {
      id: 'checkins',
      name: checkins,
      fields: [
        { id: 'habit', name: habits, type: 'link', collectionId: 'habits' },
        { id: 'date', name: date, type: 'date', default: 'today' },
      ],
    },
    {
      id: 'jobs',
      name: jobs,
      fields: [
        { id: 'name', name, type: 'text' },
        { id: 'rate', name: rate, type: 'money', currency },
      ],
    },
    {
      id: 'shifts',
      name: shifts,
      fields: [
        { id: 'job', name: jobs, type: 'link', collectionId: 'jobs' },
        { id: 'date', name: date, type: 'date', default: 'today' },
        { id: 'hours', name: hours, type: 'number', decimals: 2 },
      ],
    },
    { id: 'clients', name: clients, fields: [{ id: 'name', name, type: 'text' }] },
    {
      id: 'orders',
      name: orders,
      fields: [
        { id: 'client', name: clients, type: 'link', collectionId: 'clients' },
        { id: 'date', name: date, type: 'date', default: 'today' },
        { id: 'amount', name: amount, type: 'money', currency },
      ],
    },
    {
      id: 'fuel',
      name: fuel,
      fields: [
        {
          id: 'car',
          name: car,
          type: 'choice',
          options: [
            { id: 'car-a', label: 'A' },
            { id: 'car-b', label: 'B' },
          ],
        },
        { id: 'date', name: date, type: 'date', default: 'today' },
        { id: 'odometer', name: odometer, type: 'number', unit: 'km' },
      ],
    },
  ];
  const title = (c: Collection) => c.fields.find((f) => f.type === 'text')?.id ?? 'date';
  return tables.flatMap((collection): Op[] => [
    { op: 'addCollection', collection },
    {
      op: 'addPage',
      page: {
        id: `page-${collection.id}`,
        title: collection.name,
        components: [
          {
            id: `list-${collection.id}`,
            type: 'recordList',
            props: {
              collectionId: collection.id,
              display: 'list',
              titleField: title(collection),
              limit: 50,
            },
          },
        ],
      },
    },
  ]);
}

const home = (c: WorkspaceConfig) => c.pages.find((p) => p.id === 'home')!;
const homeIds = (c: WorkspaceConfig) => home(c).components.map((x) => x.id);
const mergeSteps = (c: WorkspaceConfig) =>
  c.workflows.find((w) => w.id === 'pdf-merge')?.steps ?? [];

/** 每个检查返回 null 表示通过，否则返回失败原因。 */
const all =
  (...checks: ((c: WorkspaceConfig) => string | null)[]) =>
  (c: WorkspaceConfig) =>
    checks.reduce<string | null>((err, check) => err ?? check(c), null);

const pdfFirst = (c: WorkspaceConfig) =>
  homeIds(c)[1] === 'card-pdf'
    ? null
    : `PDF card should be right after the header, got ${homeIds(c).join(',')}`;
/** PDF 工具页上「合并 PDF」的卡片排在标题后面的第一个。 */
const mergeRunnerFirst = (c: WorkspaceConfig) => {
  const page = c.pages.find((p) => p.id === 'tool-pdf');
  const first = page?.components.find((x) => x.type !== 'header');
  return first?.id === 'pdf-runner';
};
const navHomeToolsSettings = (c: WorkspaceConfig) =>
  JSON.stringify(c.shell.nav) === JSON.stringify(['page:home', 'tools', 'settings'])
    ? null
    : `nav should be home/tools/settings, got ${c.shell.nav.join(',')}`;
const titled = (title: string) => (c: WorkspaceConfig) =>
  home(c).title === title ? null : `home title should be ${title}, got ${home(c).title}`;
const color = (hex: string) => (c: WorkspaceConfig) =>
  c.theme.primaryColor.toLowerCase() === hex.toLowerCase()
    ? null
    : `color should be ${hex}, got ${c.theme.primaryColor}`;
/** 文件名包含日期即可（“按日期命名”既可理解为只用日期，也可保留“合并”之类的前缀）。 */
const renameStep = (c: WorkspaceConfig) => mergeSteps(c).find((s) => s.action === 'file.rename');
const savesWithDate = (c: WorkspaceConfig) => {
  const template = String(renameStep(c)?.params.template);
  return /\{date(:YYYY-MM-DD)?\}/.test(template)
    ? null
    : `the file.rename template should contain the date, got ${template}`;
};
const singlePdfTool = (c: WorkspaceConfig) =>
  c.tools.length === 1 &&
  c.workflows.filter((w) => w.id === 'pdf-merge').length === 1 &&
  new Set(c.workflows.map((w) => w.id)).size === c.workflows.length
    ? null
    : 'must keep exactly one PDF tool and one merge workflow';
/** 用户看得到的步骤只剩选文件和合并：命名、保存可以保留，但不再询问。 */
const simplifiedMerge = (c: WorkspaceConfig) => {
  const steps = mergeSteps(c);
  const visible = steps.filter((s) => s.action !== 'file.rename' && s.action !== 'file.save');
  const actions = visible.map((s) => s.action);
  if (JSON.stringify(actions) !== JSON.stringify(['in.files', 'pdf.merge'])) {
    return `visible steps should be in.files/pdf.merge, got ${actions.join(',')}`;
  }
  if (!steps.some((s) => s.action === 'file.save')) return 'file.save must stay';
  return steps.some((s) => s.ask?.length) ? 'no step should ask the user any more' : null;
};
/** 首页第 index 个组件是一个还没选照片的图片位（AI 不能替用户选照片）。 */
const imageSlot = (c: WorkspaceConfig, index: number): string | null => {
  const img = home(c).components[index];
  if (img?.type !== 'image')
    return `expected an image at position ${index}, got ${String(img?.type)}`;
  return img.props.assetId ? 'the AI must not pick a photo' : null;
};
/** 有这个标题的页面，且能从导航栏、浮动按钮或首页的按钮 / 快捷入口打开。 */
const reachablePage = (title: string) => (c: WorkspaceConfig) => {
  const page = c.pages.find((p) => p.title === title);
  if (!page) return `expected a page titled ${title}`;
  const target = `page:${page.id}`;
  const linked =
    [...c.shell.nav, ...c.shell.floating].includes(target as never) ||
    allComponents(home(c)).some(
      (x) => (x.type === 'shortcut' || x.type === 'button') && x.props.target === target,
    );
  return linked ? null : `page ${title} should be reachable`;
};
const darkBackground = (c: WorkspaceConfig) => {
  const colors = resolveColors(c.theme, isDark(c.theme, false));
  return contrast(colors.background, '#000000') < 3
    ? null
    : `background should be dark, got ${colors.background}`;
};
/** 有一张含某类型字段的数据表，并且有一个能打开的页面用上了它（统计求和或可勾选清单）。 */
const dataPage =
  (fieldType: string, usage: 'sum' | 'checklist') =>
  (c: WorkspaceConfig): string | null => {
    const table = c.collections.find((t) => t.fields.some((f) => f.type === fieldType));
    if (!table) return `expected a data table with a ${fieldType} field`;
    const page = c.pages.find((p) =>
      allComponents(p).some((x) =>
        usage === 'sum'
          ? x.type === 'stat' && x.props.collectionId === table.id && x.props.aggregate === 'sum'
          : x.type === 'recordList' &&
            x.props.collectionId === table.id &&
            x.props.display === 'checklist',
      ),
    );
    if (!page) return `expected a page with a ${usage} for ${table.id}`;
    return reachablePage(page.title)(c);
  };
const savesAs = (template: string) => (c: WorkspaceConfig) =>
  renameStep(c)?.params.template === template
    ? null
    : `the file.rename template should be ${template}, got ${String(renameStep(c)?.params.template)}`;

const BASE_EVAL_CASES: readonly EvalCase[] = [
  // 旅程 A
  {
    id: 'A1',
    input: '把首页改成文件工作台，把 PDF 放到最上面，导航栏只保留首页、工具、设置。',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: all(titled('文件工作台'), pdfFirst, navHomeToolsSettings) },
  },
  {
    id: 'A2',
    input: 'PDF 放第一个',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'A3',
    input: '导航只要首页、工具和设置',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  {
    id: 'A4',
    input: '首页改成文件工作台',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: titled('文件工作台') },
  },
  {
    id: 'A5',
    input: 'Put PDF at the top',
    locale: 'en',
    setup: 'pdfBelowFiles',
    mock: true,
    expect: { kind: 'ops', check: pdfFirst },
  },
  {
    id: 'A6',
    input: 'Only keep Home, Tools and Settings in the navigation',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  // 单项修改
  {
    id: 'B1',
    input: '主题换成绿色',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: color('#2F9E44') },
  },
  {
    id: 'B2',
    input: '切换到深色模式',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.mode === 'dark' ? null : `mode should be dark, got ${c.theme.mode}`),
    },
  },
  {
    id: 'B3',
    input: '隐藏欢迎卡片',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (home(c).components[0]?.hidden ? null : 'welcome header should be hidden'),
    },
  },
  {
    id: 'B4',
    input: '把最近文件放到 PDF 前面',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        homeIds(c).indexOf('recent-files') < homeIds(c).indexOf('card-pdf')
          ? null
          : `recent files should come before PDF, got ${homeIds(c).join(',')}`,
    },
  },
  // 样式
  {
    id: 'B5',
    input: '字体大一点',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.fontScale > 1 ? null : `fontScale should grow, got ${c.theme.fontScale}`,
    },
  },
  {
    id: 'B7',
    input: '卡片圆角小一点',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.radius < 22 ? null : `radius should shrink, got ${c.theme.radius}`),
    },
  },
  {
    id: 'B9',
    input: '去掉阴影',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.cardStyle !== 'shadow'
          ? null
          : `cards should lose their shadow, got ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'B9b',
    input: '卡片改成新粗野风格',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.cardStyle === 'brutal' ? null : `cards should be brutal, got ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'B9d',
    input: '背景改成极光，卡片改成毛玻璃',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.backdrop === 'aurora' && c.theme.cardStyle === 'glass'
          ? null
          : `expected aurora + glass, got ${c.theme.backdrop} + ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'B12b',
    input: '换成杂志风',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        sameValue(c.theme, THEME_PRESETS.editorial.theme)
          ? null
          : `theme should be the editorial preset, got ${JSON.stringify(c.theme)}`,
    },
  },
  {
    id: 'B12d',
    input: '换成毛玻璃风格',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        sameValue(c.theme, THEME_PRESETS.glass.theme)
          ? null
          : `theme should be the glass preset, got ${JSON.stringify(c.theme)}`,
    },
  },
  {
    id: 'B12c',
    input: '换成霓虹风格，主色改成粉色',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        if (c.theme.cardStyle !== 'glow')
          return `expected the neon preset, got ${c.theme.cardStyle}`;
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.theme.primaryColor.slice(i, i + 2), 16));
        return r! > 180 && r! > g! + 40 && b! > g!
          ? null
          : `primary should be pink, got ${c.theme.primaryColor}`;
      },
    },
  },
  {
    id: 'B9c',
    input: '深色模式下用纯黑背景，浅色模式不变',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const light = resolveColors(c.theme, false).background;
        const dark = resolveColors(c.theme, true).background;
        if (light !== CLAY.light.background) return `light background changed to ${light}`;
        return contrast(dark, '#000000') < 1.2
          ? null
          : `dark background should be black, got ${dark}`;
      },
    },
  },
  // 导航与页面
  {
    id: 'B13',
    input: '把 AI 入口删掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        !c.shell.nav.includes('ai') && !c.shell.floating.includes('ai')
          ? null
          : `AI should be gone from nav and floating, got ${c.shell.nav.join(',')} / ${c.shell.floating.join(',')}`,
    },
  },
  {
    id: 'E1',
    input: '新建一个叫「记账」的页面',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: reachablePage('记账') },
  },
  // 数据页面（只改结构，从不碰记录）
  {
    id: 'F1',
    input: '新建一个记账页面',
    locale: 'zh',
    setup: 'default',
    next: true,
    mock: true,
    expect: { kind: 'ops', check: dataPage('money', 'sum') },
  },
  {
    id: 'F2',
    input: '给账目加一个「支付方式」字段',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.collections[0]?.fields.some((f) => f.name === '支付方式')
          ? null
          : 'expenses should get a 支付方式 field',
    },
  },
  {
    id: 'X4',
    input: '记一笔午饭 35',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'reject', reason: 'userData' },
  },
  {
    id: 'X5',
    input: '把上个月的账都删掉',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'reject', reason: 'userData' },
  },
  // 图片、emoji 图标、富文本
  {
    id: 'G1',
    input: '在首页顶部加一张横幅',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: (c) => imageSlot(c, 1) },
  },
  {
    id: 'G2',
    input: '把记账页面的图标换成💰',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.find((p) => p.id === 'budget')?.icon === '💰'
          ? null
          : 'budget page icon should be 💰',
    },
  },
  // 旅程 C
  {
    id: 'C1',
    input: '把 PDF 工具首页简化成上传和合并两个步骤，完成后自动按照‘合并-日期’命名',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: {
      kind: 'ops',
      check: all(simplifiedMerge, savesAs('合并-{date:YYYY-MM-DD}'), singlePdfTool),
    },
  },
  {
    id: 'C2',
    input: '合并后的文件按日期命名',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: all(savesWithDate, singlePdfTool) },
  },
  // 旅程 D
  {
    id: 'D1',
    input: '恢复上一次修改前的界面',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  {
    id: 'D2',
    input: '撤销刚才的修改',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  {
    id: 'D3',
    input: 'Undo the last change',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'restorePrevious' },
  },
  // 必须拒绝
  {
    id: 'X1',
    input: '帮我订一张机票',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject' },
  },
  {
    id: 'X2',
    input: '把设置删掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'protected' },
  },
  {
    id: 'X3',
    input: '删除我所有的 PDF 文件',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject', reason: 'deleteFiles' },
  },
  // 改写说法：只要求真实模型理解
  {
    id: 'P1',
    input: '能不能把合并 PDF 的入口挪到最前面？',
    locale: 'zh',
    setup: 'pdfBelowFiles',
    mock: false,
    // T3 之后 PDF 工具页上也有「合并 PDF」的卡片：挪首页的 PDF 卡片，或者把工具页上的合并卡片挪到最前，都算理解对了。
    expect: {
      kind: 'ops',
      check: (c) => (pdfFirst(c) === null || mergeRunnerFirst(c) ? null : pdfFirst(c)),
    },
  },
  {
    id: 'P2',
    input: '底部只留三个：首页、工具、设置',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: navHomeToolsSettings },
  },
  {
    id: 'P3',
    input: '我想要一个绿色的界面',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: color('#2F9E44') },
  },
  {
    id: 'P5',
    input: '把首页的工具入口和添加工具排成两列的网格',
    locale: 'zh',
    setup: 'pdf',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const group = home(c).components.find((x) => x.type === 'group');
        if (!group || group.type !== 'group') return 'expected a group on the home page';
        if (group.props.layout !== 'grid')
          return `group layout should be grid, got ${group.props.layout}`;
        const ids = group.children.map((x) => x.id);
        return ids.includes('card-pdf') && ids.includes('catalog')
          ? null
          : `grid should hold card-pdf and catalog, got ${ids.join(',')}`;
      },
    },
  },
  {
    id: 'P6',
    input: '我想要深色背景、白色文字的界面',
    locale: 'zh',
    setup: 'default',
    mock: false,
    // 可读性由校验器保证；这里只检查最终显示的背景确实是深色。
    expect: { kind: 'ops', check: darkBackground },
  },
  {
    id: 'P7',
    input: '把 AI 修改和历史都从底部去掉，设置做成右下角的浮动按钮',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const entries = [...c.shell.nav, ...c.shell.floating];
        if (entries.includes('ai') || entries.includes('history'))
          return `AI and History should be gone, got ${entries.join(',')}`;
        return c.shell.floating.includes('settings') ? null : 'settings should be floating';
      },
    },
  },
  {
    id: 'P8',
    input: 'Add a Notes page with a short intro text, and a shortcut to it on the home page',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const page = c.pages.find((p) => /notes/i.test(p.title));
        if (!page) return 'expected a Notes page';
        if (!page.components.some((x) => x.type === 'text')) return 'Notes page should have text';
        const shortcut = allComponents(home(c)).find(
          (x) =>
            (x.type === 'shortcut' || x.type === 'button') && x.props.target === `page:${page.id}`,
        );
        return shortcut ? null : 'home should link to the Notes page';
      },
    },
  },
  {
    id: 'P9',
    input: '做一个记账页面，能看到这个月一共花了多少',
    locale: 'zh',
    setup: 'default',
    next: true,
    mock: false,
    expect: { kind: 'ops', check: dataPage('money', 'sum') },
  },
  {
    id: 'P10',
    input: '我想要一个读书清单，可以勾选读完了没有',
    locale: 'zh',
    setup: 'default',
    next: true,
    mock: false,
    expect: { kind: 'ops', check: dataPage('checkbox', 'checklist') },
  },
  {
    id: 'P11',
    input: '账目里加一个支付方式，选项有微信、支付宝、现金',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const f = c.collections[0]?.fields.find(
          (x) => x.type === 'choice' && x.name.includes('支付'),
        );
        if (!f || f.type !== 'choice') return 'expected a choice field for 支付方式';
        return f.options.length === 3 ? null : `expected 3 options, got ${f.options.length}`;
      },
    },
  },
  {
    id: 'P12',
    input: 'How much did I spend this month?',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: { kind: 'reject', reason: 'userData' },
  },
  {
    id: 'P13',
    input: '记账页面不要了',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    // 移出界面或删除页面都可以；无论哪种，校验通过即可（记录始终保留在数据库里）。
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some((p) => p.id === 'budget') &&
        [...c.shell.nav, ...c.shell.floating].includes('page:budget')
          ? 'the budget page should be gone or unreachable'
          : null,
    },
  },
  {
    id: 'P14',
    input: '首页标题下面加一段介绍：用粗体强调「全部在本机处理」，再用列表写三个要点',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const t = allComponents(home(c)).find(
          (x) => (x.type === 'text' || x.type === 'notice') && /\*\*[^*]+\*\*/.test(x.props.text),
        );
        if (!t || (t.type !== 'text' && t.type !== 'notice')) return 'expected text with **bold**';
        const blocks = parseRichText(t.props.text);
        const list = blocks.find((b) => b.type === 'list');
        return list && list.type === 'list' && list.items.length >= 3
          ? null
          : 'expected a list with three points';
      },
    },
  },
  {
    id: 'P15',
    input: 'Put a big photo at the top of the home page with the caption “Our family”',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const problem = imageSlot(c, 1);
        if (problem) return problem;
        const img = home(c).components[1]!;
        return img.type === 'image' && img.props.caption === 'Our family'
          ? null
          : 'caption should be “Our family”';
      },
    },
  },
  {
    id: 'P16',
    input: '在首页加一个链接到 https://example.com/help 的帮助说明',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        allComponents(home(c)).some(
          (x) =>
            (x.type === 'text' || x.type === 'notice') &&
            parseRichText(x.props.text).some(
              (b) =>
                b.type === 'paragraph' && b.spans.some((s) => s.url === 'https://example.com/help'),
            ),
        )
          ? null
          : 'expected a text with a link to https://example.com/help',
    },
  },
  {
    id: 'P17',
    input:
      '在首页顶部加一张横幅，标题下面加一段介绍：用粗体强调「全部在本机处理」，再用列表写三个要点，首页图标换成🏡',
    locale: 'zh',
    setup: 'default',
    mock: false,
    // 多项修改一项都不能漏。只说「横幅」时模型可能理解为文字横幅（提示框），所以这里明确说「横幅图片」。
    expect: {
      kind: 'ops',
      check: (c) => {
        if (!home(c).components.some((x) => x.type === 'image' && !x.props.assetId))
          return 'expected an empty image slot on the home page';
        if (home(c).icon !== '🏡') return `home icon should be 🏡, got ${home(c).icon}`;
        const t = allComponents(home(c)).find(
          (x) => (x.type === 'text' || x.type === 'notice') && /\*\*[^*]+\*\*/.test(x.props.text),
        );
        return t ? null : 'expected an intro with **bold**';
      },
    },
  },
  {
    id: 'P4',
    input: 'Make the PDF tool skip asking for a file name and just save it as merged-date',
    locale: 'en',
    setup: 'pdf',
    mock: false,
    expect: { kind: 'ops', check: all(savesAs('merged-{date:YYYY-MM-DD}'), singlePdfTool) },
  },
];

// ---- 工作流（T7）----

/** 用户自己的工作流（不属于工具）。 */
const userWorkflows = (c: WorkspaceConfig) => c.workflows.filter((w) => !w.toolId);
const visa = (c: WorkspaceConfig) =>
  c.workflows.find((w) => w.id === 'visa-photo' || w.presetId === 'visa-photo');
/** 有一个用户工作流按顺序包含这些动作（中间可以有别的步骤），参数满足 check。 */
const hasWorkflow =
  (
    actions: readonly string[],
    check: (steps: { action: string; params: Record<string, unknown> }[]) => string | null = () =>
      null,
  ) =>
  (c: WorkspaceConfig) => {
    for (const wf of userWorkflows(c)) {
      let i = 0;
      for (const step of wf.steps) if (step.action === actions[i]) i++;
      if (i === actions.length) return check(wf.steps);
    }
    return `expected a workflow with ${actions.join(' → ')}, got ${userWorkflows(c)
      .map((w) => w.steps.map((s) => s.action).join(' → '))
      .join(' | ')}`;
  };
const param =
  (action: string, key: string, value: unknown) =>
  (steps: { action: string; params: Record<string, unknown> }[]) => {
    const got = steps.find((s) => s.action === action)?.params[key];
    return got === value ? null : `${action}.${key} should be ${String(value)}, got ${String(got)}`;
  };
/** 有一个用户快捷操作翻译成 to；first 给了时第一步必须是其中之一。 */
const translatesTo =
  (to: string, first?: readonly string[]) =>
  (c: WorkspaceConfig): string | null => {
    for (const wf of userWorkflows(c)) {
      const step = wf.steps.find((s) => s.action === 'translate.text');
      if (step?.params.to === to && (!first || first.includes(wf.steps[0]?.action ?? ''))) {
        return null;
      }
    }
    return `expected a quick action translating into ${to}, got ${userWorkflows(c)
      .map((w) =>
        w.steps
          .map(
            (s) => `${s.action}${s.action === 'translate.text' ? `(${String(s.params.to)})` : ''}`,
          )
          .join(' → '),
      )
      .join(' | ')}`;
  };

/**
 * W10「扫描文档，压到 300KB，存到文件」：扫描的图片压到 300KB 再存，
 * 或者扫描 →（找边拉正）→ 做成不超过 0.3 MB 的 PDF，最后一步存文件。创始人 2026-10-27（本地会话）确认两种都算对。
 */
const scanDocTo300KB = (c: WorkspaceConfig): string | null => {
  const compressed = hasWorkflow(
    ['in.photos', 'image.compress', 'file.save'],
    (steps) =>
      param('in.photos', 'source', 'scanner')(steps) ??
      param('image.compress', 'maxKB', 300)(steps),
  )(c);
  if (compressed === null) return null;
  const asPdf = hasWorkflow(['in.photos', 'pdf.fromImages', 'file.save'], (steps) => {
    const maxMB = steps.find((s) => s.action === 'pdf.fromImages')?.params.maxMB;
    return (
      param('in.photos', 'source', 'scanner')(steps) ??
      (typeof maxMB === 'number' && maxMB > 0 && maxMB <= 0.3
        ? null
        : `pdf.fromImages.maxMB should be at most 0.3, got ${String(maxMB)}`) ??
      (steps.at(-1)?.action === 'file.save'
        ? null
        : `the last step should be file.save, got ${String(steps.at(-1)?.action)}`)
    );
  })(c);
  return asPdf === null ? null : `${compressed}; or as a PDF: ${asPdf}`;
};

const visaActions = (c: WorkspaceConfig) => visa(c)?.steps.map((s) => s.action) ?? [];

const WORKFLOW_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'W1',
    input: '添加签证照片工作流',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.idPhoto']) },
  },
  {
    id: 'W2',
    input: '新建一个工作流：选照片，长边 1600，压到 500KB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.resize', 'image.compress', 'out.share'],
        (steps) =>
          param('image.compress', 'maxKB', 500)(steps) ?? param('image.resize', 'px', 1600)(steps),
      ),
    },
  },
  {
    id: 'W2-en',
    input: 'Create a workflow: choose photos, convert to JPG, remove location, zip, share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow([
        'in.photos',
        'image.convert',
        'image.stripMetadata',
        'zip.create',
        'out.share',
      ]),
    },
  },
  {
    id: 'W3',
    input: '把签证照片改名为美签照片',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => (visa(c)?.name === '美签照片' ? null : `name is ${visa(c)?.name}`),
    },
  },
  {
    id: 'W4',
    input: '删除签证照片工作流',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: (c) => (visa(c) ? 'the visa workflow is still there' : null) },
  },
  {
    id: 'W4-tool',
    input: '删除合并 PDF 工作流',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject' },
  },
  {
    id: 'W5',
    input: '把签证照片放到首页',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        allComponents(home(c)).some(
          (x) => x.type === 'workflowRunner' && x.props.workflowId === visa(c)?.id,
        )
          ? null
          : 'no runner for the visa workflow on the home page',
    },
  },
  {
    id: 'W6',
    input: '在签证照片里加一步去掉定位',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        visaActions(c).includes('image.stripMetadata')
          ? null
          : `steps are ${visaActions(c).join(',')}`,
    },
  },
  {
    id: 'W7',
    input: '把签证照片的大小改成 200KB',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) => {
        const got = visa(c)?.steps.find((s) => s.action === 'image.idPhoto')?.params.maxKB;
        return got === 200 ? null : `maxKB is ${String(got)}`;
      },
    },
  },
  {
    id: 'W8',
    input: '把签证照片的命名这一步去掉',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        visaActions(c).includes('file.rename') ? 'the naming step is still there' : null,
    },
  },
  {
    id: 'W9',
    input: '把本月的账目做成 PDF 报表',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.records', 'print.records'], (steps) =>
        param('in.records', 'period', 'thisMonth')(steps),
      ),
    },
  },
  {
    id: 'W10',
    input: '新建一个工作流：扫描文档，压到 300KB，存到文件',
    locale: 'zh',
    setup: 'default',
    mock: true,
    // 两种理解都算对（D-083 补充）：把扫描的图片压到 300KB，或者先拉正再做成不超过 0.3 MB 的 PDF（scanDocTo300KB）。
    expect: { kind: 'ops', check: scanDocTo300KB },
  },
  {
    id: 'W10-en',
    input: 'Create a workflow: scan documents, make a PDF, share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages', 'out.share'], (steps) =>
        param('in.photos', 'source', 'scanner')(steps),
      ),
    },
  },
  {
    id: 'W11',
    input: '新建工作流：选照片，压到 500KB，存到 iCloud 的某个文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress', 'out.saveToFolder'], (steps) =>
        param('image.compress', 'maxKB', 500)(steps),
      ),
    },
  },
  {
    id: 'W11-en',
    input: 'Create a workflow: choose photos, compress to 500 KB, save to a folder',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress', 'out.saveToFolder']),
    },
  },
  {
    id: 'PW1',
    input: '帮我做个流程：拍收据，拉正，压缩到 300K，然后存起来',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'scan.detect', 'image.compress', 'file.save'], (steps) =>
        param('image.compress', 'maxKB', 300)(steps),
      ),
    },
  },
  {
    id: 'PW2',
    input: 'I want the visa photo workflow to also open the share sheet at the end',
    locale: 'en',
    setup: 'visa',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        visaActions(c).at(-1) === 'out.share' ? null : `steps are ${visaActions(c).join(',')}`,
    },
  },
  {
    id: 'PW3',
    input: 'Make a monthly PDF of my expenses with the total at the bottom',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.records', 'print.records'],
        (steps) =>
          param('in.records', 'period', 'thisMonth')(steps) ??
          param('print.records', 'template', 'receipt')(steps),
      ),
    },
  },
  {
    id: 'PW4',
    input: '我想把扫描文档这个预设加进来，再把它放在首页上',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const wf = userWorkflows(c).find((w) => w.steps.some((s) => s.action === 'scan.detect'));
        if (!wf) return 'no scanning workflow';
        return allComponents(home(c)).some(
          (x) => x.type === 'workflowRunner' && x.props.workflowId === wf.id,
        )
          ? null
          : 'the scanning workflow is not on the home page';
      },
    },
  },
  {
    id: 'PW5',
    input: '做一个流程：用文档相机扫描几页合同，合成 PDF，然后分享',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages', 'out.share'], (steps) =>
        param('in.photos', 'source', 'scanner')(steps),
      ),
    },
  },
  {
    id: 'PW6',
    input: '做个流程：扫描合同，合成 PDF，直接存进我 Google Drive 里的一个文件夹',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages', 'out.saveToFolder']),
    },
  },
  {
    id: 'PW7',
    input:
      'Make a workflow that shrinks my photos to 1 MB each and sends them all to WhatsApp in one go',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress', 'out.share'], (steps) =>
        param('image.compress', 'maxKB', 1024)(steps),
      ),
    },
  },
];

// 「目标式」说法（D-110）：用户只说「我有什么、想要什么」，AI 自己搭工作流。只要求真实模型通过。
// 同时检查：不顺手放到首页（D-109）、做不到的部分写进 notes、按用途补步骤但不加多余的。

/** 没有任何页面上的运行卡片（用户没说要放首页）。 */
const noRunner = (c: WorkspaceConfig) => {
  const runners = c.pages.flatMap((p) =>
    allComponents(p).filter((x) => x.type === 'workflowRunner'),
  );
  return runners.length === 0 ? null : `added a runner on a page without being asked`;
};
const withoutAction = (action: string) => (c: WorkspaceConfig) =>
  userWorkflows(c).some((w) => w.steps.some((s) => s.action === action))
    ? `added a ${action} step the goal does not need`
    : null;
const someAction =
  (actions: readonly string[]) => (steps: { action: string; params: Record<string, unknown> }[]) =>
    steps.some((s) => actions.includes(s.action))
      ? null
      : `expected one of ${actions.join(' / ')}, got ${steps.map((s) => s.action).join(',')}`;
const datedName = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const template = steps.find((s) => s.action === 'file.rename')?.params.template;
  return typeof template === 'string' && /\{date/.test(template)
    ? null
    : `the file name should carry the date, got ${String(template)}`;
};
const hasNotes = (plan: OpsPlan) =>
  plan.notes && plan.notes.length > 0 ? null : 'expected notes on what the app cannot do';

const GOAL_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'GW1',
    input: '身份证正反面两张照片，学校要一个 PDF，不能超过 2MB',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(['in.photos', 'pdf.fromImages'], param('pdf.fromImages', 'maxMB', 2)),
        noRunner,
      ),
    },
  },
  {
    id: 'GW2',
    input: '纸质合同要签字后发回',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(
          ['in.photos', 'pdf.fromImages', 'pdf.sign', 'out.share'],
          param('in.photos', 'source', 'scanner'),
        ),
        noRunner,
      ),
    },
  },
  {
    id: 'GW3',
    input: '要申请美国签证，我有一张自拍',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        (c) => (visa(c) ? null : 'expected the visa photo preset'),
        hasWorkflow(['in.photos', 'image.idPhoto'], param('image.idPhoto', 'spec', 'us-passport')),
        noRunner,
      ),
    },
  },
  {
    id: 'GW4',
    input: '每个月要把发票拍下来整理成一个 PDF 发给会计',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 没有定时运行：要在 notes 里说「每月需要你自己点一次」；发给会计按日期命名。
      check: all(hasWorkflow(['in.photos', 'pdf.fromImages'], datedName), noRunner),
      plan: hasNotes,
    },
  },
  {
    id: 'GW5',
    input: '几张照片要发邮件给朋友',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 多张大照片可能超过邮件附件上限：要压缩或缩小。
      check: all(
        hasWorkflow(['in.photos', 'out.share'], someAction(['image.compress', 'image.resize'])),
        noRunner,
      ),
    },
  },
  {
    id: 'GW6',
    input: '把购物小票拍下来存成 PDF',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 拉正就够了，不用再让用户手动裁剪。
      check: all(
        hasWorkflow(['in.photos', 'pdf.fromImages']),
        withoutAction('image.crop'),
        noRunner,
      ),
    },
  },
  {
    id: 'GW7',
    input: '添加扫描文档工作流，但是不要放到首页',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'scan.detect']), noRunner),
      plan: (plan) => (plan.homeEntry === false ? null : 'homeEntry should be false'),
    },
  },
  {
    id: 'GW4-en',
    input: 'Every month I photograph my invoices and send one PDF to my accountant',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'pdf.fromImages'], datedName), noRunner),
      plan: hasNotes,
    },
  },
  // 新手引导的三句（D-149）：内置规则也要认得；真实模型拿到同样的句子也要搭出能用的快捷操作。
  {
    id: 'GW8',
    input: '我有一堆旅行照片，想发给朋友',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      // 发给别人：要缩小或压缩。去掉定位是引导里的惊喜点，由内置规则保证（goals.test.ts），真实模型不强求。
      check: all(
        hasWorkflow(['in.photos', 'out.share'], someAction(['image.compress', 'image.resize'])),
        noRunner,
      ),
    },
  },
  {
    id: 'GW8-en',
    input: 'I have a bunch of trip photos to send to friends',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(['in.photos', 'out.share'], someAction(['image.compress', 'image.resize'])),
        noRunner,
      ),
    },
  },
  {
    id: 'GW9',
    input: '我拍了一段视频，太大了发不出去',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.videos', 'video.compress', 'out.share']), noRunner),
    },
  },
  {
    id: 'GW9-en',
    input: 'I shot a video and it’s too big to send',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.videos', 'video.compress', 'out.share']), noRunner),
    },
  },
  {
    id: 'GW10',
    input: '我有好几份 PDF 合同，想合成一份加上页码，发邮件给律师',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.files', 'pdf.merge', 'pdf.pageNumbers', 'out.share']), noRunner),
    },
  },
  {
    id: 'GW10-en',
    input:
      'I have several PDF contracts to combine into one with page numbers and email to my lawyer',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.files', 'pdf.merge', 'pdf.pageNumbers', 'out.share']), noRunner),
    },
  },
];

// 新说法（D-112）：「快捷操作 / quick action」「添加 / 移除工具」「改动记录」，旧说法仍然能用（W*、P7）。

const toolIds = (c: WorkspaceConfig) => c.tools.map((t) => t.toolId);
const onHome = (c: WorkspaceConfig) =>
  allComponents(home(c)).some(
    (x) => x.type === 'workflowRunner' && x.props.workflowId === visa(c)?.id,
  )
    ? null
    : 'no runner for the visa quick action on the home page';

const WORDING_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'QA1',
    input: '添加签证照片快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.idPhoto']) },
  },
  {
    id: 'QA1-en',
    input: 'Add the visa photo quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.idPhoto']) },
  },
  {
    id: 'QA2',
    input: '新建一个快捷操作：选照片，压到 500KB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.compress', 'out.share'],
        param('image.compress', 'maxKB', 500),
      ),
    },
  },
  {
    id: 'QA3',
    input: '把签证照片快捷操作放到首页',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: onHome },
  },
  {
    id: 'QA4',
    input: '把改动记录从导航栏去掉',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.shell.nav.includes('history')
          ? `History should leave the bar, got ${c.shell.nav.join(',')}`
          : null,
    },
  },
  {
    id: 'QA5',
    input: '添加图片工具',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        toolIds(c).includes('image') ? null : `image tool not added: ${toolIds(c).join(',')}`,
    },
  },
  {
    id: 'QA6',
    input: 'Remove the PDF tool',
    locale: 'en',
    setup: 'pdf',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => (toolIds(c).includes('pdf') ? 'the PDF tool is still there' : null),
    },
  },
];

// AI 只改 App（D-113、D-124）：办事类请求拒绝并给出能做的快捷操作；文件上的事照样做成快捷操作；
// 从一个快捷操作打开时「这个」指它；从收件页面打开时，新快捷操作的第一步收得下分享的文件。

const visaStep = (c: WorkspaceConfig, action: string) =>
  visa(c)?.steps.find((s) => s.action === action);
/** visa 场景里用户自己的快捷操作只有签证照片：改它，不新建。 */
const onlyVisa = (c: WorkspaceConfig) =>
  userWorkflows(c).length === 1 ? null : `made a new quick action instead of changing this one`;
const homeEntryOff = (plan: OpsPlan) =>
  plan.homeEntry === false ? null : 'a quick action for shared files should set homeEntry: false';
const photosFit =
  (count: number) => (steps: { action: string; params: Record<string, unknown> }[]) => {
    const first = steps[0];
    if (first?.action !== 'in.photos')
      return `first step should be in.photos, got ${first?.action}`;
    const { min, max } = first.params as { min: number; max: number };
    return min <= count && count <= max ? null : `in.photos ${min}..${max} does not take ${count}`;
  };

const ABOUT_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'ER1',
    input: '帮我写一封请假邮件',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    // D-171：翻译文件是文件上的事，做一个翻译快捷操作（以前按办事拒绝）。
    id: 'ER2',
    input: '把这份合同翻译成英文',
    locale: 'zh',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: translatesTo('en', ['in.files', 'in.photos']) },
  },
  {
    id: 'ER3',
    input: 'What does this contract say?',
    locale: 'en',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'ER4',
    input: '现在帮我运行签证照片',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'ER5',
    input: '这几张照片太大了，帮我压到 200KB',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'image.compress'], param('image.compress', 'maxKB', 200)),
    },
  },
  {
    id: 'AB1',
    input: '把这个的大小改成 200KB',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    about: { kind: 'workflow', workflowId: 'visa-photo' },
    expect: {
      kind: 'ops',
      check: all(onlyVisa, (c) =>
        visaStep(c, 'image.idPhoto')?.params.maxKB === 200
          ? null
          : 'the visa photo should be at most 200 KB',
      ),
    },
  },
  {
    id: 'AB2',
    input: '再小一点，150KB 以内',
    locale: 'zh',
    setup: 'visa',
    mock: false,
    about: { kind: 'workflow', workflowId: 'visa-photo' },
    expect: {
      kind: 'ops',
      check: all(onlyVisa, (c) =>
        visaStep(c, 'image.idPhoto')?.params.maxKB === 150
          ? null
          : `the visa photo should be at most 150 KB, got ${String(visaStep(c, 'image.idPhoto')?.params.maxKB)}`,
      ),
    },
  },
  {
    id: 'AB3-en',
    input: 'Also take the location out of it',
    locale: 'en',
    setup: 'visa',
    mock: false,
    about: { kind: 'workflow', workflowId: 'visa-photo' },
    expect: {
      kind: 'ops',
      check: all(onlyVisa, (c) =>
        visaStep(c, 'image.stripMetadata') ? null : 'no location removal step in the visa photo',
      ),
    },
  },
  {
    id: 'SH1',
    input: '做成一个 PDF',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 2, pdfs: 0, others: 0 },
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'pdf.fromImages'], photosFit(2)), noRunner),
      plan: homeEntryOff,
    },
  },
  {
    id: 'SH2-en',
    input: 'Combine them into one file',
    locale: 'en',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 3, others: 0 },
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(['in.files', 'pdf.merge'], (steps) => {
          const { accept, max } = steps[0]!.params as { accept: string; max: number };
          return ['pdf', 'pdfOrImages', 'any'].includes(accept) && max >= 3
            ? null
            : `in.files ${accept} max ${max} does not take 3 PDFs`;
        }),
        noRunner,
      ),
      plan: homeEntryOff,
    },
  },
];

/** 视频和压缩 PDF（D-140–D-147）。V* 是 mock 句式（MOCK_AI_PHRASES W12–W14），PV* 和 SH3 只要求真实模型。 */
const firstVideo = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  if (first?.action === 'in.videos') return null;
  if (first?.action === 'in.files' && first.params.accept === 'videos') return null;
  return `first step should pick videos, got ${first?.action}`;
};
const firstPdf = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  return first?.action === 'in.files' &&
    ['pdf', 'pdfOrImages', 'any'].includes(String(first.params.accept))
    ? null
    : `first step should pick PDFs, got ${first?.action} ${String(first?.params.accept)}`;
};
const presetAdded = (id: string) => (c: WorkspaceConfig) =>
  userWorkflows(c).some((w) => w.presetId === id) ? null : `the ${id} preset was not added`;

const VIDEO_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'V1',
    input: '新建一个快捷操作：选视频，压到 20MB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.videos', 'video.compress', 'out.share'],
        (steps) =>
          param('video.compress', 'maxMB', 20)(steps) ??
          param('video.compress', 'by', 'size')(steps),
      ),
    },
  },
  {
    id: 'V1-en',
    input: 'Create a quick action: choose videos, compress to 25 MB, then share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.videos', 'video.compress', 'out.share'],
        param('video.compress', 'maxMB', 25),
      ),
    },
  },
  {
    id: 'V2',
    input: '新建一个快捷操作：选视频，转成 MP4',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.videos', 'video.convert']) },
  },
  {
    id: 'V3',
    input: '新建一个快捷操作：选视频，剪一段，压缩视频，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.videos', 'video.trim', 'video.compress', 'out.share']),
    },
  },
  {
    id: 'V4',
    input: '新建一个快捷操作：选 PDF，压到 2MB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.files', 'pdf.compress', 'out.share'],
        param('pdf.compress', 'maxMB', 2),
      ),
    },
  },
  {
    id: 'V4-en',
    input: 'Create a quick action: choose PDFs, compress to 1 MB',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.files', 'pdf.compress'], param('pdf.compress', 'maxMB', 1)),
    },
  },
  {
    id: 'V5',
    input: '添加视频太大发不出去快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('video-too-big') },
  },
  {
    id: 'V6-en',
    input: 'Add the PDF too big to upload quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('pdf-too-big') },
  },
  {
    id: 'PV1',
    input: '视频太大了微信发不出去，帮我做个能压到 25MB 再分享的',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['video.compress', 'out.share'],
        (steps) => firstVideo(steps) ?? param('video.compress', 'maxMB', 25)(steps),
      ),
    },
  },
  {
    id: 'PV2',
    input: '朋友说我发的 MOV 视频在电脑上打不开，做一个转换的快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['video.convert'], firstVideo) },
  },
  {
    id: 'PV3-en',
    input: 'The school portal only takes PDFs under 2 MB and my scanned transcript is 15 MB',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(
          ['pdf.compress'],
          (steps) => firstPdf(steps) ?? param('pdf.compress', 'maxMB', 2)(steps),
        ),
        withoutAction('pdf.toImages'),
      ),
    },
  },
  {
    id: 'PV4-en',
    input: 'I want to cut a short part out of a long video and send just that part',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['video.trim', 'out.share'], firstVideo) },
  },
  {
    id: 'PV5',
    input: '把这个视频压到 20MB',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['video.compress'],
        (steps) => firstVideo(steps) ?? param('video.compress', 'maxMB', 20)(steps),
      ),
    },
  },
  {
    id: 'SH3',
    input: '压小一点，好发微信',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 0, others: 0, videos: 1 },
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['video.compress'], firstVideo), noRunner),
      plan: homeEntryOff,
    },
  },
];

// ---- 翻译（D-170–D-176）：翻译文件做成快捷操作；直接要译文仍按办事拒绝 ----

const TRANSLATE_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'TR1',
    input: '帮我翻译一下这句话：Thank you for your help',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'TR2-en',
    input: 'Translate this sentence into Chinese: break a leg',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'TR3',
    input: '新建一个快捷操作：选截图，识别文字，翻译成中文，复制文字',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'ocr.recognize', 'translate.text', 'text.copy'],
        param('translate.text', 'to', 'zh-Hans'),
      ),
    },
  },
  {
    id: 'TR4-en',
    input: 'Translate this letter into Chinese',
    locale: 'en',
    setup: 'pdf',
    mock: true,
    expect: { kind: 'ops', check: translatesTo('zh-Hans', ['in.files', 'in.photos']) },
  },
  {
    id: 'TR5',
    input: '添加截图翻译快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.presetId === 'screenshot-translate')
          ? null
          : 'expected the screenshot-translate preset',
    },
  },
  {
    id: 'TR6',
    input: '收到的日文邮件截图老是看不懂，想以后能一键翻成中文',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        translatesTo('zh-Hans', ['in.photos']),
        hasWorkflow(['in.photos', 'ocr.recognize', 'translate.text']),
      ),
    },
  },
  {
    id: 'TR7',
    input: '翻译成中文',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 1, others: 0 },
    expect: {
      kind: 'ops',
      check: all(
        translatesTo('zh-Hans', ['in.files']),
        hasWorkflow(['in.files', 'pdf.extractText', 'translate.text']),
      ),
    },
  },
  {
    id: 'TR8',
    input: '这句英文是什么意思：It’s raining cats and dogs',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'TR9-en',
    input:
      'I keep getting PDFs in Spanish from my landlord. Make something to read them in English.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: all(
        translatesTo('en', ['in.files']),
        hasWorkflow(['in.files', 'pdf.extractText', 'translate.text']),
      ),
    },
  },
];

// ---- 音频（D-150–D-157）：录音转文字、压小、剪一段、合成、取视频的声音做成快捷操作；总结录音内容按办事拒绝 ----
// AU* 是 mock 句式（MOCK_AI_PHRASES AU），PAU* 和 SH4 只要求真实模型。

const firstAudio = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  if (first?.action === 'in.audio') return null;
  if (first?.action === 'in.files' && first.params.accept === 'audio') return null;
  return `first step should pick or record audio, got ${first?.action}`;
};

const AUDIO_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'AU1',
    input: '新建一个快捷操作：录音，转成文字，转成 PDF，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.transcribe', 'text.toPdf', 'out.share'],
        (steps) =>
          param('in.audio', 'source', 'record')(steps) ??
          param('audio.transcribe', 'lang', 'zh')(steps),
      ),
    },
  },
  {
    id: 'AU1-en',
    input: 'Create a quick action: choose recordings, transcribe, save as a text file',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.transcribe', 'text.toFile'],
        (steps) =>
          param('in.audio', 'source', 'files')(steps) ??
          param('audio.transcribe', 'lang', 'en')(steps),
      ),
    },
  },
  {
    id: 'AU2',
    input: '新建一个快捷操作：选录音，压到 2MB，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.compress', 'out.share'],
        (steps) =>
          param('audio.compress', 'maxMB', 2)(steps) ??
          param('audio.compress', 'by', 'size')(steps),
      ),
    },
  },
  {
    id: 'AU3',
    input: '新建一个快捷操作：选几段录音，排序，合成一段，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.audio', 'file.order', 'audio.merge', 'out.share']),
    },
  },
  {
    id: 'AU4',
    input: '新建一个快捷操作：选视频，提取声音，存到文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.videos', 'audio.fromVideo', 'out.saveToFolder']),
    },
  },
  {
    id: 'AU5',
    input: '新建一个快捷操作：选音频，剪一段，存到文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.audio', 'audio.trim', 'out.saveToFolder']),
    },
  },
  {
    id: 'AU6',
    input: '添加录音转文字快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('audio-to-text') },
  },
  {
    id: 'AU7-en',
    input: 'Add the recording too big to send quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('audio-too-big') },
  },
  {
    id: 'PAU1',
    input: '上课录的音想变成文字笔记，帮我做一个快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['audio.transcribe'], firstAudio) },
  },
  {
    id: 'PAU2-en',
    input: 'My voice memo is too big to email, it has to be under 10 MB',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['audio.compress'],
        (steps) => firstAudio(steps) ?? param('audio.compress', 'maxMB', 10)(steps),
      ),
    },
  },
  {
    id: 'PAU3',
    input: '采访录了好几段，想拼成一个文件发给编辑',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['audio.merge'], firstAudio) },
  },
  {
    id: 'PAU4',
    input: '想把视频里的背景音乐单独存下来',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['in.videos', 'audio.fromVideo'], firstVideo) },
  },
  {
    id: 'PAU5',
    input: '帮我总结一下这段会议录音说了什么',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'PAU6-en',
    input: 'I want to cut 30 seconds out of a song to use as my ringtone',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['audio.trim'], firstAudio) },
  },
  {
    id: 'SH4',
    input: '转成文字',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 0, others: 0, audio: 1 },
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['audio.transcribe'], firstAudio), noRunner),
      plan: homeEntryOff,
    },
  },
];

// ---- 文字转语音（D-270）：PDF、纸质材料读成音频文件，做成快捷操作；要 AI 读一句话给用户听按办事拒绝 ----
// TTS* 是 mock 句式（MOCK_AI_PHRASES TTS），PTTS* 只要求真实模型。

const SPEAK_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'TTS1',
    input: '新建一个快捷操作：选 PDF，提取文字，转成语音，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.files', 'pdf.extractText', 'audio.fromText', 'out.share'],
        param('audio.fromText', 'lang', 'auto'),
      ),
    },
  },
  {
    id: 'TTS2-en',
    input: 'Create a quick action: scan documents, recognize text, read it aloud, save to a folder',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'ocr.recognize', 'audio.fromText', 'out.saveToFolder']),
    },
  },
  {
    id: 'TTS3',
    input: '添加 PDF 转成音频快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('pdf-to-audio') },
  },
  {
    id: 'TTS4-en',
    input: 'Add the read paper pages aloud quick action',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: presetAdded('paper-to-audio') },
  },
  {
    id: 'TTS5',
    input: '新建一个快捷操作：输入文字，朗读，转成 MP3，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.text', 'audio.fromText', 'audio.convert', 'out.share']),
    },
  },
  {
    id: 'PTTS1',
    input: '做一个把 PDF 变成音频的快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['in.files', 'pdf.extractText', 'audio.fromText']) },
  },
  {
    id: 'PTTS2-en',
    input:
      'I want to listen to the printed handouts from class on my commute instead of reading them',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'ocr.recognize', 'audio.fromText']) },
  },
  {
    id: 'PTTS3',
    input: '用日语慢一点读，做一个把日文 PDF 转成音频的快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.files', 'pdf.extractText', 'audio.fromText'], (steps) => {
        const p = steps.find((st) => st.action === 'audio.fromText')!.params;
        if (p.lang !== 'ja') return `audio.fromText.lang should be ja, got ${String(p.lang)}`;
        return Number(p.rate) < 1
          ? null
          : `audio.fromText.rate should be < 1, got ${String(p.rate)}`;
      }),
    },
  },
  {
    id: 'PTTS4',
    input: '把这句话读给我听：明天下午三点在三楼开会',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'PTTS5',
    input: '转成音频',
    locale: 'zh',
    setup: 'default',
    mock: false,
    about: { kind: 'shared', images: 0, pdfs: 1, others: 0 },
    expect: { kind: 'ops', check: hasWorkflow(['in.files', 'pdf.extractText', 'audio.fromText']) },
  },
];

// 工具箱是用户自己的页面，AI 能改（D-181）。

type ToolGrid = Extract<Component, { type: 'toolGrid' }>;
const toolbox = (c: WorkspaceConfig) => c.pages.find((p) => p.id === 'toolbox');
const grids = (c: WorkspaceConfig) =>
  (toolbox(c)?.components ?? []).filter((x): x is ToolGrid => x.type === 'toolGrid');
const gridWith = (c: WorkspaceConfig, toolId: string) =>
  grids(c).filter((g) => g.props.toolIds?.includes(toolId));
const gridTitled = (c: WorkspaceConfig, title: RegExp) =>
  grids(c).find((g) => title.test(g.props.title ?? ''));

const TOOLBOX_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'TB1',
    input: '把翻译移到照片那一组',
    locale: 'zh',
    setup: 'starter',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const found = gridWith(c, 'translate');
        if (found.length !== 1)
          return `translate should be in exactly one grid, got ${found.length}`;
        const g = found[0]!;
        return g.props.toolIds?.includes('image')
          ? null
          : `translate is not in the photos grid: ${JSON.stringify(g.props)}`;
      },
    },
  },
  {
    id: 'TB2',
    input: '工具箱最上面加一组「常用」，放图片和 PDF',
    locale: 'zh',
    setup: 'starter',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const g = gridTitled(c, /常用/);
        if (!g) return 'no 常用 grid';
        if (!(g.props.toolIds?.includes('image') && g.props.toolIds.includes('pdf')))
          return `常用 should list image and pdf, got ${JSON.stringify(g.props.toolIds)}`;
        const first = toolbox(c)!.components.find((x) => x.type !== 'header');
        return first === g ? null : '常用 should be the first group';
      },
    },
  },
  {
    id: 'TB3',
    input: 'Rename the toolbox to My tools',
    locale: 'en',
    setup: 'starter',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        toolbox(c)?.title === 'My tools' ? null : `toolbox title is ${toolbox(c)?.title}`,
    },
  },
  {
    id: 'TB4',
    input: '把工具箱放到导航栏',
    locale: 'zh',
    setup: 'starter',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.shell.nav.includes('page:toolbox')
          ? null
          : `toolbox not in the bar: ${c.shell.nav.join(',')}`,
    },
  },
  {
    id: 'TB5',
    input: '添加压缩包工具',
    locale: 'zh',
    setup: 'starter',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.tools.some((t) => t.toolId === 'zip')
          ? allComponents(home(c)).some((x) => x.type === 'toolCard')
            ? 'the toolbox already shows zip, so home should get no tool card'
            : null
          : 'zip not added',
    },
  },
];

const toolInFront = (toolId: string) => (c: WorkspaceConfig) => {
  const page = c.pages.find((p) => p.toolId === toolId);
  if (!page) return `the ${toolId} tool should be added`;
  return c.shell.nav[0] === `page:${page.id}`
    ? null
    : `the ${toolId} tool should be first in the bottom bar, got ${c.shell.nav.join(',')}`;
};

// 功能和外观分开改（D-191）：一句话两样都有时先做功能，外观留作下一句。
const SPLIT_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'FL1',
    input: '主题换成绿色，添加签证照片快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    next: true,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'image.idPhoto']), color('#2F9E44')),
    },
  },
  {
    id: 'FL1-en',
    input: 'Add the visa photo quick action. Change the theme color to green',
    locale: 'en',
    setup: 'default',
    mock: true,
    next: true,
    expect: {
      kind: 'ops',
      check: all(hasWorkflow(['in.photos', 'image.idPhoto']), color('#2F9E44')),
    },
  },
  {
    id: 'FL2',
    input: '添加图片工具，放到底部导航的第一个',
    locale: 'zh',
    setup: 'default',
    mock: false,
    next: true,
    expect: { kind: 'ops', check: toolInFront('image') },
  },
  {
    id: 'FL3-en',
    input: 'I want a to-do list I can tick off, and make the whole app dark',
    locale: 'en',
    setup: 'default',
    mock: false,
    next: true,
    expect: {
      kind: 'ops',
      check: all(dataPage('checkbox', 'checklist'), (c) =>
        c.theme.mode === 'dark' || darkBackground(c) === null ? null : 'the app should be dark',
      ),
    },
  },
];

// ---- 格式转换的缺口（D-183–D-186）：MP3、动图 GIF、从「文件」选视频、Word / Excel / PPT 转 PDF ----
// FG* 是 mock 句式（MOCK_AI_PHRASES FG），PFG* 只要求真实模型。

const firstDocuments = (steps: { action: string; params: Record<string, unknown> }[]) => {
  const first = steps[0];
  return first?.action === 'in.files' && first.params.accept === 'documents'
    ? null
    : `first step should pick Office documents, got ${first?.action}`;
};

const FORMAT_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'FG1',
    input: '新建一个快捷操作：选音频，转成 MP3，存到文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.audio', 'audio.convert', 'out.saveToFolder'],
        param('audio.convert', 'format', 'mp3'),
      ),
    },
  },
  {
    id: 'FG2',
    input: '新建一个快捷操作：选视频，转成 MP3，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.videos', 'audio.fromVideo', 'out.share'],
        param('audio.fromVideo', 'format', 'mp3'),
      ),
    },
  },
  {
    id: 'FG3',
    input: '新建一个快捷操作：选视频，剪一段，转成 GIF，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.videos', 'video.trim', 'video.toGif']) },
  },
  {
    id: 'FG3-en',
    input: 'Create a quick action: choose photos, make an animated GIF, share',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: hasWorkflow(['in.photos', 'image.toGif', 'out.share']) },
  },
  {
    id: 'FG4',
    input: '新建一个快捷操作：从文件选视频，转成 MP4，存到文件夹',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.videos', 'video.convert'], param('in.videos', 'source', 'files')),
    },
  },
  {
    id: 'FG5',
    input: '新建一个快捷操作：选 Word 文档，转成 PDF，分享',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.files', 'pdf.fromDocument', 'out.share'], firstDocuments),
    },
  },
  {
    id: 'FG5-en',
    input: 'Create a quick action: choose Word documents, make a PDF, save to a folder',
    locale: 'en',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.files', 'pdf.fromDocument', 'out.saveToFolder'], firstDocuments),
    },
  },
  {
    id: 'PFG1',
    input: '车里只能放 MP3，想把手机里的歌转一下',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['audio.convert'],
        (steps) => firstAudio(steps) ?? param('audio.convert', 'format', 'mp3')(steps),
      ),
    },
  },
  {
    id: 'PFG2-en',
    input: 'I want to turn a short clip of my cat into a GIF for the group chat',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['video.toGif'], firstVideo) },
  },
  {
    id: 'PFG3',
    input: '电脑上下载的 MKV 视频，手机上放不了，想转成能放的',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['video.convert'], (steps) => {
        const first = steps[0];
        if (first?.action === 'in.videos' && first.params.source === 'files') return null;
        if (first?.action === 'in.files' && first.params.accept === 'videos') return null;
        return `first step should pick videos from Files, got ${first?.action} ${JSON.stringify(first?.params)}`;
      }),
    },
  },
  {
    id: 'PFG4',
    input: '老师要交 PDF，我写的是 Word 作业',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['pdf.fromDocument'], firstDocuments) },
  },
  {
    // D-195：扫出来的 PDF 要能搜索、复制文字。
    id: 'PSP1',
    input: 'Scan receipts into a PDF where I can search and copy the text later',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'pdf.fromImages'],
        param('pdf.fromImages', 'textLayer', true),
      ),
    },
  },
  {
    // D-194：带密码的 PDF 先去密码，再合并。
    id: 'PPW1',
    input: '银行发的对账单 PDF 有密码，想去掉密码再和别的材料合成一份',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['pdf.unlock', 'pdf.merge']) },
  },
  {
    // D-194：加密码放在最后（之后只有命名、保存、分享）。
    id: 'PPW2',
    input: 'Before I send a contract I want to put a password on the PDF',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['pdf.protect'], (steps) => {
        const after = steps.slice(steps.findIndex((s) => s.action === 'pdf.protect') + 1);
        const late = ['out.share', 'out.saveToFolder', 'file.save', 'file.rename', 'out.print'];
        return after.every((s) => late.includes(s.action))
          ? null
          : `pdf.protect should come last, then ${after.map((s) => s.action).join(' → ')}`;
      }),
    },
  },
  {
    // D-197：一份报销单越攒越多。
    id: 'PFA1',
    input: '出差时每拍一张收据，就接到上次那份报销单 PDF 后面，最后只交一份',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: hasWorkflow(['file.addExisting', 'pdf.merge']) },
  },
  {
    // D-199：Wi-Fi 二维码。自己搭（in.wifi → qr.generate）或添加二维码工具（带「Wi-Fi 二维码」）都算。
    id: 'PWF1',
    input: '想做一个二维码，让来家里的客人扫一下就能连上 Wi-Fi',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => {
          const i = w.steps.findIndex((s) => s.action === 'in.wifi');
          return i === 0 && w.steps.slice(1).some((s) => s.action === 'qr.generate');
        })
          ? null
          : `expected in.wifi → qr.generate, got ${c.workflows
              .map((w) => w.steps.map((s) => s.action).join(' → '))
              .join(' | ')}`,
    },
  },
];

// ---- 记一笔、附件和公式字段（D-187、D-188）：快捷操作写记录；直接替用户记一笔仍按 userData 拒绝 ----
// RE* 是 mock 句式（MOCK_AI_PHRASES RE），PRE* 只要求真实模型。

/** 有一个快捷操作记到 expenses，而且这张表有附件字段（收文件时）。 */
const logsTo =
  (needsFile: boolean) =>
  (c: WorkspaceConfig): string | null => {
    const wf = userWorkflows(c).find((w) =>
      w.steps.some((s) => s.action === 'out.addRecord' && s.params.collectionId === 'expenses'),
    );
    if (!wf) return 'expected a quick action with out.addRecord into expenses';
    const table = c.collections.find((x) => x.id === 'expenses');
    if (needsFile && !table?.fields.some((f) => f.type === 'file'))
      return 'expenses should have a file field for the receipts';
    return null;
  };

/**
 * D-263：给表加附件字段（用户在表单里自己拍照、选文件），不另外搭「记一笔」快捷操作。
 */
const attachesTo =
  (collectionId: string) =>
  (c: WorkspaceConfig): string | null => {
    const table = c.collections.find((x) => x.id === collectionId);
    if (!table?.fields.some((f) => f.type === 'file'))
      return `${collectionId} should have a file field`;
    if (userWorkflows(c).some((w) => w.steps.some((s) => s.action === 'out.addRecord')))
      return 'no out.addRecord quick action is needed: the forms take photos and files';
    return null;
  };

const RECORD_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'RE1',
    input: '新建一个快捷操作：拍照，记到账目',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: {
      kind: 'ops',
      check: all(
        hasWorkflow(['in.photos', 'out.addRecord'], param('in.photos', 'source', 'camera')),
        logsTo(true),
      ),
    },
  },
  {
    id: 'RE1-en',
    input: 'Create a quick action: take photos, add a record to Expenses',
    locale: 'en',
    setup: 'budget',
    mock: true,
    expect: { kind: 'ops', check: all(hasWorkflow(['in.photos', 'out.addRecord']), logsTo(true)) },
  },
  {
    id: 'RE2',
    input: '新建一个快捷操作：输入文字，记一笔',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'ops', check: all(hasWorkflow(['in.text', 'out.addRecord']), logsTo(false)) },
  },
  {
    id: 'RE3',
    input: '新建一个快捷操作：拍照，记到不存在的表',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'reject' },
  },
  {
    id: 'PRE1',
    input: '我想拍一下收据就能记一笔账，收据照片也留着',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    // D-263 起表单里就能拍照，只给账目加附件字段也算对；搭了「记一笔」快捷操作也对。
    expect: {
      kind: 'ops',
      check: (c) => (logsTo(true)(c) === null ? null : attachesTo('expenses')(c)),
    },
  },
  {
    id: 'PRE2-en',
    input: 'Make a quick action to scan my receipts into the Expenses table',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: { kind: 'ops', check: logsTo(true) },
  },
  {
    id: 'PRE3',
    input: '给账目加一个「含税」，等于金额乘以 1.06',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const f = c.collections
          .find((x) => x.id === 'expenses')
          ?.fields.find((x) => x.type === 'formula');
        if (!f || f.type !== 'formula') return 'expected a formula field in expenses';
        return /\{amount\}\s*\*\s*1\.06|1\.06\s*\*\s*\{amount\}/.test(f.expression)
          ? null
          : `formula should be amount × 1.06, got ${f.expression}`;
      },
    },
  },
  {
    id: 'AT1',
    input: '给账目加照片',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'ops', check: attachesTo('expenses') },
  },
  {
    id: 'AT1-en',
    input: 'Attach receipts to Expenses',
    locale: 'en',
    setup: 'budget',
    mock: true,
    expect: { kind: 'ops', check: attachesTo('expenses') },
  },
  {
    id: 'AT2',
    input: '账目里存发票',
    locale: 'zh',
    setup: 'budget',
    mock: true,
    expect: { kind: 'ops', check: attachesTo('expenses') },
  },
  {
    id: 'PAT1',
    input: '记账的时候想顺便附上发票的照片',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: { kind: 'ops', check: attachesTo('expenses') },
  },
  {
    id: 'PAT2-en',
    input: 'I want to keep a photo of the receipt with each expense',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: { kind: 'ops', check: attachesTo('expenses') },
  },
  {
    id: 'PAT3-fr',
    input: 'Je veux pouvoir joindre des photos à mes dépenses',
    locale: 'fr',
    setup: 'budget',
    mock: false,
    expect: { kind: 'ops', check: attachesTo('expenses') },
  },
  {
    id: 'PRE4',
    input: '记一笔午饭 35',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: { kind: 'reject', reason: 'userData' },
  },
];

const BLUE = '#1C7ED6';
const toBlue: Op[] = [{ op: 'setTheme', primaryColor: BLUE }];

/** 草稿聊天框里接着说（D-207）：只有带上之前说过的话才知道「再…一点」「那就…」指什么。 */
const DRAFT_CHAT_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'DR1',
    input: '再深一点',
    locale: 'zh',
    setup: 'default',
    mock: false,
    earlier: [{ input: '主题色换成蓝色', ops: toBlue }],
    expect: {
      kind: 'ops',
      check: (c) => {
        const hex = c.theme.primaryColor;
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
          number,
          number,
          number,
        ];
        if (!(b > r && b > g)) return `the color should still be blue, got ${hex}`;
        return contrast(hex, '#FFFFFF') > contrast(BLUE, '#FFFFFF')
          ? null
          : `the blue should be darker than ${BLUE}, got ${hex}`;
      },
    },
  },
  {
    id: 'DR2',
    input: '那就用渐变吧',
    locale: 'zh',
    setup: 'default',
    mock: false,
    earlier: [
      {
        input: '背景换成我的照片',
        notDone: '背景不能用照片，可以换成纯色、渐变或极光背景。',
      },
    ],
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.backdrop === 'gradient'
          ? null
          : `backdrop should be gradient, got ${String(c.theme.backdrop)}`,
    },
  },
  {
    id: 'DR3-en',
    input: 'A bit more',
    locale: 'en',
    setup: 'default',
    mock: false,
    earlier: [{ input: 'Make the text bigger', ops: [{ op: 'setTheme', fontScale: 1.15 }] }],
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.fontScale > 1.15
          ? null
          : `fontScale should grow past 1.15, got ${c.theme.fontScale}`,
    },
  },
  {
    id: 'DR4',
    input: '首页标题改成「工具箱」',
    locale: 'zh',
    setup: 'default',
    mock: false,
    earlier: [{ input: '主题色换成蓝色', ops: toBlue }],
    expect: { kind: 'ops', check: all(titled('工具箱'), color(BLUE)) },
  },
  {
    id: 'DR5',
    input: '那先把主题换成绿色',
    locale: 'zh',
    setup: 'default',
    mock: false,
    earlier: [
      {
        input: '添加签证照片快捷操作',
        notDone:
          '草稿里只改外观。快捷操作、工具和数据表要在「修改这个 App」里改：会直接生效，可以撤销。',
      },
    ],
    expect: {
      kind: 'ops',
      check: all(color('#2F9E44'), (c) =>
        c.workflows.length === 0 ? null : 'the quick action should not be added in the draft',
      ),
    },
  },
];

const FILE_ENTRY_CASES: EvalCase[] = [
  ['FE1', '首页加上打开相册', 'zh', 'media'],
  ['FE2', 'Add a file picker to home', 'en', 'files'],
].map(([id, input, locale, source]) => ({
  id: id!,
  input: input!,
  locale: locale as Locale,
  setup: 'default',
  mock: true,
  expect: {
    kind: 'ops',
    check: (c) =>
      allComponents(home(c)).some(
        (x) => x.type === 'filePick' && x.props.source === source && !x.hidden,
      )
        ? null
        : 'missing file picker entry',
  },
}));

const VIDEO_MERGE_CASES: EvalCase[] = [
  {
    id: 'VM1',
    input: '添加把几段视频拼成一段快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps.some((s) => s.action === 'file.order') &&
            w.steps.some((s) => s.action === 'video.merge'),
        )
          ? null
          : 'missing video merge and order',
    },
  },
  {
    id: 'VM2',
    input:
      'Make a quick action to join my holiday video clips into one video. Let me arrange their order first.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps[0]?.action === 'in.videos' &&
            w.steps.findIndex((s) => s.action === 'file.order') > 0 &&
            w.steps.findIndex((s) => s.action === 'video.merge') >
              w.steps.findIndex((s) => s.action === 'file.order'),
        )
          ? null
          : 'missing ordered video merge',
    },
  },
];

const VIDEO_FRAME_CASES: EvalCase[] = [
  {
    id: 'VF1',
    input: '添加从视频里截一张照片快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.frame'))
          ? null
          : 'missing video.frame',
    },
  },
  {
    id: 'VF2',
    input: 'Make a quick action to choose a still frame from a video and save it to Photos.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps[0]?.action === 'in.videos' &&
            w.steps.some((s) => s.action === 'video.frame') &&
            w.steps.some((s) => s.action === 'out.saveToPhotos'),
        )
          ? null
          : 'missing video frame to Photos',
    },
  },
];
const VIDEO_MUTE_CASES: EvalCase[] = [
  {
    id: 'VMU1',
    input: '添加视频去掉声音快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.mute'))
          ? null
          : 'missing video.mute',
    },
  },
  {
    id: 'VMU2',
    input: 'Make a reusable action to remove all sound from my videos before I share them.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps[0]?.action === 'in.videos' && w.steps.some((s) => s.action === 'video.mute'),
        )
          ? null
          : 'missing silent video action',
    },
  },
];
const VIDEO_MUSIC_CASES: EvalCase[] = [
  {
    id: 'VMA1',
    input: '添加给视频换背景音乐快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.audio'))
          ? null
          : 'missing video.audio',
    },
  },
  {
    id: 'VMA2',
    input:
      'Make an action to replace video sound with a music file I choose each time. Keep 20% of the original sound and repeat the music if it is shorter.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps.filter((s) => s.action.startsWith('in.')).length === 1 &&
            w.steps.some(
              (s) =>
                s.action === 'video.audio' &&
                s.params.originalVolume === 20 &&
                s.params.loop === true,
            ),
        )
          ? null
          : 'missing runtime music with requested parameters',
    },
  },
];
const VIDEO_ROTATE_CASES: EvalCase[] = [
  {
    id: 'VR1',
    input: '添加把视频转正快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.rotate'))
          ? null
          : 'missing video.rotate',
    },
  },
  {
    id: 'VR2',
    input: 'Make an action to turn my upside-down videos 180 degrees, keeping the sound.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some((s) => s.action === 'video.rotate' && s.params.degrees === 180),
        )
          ? null
          : 'missing 180 degree rotation',
    },
  },
];
const VIDEO_CROP_CASES: EvalCase[] = [
  {
    id: 'VC1',
    input: '添加裁成竖屏视频快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.crop'))
          ? null
          : 'missing video.crop',
    },
  },
  {
    id: 'VC2',
    input: 'Make an action to center-crop videos into 1:1 squares, keeping their sound.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some((s) => s.action === 'video.crop' && s.params.ratio === '1:1'),
        )
          ? null
          : 'missing square video crop',
    },
  },
];
const VIDEO_SPEED_CASES: EvalCase[] = [
  {
    id: 'VS1',
    input: '添加视频加速或慢放快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.speed'))
          ? null
          : 'missing video.speed',
    },
  },
  {
    id: 'VS2',
    input: 'Make an action that plays videos at half speed (0.5x).',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some((s) => s.action === 'video.speed' && s.params.factor === 0.5),
        )
          ? null
          : 'missing half-speed video',
    },
  },
];
const AUDIO_VOLUME_CASES: EvalCase[] = [
  {
    id: 'AVL1',
    input: '添加把录音调到正常音量快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some((s) => s.action === 'audio.volume' && s.params.mode === 'normal'),
        )
          ? null
          : 'missing normal volume',
    },
  },
  {
    id: 'AVL2',
    input:
      'Make an action to bring the sound in my quiet videos up to normal volume. Keep the picture.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps[0]?.action === 'in.videos' &&
            w.steps.some((s) => s.action === 'audio.volume' && s.params.mode === 'normal') &&
            !w.steps.some((s) => s.action === 'audio.fromVideo'),
        )
          ? null
          : 'missing video volume without dropping picture',
    },
  },
  {
    id: 'AVL3',
    input: 'Make a reusable action to make recordings 6 dB louder.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some(
            (s) => s.action === 'audio.volume' && s.params.mode === 'db' && s.params.db === 6,
          ),
        )
          ? null
          : 'missing +6dB gain',
    },
  },
];
const AUDIO_DENOISE_CASES: EvalCase[] = [
  {
    id: 'ADN1',
    input: '添加录音人声降噪快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'audio.denoise'))
          ? null
          : 'missing speech noise reduction',
    },
  },
  {
    id: 'ADN2',
    input:
      'Make an action to reduce background noise in spoken videos. Keep the video picture, do not transcribe it.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps[0]?.action === 'in.videos' &&
            w.steps.some((s) => s.action === 'audio.denoise') &&
            !w.steps.some((s) => ['audio.fromVideo', 'audio.transcribe'].includes(s.action)),
        )
          ? null
          : 'missing video denoise preserving video',
    },
  },
];
const IMAGE_BACKGROUND_CASES: EvalCase[] = [
  {
    id: 'IBG1',
    input: '添加把照片背景去掉快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some(
            (s) => s.action === 'image.removeBackground' && s.params.background === 'transparent',
          ),
        )
          ? null
          : 'missing transparent background removal',
    },
  },
  {
    id: 'IBG2',
    input:
      'Make a reusable action to cut out the subjects in photos and put them on a white background.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some(
            (s) =>
              s.action === 'image.removeBackground' &&
              s.params.background === 'color' &&
              String(s.params.color).toUpperCase() === '#FFFFFF',
          ),
        )
          ? null
          : 'missing white background removal',
    },
  },
];
const IMAGE_ADJUST_CASES: EvalCase[] = [
  {
    id: 'IAD1',
    input: '添加把太暗的照片调亮快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some(
            (s) =>
              s.action === 'image.adjust' &&
              s.params.mode === 'manual' &&
              Number(s.params.brightness) > 0,
          ),
        )
          ? null
          : 'missing photo brightening',
    },
  },
  {
    id: 'IAD2',
    input:
      'Make a reusable photo adjustment: brightness +20, contrast 110, saturation 90. Keep the pixel dimensions.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) =>
          w.steps.some(
            (s) =>
              s.action === 'image.adjust' &&
              s.params.mode === 'manual' &&
              s.params.brightness === 20 &&
              s.params.contrast === 110 &&
              s.params.saturation === 90,
          ),
        )
          ? null
          : 'missing exact color adjustment parameters',
    },
  },
];
const IMAGE_ANNOTATE_CASES: EvalCase[] = [
  {
    id: 'IAN1',
    input: '添加在图片上画箭头和文字快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'image.annotate'))
          ? null
          : 'missing local photo annotations',
    },
  },
  {
    id: 'IAN2',
    input:
      'Make a reusable action where I choose photos and draw arrows, outline boxes, freehand strokes and type labels on them myself when I run it.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'image.annotate'))
          ? null
          : 'missing local annotation editor',
    },
  },
];
const VIDEO_SUBTITLE_CASES: EvalCase[] = [
  {
    id: 'VST1',
    input: '添加导出视频 SRT 字幕快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some((w) => w.steps.some((s) => s.action === 'video.subtitles'))
          ? null
          : 'missing SRT captions',
    },
  },
  {
    id: 'VST2',
    input:
      'Make an action to generate separate SRT subtitle files from my English-speaking videos. Recognize speech on this device; I will load the SRT in a video player.',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            w.steps[0]?.action === 'in.videos' &&
            w.steps.some((s) => s.action === 'video.subtitles' && s.params.lang === 'en') &&
            !w.steps.some((s) => s.action === 'audio.fromVideo'),
        )
          ? null
          : 'missing local English video captions',
    },
  },
];
const QUICK_ACTION_ENTRY_CASES: EvalCase[] = [
  {
    id: 'QAC1',
    input: '首页加上Morph 可以做什么',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some(
          (p) =>
            p.id === 'home' &&
            allComponents(p).some(
              (x) =>
                ((x.type === 'shortcut' || x.type === 'button') &&
                  x.props.target === 'quickActions') ||
                // 把分类入口直接放在首页也算（D-230）。
                (x.type === 'quickActionList' && !x.props.kind),
            ),
        )
          ? null
          : 'missing quickActions home entry',
    },
  },
  {
    id: 'QAC2',
    input: 'Add What Morph can do to home',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some(
          (p) =>
            p.id === 'home' &&
            allComponents(p).some(
              (x) =>
                ((x.type === 'shortcut' || x.type === 'button') &&
                  x.props.target === 'quickActions') ||
                // 把分类入口直接放在首页也算（D-230）。
                (x.type === 'quickActionList' && !x.props.kind),
            ),
        )
          ? null
          : 'missing quickActions home entry',
    },
  },
];
// ---- 外观选项（D-230）----
const homeEntries = (c: WorkspaceConfig) =>
  allComponents(home(c)).filter(
    (x) => x.type === 'shortcut' || x.type === 'toolCard' || x.type === 'catalogLink',
  );
/** 首页所有入口卡片都是这个样子（至少有一个）。 */
const entriesLook = (look: 'row' | 'tile') => (c: WorkspaceConfig) => {
  const entries = homeEntries(c);
  return entries.length > 0 && entries.every((x) => (x.props as { look?: string }).look === look)
    ? null
    : `home entries should all be ${look}: ${JSON.stringify(entries.map((x) => x.props))}`;
};
const quickActionListOn = (kind: string) => (c: WorkspaceConfig) =>
  allComponents(home(c)).some((x) => x.type === 'quickActionList' && x.props.kind === kind)
    ? null
    : `missing a ${kind} quickActionList on home`;

/** 工时、睡眠这类表（D-279、D-280）：两个时间或日期时间字段，一个用 hours() / minutes() 算时长的公式。 */
function workHoursProblem(c: WorkspaceConfig, needsBreak = true): string | null {
  const table = c.collections.find(
    (x) => x.fields.filter((f) => f.type === 'time' || f.type === 'datetime').length >= 2,
  );
  if (!table)
    return `expected a table with two time or datetime fields: ${JSON.stringify(c.collections)}`;
  const formula = table.fields.find(
    (f) => f.type === 'formula' && /\b(hours|minutes)\(/.test(f.expression),
  );
  if (!formula)
    return `expected a formula using hours() or minutes(): ${JSON.stringify(table.fields)}`;
  if (needsBreak && !table.fields.some((f) => f.type === 'duration' || f.type === 'number'))
    return `expected a duration (or number) field for the break: ${JSON.stringify(table.fields)}`;
  return null;
}

const LOOK_CASES: EvalCase[] = [
  {
    id: 'LK1',
    input: '图标改成浅色底',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.iconStyle === 'tint' ? null : `iconStyle ${c.theme.iconStyle}`),
    },
  },
  {
    id: 'LK1-en',
    input: 'Use solid icon backgrounds',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => (c.theme.iconStyle === 'solid' ? null : `iconStyle ${c.theme.iconStyle}`),
    },
  },
  {
    id: 'LK2',
    input: '首页入口改成列表',
    locale: 'zh',
    setup: 'pdf',
    mock: false,
    expect: { kind: 'ops', check: entriesLook('row') },
  },
  {
    id: 'LK2-en',
    input:
      'Make the entries on the home page list rows like in Settings, with an arrow on the right',
    locale: 'en',
    setup: 'pdf',
    mock: false,
    expect: { kind: 'ops', check: entriesLook('row') },
  },
  {
    id: 'LK3',
    input: '把 PDF 页面上的快捷操作改成一行一行的列表，右边有播放按钮',
    locale: 'zh',
    setup: 'pdf',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const runners = allComponents(c.pages.find((p) => p.id === 'tool-pdf')!).filter(
          (x) => x.type === 'workflowRunner',
        );
        return runners.length > 0 &&
          runners.every((x) => x.type === 'workflowRunner' && x.props.look === 'row')
          ? null
          : 'PDF quick actions should all be rows';
      },
    },
  },
  {
    id: 'LK4',
    input: '工具箱页面上的「管理工具」按钮改成只显示一个图标',
    locale: 'zh',
    setup: 'starter',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const button = allComponents(c.pages.find((p) => p.id === 'toolbox')!).find(
          (x) => x.id === 'toolbox-manage',
        );
        return button?.type === 'button' && button.props.variant === 'icon' && button.props.icon
          ? null
          : `manage button is ${JSON.stringify(button)}`;
      },
    },
  },
  {
    id: 'LK5',
    input: '首页加上照片快捷操作',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: quickActionListOn('image') },
  },
  {
    id: 'LK5-en',
    input: 'Show my video quick actions right on the home page',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: quickActionListOn('video') },
  },
];
// 新手引导第 1 步（D-231）：空白首页上加两个文件入口。中英文走内置规则，法语交给模型。
const twoFilePicks = (c: WorkspaceConfig) => {
  const picks = allComponents(home(c)).filter((x) => x.type === 'filePick');
  const sources = picks.map((x) => (x.type === 'filePick' ? x.props.source : '')).sort();
  return sources.join(',') === 'files,media' ? null : `file pickers on home: ${sources.join(',')}`;
};
const GUIDE_STEP_CASES: EvalCase[] = [
  {
    id: 'GD1',
    input: '加入「打开相册」和「打开文件」按钮',
    locale: 'zh',
    setup: 'starter',
    mock: true,
    expect: { kind: 'ops', check: twoFilePicks },
  },
  {
    id: 'GD1-fr',
    input: 'Ajouter les boutons « Ouvrir les photos » et « Ouvrir les fichiers »',
    locale: 'fr',
    setup: 'starter',
    mock: false,
    expect: { kind: 'ops', check: twoFilePicks },
  },
];
const FRENCH_CASES: readonly EvalCase[] = [
  {
    id: 'FR1',
    locale: 'fr',
    setup: 'default',
    mock: false,
    input:
      'Créez une action rapide pour choisir des photos, réduire chaque image à 500 Ko maximum, puis les partager.',
    expect: {
      kind: 'ops',
      check: (c) =>
        c.workflows.some(
          (w) =>
            (w.steps[0]?.action === 'in.photos' ||
              (w.steps[0]?.action === 'in.files' && w.steps[0]?.params.accept === 'images')) &&
            w.steps.some((s) => s.action === 'image.compress' && s.params.maxKB === 500) &&
            w.steps.some((s) => s.action === 'out.share'),
        )
          ? null
          : 'missing photo compression/share workflow',
    },
  },
  // 法语引导的第 1 步句子：内置规则不认法语，交给真模型（guide/store.ts）。
  {
    id: 'FR4',
    locale: 'fr',
    setup: 'default',
    mock: false,
    input: 'Passer au style Néon',
    expect: {
      kind: 'ops',
      check: (c) =>
        c.theme.cardStyle === 'glow' ? null : `expected the neon preset, got ${c.theme.cardStyle}`,
    },
  },
  {
    id: 'FR5',
    locale: 'fr',
    setup: 'default',
    mock: false,
    input:
      'Renommer la page d’accueil «\u00a0Bureau des fichiers\u00a0». Changer la couleur du thème en vert',
    expect: {
      kind: 'ops',
      check: (c) => {
        const title = titled('Bureau des fichiers')(c);
        if (title) return title;
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.theme.primaryColor.slice(i, i + 2), 16));
        return g! > r! && g! > b! ? null : `primary should be green, got ${c.theme.primaryColor}`;
      },
    },
  },
  {
    id: 'FR2',
    locale: 'fr',
    setup: 'default',
    mock: false,
    input: 'Envoyez ces photos à ma mère par e-mail maintenant.',
    expect: { kind: 'reject', reason: 'errand' },
  },
  {
    id: 'FR3',
    locale: 'fr',
    setup: 'default',
    mock: false,
    input:
      'Je voudrais créer un carnet de dépenses pour noter la date, le montant et la catégorie.',
    expect: {
      kind: 'ops',
      check: (c) =>
        c.collections.some((collection) =>
          collection.fields.some((f) => f.type === 'money' && f.currency === 'EUR'),
        )
          ? null
          : 'French expense table must use EUR',
    },
  },
];
const EXPERIENCE_CASES: readonly EvalCase[] = [
  {
    id: 'XP1',
    locale: 'zh',
    setup: 'default',
    mock: false,
    input: '我想逐字修改 PDF 里已经印好的文字，保留原来的排版。',
    expect: {
      kind: 'reject',
      reason: 'unknown',
      message: (m) =>
        /分享/.test(m) && /Morph/i.test(m)
          ? null
          : 'must suggest specialized editing and sharing back to Morph',
    },
  },
  {
    id: 'XP2',
    locale: 'en',
    setup: 'default',
    mock: false,
    input: 'Build a multi-track video editing timeline with keyframes and transitions.',
    expect: {
      kind: 'reject',
      reason: 'unknown',
      message: (m) =>
        /shar/i.test(m) && /Morph/.test(m)
          ? null
          : 'must suggest sharing the edited file back to Morph',
    },
  },
  {
    id: 'XP3',
    locale: 'fr',
    setup: 'default',
    mock: false,
    input:
      'Je veux retoucher les visages avec un pinceau pour effacer les rides et modifier la forme du nez.',
    expect: {
      kind: 'reject',
      reason: 'unknown',
      message: (m) =>
        /partag/i.test(m) && /Morph/.test(m)
          ? null
          : 'must suggest sharing the edited file back to Morph',
    },
  },
  {
    id: 'XP4',
    locale: 'zh',
    setup: 'default',
    mock: false,
    input: '按这个顺序合成一个快捷操作，中间不用重新选择文件。',
    about: { kind: 'chain', first: 'resize-first', second: 'pdf-second' },
    earlier: [
      {
        input: '添加两个快捷操作',
        ops: [
          {
            op: 'addWorkflow',
            workflow: {
              id: 'resize-first',
              name: '照片缩小',
              steps: [
                {
                  id: 'input',
                  action: 'in.photos',
                  params: { source: 'library', min: 1, max: 10 },
                },
                { id: 'resize', action: 'image.resize', params: { mode: 'longEdge', px: 1600 } },
              ],
            },
          },
          {
            op: 'addWorkflow',
            workflow: {
              id: 'pdf-second',
              name: '照片转 PDF',
              steps: [
                {
                  id: 'input',
                  action: 'in.photos',
                  params: { source: 'library', min: 1, max: 10 },
                },
                {
                  id: 'pdf',
                  action: 'pdf.fromImages',
                  params: {
                    pageSize: 'a4',
                    orientation: 'auto',
                    marginMm: 10,
                    fit: 'contain',
                    maxMB: 4,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    expect: {
      kind: 'ops',
      plan: (p) => (p.homeEntry === false ? null : 'must not add a home entry'),
      check: (c) => {
        if (
          !c.workflows.some((w) => w.id === 'resize-first') ||
          !c.workflows.some((w) => w.id === 'pdf-second')
        )
          return 'original actions must remain';
        const added = c.workflows.find((w) => !['resize-first', 'pdf-second'].includes(w.id));
        return added &&
          added.steps.filter((step) => step.action.startsWith('in.')).length === 1 &&
          added.steps[0]?.action === 'in.photos' &&
          added.steps[1]?.action === 'image.resize' &&
          added.steps[1]?.params.px === 1600 &&
          added.steps[2]?.action === 'pdf.fromImages' &&
          added.steps[2]?.params.maxMB === 4
          ? null
          : 'must combine first resize then PDF without a second picker';
      },
    },
  },
];
// ---- 条件、分组和文字加工（D-242 起）：只给真实模型跑 ----
const MODULE_EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'FX1',
    input: '新建一个快捷操作：选照片，只要最近 7 天拍的，打包成 ZIP',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'file.filter', 'zip.create'],
        (steps) =>
          param('file.filter', 'date', 'lastDays')(steps) ?? param('file.filter', 'days', 7)(steps),
      ),
    },
  },
  {
    id: 'FX2',
    input: 'Make a quick action: choose files, skip anything over 10 MB, then share them',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.files', 'file.filter', 'out.share'],
        (steps) =>
          param('file.filter', 'size', 'smaller')(steps) ??
          param('file.filter', 'sizeMB', 10)(steps),
      ),
    },
  },
  {
    id: 'FX3',
    input:
      'Crée une action rapide : choisir des photos, garder seulement celles de ce mois-ci en paysage, puis les partager',
    locale: 'fr',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'file.filter', 'out.share'],
        (steps) =>
          param('file.filter', 'period', 'thisMonth')(steps) ??
          param('file.filter', 'orientation', 'landscape')(steps),
      ),
    },
  },
  {
    id: 'GR1',
    input: '新建一个快捷操作：选照片，按拍摄日期每天做成一个 PDF',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'pdf.fromImages'], param('pdf.fromImages', 'group', 'day')),
    },
  },
  {
    id: 'GR2',
    input: 'Make a quick action that zips my files, 10 per ZIP',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.files', 'zip.create'],
        (steps) =>
          param('zip.create', 'group', 'count')(steps) ??
          param('zip.create', 'groupSize', 10)(steps),
      ),
    },
  },
  {
    id: 'ON1',
    input: '新建一个快捷操作：拍收据，用收据上的日期和金额命名，存到文件',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'file.rename'], (steps) => {
        const template = String(steps.find((s) => s.action === 'file.rename')?.params.template);
        return /\{ocr:date\}/.test(template) && /\{ocr:amount\}/.test(template)
          ? null
          : `template should use {ocr:date} and {ocr:amount}, got ${template}`;
      }),
    },
  },
  {
    id: 'ON2',
    input: 'Make a quick action that names each invoice photo by its invoice number',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(['in.photos', 'file.rename'], (steps) => {
        const rename = steps.find((s) => s.action === 'file.rename');
        return String(rename?.params.template).includes('{ocr:invoiceNo}')
          ? null
          : `template should use {ocr:invoiceNo}, got ${String(rename?.params.template)}`;
      }),
    },
  },
  {
    id: 'TX1',
    input: '新建一个快捷操作：拍名片，识别文字，取出所有手机号，复制',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'ocr.recognize', 'text.extract', 'text.copy'],
        param('text.extract', 'kind', 'phone'),
      ),
    },
  },
  {
    id: 'TX2',
    input:
      'Make a quick action: type text, replace "ACME" with "Globex", remove blank lines, save as a PDF',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.text', 'text.replace', 'text.tidy', 'text.toPdf'],
        (steps) =>
          param('text.replace', 'find', 'ACME')(steps) ??
          param('text.replace', 'replaceWith', 'Globex')(steps),
      ),
    },
  },
  {
    id: 'FM1',
    input: '给记账表加一个「实付」公式字段：金额满 100 打九折，不满不打折',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const formula = c.collections.flatMap((x) => x.fields).find((f) => f.type === 'formula');
        return formula?.type === 'formula' && /^\s*if\(/.test(formula.expression)
          ? null
          : `expected a formula field using if(…), got ${JSON.stringify(formula)}`;
      },
    },
  },
  {
    id: 'FM2',
    input:
      'Add a “Days left” formula to the budget table that counts the days from today until the date',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const formula = c.collections.flatMap((x) => x.fields).find((f) => f.type === 'formula');
        return formula?.type === 'formula' &&
          /days\(\s*today\s*,\s*\{[a-z0-9-]+\}\s*\)/.test(formula.expression)
          ? null
          : `expected days(today, {date}), got ${JSON.stringify(formula)}`;
      },
    },
  },
  {
    id: 'FM3',
    input: '给记账表加一个公式字段，把金额四舍五入到整数',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const formula = c.collections.flatMap((x) => x.fields).find((f) => f.type === 'formula');
        return formula?.type === 'formula' && /round\(/.test(formula.expression)
          ? null
          : `expected a formula using round(…), got ${JSON.stringify(formula)}`;
      },
    },
  },
  {
    id: 'TM1',
    input: '做一个上下班打卡的表：记上班时间、下班时间和中间休息多久，自动算出每天工作几个小时',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: (c) => workHoursProblem(c) },
  },
  {
    id: 'TM2',
    input: 'Make a sleep log: when I went to bed, when I woke up, and how many hours I slept',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: { kind: 'ops', check: (c) => workHoursProblem(c, false) },
  },
  {
    id: 'SG1',
    input: '记账页面加一个统计：每个分类一共花了多少',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some((p) =>
          allComponents(p).some(
            (x) =>
              x.type === 'stat' && x.props.groupBy !== undefined && x.props.aggregate === 'sum',
          ),
        )
          ? null
          : 'expected a stat with groupBy and aggregate sum',
    },
  },
  {
    id: 'CH1',
    input: '记账页面加一个柱状图，显示最近 12 个月每月花了多少',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some((p) =>
          allComponents(p).some(
            (x) =>
              x.type === 'chart' &&
              x.props.kind === 'bar' &&
              x.props.group === 'month' &&
              x.props.aggregate === 'sum' &&
              x.props.periods === 12,
          ),
        )
          ? null
          : 'expected a monthly bar chart of sums over 12 periods',
    },
  },
  {
    id: 'CH2',
    input: 'Add a pie chart of spending by category to the budget page',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some((p) =>
          allComponents(p).some(
            (x) => x.type === 'chart' && x.props.kind === 'pie' && x.props.group === 'choice',
          ),
        )
          ? null
          : 'expected a pie chart grouped by a choice field',
    },
  },
  {
    id: 'BG1',
    input: '首页用一张照片做背景，遮罩深一点',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        home(c).backdrop?.overlay === 'strong' && !home(c).backdrop?.assetId
          ? null
          : 'expected a strong page backdrop on home without a picture',
    },
  },
  {
    id: 'BG2',
    input: 'Add a tip card at the top of home saying "Drink water" with a picture background',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        home(c).components.some(
          (x) => x.type === 'notice' && x.style?.backdrop && !x.style.backdrop.assetId,
        )
          ? null
          : 'expected a notice with style.backdrop and no picture',
    },
  },
  {
    id: 'FS1',
    input: '首页放一个租房合同的入口，点一下就能打开合同',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const slots = c.pages.flatMap((p) => allComponents(p)).filter((x) => x.type === 'fileSlot');
        if (slots.length === 0) return 'expected a fileSlot';
        return slots.some((x) => x.props.assetId) ? 'the AI must not pick a file' : null;
      },
    },
  },
  {
    id: 'FS2',
    input: 'Add a spot on my home page for my boarding pass so I can open it quickly',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        home(c).components.some(
          (x) => x.type === 'fileSlot' && !x.props.assetId && /board/i.test(x.props.title),
        )
          ? null
          : 'expected an empty fileSlot on home titled after the boarding pass',
    },
  },
  {
    id: 'LK1',
    input: '新建一张「客户」表（名字、电话），给记账表加一个字段，选这笔账是哪个客户的',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) => {
        const link = c.collections.flatMap((x) => x.fields).find((f) => f.type === 'link');
        return link?.type === 'link' && c.collections.some((x) => x.id === link.collectionId)
          ? null
          : 'expected a link field pointing at the new clients table';
      },
    },
  },
  {
    id: 'RM1',
    input: '每天晚上 9 点提醒我记账',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        (c.reminders ?? []).some((r) => r.schedule === 'daily' && r.time === '21:00' && r.enabled)
          ? null
          : `expected a daily 21:00 reminder, got ${JSON.stringify(c.reminders)}`,
    },
  },
  {
    id: 'RM2',
    input: 'Remind me 3 days before each date in my budget table, at 8am',
    locale: 'en',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        (c.reminders ?? []).some(
          (r) => r.schedule === 'dateField' && r.daysBefore === 3 && r.time === '08:00',
        )
          ? null
          : `expected a dateField reminder 3 days before at 08:00, got ${JSON.stringify(c.reminders)}`,
    },
  },
  {
    id: 'RM3',
    input: '每天早上 8 点自动运行签证照片快捷操作',
    locale: 'zh',
    setup: 'visa',
    mock: false,
    // 不能自动运行（P-043）：只能做一个打开它的提醒，并在说明里讲清楚。
    expect: {
      kind: 'ops',
      check: (c) =>
        (c.reminders ?? []).some((r) => r.opens.startsWith('workflow:') && r.time === '08:00')
          ? null
          : 'expected a reminder that opens the quick action at 08:00',
      plan: (p) =>
        (p.notes ?? []).length > 0 ? null : 'expected a note that it will not run by itself',
    },
  },
  {
    id: 'IDP1',
    input: '新建一个快捷操作：选照片，做成一寸蓝底证件照，自动框脸',
    locale: 'zh',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.idPhoto'],
        (steps) =>
          param('image.idPhoto', 'spec', 'cn-1inch')(steps) ??
          param('image.idPhoto', 'background', 'blue')(steps) ??
          param('image.idPhoto', 'autoCenter', true)(steps),
      ),
    },
  },
  {
    id: 'IDP2',
    input: 'Make a quick action for a US visa photo on a white background',
    locale: 'en',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: hasWorkflow(
        ['in.photos', 'image.idPhoto'],
        (steps) =>
          param('image.idPhoto', 'spec', 'us-passport')(steps) ??
          param('image.idPhoto', 'background', 'white')(steps),
      ),
    },
  },
];

// ---- 手机桌面（D-271）：「放到桌面 / 主屏幕 / home screen / écran d'accueil」是手机桌面，「首页」仍是首页（D-109）----

const onHomeScreen = (c: WorkspaceConfig) => c.workflows.filter((w) => w.homeScreen);
const visaOnHomeScreen = (c: WorkspaceConfig) =>
  visa(c)?.homeScreen
    ? null
    : `the visa quick action should be on the home screen, got ${
        onHomeScreen(c)
          .map((w) => w.id)
          .join(',') || 'none'
      }`;
/** 只放到桌面，没有顺手在首页加卡片。 */
const noNewHomeRunner = (c: WorkspaceConfig) =>
  allComponents(home(c)).some(
    (x) => x.type === 'workflowRunner' && x.props.workflowId === visa(c)?.id,
  )
    ? 'the home screen request also put a card on the home page'
    : null;
const visaOnHomePageOnly = (c: WorkspaceConfig) =>
  !allComponents(home(c)).some(
    (x) => x.type === 'workflowRunner' && x.props.workflowId === visa(c)?.id,
  )
    ? 'no runner for the visa quick action on the home page'
    : onHomeScreen(c).length > 0
      ? `“home page” must not put anything on the phone home screen, got ${onHomeScreen(c)
          .map((w) => w.id)
          .join(',')}`
      : null;

/** 打卡表上的统计（D-284）。 */
const habitStat =
  (want: (props: Record<string, unknown>) => boolean, what: string) => (c: WorkspaceConfig) =>
    c.pages.some((p) =>
      allComponents(p).some(
        (x) => x.type === 'stat' && x.props.collectionId === 'checkins' && want(x.props),
      ),
    )
      ? null
      : `expected a stat on checkins with ${what}`;

const SEQUENCE_CASES: readonly EvalCase[] = [
  {
    id: 'ST1',
    input: '给每个习惯显示连续天数',
    locale: 'zh',
    setup: 'habits',
    mock: false,
    expect: {
      kind: 'ops',
      check: habitStat(
        (p) => p.aggregate === 'streak' && p.groupBy === 'habit' && (p.unit ?? 'day') === 'day',
        'aggregate streak grouped by habit',
      ),
    },
  },
  {
    id: 'ST2-en',
    input:
      'Show my streak for each habit, where a week counts when I do it at least 3 times; weeks marked Skipped shouldn’t break it',
    locale: 'en',
    setup: 'habits',
    mock: false,
    expect: {
      kind: 'ops',
      check: habitStat(
        (p) =>
          p.aggregate === 'streak' &&
          p.groupBy === 'habit' &&
          p.unit === 'week' &&
          p.perUnit === 3 &&
          p.skipField === 'status' &&
          p.skipOption === 'skip',
        'a weekly streak of 3 per habit, skipping status = skip',
      ),
    },
  },
  {
    id: 'ST3-fr',
    input: 'Affiche depuis combien de jours je n’ai pas fait chaque habitude',
    locale: 'fr',
    setup: 'habits',
    mock: false,
    expect: {
      kind: 'ops',
      check: habitStat(
        (p) => p.aggregate === 'daysSince' && p.groupBy === 'habit',
        'aggregate daysSince grouped by habit',
      ),
    },
  },
  {
    id: 'ST4',
    input: '习惯页面加一个柱状图：最近 8 周每周打卡了几天',
    locale: 'zh',
    setup: 'habits',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.pages.some((p) =>
          allComponents(p).some(
            (x) =>
              x.type === 'chart' &&
              x.props.aggregate === 'distinctDays' &&
              x.props.group === 'week' &&
              (x.props.periods ?? 8) === 8,
          ),
        )
          ? null
          : 'expected a weekly chart of distinctDays',
    },
  },
  {
    id: 'CAL1',
    input: '一天从凌晨 2 点开始算',
    locale: 'zh',
    setup: 'habits',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.calendar?.dayStartHour === 2
          ? null
          : `expected calendar.dayStartHour 2, got ${JSON.stringify(c.calendar)}`,
    },
  },
  {
    id: 'CAL2-en',
    input: 'My weeks start on Sunday',
    locale: 'en',
    setup: 'habits',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        c.calendar?.weekStart === 'sunday' && c.calendar.dayStartHour === undefined
          ? null
          : `expected only calendar.weekStart sunday, got ${JSON.stringify(c.calendar)}`,
    },
  },
];

/** 日程（D-292–D-296）：有一个日程字段；want 检查它和用到它的列表。 */
function scheduleProblem(
  c: WorkspaceConfig,
  want: {
    lastDone?: boolean;
    due?: 'today' | 'overdue' | 'thisWeek';
    sortAsc?: boolean;
    rule?: (rule: Record<string, unknown> | undefined) => boolean;
  },
): string | null {
  const table = c.collections.find((t) => t.fields.some((f) => f.type === 'schedule'));
  const field = table?.fields.find((f) => f.type === 'schedule');
  if (!table || field?.type !== 'schedule') return 'expected a table with a schedule field';
  if (want.rule && !want.rule(field.default as Record<string, unknown> | undefined))
    return `unexpected default rule ${JSON.stringify(field.default)}`;
  if (want.lastDone) {
    const source = table.fields.find((f) => f.id === field.lastDone);
    if (source?.type !== 'date' && source?.type !== 'datetime')
      return `expected lastDone on a date field, got ${JSON.stringify(field)}`;
  }
  const props = c.pages.flatMap((p) =>
    allComponents(p).flatMap((x) =>
      x.type === 'recordList' && x.props.collectionId === table.id
        ? [x.props as Record<string, unknown>]
        : [],
    ),
  );
  if (
    want.due &&
    !props.some((p) =>
      ((p.filter ?? []) as { field: string; op: string; value?: unknown }[]).some(
        (f) => f.field === field.id && f.op === 'due' && f.value === want.due,
      ),
    )
  )
    return `expected a list of ${table.id} filtered with due ${want.due}`;
  if (
    want.sortAsc &&
    !props.some((p) => {
      const sort = p.sort as { field: string; direction: string } | undefined;
      return sort?.field === field.id && sort.direction === 'asc';
    })
  )
    return `expected a list of ${table.id} sorted by ${field.id} ascending`;
  return null;
}

const SCHEDULE_CASES: readonly EvalCase[] = [
  {
    id: 'SC1',
    input: '做一个浇水的表：每盆植物每 7 天浇一次，首页列出今天该浇的',
    locale: 'zh',
    setup: 'default',
    mock: false,
    next: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        scheduleProblem(c, {
          lastDone: true,
          due: 'today',
          rule: (r) => r?.repeat === 'interval' && r.every === 7,
        }),
    },
  },
  {
    id: 'SC2',
    input: '做一个订阅的表，订阅按月续费，列表按下次扣费日期排',
    locale: 'zh',
    setup: 'default',
    mock: false,
    next: true,
    expect: { kind: 'ops', check: (c) => scheduleProblem(c, { sortAsc: true }) },
  },
  {
    id: 'SC3-en',
    input:
      'Make a chores table where each chore repeats on its own schedule, and show the overdue ones on the home page',
    locale: 'en',
    setup: 'default',
    mock: false,
    next: true,
    expect: { kind: 'ops', check: (c) => scheduleProblem(c, { due: 'overdue' }) },
  },
  {
    id: 'SC4-fr',
    input:
      'Crée un tableau de tâches ménagères à faire 3 fois par semaine, avec la liste de ce qui est à faire cette semaine',
    locale: 'fr',
    setup: 'default',
    mock: false,
    next: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        scheduleProblem(c, {
          due: 'thisWeek',
          rule: (r) => r?.repeat === 'times' && r.per === 'week' && r.count === 3,
        }),
    },
  },
];

/** 某张表的记录列表和统计（所有页面里的）。 */
const componentsOf = (c: WorkspaceConfig, type: string, collectionId: string) =>
  c.pages.flatMap((p) =>
    allComponents(p).filter(
      (x) =>
        x.type === type && (x.props as { collectionId?: string }).collectionId === collectionId,
    ),
  ) as { props: Record<string, unknown> }[];

const hasPeriod = (props: Record<string, unknown>, period: string) =>
  ((props.filter ?? []) as { op: string; value?: unknown }[]).some(
    (f) => f.op === 'inPeriod' && f.value === period,
  );

const VIEW_CASES: readonly EvalCase[] = [
  {
    id: 'VW1',
    input: '心情日记用月历显示，按心情给每天上色',
    locale: 'zh',
    setup: 'views',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        componentsOf(c, 'recordList', 'mood').some(
          (x) => x.props.display === 'calendar' && x.props.colorField === 'feel',
        )
          ? null
          : 'expected a calendar recordList of mood colored by feel',
    },
  },
  {
    id: 'VW1-fr',
    input: 'Affiche mon journal d’humeur sous forme de calendrier du mois',
    locale: 'fr',
    setup: 'views',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        componentsOf(c, 'recordList', 'mood').some((x) => x.props.display === 'calendar')
          ? null
          : 'expected a calendar recordList of mood',
    },
  },
  {
    id: 'VW2-en',
    input: 'In the shifts list, show how long I have been working on a shift that is still open',
    locale: 'en',
    setup: 'views',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        componentsOf(c, 'recordList', 'shifts').some((x) => {
          const f = x.props.trailingFormat as { kind?: string; until?: string } | undefined;
          return x.props.trailingField === 'in' && f?.kind === 'elapsed' && f.until === 'out';
        })
          ? null
          : 'expected trailingField in with trailingFormat elapsed until out',
    },
  },
  {
    id: 'VW3',
    input: '喝水页面显示今天的进度，目标 8 杯',
    locale: 'zh',
    setup: 'views',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        componentsOf(c, 'stat', 'water').some(
          (x) => x.props.goal === 8 && hasPeriod(x.props, 'today'),
        )
          ? null
          : 'expected a water stat filtered today with goal 8',
    },
  },
  {
    id: 'VW4',
    input: '记账页面加一个本月支出，和上月比',
    locale: 'zh',
    setup: 'budget',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        componentsOf(c, 'stat', 'expenses').some(
          (x) => x.props.compare === 'previous' && hasPeriod(x.props, 'thisMonth'),
        )
          ? null
          : 'expected an expenses stat for thisMonth with compare previous',
    },
  },
];

const HOME_SCREEN_CASES: readonly EvalCase[] = [
  {
    id: 'HS1',
    input: '把签证照片放到桌面',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: all(visaOnHomeScreen, noNewHomeRunner) },
  },
  {
    id: 'HS1-en',
    input: 'Put the visa photo on the home screen',
    locale: 'en',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: all(visaOnHomeScreen, noNewHomeRunner) },
  },
  {
    // 内置规则不认法语（P-037），只要求真实模型。
    id: 'HS1-fr',
    input: 'Mets la photo de visa sur l’écran d’accueil',
    locale: 'fr',
    setup: 'visa',
    mock: false,
    expect: { kind: 'ops', check: all(visaOnHomeScreen, noNewHomeRunner) },
  },
  {
    id: 'HS2',
    input: '把签证照片放到首页',
    locale: 'zh',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: visaOnHomePageOnly },
  },
  {
    id: 'HS2-en',
    input: 'Put the visa photo on the home page',
    locale: 'en',
    setup: 'visa',
    mock: true,
    expect: { kind: 'ops', check: visaOnHomePageOnly },
  },
  {
    id: 'HS2-fr',
    input: 'Mets la photo de visa sur l’accueil',
    locale: 'fr',
    setup: 'visa',
    mock: false,
    expect: { kind: 'ops', check: visaOnHomePageOnly },
  },
  {
    // 还没添加的预设：先添加，再放到桌面。
    id: 'HS3',
    input: '把签证照片放到手机主屏幕',
    locale: 'zh',
    setup: 'default',
    mock: true,
    expect: { kind: 'ops', check: visaOnHomeScreen },
  },
  {
    id: 'HS4',
    input: '把签证照片从桌面拿掉',
    locale: 'zh',
    setup: 'visaHomeScreen',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        visa(c) && onHomeScreen(c).length === 0
          ? null
          : 'the visa quick action should stay but leave the home screen',
    },
  },
  {
    id: 'HS4-en',
    input: 'Remove the visa photo from the home screen',
    locale: 'en',
    setup: 'visaHomeScreen',
    mock: true,
    expect: {
      kind: 'ops',
      check: (c) =>
        visa(c) && onHomeScreen(c).length === 0
          ? null
          : 'the visa quick action should stay but leave the home screen',
    },
  },
  {
    id: 'PHS1',
    input: '签证照片那个快捷操作，我想在手机桌面上长按 Morph 就能直接用',
    locale: 'zh',
    setup: 'visa',
    mock: false,
    expect: { kind: 'ops', check: visaOnHomeScreen },
  },
  {
    id: 'PHS2-en',
    input: 'Pin my visa photo shortcut to my phone’s home screen',
    locale: 'en',
    setup: 'visa',
    mock: false,
    expect: { kind: 'ops', check: visaOnHomeScreen },
  },
  {
    // 新做的快捷操作放到桌面：新建和放到桌面一起做（都是功能）。
    id: 'PHS3-fr',
    input:
      'Crée une action rapide pour choisir des photos, les compresser à 500 Ko et les partager, et mets-la sur l’écran d’accueil du téléphone',
    locale: 'fr',
    setup: 'default',
    mock: false,
    expect: {
      kind: 'ops',
      check: (c) =>
        userWorkflows(c).some(
          (w) => w.homeScreen && w.steps.some((st) => st.action === 'image.compress'),
        )
          ? null
          : 'expected the new quick action on the home screen',
    },
  },
];

/** 一张表上某种计算字段（查找、汇总、上一条）满足 want。 */
const relatedField =
  (collectionId: string, want: (f: Field, c: Collection) => boolean, what: string) =>
  (config: WorkspaceConfig) => {
    const c = config.collections.find((x) => x.id === collectionId);
    return c && c.fields.some((f) => want(f, c)) ? null : `expected on ${collectionId}: ${what}`;
  };

/** 这个字段显示在这张表的某个记录列表里。 */
const listed = (collectionId: string, type: Field['type']) => (config: WorkspaceConfig) => {
  const ids = new Set(
    config.collections
      .find((x) => x.id === collectionId)
      ?.fields.filter((f) => f.type === type)
      .map((f) => f.id),
  );
  return config.pages.some((p) =>
    allComponents(p).some(
      (x) =>
        x.type === 'recordList' &&
        x.props.collectionId === collectionId &&
        [x.props.titleField, ...(x.props.subtitleFields ?? []), x.props.trailingField].some(
          (f) => f !== undefined && ids.has(f),
        ),
    ),
  )
    ? null
    : `expected a recordList of ${collectionId} showing its ${type} field`;
};

const RELATED_CASES: readonly EvalCase[] = [
  {
    id: 'RL1',
    input: '给每个习惯显示连续天数',
    locale: 'zh',
    setup: 'linked',
    mock: false,
    next: true,
    expect: {
      kind: 'ops',
      check: all(
        relatedField(
          'habits',
          (f) =>
            f.type === 'rollup' &&
            f.collectionId === 'checkins' &&
            f.linkField === 'habit' &&
            f.aggregate === 'streak',
          'a streak rollup over checkins.habit',
        ),
        listed('habits', 'rollup'),
      ),
    },
  },
  {
    id: 'RL2',
    input: '工时按工作的时薪算工资',
    locale: 'zh',
    setup: 'linked',
    mock: false,
    expect: {
      kind: 'ops',
      check: relatedField(
        'shifts',
        (f, c) => {
          if (f.type !== 'formula') return false;
          const rate = c.fields.find(
            (x) => x.type === 'lookup' && x.linkField === 'job' && x.fieldId === 'rate',
          );
          return (
            !!rate && f.expression.includes(`{${rate.id}}`) && f.expression.includes('{hours}')
          );
        },
        'a formula of hours times a lookup of jobs.rate',
      ),
    },
  },
  {
    id: 'RL3-en',
    input: "Show each client's total order amount",
    locale: 'en',
    setup: 'linked',
    mock: false,
    next: true,
    expect: {
      kind: 'ops',
      check: all(
        relatedField(
          'clients',
          (f) =>
            f.type === 'rollup' &&
            f.collectionId === 'orders' &&
            f.linkField === 'client' &&
            f.aggregate === 'sum' &&
            f.fieldId === 'amount',
          'a sum rollup of orders.amount',
        ),
        listed('clients', 'rollup'),
      ),
    },
  },
  {
    id: 'RL4-fr',
    input: 'Affiche pour chaque client la date de sa dernière commande',
    locale: 'fr',
    setup: 'linked',
    mock: false,
    expect: {
      kind: 'ops',
      check: relatedField(
        'clients',
        (f) =>
          f.type === 'rollup' &&
          f.collectionId === 'orders' &&
          f.aggregate === 'latest' &&
          (f.fieldId === undefined || f.fieldId === 'date'),
        'a latest rollup of the order date',
      ),
    },
  },
  {
    id: 'RL5',
    input: '每次加油显示和上一次之间开了多少公里，两辆车分开算',
    locale: 'zh',
    setup: 'linked',
    mock: false,
    expect: {
      kind: 'ops',
      check: relatedField(
        'fuel',
        (f, c) => {
          if (f.type !== 'formula') return false;
          const prev = c.fields.find(
            (x) => x.type === 'previous' && x.fieldId === 'odometer' && x.groupBy === 'car',
          );
          return (
            !!prev && f.expression.includes(`{${prev.id}}`) && f.expression.includes('{odometer}')
          );
        },
        'a formula of odometer minus a previous odometer grouped by car',
      ),
    },
  },
  {
    id: 'RL6-en',
    input: 'For each habit show how many times I did it this week',
    locale: 'en',
    setup: 'linked',
    mock: false,
    expect: {
      kind: 'ops',
      check: relatedField(
        'habits',
        (f) =>
          f.type === 'rollup' &&
          f.collectionId === 'checkins' &&
          f.aggregate === 'count' &&
          (f.period === 'thisWeek' ||
            (f.filter ?? []).some((x) => x.op === 'inPeriod' && x.value === 'thisWeek')),
        'a count rollup of this week',
      ),
    },
  },
];

export const EVAL_CASES: readonly EvalCase[] = [
  ...SEQUENCE_CASES,
  ...RELATED_CASES,
  ...SCHEDULE_CASES,
  ...VIEW_CASES,
  ...HOME_SCREEN_CASES,
  ...EXPERIENCE_CASES,
  ...FRENCH_CASES,
  ...QUICK_ACTION_ENTRY_CASES,
  ...LOOK_CASES,
  ...GUIDE_STEP_CASES,
  ...VIDEO_SUBTITLE_CASES,
  ...IMAGE_ANNOTATE_CASES,
  ...IMAGE_ADJUST_CASES,
  ...IMAGE_BACKGROUND_CASES,
  ...AUDIO_DENOISE_CASES,
  ...AUDIO_VOLUME_CASES,
  ...VIDEO_SPEED_CASES,
  ...VIDEO_CROP_CASES,
  ...VIDEO_ROTATE_CASES,
  ...VIDEO_MUSIC_CASES,
  ...VIDEO_MUTE_CASES,
  ...VIDEO_FRAME_CASES,
  ...VIDEO_MERGE_CASES,
  ...FILE_ENTRY_CASES,
  ...BASE_EVAL_CASES,
  ...SPLIT_EVAL_CASES,
  ...WORKFLOW_EVAL_CASES,
  ...GOAL_EVAL_CASES,
  ...WORDING_EVAL_CASES,
  ...ABOUT_EVAL_CASES,
  ...VIDEO_EVAL_CASES,
  ...TRANSLATE_EVAL_CASES,
  ...AUDIO_EVAL_CASES,
  ...SPEAK_EVAL_CASES,
  ...TOOLBOX_EVAL_CASES,

  ...FORMAT_EVAL_CASES,
  ...RECORD_EVAL_CASES,
  ...DRAFT_CHAT_EVAL_CASES,
  ...MODULE_EVAL_CASES,
];

export type EvalOutcome = { pass: true } | { pass: false; reason: string };

/**
 * 按 App 的做法跑一个用例（D-191）：计划不能把功能和外观混在一起；要求接着改的用例照着 next 再问一次，
 * 在第一步的结果上套用第二个计划。mock 的测试和真实模型的评测脚本共用。
 */
export async function runEvalCase(
  c: EvalCase,
  provider: AIProvider,
  registry: Registry,
  now: Date,
): Promise<{ outcome: EvalOutcome; plans: Plan[] }> {
  const ctx = { registry, locale: c.locale, now };
  const fail = (reason: string) => ({ pass: false, reason }) as const;
  let config = buildSetup(c.setup, c.locale, registry);
  const earlier: PlanEarlier[] = [];
  for (const e of c.earlier ?? []) {
    if ('notDone' in e) {
      earlier.push({ input: e.input, done: false, reply: e.notDone });
      continue;
    }
    const done = prepareOps(config, e.ops, ctx);
    if (!done.ok) throw new Error(`${c.id}: earlier “${e.input}” does not apply`);
    config = done.after;
    earlier.push({ input: e.input, done: true, reply: done.lines.join('; ') });
  }
  const ask = (input: string, config: WorkspaceConfig) =>
    provider.plan(input, {
      config,
      registry,
      locale: c.locale,
      ...(c.about ? { about: c.about } : {}),
      ...(earlier.length ? { earlier } : {}),
    });
  const plan = await ask(c.input, config);
  const plans = [plan];
  if (plan.kind !== 'ops') return { outcome: judgeEval(c, plan, null), plans };
  const first = functionFirst(config, plan.ops, ctx);
  if (first.kind === 'function' && first.deferred.length > 0) {
    return { outcome: fail('the plan mixes function and look ops (D-191)'), plans };
  }
  let prepared: PreparedChange = prepareOps(config, plan.ops, ctx);
  if (c.next && prepared.ok) {
    if (first.kind !== 'function')
      return { outcome: fail('the first turn should do the function part'), plans };
    if (!plan.next) return { outcome: fail('expected next with the look part'), plans };
    const second = await ask(plan.next, prepared.after);
    plans.push(second);
    if (second.kind !== 'ops') {
      const why = second.kind === 'reject' ? `: ${second.message}` : '';
      return { outcome: fail(`next “${plan.next}” gave ${second.kind}${why}`), plans };
    }
    if (hasFunctionOps(second.ops))
      return { outcome: fail(`next “${plan.next}” should only change the look`), plans };
    prepared = prepareOps(prepared.after, second.ops, ctx);
  }
  return { outcome: judgeEval(c, plan, prepared), plans };
}

/** 判定一个计划是否符合用例预期。afterOrIssues 来自 prepareOps。 */
export function judgeEval(
  c: EvalCase,
  plan: Plan,
  prepared: { ok: true; after: WorkspaceConfig } | { ok: false; issues: string[] } | null,
): EvalOutcome {
  const fail = (reason: string): EvalOutcome => ({ pass: false, reason });
  if (c.expect.kind === 'restorePrevious') {
    return plan.kind === 'restorePrevious'
      ? { pass: true }
      : fail(`expected restorePrevious, got ${plan.kind}`);
  }
  if (c.expect.kind === 'reject') {
    if (plan.kind !== 'reject') return fail(`expected reject, got ${plan.kind}`);
    if (c.expect.reason && plan.reason !== c.expect.reason) {
      return fail(`expected reject reason ${c.expect.reason}, got ${plan.reason}`);
    }
    const messageProblem = c.expect.message?.(plan.message);
    return messageProblem ? fail(messageProblem) : { pass: true };
  }
  if (plan.kind !== 'ops')
    return fail(
      `expected ops, got ${plan.kind}${plan.kind === 'reject' ? `: ${plan.message}` : ''}`,
    );
  if (!prepared) return fail('ops were not prepared');
  if (!prepared.ok) return fail(`invalid ops: ${prepared.issues.join('; ')}`);
  const problem = c.expect.check(prepared.after) ?? c.expect.plan?.(plan) ?? null;
  return problem ? fail(problem) : { pass: true };
}
