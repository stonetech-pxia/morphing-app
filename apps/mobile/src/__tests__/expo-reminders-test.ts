import type { PlannedNotification } from '@morph/core';

// 换一批提醒（D-319）时，系统随时可能挂起 App（例如后台点了「完成」）。中途停下也不能把还要的提醒取消掉：
// 只取消不要的、只排新的或变了的。

const mockPending = new Map<string, { identifier: string; content: Record<string, unknown> }>();
/** 还能过几次桥；到 0 之后的调用永远不返回（App 被挂起）。 */
let mockBudget = Infinity;
const mockCalls: string[] = [];
const mockBridge = <T>(name: string, run: () => T): Promise<T> => {
  mockCalls.push(name);
  if (mockBudget <= 0) return new Promise<T>(() => {});
  mockBudget--;
  return Promise.resolve(run());
};

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', DATE: 'date' },
  getAllScheduledNotificationsAsync: () => mockBridge('list', () => [...mockPending.values()]),
  cancelScheduledNotificationAsync: (id: string) =>
    mockBridge(`cancel ${id}`, () => mockPending.delete(id)),
  scheduleNotificationAsync: (req: { identifier: string; content: Record<string, unknown> }) =>
    mockBridge(`schedule ${req.identifier}`, () => {
      mockPending.set(req.identifier, { identifier: req.identifier, content: req.content });
      return req.identifier;
    }),
}));

// eslint-disable-next-line import/first
import { expoReminders } from '../reminders/expo-reminders';

const at = (day: number) => new Date(2026, 9, 22 + day, 20).getTime();
const n = (record: string, day: number): PlannedNotification => ({
  id: `habit-${record}-${day}`,
  reminderId: 'habit',
  title: record,
  body: '该做了',
  trigger: { kind: 'date', at: at(day) },
  opens: 'page:home',
  recordId: record,
  buttons: 'doneSnooze',
});
const week = (record: string, from = 0) => Array.from({ length: 7 }, (_, i) => n(record, from + i));

beforeEach(() => {
  mockPending.clear();
  mockCalls.length = 0;
  mockBudget = Infinity;
});

describe('replacing the planned reminders (D-319)', () => {
  it('stopped half way (the app is suspended), the reminders still wanted are all kept', async () => {
    const platform = expoReminders('提醒');
    const before = [...week('run'), ...week('read'), ...week('water')];
    await platform.replaceAll(before);
    expect(mockPending.size).toBe(21);

    // 浇水做完了：今天那次不要了，往后加一次。只有两次过桥的时间就被挂起。
    const after = [...week('run'), ...week('read'), ...week('water', 1)];
    mockBudget = 2;
    void platform.replaceAll(after);
    await new Promise((r) => setTimeout(r, 0));
    const wanted = new Set(after.map((x) => x.id));
    const kept = [...mockPending.keys()].filter((id) => wanted.has(id));
    // 跑步、读书的 14 条和浇水还要的 6 条都还在。
    expect(kept.length).toBeGreaterThanOrEqual(20);
  });

  it('only touches what changed: unchanged ones are not cancelled or scheduled again', async () => {
    const platform = expoReminders('提醒');
    await platform.replaceAll([...week('run'), ...week('water')]);
    mockCalls.length = 0;
    await platform.replaceAll([...week('run'), ...week('water', 1)]);
    expect(mockCalls).toEqual(['list', 'cancel habit-water-0', 'schedule habit-water-7']);
  });

  it('a changed time or text is scheduled again under the same id', async () => {
    const platform = expoReminders('提醒');
    await platform.replaceAll([n('run', 0)]);
    mockCalls.length = 0;
    await platform.replaceAll([{ ...n('run', 0), trigger: { kind: 'date', at: at(0) + 60_000 } }]);
    expect(mockCalls).toEqual(['list', 'schedule habit-run-0']);
    expect(mockPending.size).toBe(1);
  });

  it('snoozes stay; Morph’s old notifications that are no longer planned go', async () => {
    const platform = expoReminders('提醒');
    await platform.replaceAll([n('run', 0)]);
    await platform.snooze({ ...n('run', 0), id: 'snooze-habit-run' });
    await platform.replaceAll([]);
    expect([...mockPending.keys()]).toEqual(['snooze-habit-run']);
  });
});
