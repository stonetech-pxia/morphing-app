import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnnotateScreen } from '../run/local/AnnotateScreen';
import { makePalette } from '../renderer/theme';

jest.mock('../runtime/skia', () => ({
  textLayout: () => ({
    font: { getSize: () => 20, setSize: () => {} },
    width: 100,
    height: 30,
    baseline: 24,
  }),
}));

it('places local text in the selected color, undoes it and walks through photos', async () => {
  const onDone = jest.fn();
  const onCancel = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}>
      <AnnotateScreen
        input={{
          items: ['one', 'two'].map((name) => ({
            uri: `file:///${name}.png`,
            name,
            ext: 'png',
            mimeType: 'image/png',
            size: 1,
            width: 1000,
            height: 500,
          })),
        }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        onDone={onDone}
        onCancel={onCancel}
      />
    </SafeAreaProvider>,
  );
  await fireEvent(screen.getByTestId('annotate-area'), 'layout', {
    nativeEvent: { layout: { width: 200, height: 100 } },
  });
  await fireEvent.press(screen.getByTestId('annotate-tool-text'));
  await fireEvent.changeText(screen.getByTestId('annotate-text'), '只留在本机');
  await fireEvent.press(screen.getByTestId('annotate-color-2'));
  const event = {
    nativeEvent: { locationX: 20, locationY: 20 },
    touchHistory: {
      numberActiveTouches: 0,
      indexOfSingleActiveTouch: -1,
      touchBank: [],
      mostRecentTimeStamp: 1,
    },
  };
  await fireEvent(screen.getByTestId('annotate-drawing'), 'responderGrant', event);
  expect(screen.getByTestId('annotate-label-0')).toHaveProp('accessibilityLabel', '只留在本机');
  await fireEvent.press(screen.getByTestId('annotate-undo'));
  expect(screen.queryByTestId('annotate-label-0')).toBeNull();
  await fireEvent(screen.getByTestId('annotate-drawing'), 'responderGrant', event);
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByTestId('annotate-count')).toHaveTextContent('0/100 处');
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(onDone).toHaveBeenCalledWith([
    [
      expect.objectContaining({
        kind: 'text',
        text: '只留在本机',
        color: '#2563EB',
        point: { x: 100, y: 100 },
      }),
    ],
    [],
  ]);
  await fireEvent.press(screen.getByTestId('local-cancel'));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
