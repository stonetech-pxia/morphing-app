import { createDefaultWorkspace, formatFileSize, packById, type PackNeed } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PackGate } from '../packs/PackGate';
import { PackStore } from '../packs/store';
import { makePalette } from '../renderer/theme';
import { MemoryPackFs, manifests, sha256 } from '../test-utils/memory-packs';

// 第一次用到需要下载的功能时的提示（D-112）：说要下载多少、之后能离线用，不出现「扩展包」。
// 一次运行要的都在一个提示里（D-289）。

async function setup(needs: PackNeed[]) {
  const fs = new MemoryPackFs();
  const lookup = await manifests(fs);
  const store = new PackStore(fs, sha256, (id) => lookup.get(id));
  const palette = makePalette(createDefaultWorkspace('zh').theme, false);
  const done: (string[] | null)[] = [];
  const gate = (n: PackNeed[]) => (
    <PackGate
      needs={n}
      store={store}
      palette={palette}
      locale="zh"
      onDone={(left) => done.push(left)}
    />
  );
  const view = await render(gate(needs));
  return { store, done, view, gate };
}

const size = (...ids: string[]) =>
  formatFileSize(
    ids.reduce((sum, id) => sum + packById(id)!.files.reduce((s, f) => s + f.size, 0), 0),
    'zh',
  );

describe('first-use download prompt', () => {
  it('says how much to download and that it works offline afterwards', async () => {
    await setup([{ pack: 'pdfview', optional: false }]);
    expect(await screen.findByText(/^首次使用需下载 \d+(\.\d)? (KB|MB)$/)).toBeTruthy();
    expect(screen.getByText(/之后不联网也能用/)).toBeTruthy();
    expect(screen.getByTestId('pack-gate')).not.toHaveTextContent(/扩展包|包/);
  });

  it('says the step goes on without the download when it is optional (D-274)', async () => {
    const { done } = await setup([{ pack: 'pdfview', optional: true }]);
    expect(await screen.findByText(/不下载也能继续/)).toBeTruthy();
    // 取消键写成「不下载，继续」，不让人以为会取消整个快捷操作。
    expect(screen.getByTestId('pack-cancel')).toHaveTextContent('不下载，继续');
    await fireEvent.press(screen.getByTestId('pack-cancel'));
    expect(done).toEqual([['pdfview']]);
  });

  it('lists everything a quick action needs in one prompt with the total size (D-289)', async () => {
    // 新用户「拍表格转 Excel」：找边、展平（可选）、认字，一次说清楚，不连着弹三次。
    const { done } = await setup([
      { pack: 'scan', optional: false },
      { pack: 'dewarp', optional: true },
      { pack: 'ppocr', optional: false },
    ]);
    expect(
      await screen.findByText(`首次使用需下载 ${size('scan', 'dewarp', 'ppocr')}`),
    ).toBeTruthy();
    for (const id of ['scan', 'dewarp', 'ppocr']) {
      expect(screen.getByTestId(`pack-item-${id}`)).toHaveTextContent(packById(id)!.name.zh, {
        exact: false,
      });
    }
    // 可选的可以不勾，总大小跟着变；必需的不能不勾。
    expect(screen.queryByTestId('pack-include-scan')).toBeNull();
    await fireEvent.press(screen.getByTestId('pack-include-dewarp'));
    expect(await screen.findByText(`首次使用需下载 ${size('scan', 'ppocr')}`)).toBeTruthy();
    // 有必需的时取消就是不运行。
    expect(screen.getByTestId('pack-cancel')).toHaveTextContent('取消');
    await fireEvent.press(screen.getByTestId('pack-cancel'));
    expect(done).toEqual([null]);
  });

  it('downloads every ticked item with one tap and says which optional ones were left out', async () => {
    const all = await setup([
      { pack: 'ocr', optional: false },
      { pack: 'ocr-eng', optional: true },
    ]);
    await fireEvent.press(await screen.findByTestId('pack-download'));
    await screen.findByTestId('pack-cancel');
    expect(all.done).toEqual([[]]);
    expect(await all.store.isInstalled('ocr')).toBe(true);
    expect(await all.store.isInstalled('ocr-eng')).toBe(true);
    all.view.unmount();

    const some = await setup([
      { pack: 'ocr', optional: false },
      { pack: 'ocr-eng', optional: true },
    ]);
    await fireEvent.press(await screen.findByTestId('pack-include-ocr-eng'));
    await fireEvent.press(screen.getByTestId('pack-download'));
    await screen.findByTestId('pack-cancel');
    expect(some.done).toEqual([['ocr-eng']]);
    expect(await some.store.isInstalled('ocr')).toBe(true);
    expect(await some.store.isInstalled('ocr-eng')).toBe(false);
  });

  it('asks again for the next download when one run needs two (scan, then flattening)', async () => {
    // 同一个运行页里先下载一个、再问下一个时，提示框没有重新挂载：不能停在上一个的「下载中」，
    // 要重新显示下载键（手机上卡在满格进度条、只能选「不下载，继续」）。
    const { done, view, gate } = await setup([{ pack: 'ocr', optional: true }]);
    await fireEvent.press(await screen.findByTestId('pack-download'));
    await screen.findByTestId('pack-cancel');
    expect(done).toEqual([[]]);
    await view.rerender(gate([{ pack: 'ocr-eng', optional: true }]));
    expect(await screen.findByTestId('pack-download')).toBeTruthy();
  });
});
