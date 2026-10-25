import { t } from './messages';
import type { Op } from './ops';
import {
  HOME_PAGE_ID,
  allComponents,
  pageTarget,
  type Collection,
  type Locale,
  type Page,
  type WorkspaceConfig,
} from './schema';

// 内置的数据页面模板（D-040）：mock AI 用它们理解「新建一个记账页面」这类说法，
// 评测集也用它们准备初始状态。模板只生成数据表结构和页面，不含任何记录。

export const DATA_TEMPLATES = ['budget', 'todo', 'reading', 'notes'] as const;
export type DataTemplate = (typeof DATA_TEMPLATES)[number];

function uniqueId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

function build(
  template: DataTemplate,
  locale: Locale,
  collectionId: string,
): { collection: Omit<Collection, 'id'>; page: Omit<Page, 'id'> } {
  const c = collectionId;
  switch (template) {
    case 'budget':
      return {
        collection: {
          name: t(locale, 'templates_Expenses_628c1'),
          icon: 'chart',
          fields: [
            {
              id: 'amount',
              name: t(locale, 'templates_Amount_454fd'),
              type: 'money',
              currency: t(locale, 'templates_USD_006d1'),
              required: true,
            },
            {
              id: 'category',
              name: t(locale, 'templates_Category_74b40'),
              type: 'choice',
              options: [
                { id: 'food', label: t(locale, 'templates_Food_8ab5c') },
                { id: 'transport', label: t(locale, 'templates_Transport_a9c49') },
                { id: 'shopping', label: t(locale, 'templates_Shopping_5cfd4') },
                { id: 'home', label: t(locale, 'templates_Home_38780') },
                { id: 'fun', label: t(locale, 'templates_Fun_1e014') },
                { id: 'other', label: t(locale, 'templates_Other_82cdf') },
              ],
              default: 'food',
            },
            { id: 'date', name: t(locale, 'templates_Date_a50c7'), type: 'date', default: 'today' },
            { id: 'note', name: t(locale, 'templates_Note_4f584'), type: 'text' },
          ],
        },
        page: {
          title: t(locale, 'templates_Budget_b41b1'),
          icon: 'chart',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, 'templates_Budget_b41b1') } },
            {
              id: 'summary',
              type: 'group',
              props: { layout: 'row' },
              children: [
                {
                  id: 'month-total',
                  type: 'stat',
                  props: {
                    collectionId: c,
                    aggregate: 'sum',
                    fieldId: 'amount',
                    label: t(locale, 'templates_This_month_ef628'),
                    filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
                  },
                },
                {
                  id: 'month-count',
                  type: 'stat',
                  props: {
                    collectionId: c,
                    aggregate: 'count',
                    label: t(locale, 'templates_Entries_3c27f'),
                    filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
                  },
                },
              ],
            },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['amount', 'category', 'note'],
                submitLabel: t(locale, 'templates_Add_87da3'),
                mode: 'inline',
              },
            },
            {
              id: 'recent',
              type: 'recordList',
              props: {
                collectionId: c,
                display: 'list',
                titleField: 'category',
                subtitleFields: ['note', 'date'],
                trailingField: 'amount',
                sort: { field: 'date', direction: 'desc' },
                limit: 30,
                emptyText: t(locale, 'templates_Nothing_yet_9f2eb'),
              },
            },
          ],
        },
      };
    case 'todo':
      return {
        collection: {
          name: t(locale, 'templates_To_dos_42048'),
          icon: 'check',
          fields: [
            { id: 'title', name: t(locale, 'templates_Task_5fa9b'), type: 'text', required: true },
            { id: 'done', name: t(locale, 'templates_Done_6f135'), type: 'checkbox' },
            { id: 'due', name: t(locale, 'templates_Due_f5da7'), type: 'date' },
          ],
        },
        page: {
          title: t(locale, 'templates_To_do_ca3e9'),
          icon: 'check',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, 'templates_To_do_ca3e9') } },
            {
              id: 'open-count',
              type: 'stat',
              props: {
                collectionId: c,
                aggregate: 'count',
                label: t(locale, 'templates_Open_f1cc8'),
                filter: [{ field: 'done', op: 'is', value: false }],
              },
            },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['title'],
                submitLabel: t(locale, 'templates_Add_b7a68'),
                mode: 'inline',
              },
            },
            {
              id: 'tasks',
              type: 'recordList',
              props: {
                collectionId: c,
                display: 'checklist',
                checkField: 'done',
                titleField: 'title',
                subtitleFields: ['due'],
                sort: { field: 'createdAt', direction: 'desc' },
                limit: 50,
                emptyText: t(locale, 'templates_No_tasks_c61dd'),
              },
            },
          ],
        },
      };
    case 'reading':
      return {
        collection: {
          name: t(locale, 'templates_Books_936cc'),
          icon: 'bookmark',
          fields: [
            { id: 'title', name: t(locale, 'templates_Title_880a4'), type: 'text', required: true },
            { id: 'author', name: t(locale, 'templates_Author_746ae'), type: 'text' },
            {
              id: 'status',
              name: t(locale, 'templates_Status_d925f'),
              type: 'choice',
              options: [
                { id: 'want', label: t(locale, 'templates_Want_to_read_a7318') },
                { id: 'reading', label: t(locale, 'templates_Reading_27c53') },
                { id: 'done', label: t(locale, 'templates_Finished_08ced') },
              ],
              default: 'want',
            },
            { id: 'rating', name: t(locale, 'templates_Rating_a0ed3'), type: 'rating' },
            { id: 'note', name: t(locale, 'templates_Notes_17714'), type: 'note' },
          ],
        },
        page: {
          title: t(locale, 'templates_Reading_758da'),
          icon: 'bookmark',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, 'templates_Reading_758da') } },
            {
              id: 'finished',
              type: 'stat',
              props: {
                collectionId: c,
                aggregate: 'count',
                label: t(locale, 'templates_Finished_efc6c'),
                filter: [{ field: 'status', op: 'is', value: 'done' }],
              },
            },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['title', 'author', 'status'],
                submitLabel: t(locale, 'templates_Add_a_book_7ee61'),
                mode: 'button',
              },
            },
            {
              id: 'books',
              type: 'recordList',
              props: {
                collectionId: c,
                display: 'cards',
                titleField: 'title',
                subtitleFields: ['author', 'status'],
                trailingField: 'rating',
                limit: 50,
                emptyText: t(locale, 'templates_No_books_yet_64371'),
              },
            },
          ],
        },
      };
    case 'notes':
      return {
        collection: {
          name: t(locale, 'templates_Notes_17714'),
          icon: 'document',
          fields: [
            { id: 'title', name: t(locale, 'templates_Title_5bdb7'), type: 'text', required: true },
            { id: 'body', name: t(locale, 'templates_Text_f1abc'), type: 'note' },
          ],
        },
        page: {
          title: t(locale, 'templates_Notes_17714'),
          icon: 'document',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, 'templates_Notes_17714') } },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['title', 'body'],
                submitLabel: t(locale, 'templates_New_note_b5bca'),
                mode: 'button',
              },
            },
            {
              id: 'notes',
              type: 'recordList',
              props: {
                collectionId: c,
                display: 'cards',
                titleField: 'title',
                subtitleFields: ['body'],
                sort: { field: 'updatedAt', direction: 'desc' },
                limit: 50,
                emptyText: t(locale, 'templates_No_notes_yet_56f53'),
              },
            },
          ],
        },
      };
  }
}

const BASE_IDS: Record<DataTemplate, [collection: string, page: string]> = {
  budget: ['expenses', 'budget'],
  todo: ['todos', 'todo'],
  reading: ['books', 'reading'],
  notes: ['notes', 'notes'],
};

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
): Extract<Op, { op: 'addCollection' }> {
  const collectionId = uniqueId(BASE_IDS[template][0], (id) =>
    config.collections.some((c) => c.id === id),
  );
  const { collection } = build(template, locale, collectionId);
  return { op: 'addCollection', collection: { id: collectionId, ...collection } };
}

/** 给已有的模板数据表建页面，并给页面一个入口。 */
export function templatePageOps(
  template: DataTemplate,
  config: WorkspaceConfig,
  locale: Locale,
  collectionId: string,
): Op[] {
  const pageId = uniqueId(BASE_IDS[template][1], (id) => config.pages.some((p) => p.id === id));
  const { page } = build(template, locale, collectionId);
  return [
    { op: 'addPage', page: { id: pageId, ...page } },
    ...entryOps(config, pageId, page.title, page.icon),
  ];
}

/** 这个模板建好、但还没有页面用到的数据表（先做了功能、页面还没加，D-191）。 */
export function templateCollectionWithoutPage(
  template: DataTemplate,
  config: WorkspaceConfig,
): string | undefined {
  const base = BASE_IDS[template][0];
  const shown = new Set(
    config.pages.flatMap((p) =>
      allComponents(p).flatMap((c) =>
        'collectionId' in c.props ? [String(c.props.collectionId)] : [],
      ),
    ),
  );
  return config.collections.find(
    (c) => (c.id === base || c.id.startsWith(`${base}-`)) && !shown.has(c.id),
  )?.id;
}
