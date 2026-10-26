import { createDefaultWorkspace, initialParams, type Workflow } from '@morph/core';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { dismissChain, recordChain } from '../run/chains';
import { copyResults, releaseShare, useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp, testRegistry } from '../test-utils/render-app';

const first: Workflow = {
  id: 'resize',
  name: '缩小照片',
  steps: [
    { id: 'input', action: 'in.photos', params: { source: 'library', min: 1, max: 10 } },
    { id: 'resize', action: 'image.resize', params: { mode: 'longEdge', px: 1600 } },
  ],
};
const second: Workflow = {
  id: 'pdf',
  name: '照片做成 PDF',
  steps: [
    first.steps[0]!,
    {
      id: 'pdf',
      action: 'pdf.fromImages',
      params: initialParams(testRegistry.actions.get('pdf.fromImages')!),
    },
  ],
};
afterEach(() => {
  useIncoming.getState().clear();
  jest.restoreAllMocks();
});

it('counts distinct successful transfers, resets on edits and keeps order', async () => {
  const repo = new MemoryWorkspaceRepo();
  expect(await recordChain(repo, first, second, 'transfer-1')).toBe(false);
  expect(await recordChain(repo, first, second, 'transfer-1')).toBe(false);
  expect(await recordChain(repo, second, first, 'transfer-2')).toBe(false);
  expect(await recordChain(repo, first, second, 'transfer-2')).toBe(true);
  expect(await recordChain(repo, first, { ...second, name: 'changed' }, 'transfer-3')).toBe(false);
});

it('stops suggesting a combination after combining or saying no, until either changes', async () => {
  const repo = new MemoryWorkspaceRepo();
  await recordChain(repo, first, second, 'transfer-1');
  expect(await recordChain(repo, first, second, 'transfer-2')).toBe(true);
  await dismissChain(repo, first, second);
  expect(await recordChain(repo, first, second, 'transfer-3')).toBe(false);
  expect(await recordChain(repo, first, second, 'transfer-4')).toBe(false);
  const edited = { ...second, name: 'changed' };
  await recordChain(repo, first, edited, 'transfer-5');
  expect(await recordChain(repo, first, edited, 'transfer-6')).toBe(true);
});

it('rolls back a partial result copy and preserves the source', async () => {
  const files = new FakeFiles();
  const photo = files.offerImage('private.jpg', 2000, 1000);
  const item = {
    uri: photo.uri,
    name: 'private',
    ext: 'jpg',
    mimeType: 'image/jpeg',
    size: photo.size!,
  };
  const copy = jest.spyOn(files, 'copyToRun');
  copy.mockImplementationOnce(async (...args) => {
    copy.mockRestore();
    return files.copyToRun(...args);
  });
  await expect(copyResults(files, [item, { ...item, uri: 'gone' }], 'handoff')).rejects.toThrow();
  expect([...files.disk.keys()].filter((k) => k.startsWith('runs/handoff/'))).toEqual([]);
  expect(files.disk.has(photo.uri)).toBe(true);
});

it('continues without saving or picking again; two transfers offer AI with both definitions', async () => {
  const app = await renderToolsApp(undefined, undefined, {
    seed: (locale) => ({ ...createDefaultWorkspace(locale), workflows: [first, second] }),
  });
  const picker = jest.spyOn(app.files, 'pickPhotos');
  async function transfer() {
    app.files.nextPhotos = [app.files.offerImage('private-id.jpg', 3000, 2000)];
    await act(async () =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: first.id } }),
    );
    await screen.findByTestId('run-result', {}, { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('result-continue'));
    await screen.findByTestId('share-screen');
    const incoming = useIncoming.getState().share!;
    expect(incoming.source).toBe('result');
    expect(app.files.disk.has(incoming.files[0]!.uri)).toBe(true);
    // 上一页的运行目录已经删除，只有独立交接副本留下。
    expect(
      [...app.files.disk.keys()]
        .filter((k) => k.startsWith('runs/'))
        .every((k) => k.startsWith(`runs/${incoming.result!.runId}/`)),
    ).toBe(true);
    await fireEvent.press(await screen.findByTestId('share-run-pdf'));
    await screen.findByTestId('run-result', {}, { timeout: 3000 });
    expect(await app.repo.listAssets()).toEqual([]);
    return incoming;
  }
  const one = await transfer();
  expect(screen.queryByTestId('chain-card')).toBeNull();
  await fireEvent.press(screen.getByTestId('run-again'));
  await screen.findByTestId('run-result', {}, { timeout: 3000 });
  expect(screen.queryByTestId('chain-card')).toBeNull();
  await fireEvent.press(screen.getByTestId('run-done'));
  await waitFor(() => expect(app.files.disk.has(one.files[0]!.uri)).toBe(false));
  const two = await transfer();
  await fireEvent.press(await screen.findByTestId('chain-make'));
  expect(await screen.findByTestId('change-about')).toHaveTextContent(
    '先「缩小照片」，再「照片做成 PDF」',
  );
  expect(screen.getByTestId('change-input').props.value).toContain('按这个顺序');
  expect(picker).toHaveBeenCalledTimes(2);
  await act(async () => router.dismissAll());
  await waitFor(() => expect(app.files.disk.has(two.files[0]!.uri)).toBe(false));
});

it('combining with a built-in quick action saves it first so AI can see both (D-236)', async () => {
  const app = await renderToolsApp(undefined, undefined, {
    seed: (locale) => ({ ...createDefaultWorkspace(locale), workflows: [first] }),
  });
  async function transfer() {
    app.files.nextPhotos = [app.files.offerImage('private-id.jpg', 3000, 2000)];
    await act(async () =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: first.id } }),
    );
    await screen.findByTestId('run-result', {}, { timeout: 3000 });
    await fireEvent.press(screen.getByTestId('result-continue'));
    await screen.findByTestId('share-screen');
    // 第一次在「查看全部」里，用过之后排到前面。
    if (!screen.queryByTestId('share-run-email-photos'))
      await fireEvent.press(await screen.findByTestId('share-see-all'));
    await fireEvent.press(await screen.findByTestId('share-run-email-photos'));
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    await screen.findByTestId('run-result', {}, { timeout: 3000 });
  }
  await transfer();
  await fireEvent.press(screen.getByTestId('run-done'));
  await transfer();
  expect(app.store.getState().config!.workflows.map((w) => w.id)).toEqual(['resize']);
  await fireEvent.press(await screen.findByTestId('chain-make'));
  expect(await screen.findByTestId('change-about')).toHaveTextContent(
    '先「缩小照片」，再「照片发邮件 / 传网站」',
  );
  expect(app.store.getState().config!.workflows.map((w) => w.id)).toEqual([
    'resize',
    'email-photos',
  ]);
  await act(async () => router.dismissAll());
}, 20000);

it('releasing an older result preserves new incoming files and originals', async () => {
  const files = new FakeFiles();
  const photo = files.offerImage('original.jpg', 2000, 1000);
  const picked = await copyResults(
    files,
    [{ uri: photo.uri, name: 'original', ext: 'jpg', mimeType: 'image/jpeg', size: photo.size! }],
    'result-old',
  );
  useIncoming.getState().receive(picked, [], 'result', { runId: 'result-old', workflow: first });
  const old = useIncoming.getState().share!.id;
  useIncoming.getState().receive([photo], [], 'picker');
  await releaseShare(files, old);
  expect(files.disk.has(picked[0]!.uri)).toBe(false);
  expect(files.disk.has(photo.uri)).toBe(true);
  expect(useIncoming.getState().share!.source).toBe('picker');
  await releaseShare(files, useIncoming.getState().share!.id);
});

it('cleans a result batch after cancelling AI and then closing the inbox', async () => {
  const { files } = await renderToolsApp();
  const photo = files.offerImage('source.jpg', 1000, 600);
  const picked = await copyResults(
    files,
    [{ uri: photo.uri, name: 'source', ext: 'jpg', mimeType: 'image/jpeg', size: photo.size! }],
    'ai-cancel',
  );
  await act(async () => {
    useIncoming.getState().receive(picked, [], 'result', { runId: 'ai-cancel', workflow: first });
    router.push('/share');
  });
  await fireEvent.press(await screen.findByTestId('share-ask-ai'));
  await screen.findByTestId('change-about');
  await act(async () => router.back());
  await screen.findByTestId('share-screen');
  await act(async () => router.back());
  await waitFor(() => expect(files.disk.has(picked[0]!.uri)).toBe(false));
  expect(files.disk.has(photo.uri)).toBe(true);
});

it('replacing the open result inbox cleans only the replaced batch', async () => {
  const { files } = await renderToolsApp();
  const photo = files.offerImage('source.jpg', 1000, 600);
  const picked = await copyResults(
    files,
    [{ uri: photo.uri, name: 'source', ext: 'jpg', mimeType: 'image/jpeg', size: photo.size! }],
    'replace-result',
  );
  await act(async () => {
    useIncoming
      .getState()
      .receive(picked, [], 'result', { runId: 'replace-result', workflow: first });
    router.push('/share');
  });
  await screen.findByTestId('share-screen');
  await act(async () => useIncoming.getState().receive([photo], [], 'picker'));
  await waitFor(() => expect(files.disk.has(picked[0]!.uri)).toBe(false));
  expect(useIncoming.getState().share!.files[0]!.uri).toBe(photo.uri);
  await act(async () => router.back());
});

it('applies an AI combination through normal function changes and can undo it', async () => {
  const { store } = await renderToolsApp(undefined, undefined, {
    seed: (locale) => ({ ...createDefaultWorkspace(locale), workflows: [first, second] }),
  });
  const combined: Workflow = {
    id: 'combined',
    name: '缩小并做成 PDF',
    steps: [...first.steps, second.steps[1]!],
  };
  let result: unknown;
  await act(async () => {
    result = await store
      .getState()
      .change(
        '合成',
        { plan: async () => ({ kind: 'ops', ops: [{ op: 'addWorkflow', workflow: combined }] }) },
        { about: { kind: 'chain', first: first.id, second: second.id } },
      );
  });
  expect(result).toMatchObject({ kind: 'applied' });
  expect(store.getState().config!.workflows).toEqual([first, second, combined]);
  expect(JSON.stringify(store.getState().config!.pages)).not.toContain('combined');
  expect(store.getState().banner?.undoTo).toBeDefined();
  await act(async () => store.getState().undo());
  expect(store.getState().config!.workflows).toEqual([first, second]);
});
