import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 浮动「+」和底部弹出的添加框（D-352）、看板按引用分栏和每栏添加（D-351）。

const sections: Collection = {
  id: 'sections',
  name: '版块',
  fields: [{ id: 'name', name: '名称', type: 'text', required: true }],
};
const tasks: Collection = {
  id: 'tasks',
  name: '任务',
  fields: [
    { id: 'title', name: '标题', type: 'text', required: true },
    { id: 'plan', name: '日程', type: 'schedule', default: { repeat: 'once' } },
    { id: 'section', name: '版块', type: 'link', table: 'sections' },
  ],
};

const seed = (components: NewComponent[]) => (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addData' as const, table: sections },
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

const put = (repo: MemoryWorkspaceRepo, id: string, collectionId: string, values: object, at = 1) =>
  repo.insertRecord({ id, collectionId, values: { ...values }, createdAt: at, updatedAt: at });

it('the floating add opens a sheet; the keyboard Done adds and the sheet stays for the next one', async () => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seed([
      {
        id: 'quick',
        look: 'form',
        show: { mode: 'sheet' },
        tools: [
          {
            as: 'submit',
            label: '添加任务',
            do: 'create',
            table: 'tasks',
            ask: ['title'],
            smartDate: { from: 'title', to: 'plan' },
          },
        ],
      } as NewComponent,
    ]),
  });
  // 关着的时候框不在。
  expect(screen.queryByTestId('form-quick-title')).toBeNull();
  await fireEvent.press(await screen.findByTestId('form-quick'));
  const input = await screen.findByTestId('form-quick-title');
  await fireEvent.changeText(input, '每天晚上8点吃药');
  expect(screen.getByTestId('form-quick-smart')).toHaveTextContent(/每天 20:00/);
  await fireEvent(screen.getByTestId('form-quick-title'), 'submitEditing');
  // 存好以后框还开着，文字清空，可以接着写。
  await waitFor(() => expect(screen.getByTestId('form-quick-title').props.value).toBe(''));
  const [saved] = await repo.listRecords('tasks');
  expect(saved!.values).toEqual({ title: '吃药', plan: { repeat: 'daily', time: '20:00' } });
  await fireEvent.press(screen.getByTestId('form-quick-backdrop'));
  await waitFor(() => expect(screen.queryByTestId('form-quick-title')).toBeNull());
});

it('a board by a linked table has a column per section, and adding in a column files the task there', async () => {
  const repo = new MemoryWorkspaceRepo();
  await put(repo, 's1', 'sections', { name: '待办' }, 1);
  await put(repo, 's2', 'sections', { name: '进行中' }, 2);
  await put(repo, 't1', 'tasks', { title: '买瓷砖', section: 's2' });
  const { router } = await renderToolsApp(repo, undefined, {
    locale: 'zh',
    seed: seed([
      {
        id: 'board',
        look: 'board',
        source: { table: 'tasks', group: { by: 'section' }, limit: 30 },
        show: { title: 'title' },
        tools: [
          { as: 'drag', do: 'set', table: 'tasks', field: 'section', value: '$group' },
          { as: 'addHere', do: 'create', table: 'tasks', ask: 'all', values: '$here' },
        ],
      } as NewComponent,
    ]),
  });
  expect(await screen.findByTestId('board-column-s1')).toHaveTextContent(/待办/);
  expect(screen.getByTestId('board-column-s2')).toHaveTextContent(/进行中.*买瓷砖/);
  await screen.findByTestId('board-add-s2');
  await act(async () => {});
  await fireEvent.press(screen.getByTestId('board-add-s2'));
  await waitFor(() => expect(router.getPathname()).toBe('/record/tasks'));
  expect(JSON.parse(router.getSearchParams().prefill as string)).toEqual({ section: 's2' });
});
