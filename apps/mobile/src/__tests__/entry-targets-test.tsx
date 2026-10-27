import {
  applyOps,
  createDefaultWorkspace,
  presetById,
  type Locale,
  type NewComponent,
  type OpenTarget,
  type Registry,
} from '@morph/core';
import { fireEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// D-256：首页的按钮、快捷入口打开一个快捷操作。点一下只把它摆出来，用户点「开始」才运行。

const seed = (target: OpenTarget) => (locale: Locale, registry: Registry) => {
  const components: NewComponent[] = [
    { id: 'open', type: 'button', props: { label: 'Open it', target, variant: 'filled' } },
    { id: 'go', type: 'shortcut', props: { title: 'Go there', icon: 'star', target } },
  ];
  const result = applyOps(
    createDefaultWorkspace(locale),
    components.map((component) => ({ op: 'addComponent' as const, pageId: 'home', component })),
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const preset = presetById('email-photos')!;

it.each([
  ['button', 'Open it'],
  ['shortcut', 'Go there'],
])('a %s opens a built-in quick action without running it', async (_kind, label) => {
  const repo = new MemoryWorkspaceRepo();
  await renderToolsApp(repo, undefined, { seed: seed('workflow:email-photos'), locale: 'en' });
  await fireEvent.press(await screen.findByText(label));
  expect(await screen.findByTestId('reminder-screen')).toBeTruthy();
  expect(screen.getByText('Quick action')).toBeTruthy();
  expect(screen.getByTestId('reminder-name')).toHaveTextContent(preset.name.en);
  expect(screen.queryByTestId('run-screen')).toBeNull();
  expect(await repo.listToolRuns(10)).toEqual([]);
  await fireEvent.press(screen.getByTestId('reminder-run'));
  expect(await screen.findByTestId('run-screen')).toBeTruthy();
});

it('titles the quick action view in each language', async () => {
  for (const [locale, text] of [
    ['zh', '快捷操作'],
    ['fr', 'Action rapide'],
  ] as const) {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, {
      seed: seed('workflow:email-photos'),
      locale,
    });
    await fireEvent.press(await screen.findByText('Open it'));
    expect(await screen.findByText(text)).toBeTruthy();
  }
});
