import type { Op } from '@morph/core';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

// 工作流页和编辑页的修改：走和 AI 相同的协议（proposeOps → confirm），每次生成一个 source 为 user 的版本，
// 提示条可撤销（D-082）。用户在界面上点的就是确认，所以不再弹预览。

export function useWorkflowChange() {
  const { locale } = useWorkspaceContext();
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);

  return async function change(ops: Op[], summary: string): Promise<boolean> {
    const result = await proposeOps(ops, summary);
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      await cancel();
      return false;
    }
    return confirm();
  };
}

/** 删除之前确认一次。 */
export function confirmDelete(locale: 'en' | 'zh', name: string, onDelete: () => void): void {
  const zh = locale === 'zh';
  Alert.alert(
    zh ? `删除「${name}」？` : `Delete “${name}”?`,
    zh ? '文件不受影响。删除后可以撤销。' : 'Your files are kept. You can undo this.',
    [
      { text: t(locale, 'cancel'), style: 'cancel' },
      { text: zh ? '删除' : 'Delete', style: 'destructive', onPress: onDelete },
    ],
  );
}
