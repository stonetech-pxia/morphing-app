import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t, type StringKey } from '@/i18n';
import { LANGUAGE_CHOICES, LANGUAGE_META_KEY, useLanguage } from '@/language';
import { usePalette } from '@/renderer/theme';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 「设置 → 语言」：跟随系统，或固定一种语言。选了马上生效（外壳按新语言重建）。 */
export default function LanguageRoute() {
  const { repo, locale } = useWorkspaceContext();
  const palette = usePalette(useWorkspace((s) => s.config)!.theme);
  const preference = useLanguage((s) => s.preference);
  return (
    <ScrollView
      testID="language-screen"
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      {LANGUAGE_CHOICES.map((choice) => {
        const selected = choice === preference;
        return (
          <Pressable
            key={choice}
            testID={`language-${choice}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => {
              if (selected) return;
              useLanguage.getState().set(choice);
              void repo.setMeta(LANGUAGE_META_KEY, choice);
            }}
            style={[
              styles.option,
              { padding: palette.inset },
              palette.cardStyle(selected ? palette.primaryTint : palette.surface),
              { borderColor: selected ? palette.primary : 'transparent' },
            ]}>
            <View
              style={[styles.radio, { borderColor: selected ? palette.primary : palette.border }]}>
              {selected ? (
                <View style={[styles.radioDot, { backgroundColor: palette.primary }]} />
              ) : null}
            </View>
            <Text style={[palette.font('title', 16), { color: palette.text }]}>
              {t(locale, `languageValue_${choice}` as StringKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
