import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRecordActions } from '../data/records';
import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { aboutParams } from './ai-entry';

/** 普通提示（「已记下」）显示多久。到时间就消失，切页面也不会一直留着。 */
export const TOAST_MS = 4000;
/** 能点的提示（删除后撤销、接着改）多留一会儿，够读完再点。 */
export const TOAST_UNDO_MS = 8000;

/** 记录操作的提示条（例如删除后撤销）。和版本提示条分开：记录不属于任何版本。 */
export function Toast({ palette, bottom }: { palette: Palette; bottom: number }) {
  const { locale } = useWorkspaceContext();
  const toast = useWorkspace((s) => s.toast);
  const dismiss = useWorkspace((s) => s.dismissToast);
  const hold = useWorkspace((s) => s.holdToast);
  const restorePreset = useWorkspace((s) => s.restorePreset);
  const hasNext = useWorkspace((s) => !!s.next);
  const actions = useRecordActions();
  const router = useRouter();
  const canUndo = !!(toast?.restoreRecordId || toast?.restorePreset);
  const canContinue = !!toast?.continueTable;
  const timed = toast && !toast.held;
  const ms = canUndo || canContinue ? TOAST_UNDO_MS : TOAST_MS;
  // 换了一条提示重新计时；手指按在按钮上时不消失。
  useEffect(() => {
    if (!timed) return;
    const timer = setTimeout(dismiss, ms);
    return () => clearTimeout(timer);
  }, [toast, timed, ms, dismiss]);
  if (!toast) return null;
  return (
    <View
      testID="toast"
      style={[
        styles.toast,
        { bottom, backgroundColor: palette.text, borderRadius: palette.controlRadius },
      ]}>
      <Text style={[styles.flex, palette.font('bodyMedium', 14), { color: palette.surface }]}>
        {toast.message}
      </Text>
      {toast.continueTable ? (
        <Pressable
          testID="toast-continue"
          accessibilityRole="button"
          style={styles.action}
          onPressIn={() => hold(true)}
          onPressOut={() => hold(false)}
          onPress={() => {
            const tableId = toast.continueTable!;
            dismiss();
            // 上一句还剩外观没做（接着改）：直接接上；没有就打开 AI 页，这句话默认说这张表。
            router.push({
              pathname: '/change',
              params: hasNext ? { next: '1' } : aboutParams({ kind: 'table', tableId }),
            });
          }}>
          <Text style={[palette.font('bodyBold', 14), { color: palette.surface }]}>
            {t(locale, 'toastContinue')}
          </Text>
        </Pressable>
      ) : null}
      {canUndo ? (
        <Pressable
          testID="toast-undo"
          accessibilityRole="button"
          style={styles.action}
          onPressIn={() => hold(true)}
          onPressOut={() => hold(false)}
          onPress={() => {
            if (toast.restoreRecordId) void actions.restore(toast.restoreRecordId);
            if (toast.restorePreset) void restorePreset(toast.restorePreset);
            dismiss();
          }}>
          <Text style={[palette.font('bodyBold', 14), { color: palette.surface }]}>
            {t(locale, 'undo')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={dismiss}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={t(locale, 'close')}>
        <Text style={[palette.font('bodyBold', 14), { color: palette.surface }]}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
  },
  // 撤销和关闭至少 44 见方，好点。
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
