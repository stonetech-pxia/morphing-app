import { localize } from '@morph/core';
import {
  ANTHROPIC_API_URL,
  MODELS,
  OPENAI_COMPATIBLE_PRESETS,
  checkBaseUrl,
  hostOf,
} from '@morph/planner';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useAISettings } from '../ai/context';
import type { AIMode, ConnectionResult, EndpointResult } from '../ai/settings';
import { t, type StringKey } from '../i18n';
import { usePalette, type Palette } from '../renderer/theme';
import { Button, Card, SectionLabel } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

const RESULT_MESSAGES: Record<Exclude<ConnectionResult, { ok: true }>['kind'], StringKey> = {
  no_key: 'byokNoKey',
  no_endpoint: 'byokNoEndpoint',
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

/** provider 一排：Anthropic、几家常见的 OpenAI 兼容接口、自定义。 */
const PROVIDER_CHIPS = [
  { id: 'anthropic', name: 'Anthropic' },
  ...OPENAI_COMPATIBLE_PRESETS,
  { id: 'custom', name: '' },
];

/** OpenAI 兼容接口：提到 Claude 的几条换成不点名的说法（D-241）。 */
const OTHER_RESULT_MESSAGES: typeof RESULT_MESSAGES = {
  ...RESULT_MESSAGES,
  spend_limit: 'byokOtherSpendLimit',
  overloaded: 'byokOtherBusy',
  server: 'byokOtherBusy',
  bad_request: 'byokOtherUnavailable',
  timeout: 'byokOtherUnavailable',
  network: 'byokOtherUnavailable',
};

const ENDPOINT_MESSAGES: Record<Exclude<EndpointResult, { ok: true }>['issue'], StringKey> = {
  invalid: 'baseUrlInvalid',
  insecure: 'baseUrlInsecure',
  no_model: 'customModelMissing',
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
        { padding: palette.inset },
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

/** 「设置 → AI」：选择 AI 来源；自带 key 时选 provider（D-241）、管理 key、选择模型、测试连接。 */
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
  const provider = useAISettings((s) => s.provider);
  const baseUrl = useAISettings((s) => s.baseUrl);
  const customModel = useAISettings((s) => s.customModel);
  const setProvider = useAISettings((s) => s.setProvider);
  const saveEndpoint = useAISettings((s) => s.saveEndpoint);
  const saveKey = useAISettings((s) => s.saveKey);
  const clearKey = useAISettings((s) => s.clearKey);
  const testConnection = useAISettings((s) => s.testConnection);
  const listModels = useAISettings((s) => s.listModels);
  const needsButton = useAISettings((s) => s.needsButton);
  const canSendNeeds = useAISettings((s) => s.canSendNeeds);
  const setNeedsButton = useAISettings((s) => s.setNeedsButton);

  const [draft, setDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [modelDraft, setModelDraft] = useState(customModel);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [listing, setListing] = useState(false);

  const choose = (m: AIMode) => {
    setMessage(null);
    void setMode(m);
  };

  // 「provider」一排：Anthropic 走自己的接口，别的是 OpenAI 兼容接口（填好地址）；「自定义」自己填地址。
  const [custom, setCustom] = useState(
    provider === 'openai' && !OPENAI_COMPATIBLE_PRESETS.some((p) => p.baseUrl === baseUrl),
  );
  const chip =
    provider === 'anthropic'
      ? 'anthropic'
      : custom
        ? 'custom'
        : (OPENAI_COMPATIBLE_PRESETS.find((p) => p.baseUrl === urlDraft.trim())?.id ?? 'custom');
  const chooseChip = (id: string) => {
    setMessage(null);
    setDraft('');
    if (id === 'anthropic') {
      void setProvider('anthropic');
      return;
    }
    const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === id);
    setCustom(!preset);
    if (preset) setUrlDraft(preset.baseUrl);
    else if (provider === 'anthropic') setUrlDraft('');
    if (provider !== 'openai') void setProvider('openai');
  };

  async function onSave() {
    const ok = await saveKey(draft);
    if (ok) setDraft('');
    const invalid = provider === 'openai' ? 'otherKeyFormatInvalid' : 'keyFormatInvalid';
    setMessage(ok ? null : { text: t(locale, invalid), ok: false });
  }

  async function onSaveEndpoint() {
    const result = await saveEndpoint(urlDraft, modelDraft);
    if (result.ok) {
      const checked = checkBaseUrl(urlDraft);
      if (checked.ok) setUrlDraft(checked.url);
      setModelDraft(modelDraft.trim());
      setMessage({ text: t(locale, 'endpointSaved'), ok: true });
    } else {
      setMessage({ text: t(locale, ENDPOINT_MESSAGES[result.issue]), ok: false });
    }
  }

  async function onListModels() {
    setListing(true);
    const result = await listModels();
    setListing(false);
    if (result.ok) {
      setModels(result.models);
      setMessage(
        result.models.length === 0 ? { text: t(locale, 'modelListEmpty'), ok: false } : null,
      );
    } else {
      setMessage({
        text: t(
          locale,
          OTHER_RESULT_MESSAGES[result.kind === 'no_endpoint' ? 'no_endpoint' : result.kind],
        ),
        ok: false,
      });
    }
  }

  async function onTest() {
    setTesting(true);
    const result = await testConnection();
    setTesting(false);
    setMessage(
      result.ok
        ? { text: t(locale, provider === 'openai' ? 'testOkOther' : 'testOk'), ok: true }
        : {
            text: t(
              locale,
              (provider === 'openai' ? OTHER_RESULT_MESSAGES : RESULT_MESSAGES)[result.kind],
            ),
            ok: false,
          },
    );
  }

  // 自带 key 时请求发到哪里：Anthropic 固定，OpenAI 兼容接口是已保存的地址。
  const sentTo =
    provider === 'anthropic' ? hostOf(ANTHROPIC_API_URL) : baseUrl ? hostOf(baseUrl) : '';
  const text = [palette.font('body', 15), { color: palette.text }];
  const sub = [palette.font('body', 13), { color: palette.muted }];
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      // 地址、模型名和 key 的输入框在下半屏，iOS 弹出键盘时要让开（Android 默认会调整）。
      automaticallyAdjustKeyboardInsets>
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
          note={t(locale, 'aiModeServerNote')}
          onPress={() => choose('server')}
          palette={palette}
        />
      ) : null}
      {mode === 'server' ? (
        <Text testID="ai-server-stored" style={sub}>
          {t(locale, 'aiServerStoredNote')}
        </Text>
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
          <SectionLabel palette={palette}>{t(locale, 'byokProviderLabel')}</SectionLabel>
          <Card palette={palette}>
            <View style={styles.chips}>
              {PROVIDER_CHIPS.map((p) => (
                <Pressable
                  key={p.id}
                  testID={`byok-preset-${p.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chip === p.id }}
                  onPress={() => chooseChip(p.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: chip === p.id ? palette.primary : palette.border,
                      backgroundColor: chip === p.id ? palette.primaryTint : 'transparent',
                      borderRadius: palette.controlRadius,
                    },
                  ]}>
                  <Text style={[palette.font('bodyMedium', 14), { color: palette.text }]}>
                    {p.id === 'custom' ? t(locale, 'byokProviderCustom') : p.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            {provider === 'openai' ? (
              <>
                {chip === 'custom' ? (
                  <>
                    <Text style={sub}>{t(locale, 'baseUrlLabel')}</Text>
                    <TextInput
                      testID="byok-base-url"
                      value={urlDraft}
                      onChangeText={setUrlDraft}
                      placeholder="https://api.openai.com/v1"
                      placeholderTextColor={palette.subtext}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={[
                        styles.input,
                        { paddingHorizontal: palette.inset },
                        text,
                        { borderColor: palette.border, borderRadius: palette.controlRadius },
                      ]}
                    />
                  </>
                ) : null}
                <Text style={sub}>{t(locale, 'customModelLabel')}</Text>
                <TextInput
                  testID="byok-model"
                  value={modelDraft}
                  onChangeText={setModelDraft}
                  placeholder={t(locale, 'customModelPlaceholder')}
                  placeholderTextColor={palette.subtext}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    { paddingHorizontal: palette.inset },
                    text,
                    { borderColor: palette.border, borderRadius: palette.controlRadius },
                  ]}
                />
                {baseUrl ? (
                  <>
                    <Button
                      palette={palette}
                      testID="byok-list-models"
                      variant="outline"
                      onPress={onListModels}
                      loading={listing}
                      label={t(locale, 'modelListFetch')}
                    />
                    {models && models.length > 0 ? (
                      <ScrollView
                        nestedScrollEnabled
                        style={styles.modelList}
                        testID="byok-model-list">
                        <View style={styles.chips}>
                          {models.map((id) => (
                            <Pressable
                              key={id}
                              testID={`byok-model-${id}`}
                              onPress={() => setModelDraft(id)}
                              style={[
                                styles.chip,
                                {
                                  borderColor:
                                    modelDraft.trim() === id ? palette.primary : palette.border,
                                  borderRadius: palette.controlRadius,
                                },
                              ]}>
                              <Text style={[palette.font('body', 13), { color: palette.text }]}>
                                {id}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    ) : null}
                  </>
                ) : null}
                <Button
                  palette={palette}
                  testID="byok-endpoint-save"
                  onPress={onSaveEndpoint}
                  disabled={
                    !urlDraft.trim() ||
                    !modelDraft.trim() ||
                    (urlDraft.trim() === baseUrl && modelDraft.trim() === customModel)
                  }
                  label={t(locale, 'saveEndpoint')}
                />
              </>
            ) : null}
          </Card>

          {/* key 只发给已保存的地址，所以 OpenAI 兼容接口先存地址再填 key。 */}
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
                  placeholder={t(
                    locale,
                    provider === 'openai' ? 'otherKeyPlaceholder' : 'apiKeyPlaceholder',
                  )}
                  placeholderTextColor={palette.subtext}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  style={[
                    styles.input,
                    { paddingHorizontal: palette.inset },
                    { paddingHorizontal: palette.inset },
                    text,
                    { borderColor: palette.border, borderRadius: palette.controlRadius },
                  ]}
                />
                <Button
                  palette={palette}
                  testID="api-key-save"
                  onPress={onSave}
                  disabled={!draft.trim() || !sentTo}
                  label={t(locale, 'saveKey')}
                />
              </>
            )}
            <Text style={[styles.note, sub]}>
              {!sentTo
                ? t(locale, 'byokNoEndpoint')
                : provider === 'openai'
                  ? t(locale, 'otherKeyPrivacyNote', { host: sentTo })
                  : t(locale, 'keyPrivacyNote')}
            </Text>
          </Card>

          {provider === 'anthropic' ? (
            <>
              <SectionLabel palette={palette}>{t(locale, 'modelLabel')}</SectionLabel>
              {MODELS.map((m) => (
                <Option
                  key={m.id}
                  testID={`model-${m.id}`}
                  selected={model === m.id}
                  title={m.name}
                  note={`${localize(m.note, locale)} · ${t(locale, 'perChange', { cost: m.costPerChange })}`}
                  onPress={() => {
                    setMessage(null);
                    void setModel(m.id);
                  }}
                  palette={palette}
                />
              ))}
            </>
          ) : null}

          {sentTo ? (
            <Text testID="byok-sent-note" style={[styles.note, sub]}>
              {t(locale, 'byokSentNote', { host: sentTo })}
            </Text>
          ) : null}

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

      {/* 需求回收（D-189）：默认显示按钮，点了才发送；关掉后不再显示。 */}
      {canSendNeeds ? (
        <Card palette={palette}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={[palette.font('title', 16), { color: palette.text }]}>
                {t(locale, 'needsSettingTitle')}
              </Text>
              <Text style={[palette.font('body', 14), styles.note, { color: palette.muted }]}>
                {t(locale, 'needsSettingNote')}
              </Text>
            </View>
            <Switch
              testID="ai-needs-button"
              value={needsButton}
              onValueChange={(on) => void setNeedsButton(on)}
              trackColor={{ true: palette.primary, false: palette.border }}
              thumbColor="#FFFFFF"
            />
          </View>
        </Card>
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
  input: { borderWidth: 1, paddingVertical: 14 },
  secondary: { marginTop: 4 },
  note: { lineHeight: 18 },
  modelList: { maxHeight: 220 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
});
