import { fieldDefinition } from './fields';
import { t } from './messages';
import { isRecordToolUse, type ToolUse } from './record-ops-schema';
import {
  RECORD_LOOKS,
  allComponents,
  isKnownComponent,
  parentOf,
  quickActionsOf,
  type Component,
  type Locale,
  type WorkspaceConfig,
} from './schema';

// 记录块的添加入口（D-310）：AI 新加了一个记录块（列表、卡片、清单、大圆块、看板、月历），这张表在整个 App 里
// 却没有任何添加的地方时，新用户只能看到「还没有记录」。这时在它上方补一个「添加」按钮（就地的
// {do: "create", table, ask: "all"}），打开完整的添加页。
// 只看这次新加的记录块：用户以后自己移除了这个按钮，别的修改不会再把它加回来。

const isRecordLook = (c: Component): boolean =>
  isKnownComponent(c) && (RECORD_LOOKS as readonly string[]).includes(c.look);

/**
 * 能给这张表添加记录的地方：块上任何一个新建这张表的就地工具（添加表单的提交、按钮、每一行的新建、
 * 就地添加），或者记一笔的快捷操作。
 */
function addsTo(config: WorkspaceConfig, table: string): boolean {
  const creates = (c: Component) =>
    isKnownComponent(c) &&
    ((c as { tools?: ToolUse[] }).tools ?? []).some(
      (u) => isRecordToolUse(u) && u.do === 'create' && u.table === table,
    );
  return (
    config.containers.pages.some((page) => allComponents(page).some(creates)) ||
    quickActionsOf(config).some((wf) =>
      wf.steps.some((s) => s.action === 'out.addRecord' && s.params.collectionId === table),
    )
  );
}

/** 给 after 里新加的、没有添加入口的记录块补「添加」按钮；返回补了按钮的表。 */
export function addMissingEntryForms(
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  locale: Locale,
): string[] {
  const added: string[] = [];
  for (const page of after.containers.pages) {
    const old = before.containers.pages.find((p) => p.id === page.id);
    const existed = new Set(old ? allComponents(old).map((c) => c.id) : []);
    for (const c of allComponents(page)) {
      if (!isRecordLook(c) || existed.has(c.id)) continue;
      const tableId = (c as { source: { table: string } }).source.table;
      const table = after.data.tables.find((x) => x.id === tableId);
      if (!table || addsTo(after, table.id)) continue;
      // 没有能在表单里填的字段（全是算出来的）时不补。
      if (!table.fields.some((f) => fieldDefinition(f.type).inForm !== false)) continue;
      const ids = new Set(allComponents(page).map((x) => x.id));
      const stem = `add-${table.id}`.slice(0, 44);
      let id = stem;
      for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;
      // 记录块在分组里时放在最外层那个分组的上方（按钮放在页面顶层，和 v33 一样）。
      let top: Component = c;
      for (let p = parentOf(page, top.id); p; p = parentOf(page, top.id)) top = p;
      page.blocks.splice(page.blocks.indexOf(top), 0, {
        id,
        look: 'button',
        show: { label: t(locale, 'entryFormAdd'), variant: 'filled' },
        tools: [{ do: 'create', table: table.id, ask: 'all' }],
      });
      added.push(table.id);
    }
  }
  return added;
}
