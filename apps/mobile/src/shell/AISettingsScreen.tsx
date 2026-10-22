import { MODELS } from '@morph/planner';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAISettings } from '../ai/context';
import type { AIMode, ConnectionResult } from '../ai/settings';
import { t, type StringKey } from '../i18n';
import { usePalette, type Palette } from '../renderer/theme';
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
        { backgroundColor: palette.card, borderColor: selected ? palette.primary : palette.border },
      ]}>
      <View style={[styles.radio, { borderColor: selected ? palette.primary : palette.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, { color: palette.text }]}>{title}</Text>
        <Text style={{ color: palette.subtext }}>{note}</Text>
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

  const text = { color: palette.text };
  const sub = { color: palette.subtext };
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.section, sub]}>{t(locale, 'aiModeQuestion')}</Text>
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
          <Text style={[styles.section, sub]}>{t(locale, 'apiKeyLabel')}</Text>
          <View
            style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            {keyHint ? (
              <View style={styles.row}>
                <Text testID="api-key-saved" style={[styles.flex, text]}>
                  {t(locale, 'apiKeySaved', { hint: keyHint })}
                </Text>
                <Pressable testID="api-key-delete" onPress={() => void clearKey()} hitSlop={8}>
                  <Text style={{ color: palette.danger, fontWeight: '600' }}>
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
                  style={[styles.input, text, { borderColor: palette.border }]}
                />
                <Pressable
                  testID="api-key-save"
                  onPress={onSave}
                  disabled={!draft.trim()}
                  style={[
                    styles.button,
                    { backgroundColor: palette.primary, opacity: draft.trim() ? 1 : 0.5 },
                  ]}>
                  <Text style={[styles.buttonText, { color: palette.onPrimary }]}>
                    {t(locale, 'saveKey')}
                  </Text>
                </Pressable>
              </>
            )}
            <Text style={[styles.note, sub]}>{t(locale, 'keyPrivacyNote')}</Text>
          </View>

          <Text style={[styles.section, sub]}>{t(locale, 'modelLabel')}</Text>
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

          <Pressable
            testID="ai-test-connection"
            onPress={onTest}
            disabled={testing}
            style={[styles.button, styles.secondary, { borderColor: palette.primary }]}>
            {testing ? (
              <ActivityIndicator color={palette.primary} />
            ) : (
              <Text style={[styles.buttonText, { color: palette.primary }]}>
                {t(locale, 'testConnection')}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}

      {message ? (
        <Text
          testID="ai-settings-message"
          style={{ color: message.ok ? palette.primary : palette.danger }}>
          {message.text}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, paddingBottom: 48 },
  section: { fontSize: 13, marginTop: 8 },
  option: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  optionTitle: { fontSize: 16, fontWeight: '600' },
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
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  secondary: { borderWidth: 1.5, marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 18 },
});
