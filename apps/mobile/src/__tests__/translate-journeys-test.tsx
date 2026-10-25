import { createDefaultWorkspace } from '@morph/core';
import { fireEvent, render } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { PackStore } from '../packs/store';
import { makePalette } from '../renderer/theme';
import { PacksScreen } from '../shell/PacksScreen';
import { MemoryPackFs, manifests, sha256 } from '../test-utils/memory-packs';

import { FakeFiles, FakeTranslator, FakeVision } from '../test-utils/fake-files';
import { acceptNextAlert, renderToolsApp } from '../test-utils/render-app';
import { MemoryWorkspaceRepo } from '../storage/memory';

// 翻译的界面旅程（D-170–D-173）：添加翻译工具 → 翻译文字（每次问目标语言）→ 结果页说明「适合看懂意思」；
// 快捷操作页的「现成的」里有翻译预设，按场景分组；从截图翻译预设添加并运行。

function filesWithTranslator() {
  const files = new FakeFiles();
  const translator = new FakeTranslator();
  files.translator = translator;
  files.vision = new FakeVision(files);
  return { files, translator };
}

describe('translation journeys (UI)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('translates typed text from the translate tool page and copies it', async () => {
    const { files } = filesWithTranslator();
    await renderToolsApp(new MemoryWorkspaceRepo(), files);
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-translate'));
    await fireEvent.press(await screen.findByTestId('open-translate'));
    // 工具页说明：本机翻译、看懂意思、正式文件找专业翻译（D-172）。
    expect(await screen.findByText(/适合看懂意思；正式文件请找专业翻译/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('run-translate-typed'));
    await fireEvent.changeText(await screen.findByTestId('ask-text'), '早上好。\n\nGood morning.');
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    // 目标语言每次运行时问（D-072），默认是界面语言。
    await fireEvent.press(await screen.findByTestId('ask-to-en'));
    await fireEvent.press(screen.getByTestId('prompt-ok'));

    expect(await screen.findByTestId('result-text')).toHaveTextContent(
      /^\[en\] 早上好。\s+Good morning\.$/,
    );
    expect(screen.getByTestId('translate-note')).toHaveTextContent(
      '本机翻译，适合看懂意思；正式文件请找专业翻译。',
    );
    await fireEvent.press(screen.getByTestId('result-copy'));
    // 本来就是英文的一段原样保留。
    expect(files.clipboard).toBe('[en] 早上好。\n\nGood morning.');
  });

  it('lists the translation presets by input type and runs screenshot translation', async () => {
    const { files } = filesWithTranslator();
    const { store } = await renderToolsApp(new MemoryWorkspaceRepo(), files);
    await fireEvent.press(screen.getByTestId('nav-settings'));
    await fireEvent.press(await screen.findByTestId('settings-workflows'));
    expect(await screen.findByTestId('workflows-screen')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('category-image'));
    expect(await screen.findByTestId('preset-screenshot-translate')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('preset-add-screenshot-translate'));
    const added = store
      .getState()
      .config!.workflows.find((w) => w.presetId === 'screenshot-translate')!;
    expect(added.name).toBe('截图翻译');

    (files.vision as FakeVision).texts = ['Your parcel is at the front desk.'];
    files.nextPhotos = [files.offerImage('IMG_1.png', 1170, 2532, 'image/png')];
    await fireEvent.press(await screen.findByTestId(`workflow-run-${added.id}`));
    // 识别文字的语言每次问：默认英文，直接确定。
    await fireEvent.press(await screen.findByTestId('prompt-ok'));
    expect(await screen.findByTestId('result-text')).toHaveTextContent(
      '[zh-Hans] Your parcel is at the front desk.',
    );
    // 最后一步「复制文字」已经复制好了。
    expect(files.clipboard).toBe('[zh-Hans] Your parcel is at the front desk.');
  });

  it('asks before an Android language download and can be cancelled', async () => {
    const { files, translator } = filesWithTranslator();
    translator.android = true;
    translator.missing = new Set(['ja']);
    await renderToolsApp(new MemoryWorkspaceRepo(), files);
    await fireEvent.press(screen.getByTestId('nav-tools'));
    await fireEvent.press(await screen.findByTestId('install-translate'));
    await fireEvent.press(await screen.findByTestId('open-translate'));
    await fireEvent.press(await screen.findByTestId('run-translate-typed'));
    await fireEvent.changeText(await screen.findByTestId('ask-text'), 'Hello');
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    await fireEvent.press(await screen.findByTestId('ask-to-ja'));
    acceptNextAlert();
    await fireEvent.press(screen.getByTestId('prompt-ok'));
    expect(await screen.findByTestId('result-text')).toHaveTextContent('[ja] Hello');
    expect(translator.calls.filter((c) => c.method === 'download')).toEqual([
      { method: 'download', args: ['ja'] },
    ]);
  });

  it('lists Android translation languages under Downloads and deletes one (D-175)', async () => {
    const { translator } = filesWithTranslator();
    translator.downloaded = new Set(['ja', 'zh-Hans']);
    const fs = new MemoryPackFs();
    const lookup = await manifests(fs);
    const store = new PackStore(fs, sha256, (id) => lookup.get(id));
    const palette = makePalette(createDefaultWorkspace('zh').theme, false);
    await render(
      <PacksScreen store={store} palette={palette} locale="zh" translator={translator} />,
    );
    expect(await screen.findByText('翻译语言：日文')).toBeTruthy();
    expect(screen.getByText('翻译语言：简体中文')).toBeTruthy();
    // 没有别的下载内容时不显示「还没有下载过内容」和合计。
    expect(screen.queryByTestId('packs-empty')).toBeNull();
    expect(screen.queryByTestId('packs-total')).toBeNull();

    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await fireEvent.press(screen.getByTestId('translate-language-delete-ja'));
    expect(await screen.findByTestId('translate-language-zh-Hans')).toBeTruthy();
    expect(screen.queryByTestId('translate-language-ja')).toBeNull();
    expect(translator.missing.has('ja')).toBe(true);
  });
});
