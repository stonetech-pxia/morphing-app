import { createDefaultWorkspace, initialParams, type Workflow } from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, testRegistry } from '../test-utils/render-app';

// 结果页点缩略图打开全屏预览（D-277）：图片在 App 里全屏看、左右滑；PDF 等用系统预览。

const photos: Workflow = {
  id: 'resize',
  name: '缩小照片',
  steps: [
    { id: 'input', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
    { id: 'resize', action: 'image.resize', params: { mode: 'longEdge', px: 1600 } },
  ],
};
const pdf: Workflow = {
  id: 'pdf',
  name: '照片做成 PDF',
  steps: [
    photos.steps[0]!,
    {
      id: 'pdf',
      action: 'pdf.fromImages',
      params: initialParams(testRegistry.actions.get('pdf.fromImages')!),
    },
  ],
};

async function run(wf: Workflow, files: FakeFiles) {
  await renderToolsApp(undefined, files, {
    seed: (locale) => ({ ...createDefaultWorkspace(locale), workflows: [photos, pdf] }),
  });
  files.nextPhotos = [1, 2].map((n) => files.offerImage(`scan-${n}.jpg`, 3000, 2000));
  await act(async () =>
    router.push({ pathname: '/run/[workflowId]', params: { workflowId: wf.id } }),
  );
  await screen.findByTestId('run-result', {}, { timeout: 3000 });
}

it('opens the result images full screen from their thumbnails, swiping through all of them', async () => {
  const files = new FakeFiles();
  await run(photos, files);
  await fireEvent.press(screen.getByTestId('result-open-scan-2.jpg'));
  expect(await screen.findByTestId('share-viewer')).toBeTruthy();
  // 从点的那一张开始，一共两张。
  expect(screen.getByTestId('share-viewer-count')).toHaveTextContent('2 / 2');
  await fireEvent.press(screen.getByTestId('share-viewer-close'));
  expect(screen.queryByTestId('share-viewer')).toBeNull();
});

it('opens a result PDF in the system preview', async () => {
  const files = new FakeFiles();
  await run(pdf, files);
  const row = screen.getAllByTestId(/^result-open-/)[0]!;
  await fireEvent.press(row);
  expect(files.previewed).toHaveLength(1);
  expect(files.previewed[0]!.mimeType).toBe('application/pdf');
});
