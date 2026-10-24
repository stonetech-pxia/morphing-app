import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { FrameScreen } from '../run/local/FrameScreen';

it('selects and nudges each video independently and clamps to the available duration', async () => {
  const onDone = jest.fn();
  const onCancel = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}>
      <FrameScreen
        input={{
          items: ['a', 'b'].map((name) => ({
            uri: `file:///${name}.mp4`,
            name,
            ext: 'mp4',
            mimeType: 'video/mp4',
            size: 1,
            durationMs: 2000,
          })),
          loadThumbnails: async () => [],
        }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        onDone={onDone}
        onCancel={onCancel}
      />
    </SafeAreaProvider>,
  );
  await fireEvent.press(screen.getByTestId('frame-nudge--1000'));
  expect(screen.getByTestId('frame-time')).toHaveTextContent('0:00.0');
  await fireEvent(screen.getByTestId('frame-timeline'), 'layout', {
    nativeEvent: { layout: { width: 200 } },
  });
  await fireEvent.press(screen.getByTestId('frame-timeline'), { nativeEvent: { locationX: 100 } });
  expect(screen.getByTestId('frame-time')).toHaveTextContent('0:01.0');
  await fireEvent.press(screen.getByTestId('frame-nudge-100'));
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByTestId('frame-time')).toHaveTextContent('0:00.0');
  for (let n = 0; n < 3; n++) await fireEvent.press(screen.getByTestId('frame-nudge-1000'));
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(onDone).toHaveBeenCalledWith([1100, 1999]);
  await fireEvent.press(screen.getByTestId('local-cancel'));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
