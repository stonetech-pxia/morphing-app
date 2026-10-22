import { MODELS } from '@morph/planner';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAISettings } from '../ai/context';
import type { AIMode, ConnectionResult } from '../ai/settings';
import { t, type StringKey } from '../i18n';
import { usePalette, type Palette } from '../renderer/theme';
import { Button, Card, SectionLabel } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

const RESULT_MESSAGES: Record<Exclude<ConnectionResult, { ok: true }>['kind'], StringKey> = {
  no_key: 'byokNoKey',
  invalid_key: 'byokInvalidKey',
  permission: 'byokPermission',
  spend_limit: 'byokSpendLimit',
  rate_limit: 'aiRateLimited',
  overloaded: 'byokBusy',
  server: 'byokBusy',
  not_found: 'byokModelNotFound',
  bad_request: 'byokUnavailable',
  timeout: 'byokUnavailable',
  network: 'byokUnavailable',
};

function Option({
  selected,
  title,
  note,
  onPress,
  palette,
  testID,
}: {
  selected: boolean;
  title: string;
  note: string;
  onPress: () => void;
  palette: Palette;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        styles.option,
        palette.cardStyle(selected ? palette.primaryTint : palette.surface),
        { borderColor: selected ? palette.primary : 'transparent' },
      ]}>
      <View style={[styles.radio, { borderColor: selected ? palette.primary : palette.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={[palette.font('title', 16), { color: palette.text }]}>{title}</Text>
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>{note}</Text>
      </View>
    </Pressable>
  );
}

/** 「设置 → AI」：选择 AI 来源；自带 key 时管理 key、选择模型、测试连接。 */
export function AISettingsScreen() {
  const { locale } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const palette = usePalette(theme);
  const mode = useAISettings((s) => s.mode);
  const model = useAISettings((s) => s.model);
  const keyHint = useAISettings((s) => s.keyHint);
  const serverAvailable = useAISettings((s) => s.serverAvailable);
  const setMode = useAISettings((s) => s.setMode);
  const setModel = useAISettings((s) => s.setModel);
  const saveKey = useAISettings((s) => s.saveKey);
  const clearKey = useAISettings((s) => s.clearKey);
  const testConnection = useAISettings((s) => s.testConnection);

  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  const choose = (m: AIMode) => {
    setMessage(null);
    void setMode(m);
  };

  async function onSave() {
    const ok = await saveKey(draft);
    if (ok) setDraft('');
    setMessage(ok ? null : { text: t(locale, 'keyFormatInvalid'), ok: false });
  }

  async function onTest() {
    setTesting(true);
    const result = await testConnection();
    setTesting(false);
    setMessage(
      result.ok
        ? { text: t(locale, 'testOk'), ok: true }
        : { text: t(locale, RESULT_MESSAGES[result.kind]), ok: false },
    );
  }

  const text = [palette.font('body', 15), { color: palette.text }];
  const sub = [palette.font('body', 13), { color: palette.muted }];
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled">
      <SectionLabel palette={palette}>{t(locale, 'aiModeQuestion')}</SectionLabel>
      <Option
        testID="ai-mode-mock"
        selected={mode === 'mock'}
        title={t(locale, 'aiModeMock')}
        note={t(locale, 'aiModeMockNote')}
        onPress={() => choose('mock')}
        palette={palette}
      />
      {serverAvailable ? (
        <Option
          testID="ai-mode-server"
          selected={mode === 'server'}
          title={t(locale, 'aiModeServer')}
          note={t(locale, 'aiModeServerNote', { url: process.env.EXPO_PUBLIC_MORPH_API_URL ?? '' })}
          onPress={() => choose('server')}
          palette={palette}
        />
      ) : null}
      <Option
        testID="ai-mode-byok"
        selected={mode === 'byok'}
        title={t(locale, 'aiModeByok')}
        note={t(locale, 'aiModeByokNote')}
        onPress={() => choose('byok')}
        palette={palette}
      />

      {mode === 'byok' ? (
        <>
          <SectionLabel palette={palette}>{t(locale, 'apiKeyLabel')}</SectionLabel>
          <Card palette={palette}>
            {keyHint ? (
              <View style={styles.row}>
                <Text testID="api-key-saved" style={[styles.flex, text]}>
                  {t(locale, 'apiKeySaved', { hint: keyHint })}
                </Text>
                <Pressable testID="api-key-delete" onPress={() => void clearKey()} hitSlop={8}>
                  <Text style={[palette.font('bodyBold', 15), { color: palette.danger }]}>
                    {t(locale, 'deleteKey')}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  testID="api-key-input"
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t(locale, 'apiKeyPlaceholder')}
                  placeholderTextColor={palette.subtext}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  style={[
                    styles.input,
                    text,
                    { borderColor: palette.border, borderRadius: palette.controlRadius },
                  ]}
                />
                <Button
                  palette={palette}
                  testID="api-key-save"
                  onPress={onSave}
                  disabled={!draft.trim()}
                  label={t(locale, 'saveKey')}
                />
              </>
            )}
            <Text style={[styles.note, sub]}>{t(locale, 'keyPrivacyNote')}</Text>
          </Card>

          <SectionLabel palette={palette}>{t(locale, 'modelLabel')}</SectionLabel>
          {MODELS.map((m) => (
            <Option
              key={m.id}
              testID={`model-${m.id}`}
              selected={model === m.id}
              title={m.name}
              note={`${m.note[locale]} · ${t(locale, 'perChange', { cost: m.costPerChange })}`}
              onPress={() => {
                setMessage(null);
                void setModel(m.id);
              }}
              palette={palette}
            />
          ))}

          <Button
            palette={palette}
            testID="ai-test-connection"
            variant="outline"
            onPress={onTest}
            loading={testing}
            label={t(locale, 'testConnection')}
            style={styles.secondary}
          />
        </>
      ) : null}

      {message ? (
        <Text
          testID="ai-settings-message"
          style={[
            palette.font('bodyMedium', 14),
            { color: message.ok ? palette.secondary : palette.danger },
          ]}>
          {message.text}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    padding: 16,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { borderWidth: 1, padding: 14 },
  secondary: { marginTop: 4 },
  note: { lineHeight: 18 },
});
