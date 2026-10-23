import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';

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
      onPress={() => router.back()}>
      <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
        {t(locale, 'close')}
      </Text>
    </Pressable>
  );
}
