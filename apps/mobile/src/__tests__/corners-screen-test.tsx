import { createDefaultWorkspace } from '@morph/core';
import { defaultQuad, type Quad } from '@morph/tool-image';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makePalette } from '../renderer/theme';
import { CornersScreen } from '../run/local/CornersScreen';

// 四角调整界面：逐张确认；找不到纸张时用内缩的默认框，也可以一键选整张照片。

const item = (name: string) => ({
  uri: `file:///run/${name}.jpg`,
  name,
  ext: 'jpg',
  mimeType: 'image/jpeg',
  size: 1,
  width: 3000,
  height: 4000,
});
const paper: Quad = {
  tl: { x: 300, y: 400 },
  tr: { x: 2700, y: 350 },
  br: { x: 2800, y: 3700 },
  bl: { x: 200, y: 3650 },
};

it('walks through the photos and returns the corners for each', async () => {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}>
      <CornersScreen
        input={{
          items: [
            { item: item('a'), quad: paper },
            { item: item('b'), quad: null },
          ],
        }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        onDone={onDone}
        onCancel={jest.fn()}
      />
    </SafeAreaProvider>,
  );
  expect(screen.getByText('调整四个角 1/2')).toBeTruthy();
  expect(screen.getByText('已找到纸张的边。不对的话，拖动四个角。')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(screen.getByText('没找到纸张的边，请把四个角拖到纸张的四个角上。')).toBeTruthy();
  expect(screen.queryByTestId('corners-detected')).toBeNull();
  await fireEvent.press(screen.getByTestId('corners-whole'));
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(onDone).toHaveBeenCalledWith([paper, defaultQuad({ width: 3000, height: 4000 }, 0)]);
});
