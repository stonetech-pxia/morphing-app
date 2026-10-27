import {
  FIELDS,
  applyOps,
  createDefaultWorkspace,
  type Field,
  type Locale,
  type NewComponent,
  type Registry,
} from '@morph/core';
import { screen } from 'expo-router/testing-library';

import { FIELD_EDITORS } from '../renderer/data';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { renderToolsApp } from '../test-utils/render-app';

// 每种登记的字段在 App 里都能填、能显示（新增字段类型时这里自动覆盖它，见 docs/FIELDS.md）：
// 一张表放上每种字段的 example，表单里有每个能填的字段，列表按每个字段显示一条记录。

const fields = FIELDS.map((d) => d.example as Field);
const fillable = FIELDS.filter((d) => d.inForm !== false).map((d) => d.example.id);

const seed = (locale: Locale, registry: Registry) => {
  const components: NewComponent[] = [
    {
      id: 'form',
      type: 'recordForm',
      props: { collectionId: 'expenses', fieldIds: fillable, submitLabel: 'Add', mode: 'inline' },
    },
    ...FIELDS.map((d): NewComponent => ({
      id: `list-${d.example.id}`,
      type: 'recordList',
      props: { collectionId: 'expenses', display: 'list', titleField: d.example.id, limit: 5 },
    })),
  ];
  const result = applyOps(
    createDefaultWorkspace(locale),
    [
      { op: 'addCollection', collection: { id: 'expenses', name: 'Expenses', fields } },
      ...components.map((component) => ({
        op: 'addComponent' as const,
        pageId: 'home',
        component,
      })),
    ],
    { registry, locale },
  );
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

async function withExampleValues() {
  const repo = new MemoryWorkspaceRepo();
  const values = Object.fromEntries(
    FIELDS.flatMap((d) => (d.exampleValue === undefined ? [] : [[d.example.id, d.exampleValue]])),
  );
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'expenses',
    values,
    createdAt: 1,
    updatedAt: 1,
  });
  return repo;
}

it('has an editor for every registered field type', () => {
  expect(Object.keys(FIELD_EDITORS).sort()).toEqual(FIELDS.map((d) => d.type).sort());
});

it.each(['zh', 'en', 'fr'] as const)(
  'every field example can be filled in and shown in %s',
  async (locale) => {
    const { store } = await renderToolsApp(await withExampleValues(), undefined, { seed, locale });
    for (const id of fillable) {
      const input = screen.queryByTestId(`form-form-${id}`);
      // 选项和星星是一组按钮，测试 ID 带选项后缀。
      const parts = screen.queryAllByTestId(new RegExp(`^form-form-${id}-`));
      expect({ id, shown: input !== null || parts.length > 0 }).toEqual({ id, shown: true });
    }
    for (const d of FIELDS) {
      expect(await screen.findByTestId(`component-list-${d.example.id}`)).toBeTruthy();
    }
    expect(store.getState().head!.source).not.toBe('rollback');
  },
);
