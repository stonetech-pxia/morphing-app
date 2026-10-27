import { createMockAIProvider, type AIProvider, type PlanContext } from '@morph/core';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { acceptNextAlert, renderToolsApp, starterAfterGuide } from '../test-utils/render-app';

// 草稿里逐条移除改动（D-257）：一个操作一条，旁边是「移除」；有依赖的先说明要一起去掉。

/** 一句话里三处改动：换颜色（独立）、新建页面、把它放进导航栏（依赖新建页面）。 */
const scripted: AIProvider = {
  async plan(input: string, ctx: PlanContext) {
    if (input !== '旅行页') return createMockAIProvider().plan(input, ctx);
    return {
      kind: 'ops',
      ops: [
        { op: 'setTheme', primaryColor: '#2F9E44' },
        {
          op: 'addPage',
          page: {
            id: 'trip',
            title: '旅行',
            components: [{ id: 'title', type: 'header', props: { title: '旅行' } }],
          },
        },
        { op: 'setNavItems', items: [...ctx.config.shell.nav.slice(0, 4), 'page:trip'] },
      ],
    };
  },
};

async function drafted() {
  const result = await renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
    seed: starterAfterGuide,
    provider: scripted,
  });
  await fireEvent.press(await screen.findByTestId('nav-ai'));
  await fireEvent.changeText(await screen.findByTestId('change-input'), '旅行页');
  await fireEvent.press(screen.getByTestId('change-submit'));
  await screen.findByTestId('draft-bar');
  return result;
}

const draftConfig = (store: Awaited<ReturnType<typeof drafted>>['store']) =>
  store.getState().draft!.steps.at(-1)!.config;

describe('removing changes from a draft (D-257)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists every change of the step, each with Remove', async () => {
    await drafted();
    const reply = await screen.findByTestId('draft-reply');
    expect(within(reply).getByTestId('draft-change-0-0')).toHaveTextContent(/#2F9E44/);
    expect(within(reply).getByTestId('draft-change-0-1')).toHaveTextContent(/旅行/);
    expect(within(reply).getByTestId('draft-change-0-2')).toHaveTextContent(/导航/);
    for (const op of [0, 1, 2])
      expect(within(reply).getByTestId(`draft-remove-0-${op}`)).toBeTruthy();
  });

  it('removing a change on its own re-applies the rest right away', async () => {
    const { store } = await drafted();
    const alert = jest.spyOn(Alert, 'alert');
    await fireEvent.press(await screen.findByTestId('draft-remove-0-0'));
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(draftConfig(store).theme.primaryColor).not.toBe('#2F9E44'));
    expect(draftConfig(store).shell.nav).toContain('page:trip');
    expect(await screen.findByTestId('nav-page:trip')).toBeTruthy();
    expect(screen.getByTestId('draft-change-0-0')).toHaveTextContent(/旅行/);
    // 正式的版本没动。
    expect(store.getState().config!.pages.some((p) => p.id === 'trip')).toBe(false);
  });

  it('a new page and its nav entry go together, after saying so', async () => {
    const { store } = await drafted();
    const alert = jest.spyOn(Alert, 'alert');
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('draft-remove-0-1'));
    expect(alert.mock.calls[0]![0]).toBe('这几条要一起去掉');
    expect(alert.mock.calls[0]![1]).toMatch(/旅行[\s\S]*导航/);
    await waitFor(() => expect(draftConfig(store).pages.some((p) => p.id === 'trip')).toBe(false));
    expect(draftConfig(store).theme.primaryColor).toBe('#2F9E44');
    expect(screen.queryByTestId('nav-page:trip')).toBeNull();
  });

  it('the last change left has no Remove (like stepping back on the first step)', async () => {
    const { store } = await drafted();
    acceptNextAlert();
    await fireEvent.press(await screen.findByTestId('draft-remove-0-1'));
    await waitFor(() => expect(store.getState().draft!.steps[0]!.ops).toHaveLength(1));
    expect(screen.getByTestId('draft-change-0-0')).toHaveTextContent(/#2F9E44/);
    expect(screen.queryByTestId('draft-remove-0-0')).toBeNull();
    expect(screen.getByTestId('draft-back').props.accessibilityState.disabled).toBe(true);
  });
});
