import type { Component } from '@morph/core';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useWidgetPlatform } from './context';
import { useWidgetPlacement } from './placed';
import { onRecordPage, widgetName, widgetSupported } from './snapshot';

/**
 * 长按组件的「放到桌面」（D-325）：用户自己点才放，AI 不能放。Android 弹系统的确认框（桌面支持时）；
 * iOS 不能替用户放，加进「编辑小组件」的列表，并说明在桌面上怎么加。不支持的组件说明能放哪几种。
 */
export function usePlaceWidget() {
  const { locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config);
  const platform = useWidgetPlatform();
  const placed = useWidgetPlacement((s) => s.placed);
  const isPlaced = (id: string) => placed?.some((p) => p.componentId === id) ?? false;

  async function toggle(component: Component) {
    const name = config ? widgetName(component, config, registry, locale) : component.id;
    const store = useWidgetPlacement.getState();
    if (isPlaced(component.id)) return store.remove(component.id);
    if (!widgetSupported(component)) {
      Alert.alert(t(locale, 'widgetUnsupportedTitle'), t(locale, 'widgetUnsupportedHelp'));
      return;
    }
    // D-332：这一页跟着某一条记录打开，桌面上不知道显示哪一条。
    if (config && onRecordPage(component, config)) {
      Alert.alert(t(locale, 'widgetUnsupportedTitle'), t(locale, 'widgetRecordPageHelp'));
      return;
    }
    await store.add(component.id, Date.now());
    if (platform?.canPin()) {
      const sent = await platform.pin(component.id, name).catch(() => false);
      if (!sent) Alert.alert(t(locale, 'widgetPinFailed'));
    } else {
      Alert.alert(t(locale, 'widgetIosTitle'), t(locale, 'widgetIosHow', { name }));
    }
  }

  return { available: platform !== null, isPlaced, toggle };
}
