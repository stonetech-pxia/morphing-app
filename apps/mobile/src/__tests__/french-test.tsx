import { createStarterWorkspace, formatFileSize, formatMoney, formatNumber } from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';
import { formatTime } from '../run/local/TrimScreen';

const start = () =>
  renderToolsApp(new MemoryWorkspaceRepo(), new FakeFiles(), {
    locale: 'fr',
    seed: createStarterWorkspace,
  });

describe('French journeys', () => {
  it('opens the category library and prefills a French request from the starter home', async () => {
    await start();
    expect(await screen.findByText('Ouvrir les photos')).toBeTruthy();
    expect(screen.getByText('Ouvrir les fichiers')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ce que Morph peut faire'));
    await fireEvent.press(await screen.findByTestId('category-audio'));
    await fireEvent.press(await screen.findByTestId('quick-actions-create'));
    expect(await screen.findByTestId('change-input')).toHaveProp(
      'value',
      'Avec mes fichiers audio, je veux',
    );
  });

  it('picks a photo, adds and runs an action, and shows a French result', async () => {
    const { files, store } = await start();
    files.nextMedia = [files.offerImage('private-photo.jpg', 2400, 1600)];
    await fireEvent.press(await screen.findByTestId('file-pick-media'));
    expect(await screen.findByTestId('share-screen')).toHaveTextContent(/1\s*photo/);
    await fireEvent.press(await screen.findByTestId('share-preset-add-email-photos'));
    await fireEvent.press(await screen.findByTestId('prompt-ok'));
    expect(await screen.findByTestId('run-result')).toHaveTextContent(/Enregistrer dans Fichiers/);
    expect(files.shared).toHaveLength(1);
    expect(
      store.getState().config!.workflows.find((w) => w.presetId === 'email-photos')?.name,
    ).not.toBe('Photos for email or upload');
  });

  it('uses English mock phrases in a French interface, and applies and undoes a draft', async () => {
    const { store } = await start();
    const original = store.getState().config!.theme.fontScale;
    await fireEvent.press(screen.getByTestId('nav-ai'));
    await fireEvent.changeText(await screen.findByTestId('change-input'), 'Bigger text');
    await fireEvent.press(screen.getByTestId('change-submit'));
    expect(await screen.findByTestId('draft-bar')).toBeTruthy();
    expect(store.getState().config!.theme.fontScale).toBe(original);
    await fireEvent.press(screen.getByTestId('draft-apply'));
    expect(store.getState().config!.theme.fontScale).toBeGreaterThan(original);
    await act(async () => {
      await store.getState().undo();
    });
    expect(store.getState().config!.theme.fontScale).toBe(original);
    await act(() => router.push('/quick-actions'));
    expect(await screen.findByTestId('category-document')).toHaveTextContent('Documents');
  });

  it('formats French decimals, currency, sizes and fractional seconds', () => {
    expect(formatFileSize(1.5 * 1024 * 1024, 'fr')).toBe('1,5 Mo');
    expect(formatNumber(1234.5, 2, 'fr')).toMatch(/1[\u00a0\u202f]234,50/);
    expect(formatMoney(1234.5, 'EUR', 'fr')).toMatch(/1[\u00a0\u202f]234,50[\u00a0\u202f]€/);
    expect(formatTime(5400, true, 'fr')).toBe('0:05,4');
  });
});
