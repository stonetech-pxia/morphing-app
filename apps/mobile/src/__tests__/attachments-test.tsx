import {
  applyOps,
  createDefaultWorkspace,
  type Collection,
  type Locale,
  type Registry,
} from '@morph/core';
import { act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 附件字段放多个文件（D-263）：记录里是一组文件 ID；旧数据里的单个 ID 当成一组。

const receipts: Collection = {
  id: 'expenses',
  name: '账目',
  fields: [
    { id: 'item', name: '项目', type: 'text' },
    { id: 'receipt', name: '收据', type: 'file' },
  ],
};

const seed = (locale: Locale, registry: Registry) => {
  const result = applyOps(
    createDefaultWorkspace(locale),
    [{ op: 'addCollection', collection: receipts }],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const asset = (id: string, name: string, mimeType = 'image/jpeg') => ({
  id,
  name,
  mimeType,
  size: 1000,
  path: `assets/${id}/${name}`,
  source: 'picked' as const,
  createdAt: 1,
});

async function withRecord(receipt: unknown) {
  const repo = new MemoryWorkspaceRepo();
  await repo.addAsset(asset('a1', '发票.jpg'));
  await repo.addAsset(asset('a2', '小票.pdf', 'application/pdf'));
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'expenses',
    values: { item: '午饭', receipt },
    createdAt: 1,
    updatedAt: 1,
  });
  return repo;
}

async function openEditor(repo: MemoryWorkspaceRepo) {
  const app = await renderToolsApp(repo, undefined, { seed });
  await act(() => router.push('/record/expenses?recordId=r1'));
  return app;
}

describe('attachment fields in the record editor', () => {
  it('list every file, in order, and remove one', async () => {
    const repo = await withRecord(['a2', 'a1']);
    await openEditor(repo);
    expect(await screen.findByText('小票.pdf')).toBeTruthy();
    expect(screen.getByTestId('editor-receipt-file-0')).toHaveTextContent('小票.pdf');
    expect(screen.getByTestId('editor-receipt-file-1')).toHaveTextContent('发票.jpg');
    await fireEvent.press(screen.getByTestId('editor-receipt-remove-0'));
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect((await repo.getRecord('r1'))!.values.receipt).toEqual(['a1']);
    // 文件本身还在（用户文件不随记录删除）。
    expect(await repo.getAsset('a2')).not.toBeNull();
  });

  it('read an old single id as one file and save it as a list', async () => {
    const repo = await withRecord('a1');
    await openEditor(repo);
    expect(await screen.findByText('发票.jpg')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('editor-item'), '晚饭');
    await fireEvent.press(screen.getByTestId('editor-save'));
    expect((await repo.getRecord('r1'))!.values).toEqual({ item: '晚饭', receipt: ['a1'] });
  });

  it('say when a file is no longer on this device', async () => {
    const repo = await withRecord(['gone', 'a1']);
    await openEditor(repo);
    expect(await screen.findByText('文件已经删掉了')).toBeTruthy();
    expect(screen.getByText('发票.jpg')).toBeTruthy();
  });

  it('a new user sees no attachment', async () => {
    await renderToolsApp(new MemoryWorkspaceRepo(), undefined, { seed });
    await act(() => router.push('/record/expenses'));
    expect(await screen.findByText('没有附件')).toBeTruthy();
  });
});
