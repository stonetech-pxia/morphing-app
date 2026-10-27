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
import { apply, workspace } from './test-helpers';

// 组件登记表重构的基线（2026-10-27）：配置的 JSON Schema 和四个页面模版生成的 ops。
// 重构只换写法，这些输出必须逐字不变；真要改结构时，先想清楚再更新快照。

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

describe('baseline', () => {
  it('workspace config JSON Schema', () => {
    expect(z.toJSONSchema(WorkspaceConfigSchema, JSON_SCHEMA)).toMatchSnapshot();
    expect(z.toJSONSchema(ComponentSchema, JSON_SCHEMA)).toMatchSnapshot();
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
        expect(results).toMatchSnapshot();
      });
    }
  }
});
