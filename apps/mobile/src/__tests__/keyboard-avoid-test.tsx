import { applyOps, createDefaultWorkspace, type Locale, type Registry } from '@morph/core';
import { act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Platform } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 真机（三星，Android edge-to-edge）上看到的：窗口不会因为键盘变小，记录表单下面的字段被键盘盖住，用户看不到自己在打什么。
// 所以 Android 上表单也要留出键盘的高度，不能只有 iOS 留。

const mockBehaviors: (string | undefined)[] = [];
jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const View = jest.requireActual('react-native/Libraries/Components/View/View');
  return {
    __esModule: true,
    default: ({ behavior, ...props }: { behavior?: string }) => {
      mockBehaviors.push(behavior);
      return createElement(View.default ?? View, props);
    },
  };
});

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      {
        op: 'addData',
        table: { id: 'notes', name: '笔记', fields: [{ id: 'title', name: '标题', type: 'text' }] },
      },
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

describe('Android', () => {
  const os = Platform.OS;
  beforeEach(() =>
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true }),
  );
  afterEach(() => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }));

  it('the record form leaves room for the keyboard', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed });
    mockBehaviors.length = 0;
    await act(() =>
      router.push({ pathname: '/record/[collectionId]', params: { collectionId: 'notes' } }),
    );
    await screen.findByTestId('editor-save');
    expect(mockBehaviors.length).toBeGreaterThan(0);
    expect(mockBehaviors.at(-1)).toBe('padding');
  });
});
