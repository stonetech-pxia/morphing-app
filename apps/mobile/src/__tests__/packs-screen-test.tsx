import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { PackStore } from '../packs/store';
import { makePalette } from '../renderer/theme';
import { PacksScreen } from '../shell/PacksScreen';
import { MemoryPackFs, manifests, sha256 } from '../test-utils/memory-packs';

// 「设置 → 扩展包」：列出已下载的扩展包和占用空间；删除文字识别包时语言包一起删除。

describe('extension packs screen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists downloaded packs with their size and deletes the text pack with its languages', async () => {
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    await store.install('ocr-eng');
    const palette = makePalette(createDefaultWorkspace('zh').theme, false);
    await render(<PacksScreen store={store} palette={palette} locale="zh" />);

    expect(await screen.findByTestId('pack-ocr')).toBeTruthy();
    expect(screen.getByTestId('pack-ocr-eng')).toBeTruthy();
    // 3 + 4 + 7 字节。
    expect(screen.getByTestId('packs-total').props.children).toBe('共占用 14 B');

    const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, message, buttons) => {
      expect(message).toContain('1 个语言包');
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('pack-delete-ocr'));
    expect(alert).toHaveBeenCalled();
    expect(await screen.findByTestId('packs-empty')).toBeTruthy();
    expect(await store.isInstalled('ocr-eng')).toBe(false);
  });
});
