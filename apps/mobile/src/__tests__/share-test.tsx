import {
  BUILTIN_TOOLS,
  WORKFLOW_PRESETS,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  initialParams,
  presetWorkflow,
  type AskRequest,
  type Workflow,
} from '@morph/core';
import { act, fireEvent, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { PDFDocument } from 'pdf-lib';

import type { PickedFile } from '../runtime/platform';
import { startRun } from '../runtime/runner';
import { nativeCopies, normalizeShare, useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, TINY_JPEG, makePdf } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';
import type { WorkspaceStore } from '../workspace/store';

// 分享到 Morph（TOOLS_DESIGN §11）：原生部分（expo-share-intent）换成假的，只测 JS 侧的收件、选工作流、
// 类型匹配和大小上限。

type MockListener = (e: { value: unknown }) => void;

jest.mock('expo-share-intent', () => {
  const listeners = new Map<string, MockListener>();
  return {
    ShareIntentModule: {
      addListener: (name: string, fn: MockListener) => {
        listeners.set(name, fn);
        return { remove: () => listeners.get(name) === fn && listeners.delete(name) };
      },
      getShareIntent: jest.fn(),
      clearShareIntent: jest.fn(async () => undefined),
      /** 模拟原生模块收到一次分享。 */
      emit: (value: unknown) => listeners.get('onChange')?.({ value }),
    },
  };
});

const native = () =>
  (
    jest.requireMock('expo-share-intent') as {
      ShareIntentModule: { emit(value: unknown): void; clearShareIntent: jest.Mock };
    }
  ).ShareIntentModule;

/** iOS 分享扩展写的 JSON（plugins/share-extension/ShareViewController.swift）。 */
const iosPayload = (files: PickedFile[]) =>
  JSON.stringify({
    files: files.map((f) => ({
      path: f.uri,
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.mimeType,
      type: f.mimeType?.startsWith('image/') ? 0 : 2,
    })),
    type: 'file',
  });

const registry = createRegistry(BUILTIN_TOOLS);
const pdfFromImages = registry.actions.get('pdf.fromImages')!;
const preset = (id: string) =>
  presetWorkflow(
    WORKFLOW_PRESETS.find((p) => p.id === id)!,
    'zh',
    id,
  );

describe('normalizeShare', () => {
  it('reads the iOS extension JSON', () => {
    const raw = iosPayload([
      { uri: 'file:///group/A.pdf', name: '报告.pdf', size: 1351, mimeType: 'application/pdf' },
    ]);
    expect(normalizeShare(raw)).toEqual([
      { uri: 'file:///group/A.pdf', name: '报告.pdf', size: 1351, mimeType: 'application/pdf' },
    ]);
  });

  it('uses the content:// address on Android, not the storage path', () => {
    expect(
      normalizeShare({
        files: [
          {
            contentUri: 'content://media/external/images/media/12',
            filePath: '/storage/emulated/0/DCIM/IMG_1.jpg',
            fileName: 'IMG_1.jpg',
            fileSize: '2048',
            mimeType: 'image/jpeg',
            width: '4000',
            height: '3000',
          },
          // expo-share-intent 9.0.0 单个文件时多塞的一项（Kotlin Pair），跳过。
          { first: 'type', second: 'file' },
        ],
        type: 'file',
      }),
    ).toEqual([
      {
        uri: 'content://media/external/images/media/12',
        name: 'IMG_1.jpg',
        size: 2048,
        mimeType: 'image/jpeg',
        width: 4000,
        height: 3000,
      },
    ]);
  });

  it('remembers the copies the Android module made in the app cache, to delete them later', () => {
    expect(
      nativeCopies({
        files: [
          {
            contentUri: 'content://com.google.android.apps.photos.contentprovider/-1/1/x',
            filePath: '/data/user/0/app.morph.mobile/cache/lease.jpg',
          },
          { contentUri: 'content://media/external/images/media/12', filePath: '/storage/x.jpg' },
        ],
      }),
    ).toEqual(['file:///data/user/0/app.morph.mobile/cache/lease.jpg']);
    expect(nativeCopies('{"files":[]}')).toEqual([]);
  });

  it('takes no text, links or broken data', () => {
    expect(normalizeShare({ text: 'hello', type: 'text' })).toEqual([]);
    expect(normalizeShare('{ not json')).toEqual([]);
    expect(normalizeShare(null)).toEqual([]);
    expect(normalizeShare({ files: [{ path: '/etc/passwd', fileName: 'x' }] })).toEqual([]);
  });
});

describe('running a workflow on shared files', () => {
  function setup(workflow: Workflow) {
    const files = new FakeFiles();
    const asked: string[] = [];
    const run = (incoming: PickedFile[]) =>
      startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date(2026, 9, 23, 9, 0),
        newId: () => `id${Math.random()}`,
        ui: { confirm: async () => false, choose: async () => null, open: async () => null },
        incoming,
        askParams: async (request: AskRequest) => {
          asked.push(request.step.action);
          return {};
        },
      });
    return { files, asked, run };
  }

  it('the first step takes the shared files instead of opening a picker or asking', async () => {
    const wf: Workflow = {
      id: 'w',
      name: 'w',
      steps: [
        {
          id: 'pick',
          action: 'in.photos',
          params: { source: 'camera', min: 1, max: 5 },
          ask: ['source'],
        },
        { id: 'pdf', action: 'pdf.fromImages', params: initialParams(pdfFromImages) },
      ],
    };
    const { files, asked, run } = setup(wf);
    files.camera = []; // 打开相机会得到「取消」。
    const shared = [
      files.offerShared('a.jpg', TINY_JPEG, 'image/jpeg'),
      files.offerShared('b.JPG', TINY_JPEG, null),
    ];
    const { result } = await run(shared);
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(asked).toEqual([]);
    // 原件留在共享目录（「再来一次」还要用），关闭运行页面时才删。
    expect(files.sharedFiles()).toHaveLength(2);
  });

  it('keeps picked media available after disposal for another run', async () => {
    const { files, run } = setup({
      id: 'video',
      name: 'video',
      steps: [{ id: 'pick', action: 'in.videos', params: { source: 'library', min: 1, max: 10 } }],
    });
    const video = files.offerVideo('picked.mp4', { size: 1000, durationMs: 1000 }, 'video/mp4');
    const first = await run([video]);
    expect(first.result.status).toBe('succeeded');
    await first.dispose();
    expect(files.disk.has(video.uri)).toBe(true);
    const second = await run([video]);
    expect(second.result.status).toBe('succeeded');
    await second.dispose();
  });

  it('checks the type and count like a picker would', async () => {
    const merge = applyOps(createDefaultWorkspace('zh'), [{ op: 'installTool', toolId: 'pdf' }], {
      registry,
      locale: 'zh',
    });
    if (!merge.ok) throw new Error(merge.error);
    const wf = merge.config.workflows.find((w) => w.steps[0]!.params.min === 2)!;
    const { files, run } = setup(wf);
    const pdf = files.offerShared('a.pdf', await makePdf(1));
    const photo = files.offerShared('b.jpg', TINY_JPEG, 'image/jpeg');
    expect((await run([pdf, photo])).result).toMatchObject({
      status: 'failed',
      error: { code: 'wrongType' },
      stepIndex: 0,
    });
    expect((await run([pdf])).result).toMatchObject({
      status: 'failed',
      error: { code: 'tooFew', detail: { min: 2 } },
    });
  });

  it('applies the size limit (P-006)', async () => {
    const { files, run } = setup(preset('visa-photo'));
    const big = {
      ...files.offerShared('big.jpg', TINY_JPEG, 'image/jpeg'),
      size: 60 * 1024 * 1024,
    };
    expect((await run([big])).result).toMatchObject({
      status: 'failed',
      error: { code: 'tooLarge', detail: { name: 'big.jpg', mb: 50 } },
    });
  });
});

describe('share journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function setupApp() {
    const app = await renderToolsApp();
    const store: WorkspaceStore = app.store;
    const result = await store.getState().proposeOps(
      [
        { op: 'installTool', toolId: 'pdf' },
        { op: 'addWorkflow', workflow: preset('visa-photo') },
        { op: 'addWorkflow', workflow: preset('sign-return') },
      ],
      '准备',
    );
    expect(result.kind).toBe('preview');
    await act(() => store.getState().confirm());
    const used = await app.repo.startToolRun({
      toolId: 'workflow:sign-return',
      workflowId: 'sign-return',
      revisionId: 1,
    });
    await app.repo.finishToolRun(used, { status: 'succeeded' });
    const merge = store.getState().config!.workflows.find((w) => w.steps[0]!.params.min === 2)!;
    return { ...app, merge };
  }

  const share = (files: PickedFile[]) => act(async () => native().emit(iosPayload(files)));

  it('lists the workflows that fit, runs the chosen one and cleans up afterwards', async () => {
    const { files, repo, merge } = await setupApp();
    const shared = [
      files.offerShared('报告.pdf', await makePdf(2)),
      files.offerShared('附录.pdf', await makePdf(3)),
    ];
    await share(shared);

    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(native().clearShareIntent).toHaveBeenCalledWith('morphShareKey');
    expect(screen.queryByText('报告.pdf')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-files-toggle'));
    expect(screen.getByText('报告.pdf')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('share-see-all'));
    // 合并 PDF 接得上；签回表格只收 1 个，列出来但不能运行；证件照只收照片，不列出。
    expect(screen.getByTestId(`share-run-${merge.id}`)).toBeTruthy();
    expect(screen.getByTestId('share-workflow-sign-return')).toBeTruthy();
    expect(screen.queryByTestId('share-run-sign-return')).toBeNull();
    expect(
      within(screen.getByTestId('share-workflow-sign-return')).getByText('最多 1 个文件'),
    ).toBeTruthy();
    expect(screen.queryByTestId('share-workflow-visa-photo')).toBeNull();
    // 不会自动运行。
    expect(screen.queryByTestId('run-screen')).toBeNull();

    await fireEvent.press(screen.getByTestId(`share-run-${merge.id}`));
    expect(await screen.findByText('分享进来的文件（2 个）')).toBeTruthy();
    // 合并 PDF 每次运行时问文件名。
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    expect(await screen.findByTestId('result-item-报告-合并.pdf')).toBeTruthy();
    const [asset] = await repo.listAssets();
    const merged = await PDFDocument.load(await files.readBytes(asset!.path));
    expect(merged.getPageCount()).toBe(5);
    expect(files.sharedFiles()).toHaveLength(2);

    // 关掉运行页面：共享目录里的副本删掉，待处理的分享清空。
    await act(() => router.back());
    expect(files.sharedFiles()).toEqual([]);
    expect(useIncoming.getState().share).toBeNull();
  });

  it('has no save button and clears the shared copies when dismissed', async () => {
    const { files, repo } = await setupApp();
    await share([files.offerShared('IMG_1.jpg', TINY_JPEG, 'image/jpeg')]);
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(screen.queryByTestId('share-save')).toBeNull();
    await act(() => router.back());
    expect(await repo.listAssets()).toEqual([]);
    expect(files.sharedFiles()).toEqual([]);
  });

  it('refuses files over the size limit and removes them when the page is closed', async () => {
    const { files } = await setupApp();
    await share([{ ...files.offerShared('huge.pdf', await makePdf(1)), size: 51 * 1024 * 1024 }]);
    expect(await screen.findByTestId('share-too-large')).toBeTruthy();
    expect(screen.getByText('「huge.pdf」超过 50 MB，暂不支持。')).toBeTruthy();
    expect(screen.queryByTestId('share-save')).toBeNull();
    expect(screen.queryByText('运行')).toBeNull();

    await act(() => router.back());
    expect(files.sharedFiles()).toEqual([]);
    expect(useIncoming.getState().share).toBeNull();
  });

  it('Android: reads the content:// address and deletes the module’s cache copy afterwards', async () => {
    const { files } = await setupApp();
    const content = 'content://com.google.android.apps.photos.contentprovider/-1/1/lease';
    const copy = 'file:///data/user/0/app.morph.mobile/cache/lease.jpg';
    files.disk.set(content, TINY_JPEG);
    files.disk.set(copy, TINY_JPEG);
    await act(async () =>
      native().emit({
        files: [
          {
            contentUri: content,
            filePath: copy.slice('file://'.length),
            fileName: 'lease.jpg',
            fileSize: String(TINY_JPEG.length),
            mimeType: 'image/jpeg',
          },
          ['type', 'file'],
        ],
        type: 'file',
      }),
    );
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('share-files-toggle'));
    expect(screen.getByText('lease.jpg')).toBeTruthy();
    expect(screen.getByTestId('share-run-visa-photo')).toBeTruthy();
    await act(() => router.back());
    expect(files.disk.has(copy)).toBe(false);
    expect(files.disk.has(content)).toBe(true);
  });

  it('takes shared videos: shows their length, offers the video quick actions and compresses in place', async () => {
    const { files } = await setupApp();
    const MB = 1024 * 1024;
    const trip = files.offerShared('trip.MOV', new Uint8Array(120 * MB), 'video/quicktime');
    files.videos.set(trip.uri, {
      kind: 'video',
      durationMs: 75_000,
      size: 120 * MB,
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
    await share([trip]);
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('share-files-toggle'));
    expect(screen.getByText('trip.MOV')).toBeTruthy();
    expect(await screen.findByText('1:15 · 120.0 MB')).toBeTruthy();
    // 证件照、合并 PDF 都不收视频；现成的「视频太大发不出去」可以添加并运行（视频不超过 4 GB，不受 50 MB 限制）。
    expect(screen.queryByTestId('share-too-large')).toBeNull();
    expect(screen.queryByTestId('share-workflow-visa-photo')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-preset-add-video-too-big'));
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    expect(await screen.findByTestId('result-item-trip.mp4')).toBeTruthy();
    // 分享进来的原件原地使用，不复制进运行目录。
    expect(files.adopted).toEqual([trip.uri]);
    expect(files.runFiles()).toHaveLength(1);
  });

  it('says so when nothing usable was shared', async () => {
    await setupApp();
    await act(() => native().emit({ text: 'hello', type: 'text' }));
    expect(await screen.findByTestId('share-none')).toBeTruthy();
  });

  it('a run opened for an old share that is gone says so instead of opening a picker', async () => {
    const { merge } = await setupApp();
    await act(() =>
      router.push({
        pathname: '/run/[workflowId]',
        params: { workflowId: merge.id, shared: '99' },
      }),
    );
    expect(await screen.findByText('这些文件已经不在了，请重新分享。')).toBeTruthy();
  });
});
