import { createDefaultWorkspace, type Workflow } from '@morph/core';
import { act, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 运行页上正在做的那一步（D-276）：有「正在处理」的转圈，处理多张时写出是第几张。

const wf: Workflow = {
  id: 'resize',
  name: '缩小照片',
  steps: [
    { id: 'input', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
    { id: 'resize', action: 'image.resize', params: { mode: 'longEdge', px: 1600 } },
  ],
};

it('shows a spinner and which image is being processed, from the first one on', async () => {
  const files = new FakeFiles();
  // 每张图都卡住，直到测试放行。
  const gates: (() => void)[] = [];
  const transform = files.transformImage.bind(files);
  jest
    .spyOn(files, 'transformImage')
    .mockImplementation(
      (...args: Parameters<typeof files.transformImage>) =>
        new Promise((resolve) => gates.push(() => resolve(transform(...args)))),
    );
  await renderToolsApp(undefined, files, {
    seed: (locale) => ({ ...createDefaultWorkspace(locale), workflows: [wf] }),
  });
  files.nextPhotos = [1, 2, 3].map((n) => files.offerImage(`p${n}.jpg`, 3000, 2000));
  await act(async () =>
    router.push({ pathname: '/run/[workflowId]', params: { workflowId: wf.id } }),
  );
  await waitFor(() => expect(gates).toHaveLength(1), { timeout: 3000 });
  // 第一张还没处理完，就已经看得出在处理第 1 张。
  expect(screen.getByTestId('run-step-resize')).toHaveTextContent(/第 1\/3 张/);
  expect(screen.getByTestId('run-busy-resize')).toBeTruthy();
  await act(async () => gates.shift()!());
  await waitFor(() => expect(gates).toHaveLength(1));
  expect(screen.getByTestId('run-step-resize')).toHaveTextContent(/第 2\/3 张/);
  await act(async () => gates.shift()!());
  await waitFor(() => expect(gates).toHaveLength(1));
  await act(async () => gates.shift()!());
  await screen.findByTestId('run-result', {}, { timeout: 3000 });
  expect(screen.queryByTestId('run-busy-resize')).toBeNull();
});
