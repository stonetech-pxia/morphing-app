import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnnotateScreen } from '../run/local/AnnotateScreen';
import { makePalette } from '../renderer/theme';

jest.mock('../runtime/skia', () => ({
  textLayout: () => ({ paragraph: {}, pad: 4, width: 100, height: 30 }),
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
        point: { x: 50, y: 85 },
      }),
    ],
    [],
  ]);
  await fireEvent.press(screen.getByTestId('local-cancel'));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('highlighter draws a wide, half-transparent stroke even for a single tap', async () => {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}>
      <AnnotateScreen
        input={{
          items: [
            {
              uri: 'file:///p.png',
              name: 'p',
              ext: 'png',
              mimeType: 'image/png',
              size: 1,
              width: 1000,
              height: 500,
            },
          ],
        }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        onDone={onDone}
        onCancel={() => {}}
      />
    </SafeAreaProvider>,
  );
  await fireEvent(screen.getByTestId('annotate-area'), 'layout', {
    nativeEvent: { layout: { width: 200, height: 100 } },
  });
  await fireEvent.press(screen.getByTestId('annotate-tool-highlight'));
  await fireEvent.press(screen.getByTestId('annotate-color-6'));
  const touch = (x: number, y: number) => ({
    nativeEvent: { locationX: x, locationY: y },
    touchHistory: {
      numberActiveTouches: 0,
      indexOfSingleActiveTouch: -1,
      touchBank: [],
      mostRecentTimeStamp: 1,
    },
  });
  await fireEvent(screen.getByTestId('annotate-drawing'), 'responderGrant', touch(20, 20));
  await fireEvent(screen.getByTestId('annotate-drawing'), 'responderRelease', touch(20, 20));
  await fireEvent.press(screen.getByTestId('local-done'));
  const [[marks]] = onDone.mock.calls[0]!;
  expect(marks).toEqual([
    expect.objectContaining({ kind: 'highlight', color: '#FACC1566', width: 14 }),
  ]);
});

it('a placed text gets a style panel: size and rotation sliders, edit the words, delete', async () => {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      }}>
      <AnnotateScreen
        input={{
          tool: 'text',
          items: [
            {
              uri: 'file:///p.png',
              name: 'p',
              ext: 'png',
              mimeType: 'image/png',
              size: 1,
              width: 1000,
              height: 500,
            },
          ],
        }}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        onDone={onDone}
        onCancel={() => {}}
      />
    </SafeAreaProvider>,
  );
  await fireEvent(screen.getByTestId('annotate-area'), 'layout', {
    nativeEvent: { layout: { width: 200, height: 100 } },
  });
  // 起手工具来自参数：直接是「文字」，没有先输入文字也能点一下放一个默认文字。
  expect(screen.getByTestId('annotate-tool-text')).toBeSelected();
  expect(screen.queryByTestId('annotate-style')).toBeNull();
  const touch = (x: number, y: number) => ({
    nativeEvent: { locationX: x, locationY: y },
    touchHistory: {
      numberActiveTouches: 0,
      indexOfSingleActiveTouch: -1,
      touchBank: [],
      mostRecentTimeStamp: 1,
    },
  });
  await fireEvent(screen.getByTestId('annotate-drawing'), 'responderGrant', touch(100, 50));
  expect(screen.getByTestId('annotate-label-0')).toHaveProp('accessibilityLabel', '文字');
  expect(screen.getByTestId('annotate-style')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('annotate-style-text'), '你好，签证');
  expect(screen.getByTestId('annotate-label-0')).toHaveProp('accessibilityLabel', '你好，签证');
  // 滑块：按在最右边 = 旋转到最大。
  await fireEvent(screen.getByTestId('annotate-rotation'), 'layout', {
    nativeEvent: { layout: { width: 200, height: 28 } },
  });
  await fireEvent(screen.getByTestId('annotate-rotation'), 'responderGrant', touch(100, 10));
  await fireEvent(screen.getByTestId('annotate-rotation'), 'responderRelease', touch(100, 10));
  await fireEvent.press(screen.getByTestId('local-done'));
  expect(onDone.mock.calls[0]![0][0][0]).toMatchObject({
    kind: 'text',
    text: '你好，签证',
    rotation: 180,
  });
  expect(screen.queryByTestId('annotate-delete')).toBeTruthy();
});
