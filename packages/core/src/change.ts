import { describeChange } from './describe';
import { migrateWorkspace } from './migrate';
import { OpListSchema, applyOps } from './ops';
import type { Registry } from './registry';
import type { Locale, WorkspaceConfig } from './schema';
import { validateWorkspace } from './validate';

// ChangeRequest → Plan → Validate → Preview（§5.3）中与平台无关的部分。
// 无论修改来自 mock AI、真实模型还是界面按钮，都走这里。

export interface ChangeContext {
  registry: Registry;
  locale: Locale;
  now: Date;
}

export type PreparedChange =
  | { ok: true; after: WorkspaceConfig; lines: string[] }
  | { ok: false; stage: 'parse' | 'apply' | 'validate' | 'migrate'; issues: string[] };

/** 校验来自任意来源（包括不可信模型输出）的操作列表，并生成预览所需的结果。 */
export function prepareOps(
  before: WorkspaceConfig,
  rawOps: unknown,
  ctx: ChangeContext,
): PreparedChange {
  const parsed = OpListSchema.safeParse(rawOps);
  if (!parsed.success) {
    return { ok: false, stage: 'parse', issues: parsed.error.issues.map((i) => i.message) };
  }
  const applied = applyOps(before, parsed.data, ctx);
  if (!applied.ok) return { ok: false, stage: 'apply', issues: [applied.error] };
  const valid = validateWorkspace(applied.config, ctx.registry);
  if (!valid.ok)
    return { ok: false, stage: 'validate', issues: valid.issues.map((i) => i.message) };
  return {
    ok: true,
    after: valid.config,
    lines: describeChange(parsed.data, before, applied.notes, ctx),
  };
}

/** 把历史快照（可能是旧 schemaVersion）迁移并校验为当前可用的配置（§7E）。 */
export function prepareSnapshot(raw: unknown, registry: Registry): PreparedChange {
  const migrated = migrateWorkspace(raw);
  if (!migrated.ok) return { ok: false, stage: 'migrate', issues: [migrated.error] };
  const valid = validateWorkspace(migrated.config, registry);
  if (!valid.ok)
    return { ok: false, stage: 'validate', issues: valid.issues.map((i) => i.message) };
  return { ok: true, after: valid.config, lines: [] };
}
