import {
  applyOps,
  createDefaultWorkspace,
  dateOfDayNumber,
  todayNumber,
  type Collection,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 列表分段（D-347）、月历认日程（D-348）、就地添加（D-349）。例子是待办，这些能力不只给待办用。

type Router = Awaited<ReturnType<typeof renderToolsApp>>['router'];

const tasks: Collection = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'title', name: '标题', type: 'text', required: true },
    { id: 'plan', name: '日程', type: 'schedule', default: { repeat: 'once' } },
    {
      id: 'section',
      name: '版块',
      type: 'choice',
      options: [
        { id: 'a', label: '版块1' },
        { id: 'b', label: '版块2' },
      ],
    },
    {
      id: 'status',
      name: '状态',
      type: 'choice',
      options: [
        { id: 'open', label: '待办' },
        { id: 'closed', label: '已做' },
      ],
    },
  ],
};

const addHere = { as: 'addHere', do: 'create', table: 'tasks', ask: 'all', values: '$here' };

const list = (
  id: string,
  block: { look?: string; source?: object; show?: object; tools?: object[] },
): NewComponent =>
  ({
    id,
    look: 'list',
    ...block,
    source: { table: 'tasks', limit: 30, ...block.source },
    show: { title: 'title', ...block.show },
  }) as NewComponent;

const seed = (components: NewComponent[]) => (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData' as const, table: tasks },
      ...components.map((block) => ({
        op: 'addContainer' as const,
        page: 'home',
        block,
      })),
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const put = (repo: MemoryWorkspaceRepo, id: string, values: object) =>
  repo.insertRecord({
    id,
    collectionId: 'tasks',
    values: { ...values },
    createdAt: 1,
    updatedAt: 1,
  });

/** 点一下，等它打开新记录的表单。先等列表读完、算好（之后不再重画），再点。 */
async function openForm(router: Router, testID: string) {
  await screen.findByTestId(testID);
  await act(async () => {});
  await fireEvent.press(screen.getByTestId(testID));
  await waitFor(() => expect(router.getPathname()).toBe('/record/tasks'));
}

it('sections show every section with its count, fold, and add into the section with the list filter', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 't1', { title: '买瓷砖', section: 'a', status: 'open' });
  await put(repo, 't2', { title: '量尺寸', section: 'a', status: 'open' });
  await put(repo, 't3', { title: '早做完', section: 'a', status: 'closed' });
  const { router } = await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seed([
      list('inbox', {
        source: {
          group: { by: 'section', showEmpty: true },
          filter: [{ field: 'status', op: 'is', value: 'open' }],
        },
        tools: [addHere],
      }),
    ]),
  });
  expect(await screen.findByTestId('group-a')).toHaveTextContent(/版块1.*2/);
  // 空的版块也列出来；没有「未选」。
  expect(screen.getByTestId('group-b')).toHaveTextContent(/版块2.*0/);
  expect(screen.queryByTestId('group-none')).toBeNull();
  expect(screen.queryByText('早做完')).toBeNull();
  // 折叠和展开。
  await fireEvent.press(screen.getByTestId('group-a'));
  expect(screen.queryByText('买瓷砖')).toBeNull();
  await fireEvent.press(screen.getByTestId('group-a'));
  expect(await screen.findByText('买瓷砖')).toBeTruthy();
  // 在版块2添加：版块和筛选里的「状态 = 待办」都带上，标题由用户填。
  await openForm(router, 'group-add-b');
  expect(router.getSearchParams()).toEqual({
    collectionId: 'tasks',
    prefill: JSON.stringify({ status: 'open', section: 'b' }),
  });
  await fireEvent.changeText(await screen.findByTestId('editor-title'), '订灯具');
  await fireEvent.press(screen.getByTestId('editor-save'));
  await waitFor(() => expect(router.getPathname()).toBe('/'));
  const saved = (await repo.listRecords('tasks')).find((r) => r.values.title === '订灯具')!;
  expect(saved.values).toEqual({
    title: '订灯具',
    section: 'b',
    status: 'open',
    plan: { repeat: 'once' },
  });
});

it('a new user: sections by day show nothing to group; a calendar on the schedule adds on the picked day', async () => {
  const repo = new MemoryWorkspaceRepo();
  const { router } = await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seed([
      list('days', { source: { group: { by: 'plan' } }, show: { emptyText: '没有任务' } }),
      list('cal', {
        look: 'calendar',
        source: { group: { by: 'plan', unit: 'day' } },
        tools: [addHere],
      }),
    ]),
  });
  expect(await screen.findByText('没有任务')).toBeTruthy();
  const today = dateOfDayNumber(todayNumber(new Date()));
  await openForm(router, 'calendar-add-here');
  expect(JSON.parse(router.getSearchParams().prefill as string)).toEqual({
    plan: { repeat: 'once', date: today },
  });
});

it('a weekly task sits on its coming days in the calendar and in a section per day', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 't1', { title: '倒垃圾', plan: { repeat: 'daily', time: '20:00' } });
  await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seed([
      list('days', { source: { group: { by: 'plan' } }, show: { subtitles: ['plan'] } }),
      list('cal', { look: 'calendar', source: { group: { by: 'plan', unit: 'day' } } }),
    ]),
  });
  const today = todayNumber(new Date());
  // 今天这一段，标题是「今天 · …」；规则里带着钟点。
  expect(await screen.findByTestId(`group-day-${today}`)).toHaveTextContent(/今天/);
  expect(screen.getAllByText(/每天 20:00/).length).toBeGreaterThan(0);
  // 月历上今天有一条（读屏读「日期，1 条记录」）。
  expect(
    screen.getByTestId(`calendar-cal-day-${dateOfDayNumber(today)}`).props.accessibilityLabel,
  ).toMatch(/1 条记录/);
});
