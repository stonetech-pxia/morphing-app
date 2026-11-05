import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// D-450–D-452：新用户首页的「最近操作」（读运行记录）和「最近文件」（缩略图、点开预览、「全部」）。

async function start(prepare?: (repo: MemoryWorkspaceRepo, files: FakeFiles) => Promise<void>) {
  const repo = new MemoryWorkspaceRepo();
  const files = new FakeFiles();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  const app = await renderToolsApp(repo, files, { seed: starterAfterGuide });
  if (prepare) {
    await act(() => prepare(repo, files));
    await act(async () => app.store.setState((s) => ({ assetsVersion: s.assetsVersion + 1 })));
  }
  return app;
}

afterEach(() => useGuide.setState({ stage: null, repo: null }));

describe('home: recent actions and recent files', () => {
  it('a new user sees no recent actions and an inviting empty file box', async () => {
    await start();
    expect(await screen.findByTestId('files-empty')).toHaveTextContent(
      '扫描或保存的文件会出现在这里',
    );
    expect(screen.queryByTestId('recent-actions')).toBeNull();
    expect(screen.queryByTestId('files-all')).toBeNull();
  });

  it('lists the newest files with thumbnails; tapping one previews it, “All” opens storage', async () => {
    const { files } = await start(async (repo, f) => {
      for (const [id, name, mimeType, at] of [
        ['a1', '收据.jpg', 'image/jpeg', 1],
        ['a2', '扫描 11月5日.pdf', 'application/pdf', 2],
        [
          'a3',
          '合同.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          3,
        ],
        ['a4', '旧的.pdf', 'application/pdf', 0],
      ] as const) {
        await repo.addAsset({
          id,
          name,
          mimeType,
          size: 10,
          path: `assets/${id}/${name}`,
          source: 'generated',
          createdAt: at,
        });
      }
      f.thumbnails_.set('assets/a2/扫描 11月5日.pdf', 'file:///fake/assets/a2/.thumb.jpg');
    });
    // 最近 3 个，从新到旧；图片用原图、PDF 用第一页，Word 用图标。
    expect(await screen.findByTestId('file-合同.docx')).toBeTruthy();
    expect(screen.getByTestId('file-扫描 11月5日.pdf')).toHaveTextContent(/PDF/);
    expect(screen.queryByTestId('file-旧的.pdf')).toBeNull();
    expect(screen.getByTestId('file-thumb-a1')).toBeTruthy();
    expect(screen.getByTestId('file-thumb-a2')).toBeTruthy();
    expect(screen.queryByTestId('file-thumb-a3')).toBeNull();
    await fireEvent.press(screen.getByTestId('file-扫描 11月5日.pdf'));
    expect(files.previewed).toEqual([
      { uri: 'file:///fake/assets/a2/扫描 11月5日.pdf', mimeType: 'application/pdf' },
    ]);
    await fireEvent.press(screen.getByTestId('files-all'));
    expect(await screen.findByTestId('storage-file-a1')).toBeTruthy();
  });

  it('shows quick actions that ran successfully, newest first; tapping one opens its run page', async () => {
    await start(async (repo) => {
      const run = async (workflowId: string, ok = true) => {
        const id = await repo.startToolRun({ toolId: 'x', workflowId, revisionId: 1 });
        await repo.finishToolRun(id, { status: ok ? 'succeeded' : 'failed' });
      };
      await run('scan-camera');
      await run('pdf-merge');
      await run('pdf-compress', false);
    });
    // 运行记录在回到首页时读（跑完快捷操作回来就有）：离开再回来。
    await act(() => router.push('/storage'));
    await act(() => router.back());
    const list = await screen.findByTestId('recent-actions');
    expect(list).toHaveTextContent(/扫描成 PDF/);
    expect(screen.queryByTestId('recent-pdf-compress')).toBeNull();
    await fireEvent.press(screen.getByTestId('recent-scan-camera'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
  });
});
