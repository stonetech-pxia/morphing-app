import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { componentLabel } from './describe';
import { COMPONENTS, type Component, type Locale, type WorkspaceConfig } from './schema';
import { templateOps } from './templates';
import { apply, registry, workspace } from './test-helpers';
import { validateWorkspace } from './validate';

// 每个登记的组件都要满足的事（新增组件时这里会自动检查它，见 docs/COMPONENTS.md）。

const LOCALES: Locale[] = ['en', 'zh', 'fr'];

/** 组件 example 能引用的东西：数据表 expenses、已添加的工具 pdf 和它的快捷操作。 */
function fixture(locale: Locale): WorkspaceConfig {
  const config = workspace(locale, { withPdf: true });
  const [table] = templateOps('budget', config, locale);
  return apply(config, [table!], locale);
}

function withExample(config: WorkspaceConfig, def: (typeof COMPONENTS)[number]): WorkspaceConfig {
  const component = { id: 'example', type: def.type, ...def.example } as Component;
  const home = config.pages[0]!;
  const pages = [
    { ...home, components: [...home.components, component] },
    ...config.pages.slice(1),
  ];
  return { ...config, pages };
}

/** 文字属性在结构里的长度上限（可以不写的先拆掉 optional）。 */
function maxLength(props: z.ZodObject, prop: string): number | null | undefined {
  const schema = props.shape[prop] as z.ZodType | undefined;
  if (!schema) return undefined;
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  return inner instanceof z.ZodString ? inner.maxLength : undefined;
}

describe.each(COMPONENTS.map((d) => [d.type, d] as const))('component %s', (_type, def) => {
  it.each(LOCALES)('its example passes structure and reference checks in %s', (locale) => {
    const result = validateWorkspace(withExample(fixture(locale), def), registry);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(LOCALES)('has a change description in %s', (locale) => {
    const config = withExample(fixture(locale), def);
    const component = config.pages[0]!.components.at(-1)!;
    const label = componentLabel(component, config, { registry, locale, now: new Date() });
    expect(label.trim()).not.toBe('');
  });

  it('lists only text props that exist, with the same length limit', () => {
    for (const field of def.edit.text) {
      expect({ prop: field.prop, max: maxLength(def.props, field.prop) }).toEqual({
        prop: field.prop,
        max: field.max,
      });
      const shape = def.props.shape as Record<string, z.ZodType>;
      const optional = shape[field.prop] instanceof z.ZodOptional;
      expect({ prop: field.prop, optional }).toEqual({
        prop: field.prop,
        optional: field.optional ?? false,
      });
    }
  });

  it('has a doc line for the AI, and its rule (if any) does not clash', () => {
    expect(def.ai.doc.trim()).not.toBe('');
    if (def.ai.docAfter) expect(COMPONENTS.map((d) => d.type)).toContain(def.ai.docAfter);
    const numbers = COMPONENTS.flatMap((d) => (d.ai.rule ? [d.ai.rule.n] : []));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
