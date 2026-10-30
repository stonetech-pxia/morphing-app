import { localize } from './localization';
import type { Op, OpOf } from './ops-schema';
import {
  HOME_PAGE_ID,
  allComponents,
  componentCollection,
  pageTarget,
  type Locale,
  type Page,
  type WorkspaceConfig,
} from './schema';
import budget from './templates/budget.json';
import notes from './templates/notes.json';
import reading from './templates/reading.json';
import todo from './templates/todo.json';

// 内置的数据页面模版（D-040）：mock AI 用它们理解「新建一个记账页面」这类说法，
// 评测集也用它们准备初始状态。模版只生成数据表结构和页面，不含任何记录；还没有给用户直接选（D-255）。
//
// 每个模版是 templates/<名字>.json（D-255，v34 写法）：
// - ids：数据表和页面的基本 ID；配置里已经有同名的就加 -2、-3……
// - table、page：addData {table}、addContainer {page} 的内容。ID 写成占位符 $table、$page，
//   块里引用这张表的地方（source.table、就地工具的 table）也写 $table，生成时一起换成真正的 ID。
// - 给用户看的文字写成 { en, zh, fr }，按界面语言取一种。
// - entry：页面的入口。现在只有 nav：放进导航栏（设置之前），导航栏满了就在首页加一个快捷入口。

export const DATA_TEMPLATES = ['budget', 'todo', 'reading', 'notes'] as const;
export type DataTemplate = (typeof DATA_TEMPLATES)[number];

interface TemplateJson {
  ids: { table: string; page: string };
  table: unknown;
  page: unknown;
  entry: 'nav';
}

const TEMPLATES: Record<DataTemplate, TemplateJson> = {
  budget: budget as TemplateJson,
  todo: todo as TemplateJson,
  reading: reading as TemplateJson,
  notes: notes as TemplateJson,
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
export function templateOps(template: DataTemplate, config: WorkspaceConfig, locale: Locale): Op[] {
  const op = templateCollectionOp(template, config, locale);
  return [op, ...templatePageOps(template, config, locale, op.table.id)];
}

/** 只建模板的数据表（功能，D-191）；页面之后单独加（外观，先进草稿）。 */
export function templateCollectionOp(
  template: DataTemplate,
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
  template: DataTemplate,
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
