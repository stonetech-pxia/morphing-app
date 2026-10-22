import { allComponents, componentLabel, type Op, type Page } from '@morph/core';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

// 直接编辑（D-052–D-054）：界面上的每个操作都翻译成语义化修改操作，先经过校验加入编辑模式的草稿；
// 点「完成」时整份草稿走和 AI 相同的协议：proposeOps → confirm，生成一个 source 为 user 的版本，提示条可撤销。

export function useEditActions(page: Page) {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.editing?.config ?? s.config)!;
  const draftOps = useWorkspace((s) => s.editing?.ops.length ?? 0);
  const editOps = useWorkspace((s) => s.editOps);
  const finishEditing = useWorkspace((s) => s.finishEditing);
  const cancelEditing = useWorkspace((s) => s.cancelEditing);

  const label = (componentId: string) => {
    const c = allComponents(page).find((x) => x.id === componentId);
    return c ? componentLabel(c, config, { registry, locale, now: new Date() }) : componentId;
  };

  const blocked = (issues: string[]) => Alert.alert(t(locale, 'invalidPlan'), issues.join('\n'));

  /** 把一个操作加入草稿；未通过校验时提示原因，草稿不变。 */
  function edit(ops: Op[]): boolean {
    const result = editOps(ops);
    if (result.ok) return true;
    if ('full' in result) Alert.alert(t(locale, 'tooManyEdits'));
    else blocked(result.issues);
    return false;
  }

  async function finish() {
    const result = await finishEditing(
      t(locale, 'editPageSummary', { page: page.title, count: draftOps }),
    );
    if (!result.ok && 'issues' in result) blocked(result.issues);
  }

  function cancel() {
    if (draftOps === 0) {
      cancelEditing();
      return;
    }
    Alert.alert(t(locale, 'discardEditTitle'), t(locale, 'discardEditMessage'), [
      { text: t(locale, 'keepEditing'), style: 'cancel' },
      { text: t(locale, 'discard'), style: 'destructive', onPress: cancelEditing },
    ]);
  }

  return { edit, finish, cancel, label };
}
