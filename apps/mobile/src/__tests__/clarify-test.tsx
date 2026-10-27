import { type AIProvider, type PlanContext } from '@morph/core';
import { fireEvent, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// 模糊或自相矛盾的要求先问清楚（D-256）：AI 不直接大改，回一句说明和 2–3 个可以点的具体说法。

const OPTIONS = ['主题换成深蓝色', '字体大一点', '卡片改成圆角更大的样式'];

/** 模型的回复：用拒绝的形式（reason unclear）带上可以直接发送的选项。 */
const asking: AIProvider = {
  async plan(input: string, _ctx: PlanContext) {
    return input === '让它好看一点'
      ? {
          kind: 'reject',
          reason: 'unclear',
          message: '「好看一点」可以有很多种改法，你想先改哪一样？',
          examples: OPTIONS,
        }
      : { kind: 'ops', ops: [{ op: 'setTheme', fontScale: 1.15 }] };
  },
};

describe('vague requests (D-256)', () => {
  it('changes nothing, shows the question and 2–3 options; tapping one fills the box', async () => {
    const { store } = await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      seed: starterAfterGuide,
      provider: asking,
    });
    const head = store.getState().head!.id;
    await fireEvent.press(await screen.findByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), '让它好看一点');
    await fireEvent.press(screen.getByTestId('change-submit'));

    const feedback = await screen.findByTestId('change-feedback');
    expect(feedback).toHaveTextContent(/你想先改哪一样/);
    const options = within(feedback).getByTestId('change-feedback-examples');
    for (const option of OPTIONS) expect(options).toHaveTextContent(new RegExp(option));
    // 问清楚不是「做不到」：不出「把这个需求发给我们」。
    expect(screen.queryByTestId('need-send')).toBeNull();
    expect(store.getState().head!.id).toBe(head);
    expect(store.getState().draft).toBeNull();

    await fireEvent.press(within(options).getByText('字体大一点'));
    expect(screen.getByTestId('change-input')).toHaveProp('value', '字体大一点');
  });
});
