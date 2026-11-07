import { applyOps, createDefaultWorkspace, type Locale, type Registry } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { listDesks } from '../desk/store';
import { useGuide } from '../guide/store';
import { useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { deskTool } from '../test-utils/desk-toolbar';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// 2026-11-06 模拟器测试：新记录表单填了字、桌上加了水印 / 改了格子，返回就悄悄没了。
// 现在有没保存的改动时先问「放弃修改？」；保存过的、没改过的直接走。桌面不留着（D-462）。

const seed = (locale: Locale, registry: Registry) => {
  const r = applyOps(
    createDefaultWorkspace(locale),
    [
      {
        op: 'addData',
        table: { id: 'notes', name: '笔记', fields: [{ id: 'name', name: '标题', type: 'text' }] },
      },
    ],
    { registry, locale },
  );
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

function alerts() {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  return {
    spy,
    press: async (label: string) => {
      const buttons = (spy.mock.lastCall?.[2] ?? []) as AlertButton[];
      await act(async () => {
        buttons.find((b) => b.text === label)!.onPress?.();
      });
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  useIncoming.getState().clear();
});

async function openForm() {
  const repo = new MemoryWorkspaceRepo();
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  const app = await renderToolsApp(repo, undefined, { locale: 'zh', seed });
  await act(async () => {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
  });
  await act(() =>
    router.push({ pathname: '/record/[collectionId]', params: { collectionId: 'notes' } }),
  );
  await screen.findByTestId('editor-save');
  return app;
}

describe('new record form', () => {
  afterEach(() => useGuide.setState({ stage: null, repo: null }));
  it('asks before throwing away what was typed', async () => {
    await openForm();
    const { spy, press } = alerts();
    await fireEvent.changeText(screen.getByTestId('editor-name'), '买菜');
    await act(() => router.back());
    expect(spy).toHaveBeenCalledWith('放弃修改？', expect.any(String), expect.any(Array));
    expect(screen.getByTestId('editor-save')).toBeTruthy();
    await press('继续编辑');
    expect(screen.getByTestId('editor-name').props.value).toBe('买菜');

    await act(() => router.back());
    await press('放弃');
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
  });

  it('leaves without asking when nothing was typed or after saving', async () => {
    await openForm();
    const { spy } = alerts();
    await act(() => router.back());
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());

    await act(() =>
      router.push({ pathname: '/record/[collectionId]', params: { collectionId: 'notes' } }),
    );
    await fireEvent.changeText(await screen.findByTestId('editor-name'), '买菜');
    await fireEvent.press(screen.getByTestId('editor-save'));
    await waitFor(() => expect(screen.queryByTestId('editor-save')).toBeNull());
    expect(spy).not.toHaveBeenCalledWith('放弃修改？', expect.anything(), expect.anything());
  });
});

describe('desk', () => {
  async function openDesk() {
    const files = new FakeFiles();
    await renderToolsApp(new MemoryWorkspaceRepo(), files);
    const photo = files.offer('IMG_1.jpg', TINY_JPEG, 'image/jpeg');
    await act(async () => useIncoming.getState().receive([photo], [], 'picker'));
    await act(() => router.push('/share'));
    await fireEvent.press(await screen.findByTestId('preview-edit'));
    await screen.findByTestId('desk-toolbar');
    return files;
  }

  it('asks before leaving with changes; discarding clears the desk', async () => {
    const files = await openDesk();
    await fireEvent.press(await deskTool('desk-tool-image.rotate'));
    await fireEvent.press(await screen.findByTestId('prompt-ok'));
    await waitFor(() => expect(screen.getByTestId('desk-undo')).not.toBeDisabled());
    const { spy, press } = alerts();
    await fireEvent.press(screen.getByTestId('desk-close'));
    expect(spy).toHaveBeenCalledWith('放弃修改？', expect.any(String), expect.any(Array));
    expect(screen.getByTestId('desk-screen')).toBeTruthy();
    await press('放弃');
    await waitFor(() => expect(screen.queryByTestId('desk-screen')).toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await listDesks(files)).toEqual([]);
  });

  it('has no “keep on desk” and leaves an unchanged desk without asking', async () => {
    const files = await openDesk();
    await fireEvent.press(screen.getByTestId('desk-done'));
    expect(screen.queryByTestId('desk-leave')).toBeNull();
    expect(screen.queryByTestId('desk-clear')).toBeNull();
    await fireEvent.press(screen.getByTestId('desk-sheet-cancel'));
    const { spy } = alerts();
    await fireEvent.press(screen.getByTestId('desk-close'));
    await waitFor(() => expect(screen.queryByTestId('desk-screen')).toBeNull());
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await listDesks(files)).toEqual([]);
  });
});
