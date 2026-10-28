import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ComponentSchema,
  WorkspaceConfigSchema,
  type Locale,
  type WorkspaceConfig,
} from './schema';
import {
  DATA_TEMPLATES,
  templateCollectionOp,
  templateCollectionWithoutPage,
  templateOps,
  templatePageOps,
} from './templates';
import { apply, snapshotLines, workspace } from './test-helpers';

// 组件登记表重构的基线（2026-10-27）：配置的 JSON Schema 和四个页面模版生成的 ops。
// 重构只换写法，这些输出必须逐字不变；真要改结构时，先想清楚再更新快照。
// 架构清理（2026-10-27）：Schema 只快照结构摘要（outline：路径、类型、可选值、范围、必填），
// 模版的 ops 一项一行（snapshotLines）。

const LOCALES: Locale[] = ['en', 'zh', 'fr'];
// 导航目标、提醒目标是 z.custom，JSON Schema 里写不出来，记成 {}。
const JSON_SCHEMA = { unrepresentable: 'any' } as const;

/** 导航栏还有空位的配置：模版页面放进导航栏（另一条分支是在首页加快捷入口）。 */
function roomyNav(locale: Locale): WorkspaceConfig {
  return apply(
    workspace(locale),
    [{ op: 'setNavItems', items: ['page:home', 'settings'] }],
    locale,
  );
}

type Schema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  prefixItems?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  default?: unknown;
};

/**
 * JSON Schema 的结构摘要：一个属性一行（路径、类型、可选值、范围、是否必填）。
 * 组件在配置里出现的地方写成 <Component>，组件本身单独列一份。
 */
function outline(schema: Schema, component?: string): string {
  const lines: string[] = [];
  const bounds = (s: Schema) =>
    [
      s.minimum !== undefined || s.maximum !== undefined
        ? `${s.minimum ?? ''}..${s.maximum ?? ''}`
        : '',
      s.exclusiveMinimum !== undefined ? `>${s.exclusiveMinimum}` : '',
      s.exclusiveMaximum !== undefined ? `<${s.exclusiveMaximum}` : '',
      s.minLength !== undefined || s.maxLength !== undefined
        ? `len ${s.minLength ?? ''}..${s.maxLength ?? ''}`
        : '',
      s.minItems !== undefined || s.maxItems !== undefined
        ? `items ${s.minItems ?? ''}..${s.maxItems ?? ''}`
        : '',
      s.pattern ? `/${s.pattern}/` : '',
      s.default !== undefined ? `default ${JSON.stringify(s.default)}` : '',
      s.additionalProperties && typeof s.additionalProperties === 'object' ? 'record' : '',
    ].filter(Boolean);
  /** 已经列过的子结构：再出现时写「= 第一次出现的路径」（例如分组里的组件）。 */
  const seen = new Map<string, string>();
  const walk = (s: Schema, path: string, required: boolean) => {
    const { $schema: _, ...rest } = s as Schema & { $schema?: string };
    const text = JSON.stringify(rest);
    if (component && path && text === component) {
      lines.push(`${path} <Component>${required ? '' : '?'}`);
      return;
    }
    const big = s.properties || s.oneOf || s.anyOf || s.allOf;
    if (big && seen.has(text)) {
      lines.push(`${path}${required ? '' : '?'} = ${seen.get(text)}`);
      return;
    }
    if (big) seen.set(text, path || '.');
    const kind =
      s.const !== undefined
        ? JSON.stringify(s.const)
        : s.enum
          ? s.enum.map((v) => JSON.stringify(v)).join('|')
          : ([] as string[]).concat(s.type ?? []).join('|');
    lines.push(`${path || '.'}${required ? '' : '?'} ${[kind, ...bounds(s)].join(' ')}`.trimEnd());
    for (const [k, v] of Object.entries(s.properties ?? {}))
      walk(v, `${path}.${k}`, (s.required ?? []).includes(k));
    if (s.items) walk(s.items, `${path}[]`, true);
    s.prefixItems?.forEach((v, i) => walk(v, `${path}[${i}]`, true));
    if (s.additionalProperties && typeof s.additionalProperties === 'object')
      walk(s.additionalProperties, `${path}{}`, true);
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
      s[key]?.forEach((v, i) => {
        const tag = v.properties?.type?.const;
        walk(v, `${path}<${key} ${typeof tag === 'string' ? tag : i}>`, true);
      });
  };
  walk(schema, '', true);
  return `\n${lines.join('\n')}\n`;
}

describe('baseline', () => {
  it('workspace config JSON Schema', () => {
    const component = z.toJSONSchema(ComponentSchema, JSON_SCHEMA) as Schema;
    const { $schema: _, ...bare } = component as Schema & { $schema?: string };
    expect(outline(component)).toMatchSnapshot();
    expect(
      outline(z.toJSONSchema(WorkspaceConfigSchema, JSON_SCHEMA) as Schema, JSON.stringify(bare)),
    ).toMatchSnapshot();
  });

  for (const locale of LOCALES) {
    for (const template of DATA_TEMPLATES) {
      it(`template ${template} in ${locale}`, () => {
        const results: Record<string, unknown> = {};
        for (const [name, config] of [
          ['default', workspace(locale)],
          ['roomyNav', roomyNav(locale)],
        ] as const) {
          // 已有同名的表和页面：再建一次要换成不重复的 ID。
          const taken = apply(config, templateOps(template, config, locale), locale);
          const tableOnly = apply(config, [templateCollectionOp(template, config, locale)], locale);
          results[name] = {
            templateOps: templateOps(template, config, locale),
            again: templateOps(template, taken, locale),
            collectionOp: templateCollectionOp(template, taken, locale),
            pageOps: templatePageOps(template, taken, locale, 'existing'),
            withoutPage: [
              templateCollectionWithoutPage(template, config),
              templateCollectionWithoutPage(template, taken),
              templateCollectionWithoutPage(template, tableOnly),
            ],
          };
        }
        expect(snapshotLines(results)).toMatchSnapshot();
      });
    }
  }
});
