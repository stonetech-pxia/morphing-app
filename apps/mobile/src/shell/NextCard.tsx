import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

/**
 * 「接着改」（D-191）：上一次功能修改那句话里剩下的外观请求。点一下打开 AI 修改页，
 * 句子自动打进去发送，进草稿看效果。
 */
export function NextCard({ palette, primary }: { palette: Palette; primary?: boolean }) {
  const { locale } = useWorkspaceContext();
  const next = useWorkspace((s) => s.next);
  const router = useRouter();
  if (!next) return null;
  return (
    <Card palette={palette} background={palette.primaryTint} testID="next-card">
      <Text style={[palette.font('title', 15), { color: palette.text }]}>
        {t(locale, 'nextTitle')}
      </Text>
      <Text style={[palette.font('body', 14), { color: palette.muted }]}>
        {t(locale, 'nextHint')}
      </Text>
      <Button
        palette={palette}
        testID="next-go"
        variant={primary ? 'filled' : 'outline'}
        label={next}
        onPress={() => router.replace({ pathname: '/change', params: { next: '1' } })}
      />
    </Card>
  );
}
