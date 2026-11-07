import { fireEvent, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

// 桌面工具栏有几组时，下面只排选中的那一组：测试要先点上面的页签。

const tabCount = () => screen.queryAllByTestId(/^desk-tab-\d+$/).length;

/** 每一组里的工具（testID），按页签的顺序接起来。 */
export async function allDeskTools(): Promise<string[]> {
  const ids = () =>
    within(screen.getByTestId('desk-toolbar'))
      .queryAllByTestId(/^desk-tool-/)
      .map((n) => String(n.props.testID));
  const n = tabCount();
  if (n === 0) return ids();
  const all: string[] = [];
  for (let i = 0; i < n; i++) {
    await fireEvent.press(screen.getByTestId(`desk-tab-${i}`));
    all.push(...ids());
  }
  await fireEvent.press(screen.getByTestId('desk-tab-0'));
  return all;
}

/** 点到这个工具所在的页签，返回这个工具。 */
export async function deskTool(testId: string) {
  await screen.findByTestId('desk-toolbar');
  const n = tabCount();
  for (let i = 0; i < n; i++) {
    const found = screen.queryByTestId(testId);
    if (found) return found;
    await fireEvent.press(screen.getByTestId(`desk-tab-${i}`));
  }
  return screen.getByTestId(testId);
}
