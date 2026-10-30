// 打 release 包时，Expo 会在 web 平台上把路由先跑一遍（导出服务端清单），入口最先加载的
// reminders/background.ts 也会被执行。web 上 expo-notifications 没有 getLastNotificationResponse，
// 一调用就抛错，整个打包失败。web 上不能去听通知按钮。

jest.mock('expo-notifications', () => ({
  registerTaskAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => {
    throw new Error('ExpoNotifications.getLastNotificationResponse is not available on web');
  }),
  clearLastNotificationResponse: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('../../modules/morph-background', () => ({ __esModule: true, default: null }));
jest.mock('../storage/open', () => ({ openRepo: jest.fn() }));
jest.mock('../reminders/reminder-actions', () => ({ handleReminderAction: jest.fn() }));
jest.mock('../i18n', () => ({ getDeviceLocale: () => 'zh', t: () => '提醒' }));
jest.mock('../reminders/expo-reminders', () => {
  const notifications = jest.requireMock('expo-notifications');
  return {
    expoReminders: () => ({
      onAction: () => {
        notifications.getLastNotificationResponse();
        return () => undefined;
      },
    }),
    reminderActionOf: () => null,
    setupReminderButtons: jest.fn(async () => undefined),
  };
});

it('loads on web without listening to notification buttons', () => {
  jest.useFakeTimers();
  const load = () =>
    jest.isolateModules(() => {
      // 换成 web 必须在同一份隔离的模块里，background.ts 读的就是这一份。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Platform } = require('react-native');
      Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../reminders/background');
    });
  expect(load).not.toThrow();
  jest.useRealTimers();
});
