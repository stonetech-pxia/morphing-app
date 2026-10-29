import { createDefaultWorkspace } from '@morph/core';
import { render, screen } from '@testing-library/react-native';

import { PackGate } from '../packs/PackGate';
import { PackStore } from '../packs/store';
import { makePalette } from '../renderer/theme';
import { MemoryPackFs, manifests, sha256 } from '../test-utils/memory-packs';

// 第一次用到需要下载的功能时的提示（D-112）：说要下载多少、之后能离线用，不出现「扩展包」。

describe('first-use download prompt', () => {
  it('says how much to download and that it works offline afterwards', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    const palette = makePalette(createDefaultWorkspace('zh').theme, false);
    await render(
      <PackGate packId="pdfview" store={store} palette={palette} locale="zh" onDone={() => {}} />,
    );
    expect(await screen.findByText(/^首次使用需下载 \d+(\.\d)? (KB|MB)$/)).toBeTruthy();
    expect(screen.getByText(/之后不联网也能用/)).toBeTruthy();
    expect(screen.getByTestId('pack-gate')).not.toHaveTextContent(/扩展包|包/);
  });

  it('says the step goes on without the download when it is optional (D-274)', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    const palette = makePalette(createDefaultWorkspace('zh').theme, false);
    const done: boolean[] = [];
    await render(
      <PackGate
        packId="pdfview"
        store={store}
        palette={palette}
        locale="zh"
        optional
        onDone={(installed) => done.push(installed)}
      />,
    );
    expect(await screen.findByText(/不下载也能继续/)).toBeTruthy();
    // 取消键写成「不下载，继续」，不让人以为会取消整个快捷操作。
    expect(screen.getByTestId('pack-cancel')).toHaveTextContent('不下载，继续');
  });
});
