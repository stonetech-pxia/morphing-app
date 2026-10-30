import {
  BUILTIN_TOOLS,
  applyOps,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  type Op,
  type WorkspaceConfig,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import ReminderRoute from '../app/reminder/[workflowId]';
import RunRoute from '../app/run/[workflowId]';
import { reminderDestination, syncReminders } from '../reminders/useReminders';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { FakeNotifications } from '../test-utils/fake-notifications';
import { WorkspaceProvider } from '../workspace/context';
import { createWorkspaceStore } from '../workspace/store';

// 提醒（D-251）：本地通知只按配置和本机的记录排；第一次真有提醒时才问权限；点提醒绝不运行快捷操作。

const registry = createRegistry(BUILTIN_TOOLS);

const withOps = (ops: Op[]): WorkspaceConfig => {
  const r = applyOps(createDefaultWorkspace('zh'), ops, { registry, locale: 'zh' });
  if (!r.ok) throw new Error(r.error);
  return r.config;
};
const quick: Op = {
  op: 'addWorkflow',
  workflow: {
    id: 'log',
    name: '记一笔',
    steps: [{ id: 'in', action: 'in.photos', params: { source: 'camera', min: 1, max: 1 } }],
  },
};
const daily: Op = {
  op: 'addReminder',
  reminder: {
    id: 'r',
    title: '记账',
    enabled: true,
    schedule: 'daily',
    time: '09:00',
    opens: 'workflow:log',
  },
};
const listNothing = async () => [];
const now = new Date(2026, 9, 22, 12);

describe('syncing reminders', () => {
  it('a new user without reminders is never asked for notification permission', async () => {
    const platform = new FakeNotifications();
    expect(await syncReminders(platform, withOps([]), listNothing, 'zh', now)).toBeNull();
    expect(platform.requests).toBe(0);
    expect(platform.scheduled).toEqual([]);
  });

  it('asks once when the first reminder appears, then schedules it', async () => {
    const platform = new FakeNotifications();
    const config = withOps([quick, daily]);
    expect(await syncReminders(platform, config, listNothing, 'zh', now)).toBe('granted');
    expect(platform.scheduled!.map((n) => [n.id, n.opens])).toEqual([['r', 'workflow:log']]);
    await syncReminders(platform, config, listNothing, 'zh', now);
    expect(platform.requests).toBe(1);
  });

  it('schedules nothing when the user said no, and clears them when the reminder is turned off', async () => {
    const platform = new FakeNotifications();
    platform.answer = false;
    expect(await syncReminders(platform, withOps([quick, daily]), listNothing, 'zh', now)).toBe(
      'denied',
    );
    expect(platform.scheduled).toBeNull();

    const allowed = new FakeNotifications();
    await syncReminders(allowed, withOps([quick, daily]), listNothing, 'zh', now);
    const off = withOps([
      quick,
      daily,
      { op: 'updateReminder', reminderId: 'r', changes: { enabled: false } },
    ]);
    await syncReminders(allowed, off, listNothing, 'zh', now);
    expect(allowed.scheduled).toEqual([]);
  });

  it('reads due dates from the records on this device only', async () => {
    const platform = new FakeNotifications();
    platform.status = 'granted';
    const config = withOps([
      {
        op: 'addCollection',
        collection: {
          id: 'bills',
          name: '账单',
          fields: [
            { id: 'name', name: '名字', type: 'text' },
            { id: 'due', name: '到期', type: 'date' },
          ],
        },
      },
      {
        op: 'addReminder',
        reminder: {
          id: 'due',
          title: '快到期了',
          enabled: true,
          schedule: 'dateField',
          time: '08:00',
          collectionId: 'bills',
          fieldId: 'due',
          daysBefore: 1,
          opens: 'page:home',
        },
      },
    ]);
    const asked: string[] = [];
    const list = async (id: string) => {
      asked.push(id);
      return [
        {
          id: 'b1',
          collectionId: id,
          values: { name: '房租', due: '2026-11-01' },
          createdAt: 0,
          updatedAt: 0,
        },
      ];
    };
    await syncReminders(platform, config, list, 'zh', now);
    expect(asked).toEqual(['bills']);
    expect(platform.scheduled!.map((n) => n.body)).toEqual([
      '「账单」里有一条记录还有 1 天到期（2026-11-01）',
    ]);
  });
});

describe('opening a reminder', () => {
  it('a quick action reminder goes to its reminder page, never to the run page', () => {
    expect(reminderDestination('workflow:log')).toEqual({ kind: 'workflow', workflowId: 'log' });
    expect(reminderDestination('page:home')).toEqual({ kind: 'target', target: 'page:home' });
  });

  it('the reminder page only shows the quick action; it starts when the user taps Start', async () => {
    const repo = new MemoryWorkspaceRepo();
    const files = new FakeFiles();
    const store = createWorkspaceStore({
      repo,
      provider: createMockAIProvider(),
      registry,
      locale: 'zh',
      now: () => now,
      seed: () => withOps([quick, daily]),
    });
    await store.getState().boot();
    await renderRouter(
      {
        _layout: () => (
          <WorkspaceProvider value={{ store, repo, files, registry, locale: 'zh' }}>
            <Stack />
          </WorkspaceProvider>
        ),
        'reminder/[workflowId]': ReminderRoute,
        'run/[workflowId]': RunRoute,
      },
      { initialUrl: '/reminder/log' },
    );
    expect(await screen.findByTestId('reminder-name')).toHaveTextContent('记一笔');
    expect(screen.queryByTestId('run-screen')).toBeNull();
    expect(await repo.listToolRuns(10)).toEqual([]);
    files.camera = [];
    await fireEvent.press(screen.getByTestId('reminder-run'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
  });
});
