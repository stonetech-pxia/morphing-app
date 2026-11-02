import { DEFAULT_THEME, PREFILL_MODEL_PACK, type Locale } from '@morph/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { LocalModelCard } from '../packs/LocalModelCard';
import type { Packs } from '../packs/PackHost';
import { makePalette } from '../renderer/theme';

// 「设置 → 数据」的本机模型（D-396）：用户点了、确认了才下载；能删除；内存不够的手机不给下载。

let mockPacks: Packs | null = null;
jest.mock('../packs/PackHost', () => ({ usePacks: () => mockPacks }));
let mockFits = true;
jest.mock('../runtime/local-model', () => ({ deviceFitsLocalModel: () => mockFits }));

const palette = makePalette(DEFAULT_THEME, false);
const URL = 'https://example.test/packs';

function fakeStore(installed: boolean) {
  const store = {
    isInstalled: jest.fn(async () => installed),
    installed: jest.fn(async () => []),
    install: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  };
  mockPacks = { store, bridge: {} } as unknown as Packs;
  return store;
}
const show = async (locale: Locale = 'zh') => {
  await render(<LocalModelCard palette={palette} locale={locale} />);
};

describe('本机模型的设置项（D-396）', () => {
  beforeEach(() => {
    mockFits = true;
    process.env.EXPO_PUBLIC_MORPH_PACKS_URL = URL;
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MORPH_PACKS_URL;
  });

  it('打开页面不下载；点了下载、在确认框里同意才下载', async () => {
    const store = fakeStore(false);
    await show();
    expect(store.install).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pack-gate')).toBeNull();
    await fireEvent.press(screen.getByTestId('local-model-download'));
    expect(screen.getByTestId('pack-gate')).toBeTruthy();
    expect(store.install).not.toHaveBeenCalled();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pack-download'));
    });
    expect(store.install).toHaveBeenCalledWith(PREFILL_MODEL_PACK, expect.any(Function));
    expect(screen.getByTestId('local-model-remove')).toBeTruthy();
  });

  it('确认框里取消：不下载，按钮还在', async () => {
    const store = fakeStore(false);
    await show();
    await fireEvent.press(screen.getByTestId('local-model-download'));
    await fireEvent.press(screen.getByTestId('pack-cancel'));
    expect(store.install).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-model-download')).toBeTruthy();
  });

  it('下载过：能删除，先问', async () => {
    const store = fakeStore(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await show();
    await fireEvent.press(screen.getByTestId('local-model-remove'));
    expect(store.remove).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2] as AlertButton[];
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    expect(store.remove).toHaveBeenCalledWith(PREFILL_MODEL_PACK);
    expect(screen.getByTestId('local-model-download')).toBeTruthy();
    alert.mockRestore();
  });

  it('内存不够又没装：完全不提本机模型', async () => {
    fakeStore(false);
    mockFits = false;
    await show();
    expect(screen.queryByTestId('local-model')).toBeNull();
    expect(screen.queryByTestId('local-model-download')).toBeNull();
  });

  it('内存不够但装过（例如恢复了备份）：只能删除', async () => {
    fakeStore(true);
    mockFits = false;
    await show();
    expect(screen.getByTestId('local-model-remove')).toBeTruthy();
    expect(screen.queryByTestId('local-model-download')).toBeNull();
  });

  it('没配置下载地址又没装：不提示；装好的还能删', async () => {
    delete process.env.EXPO_PUBLIC_MORPH_PACKS_URL;
    fakeStore(false);
    await show();
    expect(screen.queryByTestId('local-model')).toBeNull();
    fakeStore(true);
    await show();
    expect(screen.getByTestId('local-model-remove')).toBeTruthy();
  });
});
