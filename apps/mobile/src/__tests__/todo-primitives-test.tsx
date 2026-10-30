import {
  applyOps,
  createDefaultWorkspace,
  findDatePhrase,
  todayNumber,
  type Collection,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 日程的「一次」（D-340）、给一条记录用的页面（D-342）、快速添加的预设值（D-343）和本机认日期（D-344）。
// 例子是待办：项目、任务两张表；这些能力不只给待办用。

const tables: Collection[] = [
  {
    id: 'projects',
    name: '项目',
    fields: [{ id: 'name', name: '名称', type: 'text', required: true }],
  },
  {
    id: 'tasks',
    name: '任务',
    fields: [
      { id: 'title', name: '标题', type: 'text', required: true },
      { id: 'plan', name: '日程', type: 'schedule', default: { repeat: 'once' } },
      { id: 'project', name: '项目', type: 'link', collectionId: 'projects' },
    ],
  },
];

const quickAdd = (id: string, values?: Record<string, string>): NewComponent =>
  ({
    id,
    type: 'recordForm',
    props: {
      collectionId: 'tasks',
      fieldIds: ['title'],
      submitLabel: '添加',
      mode: 'inline',
      smartDate: { from: 'title', to: 'plan' },
      ...(values ? { values } : {}),
    },
  }) as NewComponent;

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      ...tables.map((collection) => ({ op: 'addCollection' as const, collection })),
      {
        op: 'addPage' as const,
        page: {
          id: 'project',
          title: '项目',
          recordOf: 'projects',
          components: [
            quickAdd('add-here', { project: '$record' }),
            {
              id: 'its-tasks',
              type: 'recordList',
              props: {
                collectionId: 'tasks',
                display: 'list',
                titleField: 'title',
                limit: 30,
                filter: [{ field: 'project', op: 'is', value: '$record' }],
              },
            },
          ],
        } as never,
      },
      { op: 'addComponent' as const, pageId: 'home', component: quickAdd('add') },
      {
        op: 'addComponent' as const,
        pageId: 'home',
        component: {
          id: 'projects',
          type: 'recordList',
          props: {
            collectionId: 'projects',
            display: 'list',
            titleField: 'name',
            limit: 30,
            opens: 'project',
          },
        } as NewComponent,
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const saved = (repo: MemoryWorkspaceRepo, n: number) =>
  waitFor(async () => {
    const list = await repo.listRecords('tasks');
    expect(list).toHaveLength(n);
    return list;
  });

it('quick add recognises the day on the phone and takes it out of the title', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await fireEvent.changeText(await screen.findByTestId('form-add-title'), '周五交报告');
  expect(screen.getByTestId('form-add-smart')).toHaveTextContent(/认出「周五」/);
  await fireEvent.press(screen.getByTestId('form-add-submit'));
  const [task] = await saved(repo, 1);
  const friday = findDatePhrase('周五', todayNumber(new Date()))!.value as { date: string };
  expect(task?.values).toEqual({ title: '交报告', plan: { repeat: 'once', date: friday.date } });
  expect(screen.queryByTestId('form-add-smart')).toBeNull();
});

it('dismissing the recognised day keeps the words and the default rule', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await fireEvent.changeText(await screen.findByTestId('form-add-title'), '明天的会议纪要');
  await fireEvent.press(screen.getByTestId('form-add-smart-dismiss'));
  expect(screen.queryByTestId('form-add-smart')).toBeNull();
  await fireEvent.press(screen.getByTestId('form-add-submit'));
  const [task] = await saved(repo, 1);
  expect(task?.values).toEqual({ title: '明天的会议纪要', plan: { repeat: 'once' } });
});

it('nothing to recognise: no hint, saved as typed', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { locale: 'en', seed });
  await fireEvent.changeText(await screen.findByTestId('form-add-title'), 'Buy sunscreen');
  expect(screen.queryByTestId('form-add-smart')).toBeNull();
  await fireEvent.press(screen.getByTestId('form-add-submit'));
  const [task] = await saved(repo, 1);
  expect(task?.values.title).toBe('Buy sunscreen');
});
