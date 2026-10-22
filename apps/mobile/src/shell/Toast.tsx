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
      {toast.restoreRecordId ? (
        <Pressable
          testID="toast-undo"
          hitSlop={8}
          onPress={() => {
            void actions.restore(toast.restoreRecordId!);
            dismiss();
          }}>
          <Text style={[palette.font('bodyBold', 14), { color: palette.surface }]}>
            {t(locale, 'undo')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel={t(locale, 'close')}>
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
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  flex: { flex: 1 },
});
