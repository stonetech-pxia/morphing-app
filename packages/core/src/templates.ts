import type { Op } from './ops';
import {
  HOME_PAGE_ID,
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

const t = (locale: Locale, zh: string, en: string) => (locale === 'zh' ? zh : en);

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
          name: t(locale, '账目', 'Expenses'),
          icon: 'chart',
          fields: [
            {
              id: 'amount',
              name: t(locale, '金额', 'Amount'),
              type: 'money',
              currency: t(locale, 'CNY', 'USD'),
              required: true,
            },
            {
              id: 'category',
              name: t(locale, '分类', 'Category'),
              type: 'choice',
              options: [
                { id: 'food', label: t(locale, '餐饮', 'Food') },
                { id: 'transport', label: t(locale, '交通', 'Transport') },
                { id: 'shopping', label: t(locale, '购物', 'Shopping') },
                { id: 'home', label: t(locale, '居家', 'Home') },
                { id: 'fun', label: t(locale, '娱乐', 'Fun') },
                { id: 'other', label: t(locale, '其他', 'Other') },
              ],
              default: 'food',
            },
            { id: 'date', name: t(locale, '日期', 'Date'), type: 'date', default: 'today' },
            { id: 'note', name: t(locale, '备注', 'Note'), type: 'text' },
          ],
        },
        page: {
          title: t(locale, '记账', 'Budget'),
          icon: 'chart',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, '记账', 'Budget') } },
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
                    label: t(locale, '本月支出', 'This month'),
                    filter: [{ field: 'date', op: 'inPeriod', value: 'thisMonth' }],
                  },
                },
                {
                  id: 'month-count',
                  type: 'stat',
                  props: {
                    collectionId: c,
                    aggregate: 'count',
                    label: t(locale, '本月笔数', 'Entries'),
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
                submitLabel: t(locale, '记一笔', 'Add'),
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
                emptyText: t(locale, '还没有记录', 'Nothing yet'),
              },
            },
          ],
        },
      };
    case 'todo':
      return {
        collection: {
          name: t(locale, '待办', 'To-dos'),
          icon: 'check',
          fields: [
            { id: 'title', name: t(locale, '事项', 'Task'), type: 'text', required: true },
            { id: 'done', name: t(locale, '完成', 'Done'), type: 'checkbox' },
            { id: 'due', name: t(locale, '截止日期', 'Due'), type: 'date' },
          ],
        },
        page: {
          title: t(locale, '待办', 'To-do'),
          icon: 'check',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, '待办', 'To-do') } },
            {
              id: 'open-count',
              type: 'stat',
              props: {
                collectionId: c,
                aggregate: 'count',
                label: t(locale, '未完成', 'Open'),
                filter: [{ field: 'done', op: 'is', value: false }],
              },
            },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['title'],
                submitLabel: t(locale, '添加', 'Add'),
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
                emptyText: t(locale, '没有待办事项', 'No tasks'),
              },
            },
          ],
        },
      };
    case 'reading':
      return {
        collection: {
          name: t(locale, '书单', 'Books'),
          icon: 'bookmark',
          fields: [
            { id: 'title', name: t(locale, '书名', 'Title'), type: 'text', required: true },
            { id: 'author', name: t(locale, '作者', 'Author'), type: 'text' },
            {
              id: 'status',
              name: t(locale, '状态', 'Status'),
              type: 'choice',
              options: [
                { id: 'want', label: t(locale, '想读', 'Want to read') },
                { id: 'reading', label: t(locale, '在读', 'Reading') },
                { id: 'done', label: t(locale, '读完', 'Finished') },
              ],
              default: 'want',
            },
            { id: 'rating', name: t(locale, '评分', 'Rating'), type: 'rating' },
            { id: 'note', name: t(locale, '笔记', 'Notes'), type: 'note' },
          ],
        },
        page: {
          title: t(locale, '读书清单', 'Reading'),
          icon: 'bookmark',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, '读书清单', 'Reading') } },
            {
              id: 'finished',
              type: 'stat',
              props: {
                collectionId: c,
                aggregate: 'count',
                label: t(locale, '已读完', 'Finished'),
                filter: [{ field: 'status', op: 'is', value: 'done' }],
              },
            },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['title', 'author', 'status'],
                submitLabel: t(locale, '添加一本书', 'Add a book'),
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
                emptyText: t(locale, '还没有书', 'No books yet'),
              },
            },
          ],
        },
      };
    case 'notes':
      return {
        collection: {
          name: t(locale, '笔记', 'Notes'),
          icon: 'document',
          fields: [
            { id: 'title', name: t(locale, '标题', 'Title'), type: 'text', required: true },
            { id: 'body', name: t(locale, '正文', 'Text'), type: 'note' },
          ],
        },
        page: {
          title: t(locale, '笔记', 'Notes'),
          icon: 'document',
          components: [
            { id: 'title', type: 'header', props: { title: t(locale, '笔记', 'Notes') } },
            {
              id: 'add',
              type: 'recordForm',
              props: {
                collectionId: c,
                fieldIds: ['title', 'body'],
                submitLabel: t(locale, '写笔记', 'New note'),
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
                emptyText: t(locale, '还没有笔记', 'No notes yet'),
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
  const [collectionBase, pageBase] = BASE_IDS[template];
  const collectionId = uniqueId(collectionBase, (id) =>
    config.collections.some((c) => c.id === id),
  );
  const pageId = uniqueId(pageBase, (id) => config.pages.some((p) => p.id === id));
  const { collection, page } = build(template, locale, collectionId);
  return [
    { op: 'addCollection', collection: { id: collectionId, ...collection } },
    { op: 'addPage', page: { id: pageId, ...page } },
    ...entryOps(config, pageId, page.title, page.icon),
  ];
}
