import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { useWorkspaceContext } from '../workspace/context';

/** 弹出页（AI 修改、运行、记录）左上角的「关闭」：不用知道可以下滑关闭（D-111）。 */
export function CloseButton({ palette }: { palette: Palette }) {
  const router = useRouter();
  const { locale } = useWorkspaceContext();
  return (
    <Pressable
      testID="modal-close"
      accessibilityRole="button"
      hitSlop={10}
      style={styles.button}
      onPress={() => router.back()}>
      <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
        {t(locale, 'close')}
      </Text>
    </Pressable>
  );
}

// 文字两边留空，不和居中的标题贴在一起（iOS 26 的玻璃按钮按内容宽度包住文字）。
const styles = StyleSheet.create({ button: { paddingHorizontal: 12 } });
