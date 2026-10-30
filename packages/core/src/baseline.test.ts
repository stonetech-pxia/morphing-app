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
import { describeChange, describeRestore } from './describe';
import type { Op } from './ops-schema';
import { apply, fromV33, registry, snapshotLines, v33Fixture, workspace } from './test-helpers';

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
    [{ op: 'updateContainer', nav: { bar: ['page:home', 'settings'] } }],
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

// 修改说明（describe.ts）：每个 v34 操作一句话。v34 迁移时逐条和 v33 代码（main 415a340）对同一个修改
// （v33 的操作、v33 的配置）的说明比过，三种语言 129 句逐字一样（2026-10-30）；改文字时想清楚再更新快照。
// 名字是原来的 v33 操作。配置是「出国办证」样板（fixtures/v33/sample-visa-docs-zh.json 迁移来的）。
const DESCRIBED: [string, Op[]][] = [
  [
    'addCollection',
    [
      {
        op: 'addData',
        table: {
          id: 'x',
          name: 'X',
          fields: [
            { id: 'a', name: 'A', type: 'text' },
            { id: 'b', name: 'B', type: 'money', currency: 'CNY' },
          ],
        },
      },
    ],
  ],
  [
    'updateCollection',
    [{ op: 'updateData', table: 'papers', changes: { name: '材料单', icon: 'star' } }],
  ],
  [
    'addField',
    [{ op: 'addData', table: 'papers', field: { id: 'n', name: '份数', type: 'number' } }],
  ],
  [
    'updateField',
    [{ op: 'updateData', table: 'papers', field: 'name', changes: { name: '名字', type: 'note' } }],
  ],
  ['moveField', [{ op: 'moveData', table: 'papers', field: 'due', toIndex: 0 }]],
  ['removeField', [{ op: 'removeData', table: 'papers', field: 'due' }]],
  ['removeCollection', [{ op: 'removeData', table: 'papers' }]],
  [
    'setCalendar',
    [{ op: 'updateData', calendar: { dayStartHour: 4, weekStart: 'sunday', twoWeekStart: null } }],
  ],
  [
    'addReminder daily',
    [
      {
        op: 'addTool',
        tool: {
          id: 'r',
          kind: 'reminder',
          title: '喝水',
          enabled: true,
          when: { every: 'week', days: [1, 3], at: '09:00' },
          opens: 'page:visa',
        },
      },
    ],
  ],
  [
    'addReminder date',
    [
      {
        op: 'addTool',
        tool: {
          id: 'r',
          kind: 'reminder',
          title: '到期',
          enabled: true,
          when: { before: { table: 'papers', field: 'due' }, days: 2, at: '09:00' },
          opens: 'page:visa',
        },
      },
    ],
  ],
  ['updateReminder', [{ op: 'updateTool', tool: 'id-expiry', changes: { enabled: false } }]],
  ['removeReminder', [{ op: 'removeTool', tool: 'paper-deadline' }]],
  [
    'setTheme',
    [
      {
        op: 'setTheme',
        primaryColor: '#112233',
        mode: 'dark',
        colors: { background: '#000000' },
        darkColors: { text: null },
        font: 'serif',
        radius: 4,
      },
    ],
  ],
  ['applyThemePreset', [{ op: 'setTheme', preset: 'neon' }]],
  ['resetTheme', [{ op: 'setTheme', reset: true }]],
  [
    'setNavItems',
    [{ op: 'updateContainer', nav: { bar: ['page:home', 'page:visa', 'settings'] } }],
  ],
  ['setFloatingItems', [{ op: 'updateContainer', nav: { floating: ['ai'] } }]],
  ['setFloatingItems none', [{ op: 'updateContainer', nav: { floating: [] } }]],
  [
    'setPageBackdrop',
    [{ op: 'updateContainer', page: 'visa', changes: { backdrop: { overlay: 'strong' } } }],
  ],
  ['setPageIcon', [{ op: 'updateContainer', page: 'visa', changes: { icon: 'star' } }]],
  ['setPageTitle', [{ op: 'updateContainer', page: 'visa', changes: { title: '办证' } }]],
  [
    'addPage',
    [
      {
        op: 'addContainer',
        page: {
          id: 'np',
          title: '新页',
          blocks: [{ id: 'h', look: 'header', show: { title: 'H' } }],
        },
      },
      { op: 'updateContainer', nav: { bar: ['page:home', 'page:np', 'settings'] } },
    ],
  ],
  ['removePage', [{ op: 'removeContainer', page: 'my-ids' }]],
  [
    'moveComponent',
    [
      { op: 'moveContainer', page: 'visa', block: 'papers', toIndex: 0 },
      { op: 'moveContainer', page: 'visa', block: 'left', toIndex: 0, parent: 'actions' },
    ],
  ],
  [
    'props header',
    [
      {
        op: 'updateContainer',
        page: 'visa',
        block: 'title',
        changes: { show: { title: '新标题', subtitle: null } },
      },
    ],
  ],
  [
    'props shortcut',
    [
      {
        op: 'updateContainer',
        page: 'visa',
        block: 'to-ids',
        changes: { show: { shape: 'tile', icon: 'star' }, opens: 'page:home' },
      },
    ],
  ],
  [
    'props file slot',
    [
      {
        op: 'updateContainer',
        page: 'my-ids',
        block: 'passport-scan',
        changes: { opens: { file: null } },
      },
    ],
  ],
  [
    'style',
    [
      {
        op: 'updateContainer',
        page: 'visa',
        block: 'left',
        changes: { style: { tone: 'primary', align: null } },
      },
    ],
  ],
  ['hidden', [{ op: 'updateContainer', page: 'visa', block: 'papers', changes: { hidden: true } }]],
  [
    'addComponent',
    [
      {
        op: 'addContainer',
        page: 'visa',
        parent: 'actions',
        block: {
          id: 'n',
          look: 'number',
          show: { label: '材料' },
          source: { table: 'papers', aggregate: 'count' },
        },
      },
    ],
  ],
  [
    'addComponent list',
    [
      {
        op: 'addContainer',
        page: 'visa',
        block: {
          id: 'l',
          look: 'checklist',
          source: { table: 'papers', limit: 20 },
          show: { title: 'name' },
          tools: [{ as: 'check', do: 'toggle', table: 'papers', field: 'ready' }],
        },
      },
    ],
  ],
  ['removeComponent', [{ op: 'removeContainer', page: 'visa', block: 'papers' }]],
  ['installTool', [{ op: 'setPackage', package: 'zip', do: 'add' }]],
  ['uninstallTool', [{ op: 'setPackage', package: 'pdf', do: 'remove' }]],
  ['setStepParams', [{ op: 'updateTool', tool: 'visa-photo', step: 'pick', changes: { ask: [] } }]],
  [
    'addWorkflow',
    [
      {
        op: 'addTool',
        tool: {
          id: 'w',
          kind: 'quickAction',
          name: '我的',
          preset: 'x',
          steps: [{ id: 'extra', action: 'pdf.compress', params: {} }],
        },
      },
    ],
  ],
  ['removeWorkflow', [{ op: 'removeTool', tool: 'scan-paper-log' }]],
  ['renameWorkflow', [{ op: 'updateTool', tool: 'scan-paper-log', changes: { name: '扫一张' } }]],
  ['homeScreen', [{ op: 'updateContainer', nav: { phoneHomeScreen: ['visa-photo'] } }]],
  [
    'addWorkflowStep',
    [
      {
        op: 'addTool',
        tool: 'scan-paper-log',
        step: { id: 'extra', action: 'pdf.compress', params: {} },
      },
    ],
  ],
  ['moveWorkflowStep', [{ op: 'moveTool', tool: 'scan-paper-log', step: 'log', toIndex: 0 }]],
  [
    'updateWorkflow',
    [
      {
        op: 'updateTool',
        tool: 'scan-paper-log',
        changes: { name: '新名', steps: [{ id: 'extra', action: 'pdf.compress', params: {} }] },
      },
    ],
  ],
  ['removeWorkflowStep', [{ op: 'removeTool', tool: 'scan-paper-log', step: 'log' }]],
  // v34 才有的写法（没有 v33 对应，新文案 v34desc*）。
  [
    'v34 desk',
    [
      {
        op: 'addContainer',
        desk: 'above',
        block: { id: 'tip', look: 'notice', show: { text: '提示' } },
      },
      { op: 'updateContainer', desk: { toolbar: 'top' } },
      { op: 'removeContainer', desk: 'below', block: 'tip' },
    ],
  ],
  [
    'v34 quick action icon',
    [{ op: 'updateTool', tool: 'scan-paper-log', changes: { icon: 'star' } }],
  ],
  [
    'v34 block tools',
    [
      { op: 'updateContainer', page: 'visa', block: 'papers', changes: { tools: [] } },
      { op: 'updateContainer', page: 'visa', block: 'papers', changes: { tools: null } },
    ],
  ],
];

describe('describe baseline', () => {
  const before = fromV33(v33Fixture('sample-visa-docs-zh'));
  for (const locale of LOCALES)
    it(`one sentence per op in ${locale}`, () => {
      const ctx = { registry, locale, now: new Date(2026, 9, 30) };
      const lines = Object.fromEntries(
        DESCRIBED.map(([name, ops]) => [name, describeChange(ops, before, [], ctx)]),
      );
      lines.restore = describeRestore(
        before,
        fromV33(v33Fixture('starter-zh')),
        { id: 1, summary: 'x' },
        ctx,
      );
      expect(snapshotLines(lines)).toMatchSnapshot();
    });
});
