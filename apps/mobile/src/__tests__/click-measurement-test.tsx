import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { useIncoming } from '../share/incoming';
import { makePdf } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// D-200：真实路由的 App 内点击计数；假选择器 / 媒体平台，不冒充模拟器、系统分享或耗时测量。
// D-449：首页只有一个「打开文件」，先选相册还是文件，比以前多一下。
afterEach(() => useIncoming.getState().clear());
it.each([
  // 一份文件进预览页，要先点开「快捷操作」面板再点运行，比以前多一下（D-457）；两张照片仍进收件页面，不变。
  ['video-too-big', 'media', 5],
  ['pdf-too-big', 'files', 5],
  ['document-packet', 'media', 7],
] as const)(
  '%s (%s): first and second use finish with %i App taps',
  async (preset, source, expected) => {
    const { files } = await renderToolsApp(undefined, undefined, { seed: starterAfterGuide });
    const traces: string[][] = [];
    for (const iteration of [0, 1]) {
      const trace: string[] = [];
      const press = async (id: string) => {
        await fireEvent.press(await screen.findByTestId(id, {}, { timeout: 3000 }));
        trace.push(id);
      };
      if (preset === 'video-too-big')
        files.nextMedia = [files.offerVideo('clip.mov', { size: 120 * 1024 * 1024 })];
      else if (preset === 'pdf-too-big')
        files.nextPick = [files.offer('document.pdf', await makePdf(2), 'application/pdf')];
      else
        files.nextMedia = [
          files.offerImage('id-front.jpg', 1000, 630),
          files.offerImage('id-back.jpg', 1000, 630),
        ];
      jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
        buttons?.[source === 'media' ? 0 : 1]?.onPress?.();
      });
      await press('file-pick-open');
      trace.push(`choose-${source}`);
      if (preset !== 'document-packet') await press('preview-more');
      await press(`share-run-${preset}`);
      if (preset === 'document-packet') {
        await screen.findByText('裁剪 1/2', {}, { timeout: 3000 });
        await press('local-done');
        await screen.findByText('裁剪 2/2');
        await press('local-done');
        await screen.findByTestId('reorder-item-0');
        await press('local-done');
      }
      await press('prompt-ok');
      await screen.findByTestId('run-result', {}, { timeout: 3000 });
      expect(files.shared).toHaveLength(iteration + 1);
      expect(trace).toHaveLength(expected);
      traces.push(trace);
      // 完成后回首页的动作不算在「得到可分享结果」之内。
      await fireEvent.press(screen.getByTestId('run-done'));
    }
    expect(traces.map((trace) => trace.length)).toEqual([expected, expected]);
  },
);
