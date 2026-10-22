import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Palette } from '../../renderer/theme';

// 本地操作界面的外框：标题、取消、完成。全屏显示在运行页面之上。

export function LocalFrame({
  palette,
  title,
  cancelLabel,
  doneLabel,
  onCancel,
  onDone,
  doneDisabled,
  children,
}: {
  palette: Palette;
  title: string;
  cancelLabel: string;
  doneLabel: string;
  onCancel: () => void;
  onDone: () => void;
  doneDisabled?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="local-cancel" onPress={onCancel} hitSlop={10}>
          <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
            {cancelLabel}
          </Text>
        </Pressable>
        <Text
          numberOfLines={1}
          style={[palette.font('title', 17), styles.title, { color: palette.text }]}>
          {title}
        </Text>
        {/* 与「取消」对称占位，让标题居中。 */}
        <View style={styles.side} />
      </View>
      <View style={styles.body}>{children}</View>
      {/* 「完成」放在底部：单手好按，也不会被系统或开发菜单的按钮挡住。 */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          testID="local-done"
          onPress={onDone}
          disabled={doneDisabled}
          style={({ pressed }) => [
            styles.done,
            {
              backgroundColor: doneDisabled ? palette.border : palette.primary,
              borderRadius: palette.controlRadius,
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          <Text style={[palette.font('bodyBold', 17), { color: palette.onPrimary }]}>
            {doneLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  title: { flex: 1, textAlign: 'center' },
  side: { width: 40 },
  body: { flex: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 10 },
  done: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});
