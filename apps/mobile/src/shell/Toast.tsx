import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRecordActions } from '../data/records';
import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

/** 记录操作的提示条（例如删除后撤销）。和版本提示条分开：记录不属于任何版本。 */
export function Toast({ palette, bottom }: { palette: Palette; bottom: number }) {
  const { locale } = useWorkspaceContext();
  const toast = useWorkspace((s) => s.toast);
  const dismiss = useWorkspace((s) => s.dismissToast);
  const actions = useRecordActions();
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
      {toast.restoreRecordId || toast.undo ? (
        <Pressable
          testID="toast-undo"
          accessibilityRole="button"
          style={styles.action}
          onPress={() => {
            if (toast.undo) void actions.undo(toast.undo);
            else void actions.restore(toast.restoreRecordId!);
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
