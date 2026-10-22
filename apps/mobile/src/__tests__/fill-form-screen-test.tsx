import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { FillFormScreen } from '../run/local/FillFormScreen';

// 填表界面：按字段类型生成输入，只返回改过的字段；标准字体写不了的文字不能提交。

const item = {
  uri: 'file:///run/form.pdf',
  name: 'form',
  ext: 'pdf',
  mimeType: 'application/pdf',
  size: 1,
};
const fields = [
  { name: 'full_name', type: 'text', value: '' },
  { name: 'agree', type: 'checkbox', value: false },
  { name: 'country', type: 'dropdown', options: ['France', 'Japan'] },
  { name: 'office_use', type: 'text', readOnly: true },
  { name: 'signature', type: 'other' },
];

async function open() {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}>
      <FillFormScreen
        input={{ item, fields }}
        palette={makePalette(createDefaultWorkspace('en').theme, false)}
        locale="en"
        onDone={onDone}
        onCancel={jest.fn()}
      />
    </SafeAreaProvider>,
  );
  return onDone;
}

describe('fill-in form screen', () => {
  it('shows only editable fields and returns what the user changed', async () => {
    const onDone = await open();
    expect(screen.getByText('full_name')).toBeTruthy();
    expect(screen.queryByText('office_use')).toBeNull();
    expect(screen.queryByText('signature')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('form-text-0'), 'Ada Lovelace');
    await fireEvent(screen.getByTestId('form-check-1'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('form-option-2-1'));
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(onDone).toHaveBeenCalledWith({
      full_name: 'Ada Lovelace',
      agree: true,
      country: 'Japan',
    });
  });

  it('blocks text the form font cannot show', async () => {
    const onDone = await open();
    await fireEvent.changeText(screen.getByTestId('form-text-0'), '张三');
    expect(
      screen.getByText('This form can only hold Latin letters, digits and common symbols.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(onDone).not.toHaveBeenCalled();
  });
});
