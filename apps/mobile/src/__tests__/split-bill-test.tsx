import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { parsePaid } from '../run/local/SplitBillScreen';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';

// AA 分摊（D-259）：添加工具 → 填每个人付了多少 → 结果页列出谁给谁多少。本机计算，不用 AI。

async function openSplit(locale: 'zh' | 'fr' = 'zh') {
  const app = await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), { locale });
  await fireEvent.press(screen.getByTestId('nav-tools'));
  await fireEvent.press(await screen.findByTestId('install-split'));
  await fireEvent.press(await screen.findByTestId('open-split'));
  await fireEvent.press(await screen.findByTestId('run-split-bill'));
  await screen.findByTestId('split-row-0');
  return app;
}

async function fill(i: number, name: string, paid: string) {
  await fireEvent.changeText(screen.getByTestId(`split-name-${i}`), name);
  await fireEvent.changeText(screen.getByTestId(`split-paid-${i}`), paid);
}

describe('split the bill (D-259)', () => {
  it('starts with two empty rows and asks for two people', async () => {
    await openSplit();
    expect(screen.getByTestId('split-row-1')).toBeTruthy();
    expect(screen.queryByTestId('split-row-2')).toBeNull();
    expect(screen.queryByTestId('split-remove-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(screen.getByTestId('split-error')).toHaveTextContent('至少要两个人。');
  });

  it('works out who pays whom; three people, one paid for everyone', async () => {
    const { repo } = await openSplit();
    await fill(0, '小王', '100');
    await fill(1, '小李', '');
    await fireEvent.press(screen.getByTestId('split-add'));
    await fill(2, '小张', '0');
    await fireEvent.press(screen.getByTestId('local-done'));
    expect((await screen.findByTestId('result-text')).props.children).toBe(
      '合计 100.00，3 人，每人 33.33\n除不尽的 0.01 由 小王 多付\n小李 → 小王：33.33\n小张 → 小王：33.33',
    );
    // 名字和金额不存进 App（没有记录、没有文件）。
    expect(await repo.listAssets()).toEqual([]);
  });

  it('catches a missing name, the same name twice and a bad amount; a row can be removed', async () => {
    await openSplit();
    await fill(0, '小王', '30');
    await fill(1, '', '10');
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(screen.getByTestId('split-error')).toHaveTextContent('每个人都要填名字。');
    await fill(1, '小王', '10');
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(screen.getByTestId('split-error')).toHaveTextContent('名字不能重复：小王');
    await fill(1, '小李', '-5');
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(screen.getByTestId('split-error')).toHaveTextContent('「小李」的金额不对。');
    await fireEvent.press(screen.getByTestId('split-add'));
    await fireEvent.press(screen.getByTestId('split-remove-2'));
    expect(screen.queryByTestId('split-row-2')).toBeNull();
    await fill(1, '小李', '10');
    await fireEvent.press(screen.getByTestId('local-done'));
    expect(await screen.findByTestId('result-text')).toHaveTextContent(/小李 → 小王：10\.00/);
  });

  it('in French: comma decimals and French wording', async () => {
    await openSplit('fr');
    await fill(0, 'Léa', '12,50');
    await fill(1, 'Tom', '0');
    await fireEvent.press(screen.getByTestId('local-done'));
    expect((await screen.findByTestId('result-text')).props.children).toBe(
      'Total 12,50, 2 personnes, 6,25 chacun\nTom → Léa : 6,25',
    );
  });

  it('reads amounts the way people type them', () => {
    expect(parsePaid('')).toBe(0);
    expect(parsePaid(' 12,5 ')).toBe(12.5);
    expect(parsePaid('1 000.25')).toBe(1000.25);
    expect(parsePaid('-1')).toBeNull();
    expect(parsePaid('1.234')).toBeNull();
    expect(parsePaid('abc')).toBeNull();
  });
});
