import {
  applyOps,
  dateOfDayNumber,
  todayNumber,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { screen, testRouter } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

type Router = Awaited<ReturnType<typeof renderToolsApp>>['router'];

// 给一条记录用的页面（D-332）和快速添加的预设值（D-333）：点一个项目打开它的页面。

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

const put = (repo: MemoryWorkspaceRepo, id: string, collectionId: string, values: object) =>
  repo.insertRecord({ id, collectionId, values: { ...values }, createdAt: 1, updatedAt: 1 });

/** 点列表里的一行，等它的页面打开。先等列表读完、算好（之后不再重画），再点。 */
async function openFromList(router: Router, testID: string) {
  await screen.findByTestId(testID);
  await act(async () => {});
  await fireEvent.press(screen.getByTestId(testID));
  await waitFor(() => expect(router.getPathname()).toBe('/page/project'));
}

// 打开、在页面上添加、回到首页、打开一个刚被删掉的项目：一条连着走完。
it('tapping a project opens its page with only its tasks; a project deleted meanwhile says so', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 'p1', 'projects', { name: '装修' });
  await put(repo, 'p2', 'projects', { name: '旅行' });
  await put(repo, 't1', 'tasks', { title: '买瓷砖', project: 'p1' });
  await put(repo, 't2', 'tasks', { title: '订机票', project: 'p2' });
  const { router } = await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await screen.findByTestId('record-p2');
  await openFromList(router, 'record-p1');
  expect(router.getSearchParams()).toEqual({ pageId: 'project', record: 'p1' });
  expect(await screen.findByText('买瓷砖')).toBeTruthy();
  expect(screen.queryByText('订机票')).toBeNull();
  expect(screen.getByTestId('page-record-edit')).toBeTruthy();
  // 页面上的快速添加：任务挂在这个项目下（预设值 "$record"），「后天」在本机认出来。
  await fireEvent.changeText(screen.getByTestId('form-add-here-title'), '后天量尺寸');
  expect(screen.getByTestId('form-add-here-smart')).toHaveTextContent(/认出「后天」/);
  await fireEvent.press(screen.getByTestId('form-add-here-submit'));
  const added = await waitFor(async () => {
    const found = (await repo.listRecords('tasks')).find((r) => r.values.title === '量尺寸');
    expect(found).toBeTruthy();
    return found!;
  });
  expect(added.values).toEqual({
    title: '量尺寸',
    project: 'p1',
    plan: { repeat: 'once', date: dateOfDayNumber(todayNumber(new Date()) + 2) },
  });
  expect(await screen.findByText('量尺寸')).toBeTruthy();

  await testRouter.back();
  await waitFor(() => expect(router.getPathname()).toBe('/'));
  // 列表还没刷新时项目被删了（例如在别处删的）：页面说明，不会列出所有任务。
  await repo.deleteRecord('p2', Date.now());
  await openFromList(router, 'record-p2');
  expect(await screen.findByText(/这条记录已经删除/)).toBeTruthy();
  expect(screen.queryByText('订机票')).toBeNull();
});
