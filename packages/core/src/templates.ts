import { localize } from './localization';
import type { Op } from './ops';
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
// 每个模版是 templates/<名字>.json（D-255）：
// - ids：数据表和页面的基本 ID；配置里已经有同名的就加 -2、-3……
// - collection、page：addCollection、addPage 的内容。ID 写成占位符 $collection、$page，
//   组件里引用这张表的地方（collectionId）也写 $collection，生成时一起换成真正的 ID。
// - 给用户看的文字写成 { en, zh, fr }，按界面语言取一种。
// - entry：页面的入口。现在只有 nav：放进导航栏（设置之前），导航栏满了就在首页加一个快捷入口。

export const DATA_TEMPLATES = ['budget', 'todo', 'reading', 'notes'] as const;
export type DataTemplate = (typeof DATA_TEMPLATES)[number];

interface TemplateJson {
  ids: { collection: string; page: string };
  collection: unknown;
  page: unknown;
  entry: 'nav';
}

const TEMPLATES: Record<DataTemplate, TemplateJson> = {
  budget: budget as TemplateJson,
  todo: todo as TemplateJson,
  reading: reading as TemplateJson,
  notes: notes as TemplateJson,
};

type AddCollection = Extract<Op, { op: 'addCollection' }>;
type AddPage = Extract<Op, { op: 'addPage' }>;

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
  const nav = config.shell.nav;
  if (nav.length < 5) {
    const at = nav.indexOf('settings');
    const items = [...nav];
    items.splice(at < 0 ? items.length : at, 0, pageTarget(pageId));
    return [{ op: 'setNavItems', items }];
  }
  return [
    {
      op: 'addComponent',
      pageId: HOME_PAGE_ID,
      component: {
        id: `shortcut-${pageId}`,
        type: 'shortcut',
        props: { title, icon: icon ?? 'star', target: pageTarget(pageId) },
      },
    },
  ];
}

/** 生成某个模板的修改操作：新建数据表、新建页面，并给页面一个入口。 */
export function templateOps(template: DataTemplate, config: WorkspaceConfig, locale: Locale): Op[] {
  const op = templateCollectionOp(template, config, locale);
  return [op, ...templatePageOps(template, config, locale, op.collection.id)];
}

/** 只建模板的数据表（功能，D-191）；页面之后单独加（外观，先进草稿）。 */
export function templateCollectionOp(
  template: DataTemplate,
  config: WorkspaceConfig,
  locale: Locale,
): AddCollection {
  const json = TEMPLATES[template];
  const collectionId = uniqueId(json.ids.collection, (id) =>
    config.collections.some((c) => c.id === id),
  );
  const collection = fill(json.collection, locale, { $collection: collectionId });
  return { op: 'addCollection', collection: collection as AddCollection['collection'] };
}

/** 给已有的模板数据表建页面，并给页面一个入口。 */
export function templatePageOps(
  template: DataTemplate,
  config: WorkspaceConfig,
  locale: Locale,
  collectionId: string,
): Op[] {
  const json = TEMPLATES[template];
  const pageId = uniqueId(json.ids.page, (id) => config.pages.some((p) => p.id === id));
  const page = fill(json.page, locale, {
    $collection: collectionId,
    $page: pageId,
  }) as AddPage['page'];
  return [{ op: 'addPage', page }, ...entryOps(config, pageId, page.title, page.icon)];
}

/** 这个模板建好、但还没有页面用到的数据表（先做了功能、页面还没加，D-191）。 */
export function templateCollectionWithoutPage(
  template: DataTemplate,
  config: WorkspaceConfig,
): string | undefined {
  const base = TEMPLATES[template].ids.collection;
  const shown = new Set(
    config.pages.flatMap((p) =>
      allComponents(p).flatMap((c) => {
        const id = componentCollection(c);
        return id === null ? [] : [id];
      }),
    ),
  );
  return config.collections.find(
    (c) => (c.id === base || c.id.startsWith(`${base}-`)) && !shown.has(c.id),
  )?.id;
}
