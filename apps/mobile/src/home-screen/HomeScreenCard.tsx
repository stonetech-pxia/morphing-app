import type { Workflow } from '@morph/core';
import { Alert, StyleSheet, Text } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { useWorkspaceContext } from '../workspace/context';
import { useHomeScreenPlatform } from './context';
import { iosSymbolName } from '../renderer/Icon';

/**
 * 放到桌面的快捷操作怎么用（D-269）：iOS 只能长按 Morph 图标；Android 另外可以在桌面上单独放一个图标，
 * 系统会弹确认框，所以只在用户点了「添加到桌面」之后才请求，绝不在应用修改时自动弹。
 */
export function HomeScreenCard({ workflow, palette }: { workflow: Workflow; palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const platform = useHomeScreenPlatform();
  if (!workflow.homeScreen) return null;
  const canPin = platform?.canPin() ?? false;

  async function pin() {
    const symbol = workflow.icon ? iosSymbolName(workflow.icon) : undefined;
    const sent = await platform!
      .pin({ id: workflow.id, title: workflow.name, ...(symbol ? { symbol } : {}) })
      .catch(() => false);
    if (!sent) Alert.alert(t(locale, 'homeScreenPinFailed'));
  }

  return (
    <Card palette={palette}>
      <Text style={[palette.font('title', 15), { color: palette.text }]}>
        {t(locale, 'homeScreenTitle')}
      </Text>
      <Text
        testID="home-screen-how"
        style={[palette.font('body', 14), styles.body, { color: palette.muted }]}>
        {t(locale, canPin ? 'homeScreenAndroid' : 'homeScreenIos', { name: workflow.name })}
      </Text>
      {canPin ? (
        <Button
          palette={palette}
          testID="home-screen-pin"
          variant="outline"
          label={t(locale, 'homeScreenPin')}
          onPress={() => void pin()}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 20 },
});
