import { fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { act } from 'react';

import type { Locale } from '@morph/core';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { acceptNextAlert, renderToolsApp } from '../test-utils/render-app';

// AI 修改页上的搭建计划和工具清单（D-414、D-415）。用内置规则，不发请求。

async function openChange(locale: Locale = 'zh', repo = new MemoryWorkspaceRepo()) {
  const app = await renderToolsApp(repo, undefined, { locale });
  await act(async () => router.push('/change'));
  return { ...app, repo };
}

async function say(text: string) {
  await fireEvent.changeText(await screen.findByTestId('change-input'), text);
  await fireEvent.press(screen.getByTestId('change-submit'));
}

describe('搭建计划', () => {
  it('新用户：说大工程看到计划，删一步，开始，走完，看结果和存预设的提示', async () => {
    const { store } = await openChange();
    await say('搭建一个记账 App');
    expect(await screen.findByTestId('build-panel')).toBeTruthy();
    expect(screen.getByText('一个能用的记账 App')).toBeTruthy();
    expect(screen.getByText('证件照快捷操作')).toBeTruthy();
    // 计划开着时没有输入框的发送、没有清单。
    expect(screen.queryByTestId('change-session')).toBeNull();

    await fireEvent.press(screen.getByTestId('build-step-remove-scan'));
    expect(screen.queryByText('证件照快捷操作')).toBeNull();
    expect(store.getState().config!.data.tables).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('build-start'));
    expect(await screen.findByTestId('build-check')).toBeTruthy();
    expect(screen.getByTestId('build-preset-hint')).toBeTruthy();
    expect(store.getState().config!.data.tables.length).toBeGreaterThan(0);
    // 外观在草稿里：点了才看。
    expect(store.getState().draft!.open).toBe(false);
    await fireEvent.press(screen.getByTestId('build-see-look'));
    await waitFor(() => expect(store.getState().draft!.open).toBe(true));
    expect(store.getState().build).toBeNull();
  });

  it('一步失败（内置规则触发）：卡在哪、重试、走完', async () => {
    const { store } = await openChange();
    await say('搭建一个记账 App，有一步会失败');
    await fireEvent.press(await screen.findByTestId('build-start'));
    expect(await screen.findByTestId('build-stuck')).toBeTruthy();
    expect(screen.getByText('卡在「证件照快捷操作」')).toBeTruthy();
    expect(screen.getByTestId('build-skip')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('build-retry'));
    expect(await screen.findByTestId('build-check')).toBeTruthy();
    expect(store.getState().build!.steps.map((s) => s.status)).toEqual(['done', 'done', 'done']);
  });

  it('停下：显示还差几步，继续能接着做', async () => {
    const repo = new MemoryWorkspaceRepo();
    const { store } = await openChange('zh', repo);
    await say('搭建一个记账 App，有一步会失败');
    await fireEvent.press(await screen.findByTestId('build-start'));
    await fireEvent.press(await screen.findByTestId('build-stop'));
    expect(await screen.findByTestId('build-paused')).toBeTruthy();
    expect(screen.getByText('停下了，做好的都留着。还差 2 步。')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('build-resume'));
    expect(await screen.findByTestId('build-check')).toBeTruthy();
    expect(store.getState().build!.phase).toBe('finished');
  });

  it('小改（改颜色）不出现计划', async () => {
    const { store } = await openChange();
    await say('主题换成绿色');
    await waitFor(() => expect(store.getState().draft).not.toBeNull());
    expect(screen.queryByTestId('build-panel')).toBeNull();
  });

  it('法语界面：新界面都是法语', async () => {
    await openChange('fr');
    await say('Build a budget app');
    expect(await screen.findByText('Plan de création')).toBeTruthy();
    expect(screen.getByText('Une app de budget prête à servir')).toBeTruthy();
    expect(screen.getByText('Commencer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('build-start'));
    expect(await screen.findByText('Toutes les étapes sont terminées')).toBeTruthy();
  });
});

describe('工具清单', () => {
  it('还差的项点一下填进输入框；能清空；新用户没有清单', async () => {
    const { store } = await openChange();
    expect(screen.queryByTestId('change-session')).toBeNull();
    // 开始后结束：没做的留在清单里。
    await say('搭建一个记账 App，有一步会失败');
    await fireEvent.press(await screen.findByTestId('build-start'));
    await fireEvent.press(await screen.findByTestId('build-stop'));
    await fireEvent.press(await screen.findByTestId('build-end'));
    expect(await screen.findByTestId('change-session')).toBeTruthy();
    const open = store
      .getState()
      .session.items.find((i) => i.status === 'todo' || i.status === 'failed')!;
    await fireEvent.press(screen.getByTestId(`change-session-item-${open.id}`));
    expect(screen.getByTestId('change-input').props.value).toBe(open.text);

    acceptNextAlert();
    await fireEvent.press(screen.getByTestId('change-session-clear'));
    await waitFor(() => expect(store.getState().session.items).toEqual([]));
    expect(screen.queryByTestId('change-session')).toBeNull();
  });
});

describe('把这些补上（D-418）', () => {
  it('没有问题：不显示', async () => {
    await openChange();
    expect(screen.queryByTestId('change-fix')).toBeNull();
    await say('搭建一个记账 App');
    await fireEvent.press(await screen.findByTestId('build-start'));
    expect(await screen.findByTestId('build-check')).toBeTruthy();
    expect(screen.queryByTestId('build-fix')).toBeNull();
    await fireEvent.press(screen.getByTestId('build-finish'));
    expect(screen.queryByTestId('change-fix')).toBeNull();
  });

  it('搭建结果有问题：看到按钮，点了问题消失，按钮也没了', async () => {
    const { store } = await openChange();
    await say('搭建一个记账 App，缺页面');
    await fireEvent.press(await screen.findByTestId('build-start'));
    expect(await screen.findByTestId('build-fix')).toBeTruthy();
    expect(screen.getAllByTestId('build-check-problem')).toHaveLength(1);
    expect(screen.getByText('把这些补上')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('build-fix'));
    await waitFor(() => expect(screen.queryByTestId('build-fix')).toBeNull());
    expect(screen.queryByTestId('build-check-problem')).toBeNull();
    // 补的是页面（外观）：进草稿，看外观的按钮还在。
    expect(store.getState().draft).not.toBeNull();
    expect(screen.getByTestId('build-see-look')).toBeTruthy();
    expect(store.getState().build!.phase).toBe('finished');
  });

  it('AI 修改页平时也显示：有 N 个地方用不了和按钮；点了进草稿，回来按钮没了', async () => {
    const { store } = await openChange();
    await store.getState().change('新建一个记账页面');
    await store.getState().change('新建一个快捷操作：拍照，记到账目');
    expect(await screen.findByTestId('change-fix')).toBeTruthy();
    expect(screen.getByText('有 1 个地方用不了')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('change-fix-button'));
    await waitFor(() => expect(store.getState().draft).not.toBeNull());
    expect(store.getState().session.said.at(-1)!.input).toBe('把这些补上');
    await act(async () => router.push('/change'));
    expect(await screen.findByTestId('change-session')).toBeTruthy();
    expect(screen.queryByTestId('change-fix')).toBeNull();
  });

  it('起点已有的问题不显示', async () => {
    const repo = new MemoryWorkspaceRepo();
    const first = await openChange('zh', repo);
    await first.store.getState().change('新建一个记账页面');
    await first.store.getState().change('新建一个快捷操作：拍照，记到账目');
    await first.store.getState().clearSession();
    await first.store.getState().change('主题换成绿色');
    await act(async () => router.push('/change'));
    expect(await screen.findByTestId('change-session')).toBeTruthy();
    expect(screen.queryByTestId('change-fix')).toBeNull();
  });

  it('法语：按钮和个数都是法语，单数写法', async () => {
    const { store } = await openChange('fr');
    await store.getState().change('Create an expense page');
    await store.getState().change('Create a quick action: take photos, add a record to Expenses');
    expect(await screen.findByText('1 élément n’est pas utilisable')).toBeTruthy();
    expect(screen.getByText('Compléter ce qui manque')).toBeTruthy();
  });
});
