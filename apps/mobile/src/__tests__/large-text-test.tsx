import { applyOps, type Locale, type Registry } from '@morph/core';
import { fireEvent, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// 大字号（D-258）：字号最大 150%。页面内容按 1.5 倍放大；底部导航栏和草稿栏一行排满，
// 字最多放大到 1.3 倍（之前的上限），免得挤出屏幕或被截断。布局本身要在模拟器上看（见验收清单）。

const largest = (locale: Locale, registry: Registry) => {
  const base = starterAfterGuide(locale, registry);
  const result = applyOps(base, [{ op: 'setTheme', fontScale: 1.5 }], { registry, locale });
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const fontSize = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never)?.fontSize as number | undefined;

describe('largest text size (D-258)', () => {
  it('page text is 1.5×; bottom bar labels stop at 1.3× and stay on one line', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: largest });
    const tab = await screen.findByTestId('nav-settings');
    const label = screen.getAllByText('设置').find((n) => fontSize(n) !== undefined)!;
    expect(tab).toBeTruthy();
    expect(fontSize(label)).toBe(Math.round(12 * 1.3));
    expect(label.props.numberOfLines).toBe(1);
    // 页面内容照常放大。
    await fireEvent.press(tab);
    await screen.findByTestId('settings-ai');
    expect(screen.getAllByText('设置').map(fontSize)).toContain(Math.round(28 * 1.5));
  });

  it('draft bar labels stop at 1.3× too', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { seed: largest });
    await fireEvent.press(await screen.findByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '主题换成绿色');
    await fireEvent.press(screen.getByTestId('change-submit'));
    const apply = await screen.findByTestId('draft-apply');
    expect(apply).toBeTruthy();
    for (const label of ['应用', '退一步', '离开']) {
      const text = within(screen.getByTestId('draft-bar')).getByText(label);
      expect(fontSize(text)).toBe(Math.round(11 * 1.3));
    }
  });
});
