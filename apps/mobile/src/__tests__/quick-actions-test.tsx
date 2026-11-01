import {
  createStarterWorkspace,
  presetById,
  presetWorkflow,
  QUICK_ACTION_CATEGORIES,
  QUICK_ACTION_KINDS,
} from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';
import { useIncoming } from '../share/incoming';

describe('quick-action categories (UI)', () => {
  it('also opens as a configurable system tab with one undo banner', async () => {
    const { store } = await renderToolsApp();
    await act(async () => {
      await store
        .getState()
        .proposeOps(
          [{ op: 'updateContainer', nav: { bar: ['page:home', 'quickActions', 'settings'] } }],
          'setup',
        );
      await store.getState().confirm();
    });
    await fireEvent.press(await screen.findByTestId('nav-quickActions'));
    expect(await screen.findByTestId('category-document')).toBeTruthy();
    expect(screen.getAllByTestId('banner')).toHaveLength(1);
  });

  it('shows a quick action list and an icon-only button on the home page (D-230)', async () => {
    const { store } = await renderToolsApp();
    await act(async () => {
      await store.getState().proposeOps(
        [
          {
            op: 'addContainer',
            page: 'home',
            block: {
              id: 'photos',
              look: 'library',
              source: { catalog: 'quickActions', kind: 'image' },
            },
          },
          {
            op: 'addContainer',
            page: 'home',
            block: {
              id: 'open-ai',
              look: 'button',
              show: { label: '修改这个 App', variant: 'icon', icon: 'sparkles' },
              opens: 'ai',
            },
          },
        ],
        'setup',
      );
      await store.getState().confirm();
    });
    expect(await screen.findByLabelText('修改这个 App')).toBeTruthy();
    // 内设的直接列出来、直接运行（D-236）。
    await fireEvent.press(await screen.findByTestId('workflow-run-visa-photo'));
    expect(await screen.findByTestId('run-screen')).toBeTruthy();
  });

  it('opens the kernel library on a starter workspace', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      seed: createStarterWorkspace,
    });
    await screen.findByTestId('nav-settings');
    await act(() => router.push('/quick-actions'));
    for (const kind of QUICK_ACTION_KINDS)
      expect(await screen.findByTestId(`category-${kind}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('category-image'));
    await fireEvent.press(await screen.findByTestId('quick-actions-create'));
    const input = await screen.findByTestId('change-input');
    expect(input).toHaveProp('value', '我想要把图片');
    expect(input).toHaveProp('autoFocus', true);
    expect(input).toHaveProp('selection', { start: 6, end: 6 });
    // Editing the middle of the prefill must not snap the cursor to its end.
    await fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 2, end: 2 } } });
    expect(input.props.selection).toBeUndefined();
  });

  it.each(QUICK_ACTION_KINDS)('prefills the %s request without submitting it', async (kind) => {
    await renderToolsApp();
    await act(() => router.push({ pathname: '/quick-actions/[kind]', params: { kind } }));
    await fireEvent.press(await screen.findByTestId('quick-actions-create'));
    expect(await screen.findByTestId('change-input')).toHaveProp(
      'value',
      QUICK_ACTION_CATEGORIES[kind].prefill.zh,
    );
    expect(screen.queryByTestId('draft-bar')).toBeNull();
  });

  it('ranks own and built-in actions together by successful uses, ignoring failed runs', async () => {
    const repo = new MemoryWorkspaceRepo();
    for (const [workflowId, status] of [
      ['send-photos', 'succeeded'],
      ['send-photos', 'succeeded'],
      ['email-photos', 'succeeded'],
      ['video-too-big', 'succeeded'],
      ['unused', 'failed'],
      ['unused', 'failed'],
    ] as const) {
      const id = await repo.startToolRun({
        toolId: `workflow:${workflowId}`,
        workflowId,
        revisionId: 1,
      });
      await repo.finishToolRun(id, { status });
    }
    await renderToolsApp(repo, new FakeFiles(), {
      seed: (locale, registry) => {
        const config = createStarterWorkspace(locale, registry);
        config.tools.push(presetWorkflow(presetById('email-photos')!, locale, 'email-photos'));
        config.tools.unshift({
          kind: 'quickAction',
          id: 'unused',
          name: 'Unused',
          steps: [
            { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 1 } },
          ],
        });
        return config;
      },
    });
    await act(() => router.push('/quick-actions/image'));
    await waitFor(() =>
      expect(screen.getByTestId('workflow-email-photos')).toHaveTextContent(/用过\s*1\s*次/),
    );
    const rows = within(screen.getByTestId('quick-actions-image')).getAllByTestId(
      /^workflow-(?:send-photos|email-photos|unused|visa-photo)$/,
    );
    // 没用过的：自己的在内设的前面。
    expect(rows.map((row) => row.props.testID)).toEqual([
      'workflow-send-photos',
      'workflow-email-photos',
      'workflow-unused',
      'workflow-visa-photo',
    ]);
  });

  it('keeps mixed files while choosing a category, and releases them after returning from AI', async () => {
    const { files } = await renderToolsApp();
    const image = files.offer('a.jpg', TINY_JPEG, 'image/jpeg');
    const document = files.offer('a.pdf', TINY_JPEG, 'application/pdf');
    await act(async () => useIncoming.getState().receive([image, document], [], 'picker'));
    const shared = String(useIncoming.getState().share!.id);
    await act(() => router.push({ pathname: '/quick-actions', params: { shared } }));
    await fireEvent.press(await screen.findByTestId('category-image'));
    expect(await screen.findByTestId('quick-actions-image')).toBeTruthy();
    expect(useIncoming.getState().share?.files).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('quick-actions-create'));
    expect(await screen.findByTestId('change-input')).toHaveProp('value', '我想要把图片');
    await act(() => router.back());
    expect(await screen.findByTestId('quick-actions-image')).toBeTruthy();
    await act(() => router.back());
    await waitFor(() => expect(useIncoming.getState().share).toBeNull());
  });

  it('releases a shared batch when its category is dismissed', async () => {
    const { files } = await renderToolsApp();
    const photo = files.offer('a.jpg', TINY_JPEG, 'image/jpeg');
    await act(async () => useIncoming.getState().receive([photo], [], 'picker'));
    const shared = String(useIncoming.getState().share!.id);
    await act(() =>
      router.push({ pathname: '/quick-actions/[kind]', params: { kind: 'image', shared } }),
    );
    expect(await screen.findByTestId('quick-actions-image')).toBeTruthy();
    await act(() => router.back());
    await waitFor(() => expect(useIncoming.getState().share).toBeNull());
  });
});
