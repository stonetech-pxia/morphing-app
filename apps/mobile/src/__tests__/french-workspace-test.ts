import { createMockAIProvider, createStarterWorkspace } from '@morph/core';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { createWorkspaceStore } from '../workspace/store';
import { testRegistry } from '../test-utils/render-app';

describe('changing the interface language', () => {
  it('keeps the saved workspace, page titles and action names when reopening in French', async () => {
    const repo = new MemoryWorkspaceRepo();
    const deps = {
      repo,
      provider: createMockAIProvider(),
      registry: testRegistry,
      now: () => new Date(2026, 9, 25),
      seed: createStarterWorkspace,
    };
    const english = createWorkspaceStore({ ...deps, locale: 'en' });
    await english.getState().boot();
    const saved = structuredClone(english.getState().config);
    const french = createWorkspaceStore({ ...deps, locale: 'fr' });
    await french.getState().boot();
    expect(french.getState().config).toEqual(saved);
    expect(french.getState().config!.containers.pages.find((p) => p.id === 'home')!.title).toBe(
      'Home',
    );
  });
});
