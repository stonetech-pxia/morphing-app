import { describe, expect, it } from 'vitest';

import { appConfigFile, appConfigFileName } from '../config-file';
import { createDefaultWorkspace } from '../defaults';
import type { LayoutMemory } from './memory';
import {
  LAYOUT_FILE_FORMAT,
  layoutCount,
  layoutStoreFile,
  MAX_LAYOUTS_PER_TABLE,
  parseLayoutStore,
  parsePickStore,
  putLayout,
  putPick,
  readLayoutStoreFile,
  readPickStoreFile,
  serializeLayoutStore,
  serializePickStore,
} from './store';

const layout = (id: string): LayoutMemory => ({
  id,
  anchors: ['maple corner store', 'total due', 'thank you'],
  fieldTypes: { amount: 'money', shop: 'text' },
  fields: {
    amount: {
      kind: 'amount',
      label: 'total due',
      offset: 0,
      position: 0.8,
      format: 'dot',
      hits: 1,
    },
    shop: { kind: 'constant', value: 'Maple Corner Store', hits: 2, needs: 2 },
  },
});

describe('layout store', () => {
  it('round-trips through app_meta and counts layouts', () => {
    const store = putLayout(putLayout({}, 'expenses', layout('a')), 'bills', layout('b'));
    expect(layoutCount(parseLayoutStore(serializeLayoutStore(store)))).toBe(2);
    // 同一个版式再学一次：换掉，不重复。
    expect(layoutCount(putLayout(store, 'expenses', layout('a')))).toBe(2);
  });

  it('keeps at most the newest layouts of a table', () => {
    let store = {};
    for (let i = 0; i < MAX_LAYOUTS_PER_TABLE + 3; i++)
      store = putLayout(store, 't', layout(`l${i}`));
    expect(layoutCount(store)).toBe(MAX_LAYOUTS_PER_TABLE);
  });

  it('treats a missing or broken value as empty and drops broken layouts', () => {
    expect(parseLayoutStore(null)).toEqual({});
    expect(parseLayoutStore('{not json')).toEqual({});
    const raw = JSON.stringify({ t: [layout('ok'), { id: 'bad', anchors: 'x' }] });
    expect(parseLayoutStore(raw).t!.map((l) => l.id)).toEqual(['ok']);
  });

  it('exports a backup file that restores to the same memory', () => {
    const store = putLayout({}, 'expenses', layout('a'));
    const file = layoutStoreFile(store, new Date('2026-10-28T10:00:00Z'));
    expect(JSON.parse(file)).toMatchObject({ format: 'morph-prefill-memory', version: 3 });
    expect(readLayoutStoreFile(file)).toEqual(store);
  });

  it('refuses files that are not prefill memory or come from a newer version', () => {
    expect(readLayoutStoreFile('hello')).toBeNull();
    expect(readLayoutStoreFile(JSON.stringify({ tables: {} }))).toBeNull();
    expect(
      readLayoutStoreFile(
        JSON.stringify({ format: 'morph-prefill-memory', version: 99, tables: {} }),
      ),
    ).toBeNull();
    // 别的 Tinkrum 文件（App 配置）也不当成预填记忆。
    expect(readLayoutStoreFile(appConfigFile(createDefaultWorkspace('en'), new Date()))).toBeNull();
  });
});

describe('app config file', () => {
  it('holds the whole config with a format name, and a dated file name', () => {
    const file = JSON.parse(
      appConfigFile(createDefaultWorkspace('en'), new Date('2026-10-28T10:00:00Z')),
    );
    expect(file).toMatchObject({ format: 'morph-app-config', version: 1 });
    expect(file.config).toEqual(JSON.parse(JSON.stringify(createDefaultWorkspace('en'))));
    expect(appConfigFileName(new Date(2026, 9, 28, 9))).toBe('tinkrum-config-2026-10-28.json');
  });
});

describe('点过的候选：学过的标签', () => {
  const pick = {
    label: 'startAt',
    relY: 0.2,
    labels: [
      { label: 'startat', order: 'DMY' as const },
      { label: 'date', rejected: true as const },
    ],
  };

  it('存进去、读出来一样；导出的文件能恢复', () => {
    const store = putPick({}, 't', 'f', pick);
    expect(parsePickStore(serializePickStore(store))).toEqual(store);
    expect(readPickStoreFile(layoutStoreFile({}, new Date(0), store))).toEqual(store);
  });

  it('第 2 版的文件（一个字段只有一个标签）还能读', () => {
    const old = JSON.stringify({
      format: LAYOUT_FILE_FORMAT,
      version: 2,
      tables: {},
      picks: { t: { f: { label: 'Date', relY: 0.1 } } },
    });
    expect(readPickStoreFile(old)).toEqual({ t: { f: { label: 'Date', relY: 0.1 } } });
  });

  it('坏的记忆丢掉', () => {
    const raw = JSON.stringify({ t: { f: { label: 'x', relY: 0.1, labels: [{ label: 1 }] } } });
    expect(parsePickStore(raw)).toEqual({});
  });
});
