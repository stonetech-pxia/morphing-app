import { act, fireEvent, within } from '@testing-library/react-native';
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

  it('lists the newest files with thumbnails; tapping one previews it, “All” opens the all-files page', async () => {
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
    // 点一行进文件预览页（D-457），不是系统预览；返回回到首页。
    await fireEvent.press(screen.getByTestId('file-扫描 11月5日.pdf'));
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    expect(files.previewed).toEqual([]);
    await act(() => router.back());
    // D-453：「全部」打开全部文件页面（不是存储空间）：搜索、排序、类型筛选，没有固定按钮。
    await fireEvent.press(screen.getByTestId('files-all'));
    const page = await screen.findByTestId('files-screen');
    const order = () =>
      within(page)
        .getAllByTestId(/^file-/)
        .map((n) => String(n.props.testID).replace('file-', ''))
        .filter((id) => !id.startsWith('thumb-'));
    expect(order()).toEqual(['合同.docx', '扫描 11月5日.pdf', '收据.jpg', '旧的.pdf']);
    await fireEvent.press(within(page).getByTestId('files-sort-name'));
    // 按名称：中文按拼音（合 he、旧 jiu、扫 sao、收 shou）。
    expect(order()).toEqual(['合同.docx', '旧的.pdf', '扫描 11月5日.pdf', '收据.jpg']);
    await fireEvent.press(within(page).getByTestId('files-kind-pdf'));
    expect(order()).toEqual(['旧的.pdf', '扫描 11月5日.pdf']);
    await fireEvent.changeText(within(page).getByTestId('files-search'), '旧');
    expect(order()).toEqual(['旧的.pdf']);
    await fireEvent.changeText(within(page).getByTestId('files-search'), '没有这个');
    expect(within(page).getByTestId('files-none')).toHaveTextContent('没有找到相符的文件');
    await fireEvent.changeText(within(page).getByTestId('files-search'), '');
    await fireEvent.press(within(page).getByTestId('files-kind-all'));
    await fireEvent.press(within(page).getByTestId('file-收据.jpg'));
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    expect(files.previewed).toEqual([]);
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
