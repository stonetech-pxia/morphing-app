import {
  applyOps,
  type AskRequest,
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createRegistry,
  initialParams,
  presetWorkflow,
  quickActionsOf,
  type Workflow,
  WORKFLOW_PRESETS,
} from '@morph/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { PDFDocument } from 'pdf-lib';

import { listDesks } from '../desk/store';
import type { PickedFile } from '../runtime/platform';
import { startRun } from '../runtime/runner';
import { nativeCopies, normalizeShare, useIncoming } from '../share/incoming';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles, FakeVision, TINY_JPEG, makePdf } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';
import type { WorkspaceStore } from '../workspace/store';

// 分享到 Tinkrum（TOOLS_DESIGN §11）：原生部分（expo-share-intent）换成假的，只测 JS 侧的收件、选工作流、
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
      kind: 'quickAction',
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
      kind: 'quickAction',
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

  it('a rename right after the inbox files copies them instead of moving them', async () => {
    const { files, run } = setup({
      kind: 'quickAction',
      id: 'video',
      name: 'video',
      steps: [
        { id: 'pick', action: 'in.videos', params: { source: 'library', min: 1, max: 10 } },
        { id: 'name', action: 'file.rename', params: { template: '{sourceName}-x' } },
      ],
    });
    const video = files.offerVideo('picked.mp4', { size: 1000, durationMs: 1000 }, 'video/mp4');
    const first = await run([video]);
    expect(first.result.status).toBe('succeeded');
    expect(files.disk.has(video.uri)).toBe(true);
    await first.dispose();
    // 「再来一次」：原来那份还在。
    expect((await run([video])).result.status).toBe('succeeded');
  });

  it('checks the type and count like a picker would', async () => {
    const merge = applyOps(
      createDefaultWorkspace('zh'),
      [{ op: 'setPackage', package: 'pdf', do: 'add' }],
      {
        registry,
        locale: 'zh',
      },
    );
    if (!merge.ok) throw new Error(merge.error);
    const wf = quickActionsOf(merge.config).find((w) => w.steps[0]!.params.min === 2)!;
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
        { op: 'setPackage', package: 'pdf', do: 'add' },
        { op: 'addTool', tool: preset('visa-photo') },
        { op: 'addTool', tool: preset('sign-return') },
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
    const merge = quickActionsOf(store.getState().config!).find(
      (w) => w.steps[0]!.params.min === 2,
    )!;
    return { ...app, merge };
  }

  const share = (files: PickedFile[]) => act(async () => native().emit(iosPayload(files)));

  it('lists the workflows that fit, runs the chosen one and cleans up afterwards', async () => {
    const { files, merge } = await setupApp();
    const shared = [
      files.offerShared('报告.pdf', await makePdf(2)),
      files.offerShared('附录.pdf', await makePdf(3)),
    ];
    await share(shared);

    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(native().clearShareIntent).toHaveBeenCalledWith('morphShareKey');
    // 文件一直列在页面上，没有展开收起（D-457）。
    expect(screen.getByText('报告.pdf')).toBeTruthy();
    expect(screen.queryByTestId('share-files-toggle')).toBeNull();
    expect(screen.queryByTestId('share-desk')).toBeNull();
    // 「查看全部」在这一页展开：收这些文件的都在，用过但个数不对的说明原因，收不了的不出现。
    await fireEvent.press(screen.getByTestId('share-see-all'));
    expect(screen.queryByTestId('share-see-all')).toBeNull();
    expect(screen.getByTestId(`share-run-${merge.id}`)).toBeTruthy();
    expect(screen.queryByTestId('share-run-sign-return')).toBeNull();
    expect(
      within(screen.getByTestId('share-workflow-sign-return')).getByText('最多 1 个文件'),
    ).toBeTruthy();
    expect(screen.queryByTestId('share-workflow-visa-photo')).toBeNull();
    expect(screen.queryByTestId('run-screen')).toBeNull();
    await fireEvent.press(screen.getByTestId(`share-run-${merge.id}`));
    // 运行时不摆出步骤列表（D-457）：只有转圈和一句在做什么。
    expect(await screen.findByTestId('run-compact')).toBeTruthy();
    expect(screen.queryByTestId('run-step-pick')).toBeNull();
    // 合并 PDF 每次运行时问文件名。
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    // 结果是一个文件：不停在结果页，直接进它的预览页（D-457）；收到的两个文件跟着运行页面释放。
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    const result = useIncoming.getState().share!;
    expect(result.source).toBe('result');
    const merged = await PDFDocument.load(await files.readUri(result.files[0]!.uri));
    expect(merged.getPageCount()).toBe(5);
    expect(files.sharedFiles()).toEqual([]);
    expect(screen.queryByTestId('run-screen')).toBeNull();

    // 关掉预览页：结果的副本删掉，待处理的清空。
    await act(() => router.back());
    expect(useIncoming.getState().share).toBeNull();
    expect(files.disk.has(result.files[0]!.uri)).toBe(false);
  });

  // D-455：分享进来的文件留一份在文档库；收件的临时副本关掉时照样删掉。
  it('has no save button, keeps the file in the library and clears the shared copies when dismissed', async () => {
    const { files, repo } = await setupApp();
    await share([files.offerShared('IMG_1.jpg', TINY_JPEG, 'image/jpeg')]);
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    expect(screen.queryByTestId('share-save')).toBeNull();
    expect((await repo.listAssets()).map((a) => [a.name, a.source])).toEqual([
      ['IMG_1.jpg', 'picked'],
    ]);
    await act(() => router.back());
    expect(await repo.listAssets()).toHaveLength(1);
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
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preview-more'));
    expect(await screen.findByTestId('share-workflow-visa-photo')).toBeTruthy();
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
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preview-more'));
    // 证件照、合并 PDF 都不收视频；内设的「视频太大发不出去」直接运行（视频不超过 4 GB，不受 50 MB 限制）。
    expect(screen.queryByTestId('share-too-large')).toBeNull();
    expect(await screen.findByTestId('share-workflow-video-too-big')).toBeTruthy();
    expect(screen.queryByTestId('share-workflow-visa-photo')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-run-video-too-big'));
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    expect(await screen.findByTestId('result-item-trip.mp4')).toBeTruthy();
    // 分享进来的原件原地使用，不复制进运行目录。
    expect(files.adopted).toEqual([trip.uri]);
    expect(files.runFiles()).toHaveLength(1);
  });

  it('one photo opens its preview page; the five most common quick actions come first in the panel (D-237, D-457)', async () => {
    const { files } = await renderToolsApp();
    await share([files.offerShared('IMG_0001.jpg', TINY_JPEG, 'image/jpeg')]);
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    // 一份文件直接是预览页，不是收件页面：没有「我要自己说」，Tink 在右上角。
    expect(screen.queryByTestId('share-ask-ai')).toBeNull();
    expect(screen.getByTestId('page-ai')).toBeTruthy();
    expect(screen.getByTestId('desk-preview-image')).toBeTruthy();
    // 进来什么都不跑。
    expect(screen.queryByTestId('run-screen')).toBeNull();
    await fireEvent.press(screen.getByTestId('preview-more'));
    await screen.findByTestId('preview-panel-more');
    // 「更多」按做的事分类（格式转换、智能处理、管理、快捷操作），最常用的几个都在里面。
    const ids = screen.getAllByTestId(/^share-workflow-/).map((n) => n.props.testID as string);
    expect(ids).toEqual(
      expect.arrayContaining([
        'share-workflow-email-photos',
        'share-workflow-scan-document',
        'share-workflow-scan-table-excel',
        'share-workflow-document-packet',
        'share-workflow-visa-photo',
      ]),
    );
    expect(screen.getByTestId('preview-more-convert')).toBeTruthy();
    expect(screen.getByTestId('preview-more-quick')).toBeTruthy();
  });

  it('a photo has edit and to-Word buttons; a video only edit; both are plain buttons that run nothing on open (D-457)', async () => {
    const { files } = await renderToolsApp();
    await share([files.offerShared('IMG_0001.jpg', TINY_JPEG, 'image/jpeg')]);
    expect(await screen.findByTestId('preview-word')).toBeTruthy();
    expect(screen.getByTestId('preview-edit')).toHaveTextContent('编辑');
    expect(screen.getByTestId('preview-record')).toBeTruthy();
    expect(screen.getByTestId('preview-more')).toBeTruthy();
    await act(() => router.back());

    await share([files.offerShared('clip.mp4', TINY_JPEG, 'video/mp4')]);
    expect(await screen.findByTestId('desk-preview-video')).toBeTruthy();
    expect(screen.queryByTestId('preview-word')).toBeNull();
    expect(screen.getByTestId('preview-edit')).toBeTruthy();
  });

  it('a PDF: edit PDF and to-Word; the pack is asked for when missing, the system preview still opens it (D-457)', async () => {
    const { files } = await renderToolsApp();
    const pdf = files.offerShared('报告.pdf', await makePdf(2));
    await share([pdf]);
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    expect(screen.getByTestId('preview-edit')).toHaveTextContent('编辑 PDF');
    expect(screen.getByTestId('preview-word')).toHaveTextContent('转 Word');
    await fireEvent.press(await screen.findByTestId('desk-system-preview'));
    expect(files.previewed).toEqual([{ uri: pdf.uri, mimeType: 'application/pdf' }]);
    // 没有能打开它的 App（Android）时说明原因，页面照常能用。
    files.previewFails = true;
    await fireEvent.press(screen.getByTestId('desk-system-preview'));
    expect(await screen.findByTestId('share-preview-error')).toHaveTextContent(/没有能打开/);
    expect(screen.getByTestId('preview-bar')).toBeTruthy();
  });

  it('several files stay listed; tapping one opens its preview without tools, and back keeps the batch (D-457)', async () => {
    const { files } = await renderToolsApp();
    const shared = [
      files.offerShared('a.jpg', TINY_JPEG, 'image/jpeg'),
      files.offerShared('b.mp4', TINY_JPEG, 'video/mp4'),
      files.offerShared('c.jpg', TINY_JPEG, 'image/jpeg'),
    ];
    await share(shared);
    await screen.findByTestId('share-ask-ai');
    expect(screen.queryByTestId('desk-preview-image')).toBeNull();
    expect(screen.queryByTestId('share-files-toggle')).toBeNull();
    await fireEvent.press(screen.getByTestId('share-file-1'));
    expect(await screen.findByTestId('desk-preview-video')).toBeTruthy();
    expect(screen.queryByTestId('preview-bar')).toBeNull();
    await act(() => router.back());
    expect(await screen.findByTestId('share-ask-ai')).toBeTruthy();
    expect(files.sharedFiles()).toHaveLength(3);
  });

  it('to Word runs on the shown file and back returns to the preview with the file still there (D-457)', async () => {
    const { files } = await renderToolsApp();
    const pdf = files.offerShared('报告.pdf', await makePdf(1));
    await share([pdf]);
    await fireEvent.press(await screen.findByTestId('preview-word'));
    expect(await screen.findByText('分享进来的文件（1 个）')).toBeTruthy();
    await act(() => router.back());
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    expect(files.sharedFiles()).toHaveLength(1);
    expect(useIncoming.getState().share).not.toBeNull();
  });

  it('a run opened with then=desk puts the result on a desk that is thrown away on back; the shared files stay (D-457)', async () => {
    const { files, merge } = await setupApp();
    const shared = [
      files.offerShared('报告.pdf', await makePdf(2)),
      files.offerShared('附录.pdf', await makePdf(3)),
    ];
    await share(shared);
    await screen.findByTestId('share-screen');
    const batch = useIncoming.getState().share!.id;
    await act(() =>
      router.push({
        pathname: '/run/[workflowId]',
        params: { workflowId: merge.id, shared: String(batch), keep: '1', then: 'desk' },
      }),
    );
    await fireEvent.press(await screen.findByTestId('prompt-ok', {}, { timeout: 3000 }));
    expect(await screen.findByTestId('desk-screen', {}, { timeout: 5000 })).toBeTruthy();
    expect(await listDesks(files)).toHaveLength(1);
    // 返回：回到进来前的页面，这份桌面舍弃，收到的文件还在。
    await act(() => router.back());
    expect(await screen.findByTestId('share-screen')).toBeTruthy();
    await waitFor(async () => expect(await listDesks(files)).toHaveLength(0));
    expect(files.sharedFiles()).toHaveLength(2);
    expect(useIncoming.getState().share?.id).toBe(batch);
  });

  const photoPdf = (id: string, source: 'scanner' | 'library'): Workflow => ({
    id,
    kind: 'quickAction',
    name: id,
    steps: [
      { id: 'pick', action: 'in.photos', params: { source, min: 1, max: 1 } },
      {
        id: 'pdf',
        action: 'pdf.fromImages',
        params: { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain', maxMB: 4 },
      },
    ],
  });

  it('a scan that makes one file goes straight to its preview page, not the result page (D-457)', async () => {
    const app = await renderToolsApp();
    await app.store
      .getState()
      .proposeOps([{ op: 'addTool', tool: photoPdf('scan-pdf', 'scanner') }], '准备');
    await act(() => app.store.getState().confirm());
    app.files.camera.push(app.files.offerImage('page.jpg', 1000, 1400));
    await act(() =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: 'scan-pdf' } }),
    );
    expect(await screen.findByTestId('preview-bar', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('run-result')).toBeNull();
    expect(useIncoming.getState().share!.source).toBe('result');
    expect(useIncoming.getState().share!.files[0]!.name).toMatch(/\.pdf$/);
    // 预览页是容器：进来什么都没存、没发。
    expect(await app.repo.listAssets()).toEqual([]);
    expect(app.files.shared).toHaveLength(0);
  });

  // 2026-11-09 用户测试：「扫描成 PDF」第一步叫「Choose photos」，停下时却说相机用不了。
  it('the run page names the first step after where the photos come from', async () => {
    const app = await renderToolsApp(undefined, undefined, { locale: 'en' });
    app.files.cameraAvailable = false;
    await app.store
      .getState()
      .proposeOps([{ op: 'addTool', tool: photoPdf('scan-pdf', 'scanner') }], 'prepare');
    await act(() => app.store.getState().confirm());
    await act(() =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: 'scan-pdf' } }),
    );
    expect(await screen.findByText('Stopped at step 1', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('Scan documents')).toBeTruthy();
    expect(screen.queryByText('Choose photos')).toBeNull();
  });

  // 2026-11-09 用户测试：相机用不了时只停在第 1 步，没有别的路（D-508）。
  it('when the camera is not available, this run can take photos from the library instead', async () => {
    const app = await renderToolsApp(undefined, undefined, { locale: 'en' });
    app.files.cameraAvailable = false;
    await app.store
      .getState()
      .proposeOps([{ op: 'addTool', tool: photoPdf('scan-pdf', 'scanner') }], 'prepare');
    await act(() => app.store.getState().confirm());
    await act(() =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: 'scan-pdf' } }),
    );
    expect(await screen.findByTestId('run-from-library', {}, { timeout: 5000 })).toHaveTextContent(
      'Choose photos instead',
    );
    // 「再来一次」照快捷操作原样跑：还是相机，还是停在第 1 步。
    await fireEvent.press(screen.getByTestId('run-again'));
    const instead = await screen.findByTestId('run-from-library', {}, { timeout: 5000 });
    app.files.nextPhotos = [app.files.offerImage('page.jpg', 1000, 1400)];
    await fireEvent.press(instead);
    // 还是一次扫描：做出一个文件就直接进预览页（D-457）。
    expect(await screen.findByTestId('preview-bar', {}, { timeout: 5000 })).toBeTruthy();
    expect(useIncoming.getState().share!.files[0]!.name).toMatch(/\.pdf$/);
    // 只是这一次：快捷操作本身还是用文档相机，配置没写。
    const saved = quickActionsOf(app.store.getState().config!).find((w) => w.id === 'scan-pdf');
    expect(saved!.steps[0]!.params).toMatchObject({ source: 'scanner' });
  });

  it('other failures do not offer the photo library', async () => {
    const app = await renderToolsApp(undefined, undefined, { locale: 'en' });
    app.files.cameraAvailable = false;
    await app.store
      .getState()
      .proposeOps([{ op: 'addTool', tool: photoPdf('lib-pdf', 'library') }], 'prepare');
    await act(() => app.store.getState().confirm());
    // 相册这一步没选照片就关了：照常结束，不提议「改从相册选」。
    app.files.nextPhotos = [];
    await act(() =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: 'lib-pdf' } }),
    );
    await screen.findByTestId('run-again', {}, { timeout: 5000 });
    expect(screen.queryByTestId('run-from-library')).toBeNull();
  });

  it('a run where the person picks the photo inside it keeps its result page (D-457)', async () => {
    const app = await renderToolsApp();
    await app.store
      .getState()
      .proposeOps([{ op: 'addTool', tool: photoPdf('lib-pdf', 'library') }], '准备');
    await act(() => app.store.getState().confirm());
    app.files.nextPhotos = [app.files.offerImage('page.jpg', 1000, 1400)];
    await act(() =>
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: 'lib-pdf' } }),
    );
    expect(await screen.findByTestId('run-result', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('preview-bar')).toBeNull();
  });

  // 模拟器上发现（2026-11-06）：预览页的「编辑」只复制 xlsx，不带识别出的表格，桌上改不了。
  it('an Excel result made from a shared photo stays on its result page, where it goes on the desk editable (D-457)', async () => {
    const files = new FakeFiles();
    const vision = new FakeVision(files);
    // 识别出一行字：没有画线的表格也做成一张表（全部内容）。
    vision.layers = [
      { width: 100, height: 100, lines: [{ text: '品名', x: 10, y: 10, width: 40, height: 12 }] },
    ];
    files.vision = vision;
    await renderToolsApp(undefined, files);
    await share([files.offerShared('表格.jpg', TINY_JPEG, 'image/jpeg')]);
    await fireEvent.press(await screen.findByTestId('preview-more'));
    await fireEvent.press(await screen.findByTestId('share-run-image-table-excel'));
    expect(await screen.findByTestId('result-desk', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('preview-bar')).toBeNull();
    await fireEvent.press(screen.getByTestId('result-desk'));
    expect(await screen.findByTestId('table-sheet', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('the share panel shares, saves to a folder and prints; photos also save to the album (D-457)', async () => {
    const { files } = await renderToolsApp();
    const pdf = files.offerShared('报告.pdf', await makePdf(1));
    await share([pdf]);
    await fireEvent.press(await screen.findByTestId('preview-share'));
    expect(await screen.findByTestId('preview-share-send')).toBeTruthy();
    // 面板标题是「分享」，第一项不能也叫「分享」（出现两行一样的字）。
    expect(within(screen.getByTestId('preview-panel-share')).getAllByText('分享')).toHaveLength(1);
    expect(screen.getByTestId('preview-share-folder')).toBeTruthy();
    expect(screen.getByTestId('preview-share-print')).toBeTruthy();
    expect(screen.queryByTestId('preview-share-photos')).toBeNull();
    await fireEvent.press(screen.getByTestId('preview-share-send'));
    expect(files.shared).toEqual([pdf.uri]);
    // 点完面板关上，页面还在、文件还在。
    expect(screen.queryByTestId('preview-share-send')).toBeNull();
    expect(screen.getByTestId('preview-bar')).toBeTruthy();
    await act(() => router.back());

    await share([files.offerShared('IMG_1.jpg', TINY_JPEG, 'image/jpeg')]);
    await fireEvent.press(await screen.findByTestId('preview-share'));
    expect(await screen.findByTestId('preview-share-photos')).toBeTruthy();
  });

  it('a to-Word run that fails shows the full run page with the error and the steps (D-457)', async () => {
    const { files } = await renderToolsApp();
    const pdf = files.offerShared('报告.pdf', await makePdf(1));
    await share([pdf]);
    await fireEvent.press(await screen.findByTestId('preview-word'));
    // 测试环境没有文字识别：失败了就露出完整的运行页面，能看到停在哪一步、能再来一次。
    expect(await screen.findByTestId('run-error', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('run-compact')).toBeNull();
    expect(screen.getByTestId('run-step-pages')).toBeTruthy();
    expect(screen.getByTestId('run-again')).toBeTruthy();
    // 返回回到预览页，文件还在。
    await act(() => router.back());
    expect(await screen.findByTestId('preview-bar')).toBeTruthy();
    expect(files.sharedFiles()).toHaveLength(1);
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
