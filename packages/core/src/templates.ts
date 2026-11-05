import { localize } from './localization';
import type { Op, OpOf } from './ops-schema';
import {
  HOME_PAGE_ID,
  allComponents,
  componentCollection,
  pageTarget,
  type Collection,
  type Locale,
  type Page,
  type WorkspaceConfig,
} from './schema';
import bank from './templates/bank.json';
import education from './templates/education.json';
import identity from './templates/identity.json';
import insurance from './templates/insurance.json';
import lab from './templates/lab.json';
import lease from './templates/lease.json';
import loan from './templates/loan.json';
import payslip from './templates/payslip.json';
import pet from './templates/pet.json';
import prescription from './templates/prescription.json';
import property from './templates/property.json';
import tax from './templates/tax.json';
import travel from './templates/travel.json';
import vaccination from './templates/vaccination.json';
import vehicle from './templates/vehicle.json';
import warranty from './templates/warranty.json';
import bill from './templates/bill.json';
import blank from './templates/blank.json';
import budget from './templates/budget.json';
import contacts from './templates/contacts.json';
import contract from './templates/contract.json';
import notes from './templates/notes.json';
import purchase from './templates/purchase.json';
import reading from './templates/reading.json';
import reimbursement from './templates/reimbursement.json';
import todo from './templates/todo.json';

// 内置的数据页面模版（D-040）：mock AI 用它们理解「新建一个记账页面」这类说法，
// 评测集也用它们准备初始状态。模版只生成数据表结构和页面，不含任何记录；这四个还没有给用户直接选（D-255），收件页面的预设表见下面（D-392）。
//
// 每个模版是 templates/<名字>.json（D-255，v34 写法）：
// - ids：数据表和页面的基本 ID；配置里已经有同名的就加 -2、-3……
// - table、page：addData {table}、addContainer {page} 的内容。ID 写成占位符 $table、$page，
//   块里引用这张表的地方（source.table、就地工具的 table）也写 $table，生成时一起换成真正的 ID。
// - 给用户看的文字写成 { en, zh, fr }，按界面语言取一种。
// - entry：页面的入口。现在只有 nav：放进导航栏（设置之前），导航栏满了就在首页加一个快捷入口。

export const DATA_TEMPLATES = ['budget', 'todo', 'reading', 'notes'] as const;
export type DataTemplate = (typeof DATA_TEMPLATES)[number];

/**
 * 收件页面「存成记录」给用户选的预设表（D-392）：每个都有一个附件字段（attachments），字段之后都能改。
 * 和上面四个分开列：mock AI 和评测只认上面四个，这几个只给用户在收件页面选。blank 是「空白」：
 * 一个标题字段加附件字段，表名先用默认的名字，用户之后自己改。
 */
export const FILE_RECORD_PRESETS = [
  'purchase',
  'bill',
  'contract',
  'reimbursement',
  'contacts',
  'blank',
] as const;
export type FileRecordPreset = (typeof FILE_RECORD_PRESETS)[number];
/**
 * 用户平时看不到的预设（D-444）：只在导入文件、决定新建表单时参与排序和推荐；mock AI 和评测不认。
 * 字段是原型，名字还没有人审过。
 */
export const HIDDEN_RECORD_PRESETS = [
  'bank',
  'education',
  'identity',
  'insurance',
  'lab',
  'lease',
  'loan',
  'payslip',
  'pet',
  'prescription',
  'property',
  'tax',
  'travel',
  'vaccination',
  'vehicle',
  'warranty',
] as const;
export type HiddenRecordPreset = (typeof HIDDEN_RECORD_PRESETS)[number];
/** 新建表单时能选的全部预设（不含空白）。 */
export type NewTablePreset = Exclude<FileRecordPreset, 'blank'> | HiddenRecordPreset;
type Template = DataTemplate | FileRecordPreset | HiddenRecordPreset;

interface TemplateJson {
  ids: { table: string; page: string };
  table: unknown;
  page: unknown;
  entry: 'nav';
}

const TEMPLATES: Record<Template, TemplateJson> = {
  budget: budget as TemplateJson,
  todo: todo as TemplateJson,
  reading: reading as TemplateJson,
  notes: notes as TemplateJson,
  purchase: purchase as TemplateJson,
  bill: bill as TemplateJson,
  contract: contract as TemplateJson,
  reimbursement: reimbursement as TemplateJson,
  contacts: contacts as TemplateJson,
  blank: blank as TemplateJson,
  bank: bank as TemplateJson,
  education: education as TemplateJson,
  identity: identity as TemplateJson,
  insurance: insurance as TemplateJson,
  lab: lab as TemplateJson,
  lease: lease as TemplateJson,
  loan: loan as TemplateJson,
  payslip: payslip as TemplateJson,
  pet: pet as TemplateJson,
  prescription: prescription as TemplateJson,
  property: property as TemplateJson,
  tax: tax as TemplateJson,
  travel: travel as TemplateJson,
  vaccination: vaccination as TemplateJson,
  vehicle: vehicle as TemplateJson,
  warranty: warranty as TemplateJson,
};

type AddTable = OpOf<'addData'> & { table: Exclude<OpOf<'addData'>['table'], string> };
type AddPage = OpOf<'addContainer'> & {
  page: Exclude<NonNullable<OpOf<'addContainer'>['page']>, string>;
};

const isLocalized = (v: object) => {
  const keys = Object.keys(v).sort();
  return keys.length === 3 && keys.join() === 'en,fr,zh';
};

/** 换掉占位符、按语言取文字。 */
function fill(value: unknown, locale: Locale, ids: Record<string, string>): unknown {
  if (typeof value === 'string') return ids[value] ?? value;
  if (Array.isArray(value)) return value.map((v) => fill(v, locale, ids));
  if (typeof value === 'object' && value !== null) {
    if (isLocalized(value)) return localize(value as Record<Locale, string>, locale);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fill(v, locale, ids)] as const),
    );
  }
  return value;
}

function uniqueId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

/** 新页面需要一个入口：导航栏有空位就放进导航栏（设置之前），否则在首页加一个快捷入口。 */
export function entryOps(
  config: WorkspaceConfig,
  pageId: string,
  title: string,
  icon: Page['icon'],
): Op[] {
  const nav = config.nav.bar;
  if (nav.length < 5) {
    const at = nav.indexOf('settings');
    const bar = [...nav];
    bar.splice(at < 0 ? bar.length : at, 0, pageTarget(pageId));
    return [{ op: 'updateContainer', nav: { bar } }];
  }
  return [
    {
      op: 'addContainer',
      page: HOME_PAGE_ID,
      block: {
        id: `shortcut-${pageId}`,
        look: 'entry',
        show: { title, icon: icon ?? 'star' },
        opens: pageTarget(pageId),
      },
    },
  ];
}

/** 生成某个模板的修改操作：新建数据表、新建页面，并给页面一个入口。 */
export function templateOps(template: Template, config: WorkspaceConfig, locale: Locale): Op[] {
  const op = templateCollectionOp(template, config, locale);
  return [op, ...templatePageOps(template, config, locale, op.table.id)];
}

/** 只建模板的数据表（功能，D-191）；页面之后单独加（外观，先进草稿）。 */
export function templateCollectionOp(
  template: Template,
  config: WorkspaceConfig,
  locale: Locale,
): AddTable {
  const json = TEMPLATES[template];
  const tableId = uniqueId(json.ids.table, (id) => config.data.tables.some((c) => c.id === id));
  const table = fill(json.table, locale, { $table: tableId });
  return { op: 'addData', table: table as AddTable['table'] };
}

/** 给已有的模板数据表建页面，并给页面一个入口。 */
export function templatePageOps(
  template: Template,
  config: WorkspaceConfig,
  locale: Locale,
  tableId: string,
): Op[] {
  const json = TEMPLATES[template];
  const pageId = uniqueId(json.ids.page, (id) => config.containers.pages.some((p) => p.id === id));
  const page = fill(json.page, locale, {
    $table: tableId,
    $page: pageId,
  }) as AddPage['page'];
  return [{ op: 'addContainer', page }, ...entryOps(config, pageId, page.title, page.icon)];
}

/** 预设表在这种语言下的名字（收件页面「存成记录」的列表里显示）。 */
export function templateTableName(template: Template, locale: Locale): string {
  return localize((TEMPLATES[template].table as { name: Record<Locale, string> }).name, locale);
}

/** 由这个模板建出来、现在还在的数据表（ID 是基本 ID 或加了 -2、-3……）；没有时 undefined。 */
export function templateTableOf(template: Template, config: WorkspaceConfig): string | undefined {
  const base = TEMPLATES[template].ids.table;
  return config.data.tables.find(
    (c) =>
      c.id === base || (c.id.startsWith(`${base}-`) && /^\d+$/.test(c.id.slice(base.length + 1))),
  )?.id;
}

/** 这个模板建好、但还没有页面用到的数据表（先做了功能、页面还没加，D-191）。 */
export function templateCollectionWithoutPage(
  template: DataTemplate,
  config: WorkspaceConfig,
): string | undefined {
  const base = TEMPLATES[template].ids.table;
  const shown = new Set(
    config.containers.pages.flatMap((p) =>
      allComponents(p).flatMap((c) => {
        const id = componentCollection(c);
        return id === null ? [] : [id];
      }),
    ),
  );
  return config.data.tables.find(
    (c) => (c.id === base || c.id.startsWith(`${base}-`)) && !shown.has(c.id),
  )?.id;
}

export type NewPreset = NewTablePreset | 'blank';

/** 新建表单页上正在改的表（D-444）：还没有写进配置，点「记下」才建。 */
export function draftTable(preset: NewPreset, config: WorkspaceConfig, locale: Locale): Collection {
  return templateCollectionOp(preset, config, locale).table as unknown as Collection;
}

/**
 * 点「记下」时建表的修改：数据表、页面和入口。字段都还在就用预设自己的页面；用户去掉了字段（预设的页面
 * 可能引用它）或者是自己搭的表：用「空白」的页面，列表显示前两个文字字段。
 */
export function draftTableOps(
  table: Collection,
  preset: NewPreset,
  config: WorkspaceConfig,
  locale: Locale,
): Op[] {
  const json = TEMPLATES[preset];
  const original = (json.table as { fields: { id: string }[] }).fields;
  const intact =
    preset !== 'blank' && original.every((f) => table.fields.some((d) => d.id === f.id));
  const pageId = uniqueId(json.ids.page, (id) => config.containers.pages.some((p) => p.id === id));
  const page = fill((intact ? json : TEMPLATES.blank).page, locale, {
    $table: table.id,
    $page: pageId,
  }) as Record<string, unknown> & {
    title: string;
    icon?: Page['icon'];
    blocks: { id: string; show?: Record<string, unknown> }[];
  };
  page.title = table.name;
  const header = page.blocks.find((b) => b.id === 'title');
  if (header?.show) header.show.title = table.name;
  if (!intact) {
    const texts = table.fields.filter((f) => f.type === 'text').map((f) => f.id);
    const list = page.blocks.find((b) => b.id === 'entries');
    if (list?.show) {
      if (texts[0]) list.show.title = texts[0];
      else delete list.show.title;
      list.show.subtitles = texts.slice(1, 2);
    }
    if (table.icon) page.icon = table.icon as Page['icon'];
  }
  return [
    { op: 'addData', table: table as unknown as AddTable['table'] },
    { op: 'addContainer', page: page as unknown as AddPage['page'] },
    ...entryOps(config, pageId, page.title, page.icon),
  ];
}
