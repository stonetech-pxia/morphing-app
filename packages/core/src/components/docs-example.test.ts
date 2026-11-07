import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { t } from '../messages';
import { boundedText, IdSchema } from '../schema-base';
import { defineLook, type LookDefinitionOf } from './define';

// docs/COMPONENTS.md 第 1 步里的最小外观定义：这个文件会被类型检查和运行，所以写法不对（defineLook 的
// 签名变了、键改了名）这里先编译不过。文档里的代码和这里保持一致；改了 defineLook，先改这里，再改文档。

const shape = {
  show: z.strictObject({ title: boundedText(1, 60) }),
  source: z.strictObject({ table: IdSchema }),
};

export const exampleComponent: LookDefinitionOf<'example', typeof shape> = defineLook({
  look: 'example',
  shape,
  kind: 'container',
  layer: 'table',
  reads: 'table',
  writes: false,
  refs: { 'source.table': { to: 'table' } },
  describe: (c, _config, ctx) => t(ctx.locale, 'describeChart', { v0: c.show.title }),
  edit: { text: [{ prop: 'title', max: 60 }], style: ['tone'] },
  ai: { doc: 'show {title}, source {table}: one number per entry of the table' },
  example: { show: { title: 'Spending' }, source: { table: 'expenses' } },
});

describe('docs/COMPONENTS.md 的最小外观定义', () => {
  it('生成的结构接受它的例子，拒绝多余的键', () => {
    const block = { id: 'x', look: 'example', ...exampleComponent.example };
    expect(exampleComponent.schema.safeParse(block).success).toBe(true);
    expect(exampleComponent.schema.safeParse({ ...block, extra: 1 }).success).toBe(false);
    expect(exampleComponent.schema.safeParse({ ...block, show: { title: '' } }).success).toBe(
      false,
    );
  });
});
