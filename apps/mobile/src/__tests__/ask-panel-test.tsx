import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { makePalette } from '../renderer/theme';
import { AskPanel } from '../run/AskPanel';
import { testRegistry } from '../test-utils/render-app';

const idPhoto = testRegistry.actions.get('image.idPhoto')!;

function ask(onAnswer = jest.fn()) {
  return render(
    <AskPanel
      request={{
        step: { id: 'id', action: 'image.idPhoto', params: {} },
        action: idPhoto,
        keys: ['spec', 'maxKB'],
        params: { spec: 'us-passport', maxKB: 240 },
        input: null,
      }}
      palette={makePalette(createDefaultWorkspace('zh').theme, false)}
      locale="zh"
      now={new Date(2026, 9, 26)}
      onAnswer={onAnswer}
    />,
  );
}

describe('run-time ask panel', () => {
  it('lists each ID photo size once, and picking one also sets its size limit', async () => {
    const onAnswer = jest.fn();
    await ask(onAnswer);
    // 规格只出现在「规格」这一组里，不再在上面重复一排一样的按钮。
    expect(screen.queryByTestId('ask-preset-cn-visa')).toBeNull();
    expect(screen.getAllByText('中国签证 33×48 毫米')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('ask-spec-cn-visa'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    // 中国签证没有大小要求：跟着规格变成 0（不限），和原来点规格按钮一样。
    expect(onAnswer).toHaveBeenCalledWith({ spec: 'cn-visa', maxKB: 0 });
  });

  it('scrolls when the questions are taller than the screen, so OK stays reachable', async () => {
    await ask();
    expect(screen.getByTestId('ask-scroll')).toBeTruthy();
    // 「确定」不在滚动区域里，内容再长也在屏幕上。
    expect(screen.getByTestId('ask-scroll')).not.toContainElement(screen.getByTestId('prompt-ok'));
  });
});
