import { fieldDefinition } from './fields';
import { t } from './messages';
import { allComponents, type Component, type Locale, type WorkspaceConfig } from './schema';

// 列表的添加入口（D-310）：AI 新加了一个列表，这张表在整个 App 里却没有任何添加的地方时，
// 新用户只能看到「还没有记录」。这时在列表上方补一个「添加」按钮，打开完整的添加页。
// 只看这次新加的列表：用户以后自己移除了这个按钮，别的修改不会再把它加回来。

/** 能给这张表添加记录的地方：添加表单、新建或打开添加页的按钮、列表每一行的新建、就地添加的列表、记一笔的快捷操作。 */
function addsTo(config: WorkspaceConfig, collectionId: string): boolean {
  const inComponent = (c: Component) =>
    (c.type === 'recordForm' && c.props.collectionId === collectionId) ||
    (c.type === 'button' &&
      c.props.action !== undefined &&
      c.props.action.do !== 'setAll' &&
      c.props.action.collectionId === collectionId) ||
    (c.type === 'recordList' &&
      (c.props.rowActions ?? []).some(
        (a) => a.do === 'create' && a.collectionId === collectionId,
      )) ||
    // 就地添加（D-339）的列表自己就能添加。
    (c.type === 'recordList' && c.props.addHere === true && c.props.collectionId === collectionId);
  return (
    config.pages.some((page) => allComponents(page).some(inComponent)) ||
    config.workflows.some((wf) =>
      wf.steps.some((s) => s.action === 'out.addRecord' && s.params.collectionId === collectionId),
    )
  );
}

/** 给 after 里新加的、没有添加入口的列表补「添加」按钮；返回补了按钮的表。 */
export function addMissingEntryForms(
  before: WorkspaceConfig,
  after: WorkspaceConfig,
  locale: Locale,
): string[] {
  const added: string[] = [];
  for (const page of after.pages) {
    const old = before.pages.find((p) => p.id === page.id);
    const existed = new Set(old ? allComponents(old).map((c) => c.id) : []);
    for (const c of allComponents(page)) {
      if (c.type !== 'recordList' || existed.has(c.id)) continue;
      const collection = after.collections.find((x) => x.id === c.props.collectionId);
      if (!collection || addsTo(after, collection.id)) continue;
      const fieldIds = collection.fields
        .filter((f) => fieldDefinition(f.type).inForm !== false)
        .slice(0, 10)
        .map((f) => f.id);
      if (fieldIds.length === 0) continue;
      const ids = new Set(allComponents(page).map((x) => x.id));
      const stem = `add-${collection.id}`.slice(0, 44);
      let id = stem;
      for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;
      // 列表在分组里时放在分组上方（分组里只能放小组件）。
      const index = page.components.findIndex(
        (x) => x === c || (x.type === 'group' && x.children.includes(c)),
      );
      page.components.splice(index, 0, {
        id,
        type: 'recordForm',
        props: {
          collectionId: collection.id,
          fieldIds,
          submitLabel: t(locale, 'entryFormAdd'),
          mode: 'button',
        },
      } as Component);
      added.push(collection.id);
    }
  }
  return added;
}
