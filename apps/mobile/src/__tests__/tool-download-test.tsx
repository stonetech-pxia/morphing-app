import {
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createMockAIProvider,
  createRegistry,
  quickActionsOf,
  ToolDownloadError,
  type ToolManifest,
} from '@morph/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { PackStore } from '../packs/store';
import { makePalette } from '../renderer/theme';
import { PacksScreen } from '../shell/PacksScreen';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { MemoryPackFs, sha256 } from '../test-utils/memory-packs';
import {
  MemoryToolFs,
  TOOLS_URL,
  exampleManifest,
  publish,
  testKey,
  toolSha256,
} from '../test-utils/memory-tools';
import { renderToolsApp } from '../test-utils/render-app';
import { createToolDownloads, toolRevoked } from '../tool-download/state';
import { ToolDownloadStore } from '../tool-download/store';
import { createWorkspaceStore } from '../workspace/store';

// 从服务器下载的工具（D-177、D-178）：签名目录、下载检查、在工具页添加 / 更新 / 停用、恢复历史版本。

function setup(now = () => 1_000) {
  const fs = new MemoryToolFs();
  const registry = createRegistry(BUILTIN_TOOLS);
  const store = new ToolDownloadStore(fs, toolSha256, {
    baseUrl: TOOLS_URL,
    trustedKeys: [testKey.publicKey],
    now,
  });
  const downloads = createToolDownloads({ store, registry, configured: true, now });
  return { fs, registry, store, downloads };
}

const v110 = (): ToolManifest => {
  const m = exampleManifest();
  m.version = '1.1.0';
  m.workflows.push({
    id: 'job-apply-letter',
    name: { en: 'Cover letter', zh: '求职信', fr: 'Cover letter' },
    steps: [
      { id: 'pick', action: 'in.files', params: { accept: 'pdf', min: 1, max: 1 } },
      { id: 'share', action: 'out.share', params: {} },
    ],
  });
  return m;
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (e) {
    return (e as ToolDownloadError).code;
  }
};

describe('tool download store', () => {
  it('keeps only catalogs signed by a trusted key, and never an older one', async () => {
    const { fs, store } = setup();
    await publish(fs, [exampleManifest()], { seq: 2 });
    expect((await store.refreshCatalog()).seq).toBe(2);
    expect((await store.cachedCatalog())?.catalog.seq).toBe(2);

    // 有人拿出一份旧目录（seq 1）：不接受，还用 seq 2 的。
    await publish(fs, [exampleManifest()], { seq: 1 });
    expect(await codeOf(store.refreshCatalog())).toBe('stale');
    expect((await store.cachedCatalog())?.catalog.seq).toBe(2);

    // 签名对不上：不接受。
    fs.net.set(`${TOOLS_URL}/catalog.sig`, new TextEncoder().encode('AAAA'));
    expect(await codeOf(store.refreshCatalog())).toBe('signature');

    // 本机存的目录被改过：读出来也当作没有。
    fs.files.set('catalog.json', fs.files.get('catalog.json')!.replace('job-apply', 'job-apply '));
    expect(await store.cachedCatalog()).toBeNull();
  });

  it('downloads a manifest only when its size and SHA-256 match the catalog', async () => {
    const { fs, store, registry } = setup();
    const catalog = await publish(fs, [exampleManifest()], {
      seq: 1,
      tamper: (b) => {
        const copy = b.slice();
        copy[20] = copy[20]! ^ 1;
        return copy;
      },
    });
    expect(await codeOf(store.download(catalog.tools[0]!, registry))).toBe('hash');
    expect(await store.downloaded()).toEqual([]);

    const ok = await publish(fs, [exampleManifest()], { seq: 2 });
    await store.download(ok.tools[0]!, registry);
    expect((await store.downloaded()).map((d) => d.manifest.version)).toEqual(['1.0.0']);

    // 新版本替换旧版本；不能退回旧版本。
    const next = await publish(fs, [v110()], { seq: 3 });
    await store.download(next.tools[0]!, registry);
    expect((await store.downloaded()).map((d) => d.manifest.version)).toEqual(['1.1.0']);
    expect(await codeOf(store.download(ok.tools[0]!, registry))).toBe('downgrade');
    expect([...fs.files.keys()].filter((k) => k.startsWith('job-apply/'))).toEqual([
      'job-apply/1.1.0/manifest.json',
      'job-apply/1.1.0/ready.json',
    ]);
  });

  it('refuses a manifest that would not work in this app', async () => {
    const { fs, store, registry } = setup();
    const bad = exampleManifest();
    bad.workflows[0]!.steps[1]!.action = 'pdf.nothing';
    const catalog = await publish(fs, [bad], { seq: 1 });
    expect(await codeOf(store.download(catalog.tools[0]!, registry))).toBe('invalid');
    const tooNew = await publish(fs, [{ ...exampleManifest(), hostApi: 99 }], { seq: 2 });
    expect(await codeOf(store.download(tooNew.tools[0]!, registry))).toBe('host');
  });

  it('registers downloaded tools again on the next start, and knows revoked versions', async () => {
    const first = setup();
    const catalog = await publish(first.fs, [exampleManifest()], { seq: 1 });
    await first.downloads.getState().refresh();
    await first.downloads.getState().download(catalog.tools[0]!);
    expect(first.registry.tools.get('job-apply')?.version).toBe('1.0.0');

    // 下一次启动：新的注册表，从磁盘上读回来。
    const registry = createRegistry(BUILTIN_TOOLS);
    const store = new ToolDownloadStore(first.fs, toolSha256, {
      baseUrl: TOOLS_URL,
      trustedKeys: [testKey.publicKey],
    });
    const downloads = createToolDownloads({ store, registry, configured: true });
    await downloads.getState().load();
    expect(registry.tools.get('job-apply')?.origin).toBe('download');
    expect(downloads.getState().downloaded['job-apply']?.version).toBe('1.0.0');
    expect(toolRevoked(downloads.getState(), 'job-apply')).toBe(false);

    await publish(first.fs, [exampleManifest()], { seq: 2, revoked: ['job-apply@1.0.0'] });
    await downloads.getState().refresh();
    expect(toolRevoked(downloads.getState(), 'job-apply')).toBe(true);
  });

  it('does not ask the network again within maxAge, and keeps the old catalog when offline', async () => {
    let clock = 1_000;
    const { fs, downloads } = setup(() => clock);
    await publish(fs, [exampleManifest()], { seq: 1 });
    await downloads.getState().refresh(60_000);
    expect(fs.fetches).toHaveLength(2);
    clock += 30_000;
    await downloads.getState().refresh(60_000);
    expect(fs.fetches).toHaveLength(2);
    fs.net.clear();
    clock += 60_000;
    await downloads.getState().refresh(60_000);
    expect(downloads.getState().catalog?.seq).toBe(1);
  });
});

/** 点一下，等下载、检查和添加这一串异步操作都做完（包在 act 里，免得 React 报警告）。 */
async function pressAndSettle(testID: string) {
  const target = await screen.findByTestId(testID);
  await act(async () => {
    fireEvent.press(target);
    for (let i = 0; i < 200; i++) await Promise.resolve();
  });
}

describe('downloaded tools in the app (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function openTools() {
    const tools = setup();
    await publish(tools.fs, [exampleManifest()], { seq: 1 });
    await tools.downloads.getState().load();
    const app = await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      registry: tools.registry,
      toolDownloads: tools.downloads,
    });
    await pressAndSettle('nav-tools');
    return { ...tools, ...app };
  }

  it('adds a tool from the catalog: download, check, add, open its page', async () => {
    const { fs, store } = await openTools();
    // 打开工具页时拉目录，可下载的工具排在内置工具后面，标出大小。
    expect(await screen.findByTestId('catalog-job-apply')).toBeTruthy();
    expect(screen.getByText('求职材料')).toBeTruthy();
    expect(screen.getByText(/^需要下载 \d+ KB$/)).toBeTruthy();

    await pressAndSettle('install-job-apply');
    await fireEvent.press(await screen.findByTestId('open-job-apply'));
    expect(await screen.findByText('简历和证书合成一个 PDF')).toBeTruthy();
    expect(screen.getByText('头像压到 200 KB')).toBeTruthy();
    expect(store.getState().config!.packages.map((t) => t.id)).toContain('job-apply');
    expect(fs.files.has('job-apply/1.0.0/ready.json')).toBe(true);
  });

  it('says what went wrong and changes nothing when the download does not pass the check', async () => {
    const tools = setup();
    await publish(tools.fs, [exampleManifest()], {
      seq: 1,
      tamper: (b) => b.slice(0, b.length - 1),
    });
    const app = await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
      registry: tools.registry,
      toolDownloads: tools.downloads,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await pressAndSettle('nav-tools');
    await pressAndSettle('install-job-apply');
    expect(alert).toHaveBeenCalledWith(
      '「求职材料」没有添加',
      '下载的内容没有通过安全检查，什么都没有改。',
    );
    expect(app.store.getState().config!.packages.map((t) => t.id)).not.toContain('job-apply');
    expect(tools.registry.tools.has('job-apply')).toBe(false);
  });

  it('updates to a newer version from the catalog and keeps the quick actions', async () => {
    const { fs, downloads, store, registry } = await openTools();
    await pressAndSettle('install-job-apply');
    expect(await screen.findByTestId('open-job-apply')).toBeTruthy();
    expect(screen.queryByTestId('update-job-apply')).toBeNull();

    await publish(fs, [v110()], { seq: 2 });
    await act(() => downloads.getState().refresh());
    await pressAndSettle('update-job-apply');
    expect(await screen.findByTestId('open-job-apply')).toBeTruthy();
    expect(registry.tools.get('job-apply')?.version).toBe('1.1.0');
    const config = store.getState().config!;
    expect(config.packages.find((t) => t.id === 'job-apply')?.version).toBe('1.1.0');
    expect(quickActionsOf(config).map((w) => w.id)).toEqual(
      expect.arrayContaining(['job-apply-docs', 'job-apply-photo', 'job-apply-letter']),
    );
  });

  it('a revoked tool is marked and its quick actions do not run; nothing is deleted', async () => {
    const { fs, downloads, store } = await openTools();
    await pressAndSettle('install-job-apply');
    expect(await screen.findByTestId('open-job-apply')).toBeTruthy();

    await publish(fs, [exampleManifest()], { seq: 2, revoked: ['job-apply@1.0.0'] });
    await act(() => downloads.getState().refresh());
    expect(await screen.findByText('求职材料 · 已添加 · 暂时停用')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('open-job-apply'));
    await fireEvent.press(await screen.findByTestId('run-job-apply-docs'));
    expect(await screen.findByTestId('run-revoked')).toHaveTextContent(
      '「求职材料」暂时停用了，这个快捷操作现在不能用。过一阵再试试。',
    );
    expect(quickActionsOf(store.getState().config!).some((w) => w.id === 'job-apply-docs')).toBe(
      true,
    );
  });
});

describe('restoring a version that used a downloaded tool', () => {
  it('asks to add the tool first when it is not on this phone', async () => {
    const tools = setup();
    const catalog = await publish(tools.fs, [exampleManifest()], { seq: 1 });
    await tools.downloads.getState().refresh();
    await tools.downloads.getState().download(catalog.tools[0]!);
    const repo = new MemoryWorkspaceRepo();
    const deps = {
      repo,
      provider: createMockAIProvider(),
      locale: 'zh' as const,
      now: () => new Date(2026, 9, 24, 9, 0),
    };
    const first = createWorkspaceStore({ ...deps, registry: tools.registry });
    await first.getState().boot();
    const added = await first
      .getState()
      .proposeOps([{ op: 'setPackage', package: 'job-apply', do: 'add' }], '添加求职材料');
    expect(added.kind).toBe('preview');
    await first.getState().confirm();
    const withTool = first.getState().head!.id;
    await first
      .getState()
      .proposeOps([{ op: 'setPackage', package: 'job-apply', do: 'remove' }], '移除');
    await first.getState().confirm();

    // 换一台手机：没有这个工具，但目录里查得到它的名字。
    const second = createWorkspaceStore({
      ...deps,
      registry: createRegistry(BUILTIN_TOOLS),
      toolName: (id) => tools.downloads.getState().catalog?.tools.find((e) => e.id === id)?.name.zh,
    });
    await second.getState().boot();
    expect(await second.getState().proposeRestore(withTool)).toEqual({
      kind: 'invalid',
      issues: ['这个版本用到了「求职材料」，这台手机上还没有。先到「工具」里添加，再恢复。'],
    });
  });
});

describe('downloads screen', () => {
  it('lists downloaded tools; one still added must be removed in Tools first', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onRemoveTool = jest.fn(async () => undefined);
    const packs = new PackStore(new MemoryPackFs(), sha256);
    await render(
      <PacksScreen
        store={packs}
        palette={makePalette(createDefaultWorkspace('zh').theme, false)}
        locale="zh"
        tools={[
          { id: 'job-apply', name: '求职材料', version: '1.0.0', bytes: 2048, added: true },
          { id: 'old-tool', name: '旧工具', version: '1.0.0', bytes: 1024, added: false },
        ]}
        onRemoveTool={onRemoveTool}
      />,
    );
    expect(await screen.findByTestId('downloaded-tool-job-apply')).toBeTruthy();
    expect(screen.queryByTestId('packs-empty')).toBeNull();
    await fireEvent.press(screen.getByTestId('downloaded-tool-delete-job-apply'));
    expect(alert).toHaveBeenLastCalledWith(
      '删除「求职材料」？',
      '这个工具还在用。先到「工具」里移除它，再回来删除。',
    );
    alert.mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('downloaded-tool-delete-old-tool'));
    expect(onRemoveTool).toHaveBeenCalledWith('old-tool');
    alert.mockRestore();
  });
});
