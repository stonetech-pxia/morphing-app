import { describeChange } from './describe';
import { newFileRefs, restoreFileRefs } from './file-refs';
import { migrateWorkspace } from './migrate';
import { OpListSchema, applyOps } from './ops';
import type { Registry } from './registry';
import type { Locale, WorkspaceConfig } from './schema';
import { validateWorkspace } from './validate';
import { addMissingPageEntries } from './page-entries';
import { referenceProblems } from './reference-checks';
import { issueLines } from './zod-issues';

// ChangeRequest → Plan → Validate → Preview（§5.3）中与平台无关的部分。
// 无论修改来自 mock AI、真实模型还是界面按钮，都走这里。

export interface ChangeContext {
  registry: Registry;
  locale: Locale;
  now: Date;
  /**
   * 修改来自 AI（底线 3）：不能多出指向用户文件的引用（文件位、图片、图片背景只能由用户自己选）。
   * 用户在界面上的修改不带这一项。
   */
  fromAI?: boolean;
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
    return { ok: false, stage: 'parse', issues: issueLines(parsed.error) };
  }
  const applied = applyOps(before, parsed.data, ctx);
  if (!applied.ok) return { ok: false, stage: 'apply', issues: [applied.error] };
  // AI 看到的文件 ID 是占位符；原样写回来的换回原来的文件。
  const config = restoreFileRefs(before, applied.config);
  // 修改里新加的页面没有任何地方能打开时，在首页补一个入口（AI 常忘了加）。
  const notes = [
    ...applied.notes,
    ...addMissingPageEntries(before, config).map((page) => ({
      kind: 'addedPageEntry' as const,
      page,
    })),
  ];
  if (ctx.fromAI) {
    const added = newFileRefs(before, config);
    if (added.length > 0)
      return {
        ok: false,
        stage: 'validate',
        issues: added.map(
          (place) =>
            `${place}: only the user picks a file (a file slot's opens.file, an image's show.asset, a backdrop's assetId); leave it as it is or null`,
        ),
      };
  }
  // 修改前就有的、这个版本不认识的组件（D-254）原样留着；修改不能新加或改动它们。
  const valid = validateWorkspace(config, ctx.registry, { unknownComponents: before });
  if (!valid.ok)
    return { ok: false, stage: 'validate', issues: valid.issues.map((i) => i.message) };
  // 校验器不查的引用（底线 18）：修改不能多出新的；修改前就有的不拦（底线 12，旧配置照常能改）。
  const old = new Set(referenceProblems(before, ctx.registry));
  const added = referenceProblems(valid.config, ctx.registry).filter((p) => !old.has(p));
  if (added.length > 0) return { ok: false, stage: 'validate', issues: added };
  return {
    ok: true,
    after: valid.config,
    lines: describeChange(parsed.data, before, notes, ctx),
  };
}

/** 把历史快照（可能是旧 schemaVersion）迁移并校验为当前可用的配置（§7E）。 */
export function prepareSnapshot(raw: unknown, registry: Registry): PreparedChange {
  const migrated = migrateWorkspace(raw);
  if (!migrated.ok) return { ok: false, stage: 'migrate', issues: [migrated.error] };
  // 更新的 App 加的组件（D-254）原样保留，保存时写回去。
  const valid = validateWorkspace(migrated.config, registry, { unknownComponents: 'keep' });
  if (!valid.ok)
    return { ok: false, stage: 'validate', issues: valid.issues.map((i) => i.message) };
  return { ok: true, after: valid.config, lines: [] };
}
