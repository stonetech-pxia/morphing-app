import { CURRENT_SCHEMA_VERSION } from '@morph/core';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { useWorkspace } from '../workspace/context';

/** 设置页始终提供历史版本入口，保证“设置”在导航中时历史也可达。 */
export function SettingsView({
  env,
  onOpenHistory,
}: {
  env: RenderEnv;
  onOpenHistory: () => void;
}) {
  const { palette, locale } = env;
  const headId = useWorkspace((s) => s.head!.id);
  const row = (label: string, value?: string, onPress?: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.row, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={{ color: onPress ? palette.primary : palette.text, fontSize: 16 }}>{label}</Text>
      {value ? <Text style={{ color: palette.subtext }}>{value}</Text> : null}
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={[styles.title, { color: palette.text }]}>{t(locale, 'settingsTitle')}</Text>
      {row(t(locale, 'openHistory'), undefined, onOpenHistory)}
      <View style={styles.gap} />
      {row(t(locale, 'language'), t(locale, 'languageValue'))}
      {row(
        t(locale, 'aiEngine'),
        t(locale, process.env.EXPO_PUBLIC_MORPH_API_URL ? 'aiEngineRemote' : 'aiEngineMock'),
      )}
      {row(
        t(locale, 'about'),
        t(locale, 'aboutValue', { schema: CURRENT_SCHEMA_VERSION, revision: headId }),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 8, paddingBottom: 160 },
  title: { fontSize: 28, fontWeight: '700', paddingVertical: 8 },
  row: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  gap: { height: 8 },
});
