import { ScrollView, Text } from 'react-native';

import { t } from '../i18n';
import { LOCALE_CHOICES, LOCALE_NAMES, useLocaleChoice } from '../locale/store';
import { usePalette } from '../renderer/theme';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { Option } from './AISettingsScreen';

/** 「设置 → 语言」（D-254）：跟随系统或选一种；选了马上生效，只存在本机。 */
export function LanguageScreen() {
  const { locale } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const palette = usePalette(theme);
  const choice = useLocaleChoice((s) => s.choice);
  const device = useLocaleChoice((s) => s.device);
  const setChoice = useLocaleChoice((s) => s.setChoice);
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      {LOCALE_CHOICES.map((c) => (
        <Option
          key={c}
          testID={`language-${c}`}
          selected={choice === c}
          title={c === 'system' ? t(locale, 'languageSystem') : LOCALE_NAMES[c]}
          {...(c === 'system'
            ? { note: t(locale, 'languageSystemNote', { name: LOCALE_NAMES[device] }) }
            : {})}
          onPress={() => void setChoice(c)}
          palette={palette}
        />
      ))}
      <Text
        testID="language-note"
        style={[palette.font('body', 13), { color: palette.muted, lineHeight: 18 }]}>
        {t(locale, 'languageNote')}
      </Text>
    </ScrollView>
  );
}
