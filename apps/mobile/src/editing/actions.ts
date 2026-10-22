import { allComponents, componentLabel, type Op, type Page } from '@morph/core';
import { Alert } from 'react-native';

import { t, type StringKey } from '../i18n';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

// 直接编辑（D-052）：界面上的每个操作都翻译成语义化修改操作，走和 AI 相同的协议：
// proposeOps（校验、记录修改请求）→ confirm（生成 source 为 user 的新版本，提示条可撤销）。

export function useEditActions(page: Page) {
  const { registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);

  const label = (componentId: string) => {
    const c = allComponents(page).find((x) => x.id === componentId);
    return c ? componentLabel(c, config, { registry, locale, now: new Date() }) : componentId;
  };

  /** 提交一次修改；未通过校验时提示原因，什么也不改。 */
  async function run(ops: Op[], summaryKey: StringKey, componentId: string): Promise<boolean> {
    const result = await proposeOps(ops, t(locale, summaryKey, { label: label(componentId) }));
    if (result.kind === 'preview') return confirm();
    Alert.alert(
      t(locale, 'invalidPlan'),
      result.kind === 'invalid' ? result.issues.join('\n') : result.message,
    );
    return false;
  }

  return { run, label };
}
