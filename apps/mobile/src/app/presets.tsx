import {
  HOME_PAGE_ID,
  MAX_PRESET_NAME,
  MAX_SAVED_PRESETS,
  canSavePreset,
  checkTools,
  issueReason,
  pageTarget,
  quickActionsOf,
  sessionIsEmpty,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatWhen, t } from '@/i18n';
import { usePalette, type Palette } from '@/renderer/theme';
import { Button, Card, Pill } from '@/renderer/ui';
import { Toast } from '@/shell/Toast';
import type { SavedPreset } from '@/storage/types';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/**
 * 「设置 → 我的预设」（D-410）：把整个 App 存起来，以后换回来。系统层的页面，AI 改不了（底线 8）。
 * 应用和恢复历史版本一样先问一句，确认后生成一个版本，能撤销（底线 7）；记录都留着（底线 5）。
 */
export default function PresetsRoute() {
  const { repo, locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const version = useWorkspace((s) => s.presetsVersion);
  const savePreset = useWorkspace((s) => s.savePreset);
  const renamePreset = useWorkspace((s) => s.renamePreset);
  const deletePreset = useWorkspace((s) => s.deletePreset);
  const proposePreset = useWorkspace((s) => s.proposePreset);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const clearNext = useWorkspace((s) => s.clearNext);
  const clearSuggest = useWorkspace((s) => s.clearSuggest);
  const selectTab = useWorkspace((s) => s.selectTab);
  const hasSession = useWorkspace((s) => !sessionIsEmpty(s.session));
  const clearSession = useWorkspace((s) => s.clearSession);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [presets, setPresets] = useState<SavedPreset[] | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void repo.listPresets().then((list) => alive && setPresets(list));
    return () => {
      alive = false;
    };
  }, [repo, version]);

  async function save() {
    const result = await savePreset(name);
    if (result.kind !== 'saved') return;
    setName('');
    // 这个 App 做好了：工具清单可以清掉，开始下一个（D-414）。
    if (hasSession)
      Alert.alert(t(locale, 'sessionClearAfterPreset'), undefined, [
        { text: t(locale, 'sessionKeep'), style: 'cancel' },
        { text: t(locale, 'sessionClear'), onPress: () => void clearSession() },
      ]);
  }

  async function rename() {
    if (renaming && (await renamePreset(renaming.id, renaming.name))) setRenaming(null);
  }

  async function apply(preset: SavedPreset) {
    const result = await proposePreset(preset.id);
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      return;
    }
    Alert.alert(
      t(locale, 'presetApplyTitle', { name: preset.name }),
      result.proposal.lines.join('\n'),
      [
        { text: t(locale, 'cancel'), style: 'cancel', onPress: () => void cancel() },
        {
          text: t(locale, 'presetApply'),
          onPress: () =>
            void (async () => {
              if (!(await confirm())) return;
              // 换了一个 App，上一次修改剩下的那句和下一步的建议也就接不上了。
              await clearNext();
              await clearSuggest();
              // 回到首页看结果，顶部的提示条能撤销。
              selectTab(pageTarget(HOME_PAGE_ID));
              router.back();
            })(),
        },
      ],
    );
  }

  const caption = [palette.font('body', 13), { color: palette.caption }];
  const full = presets !== null && !canSavePreset(presets.length);
  // 这个 App 现在的完成度（D-417）：只提醒，不阻止（底线 19）。
  const check = useMemo(() => {
    const { tools, issues } = checkTools(config, registry);
    // 工具包自带的快捷操作不算用户做的工具，否则一个空 App 也有几十个。
    const packaged = new Set(
      quickActionsOf(config)
        .filter((w) => w.package)
        .map((w) => w.id),
    );
    return {
      tools: tools.filter((x) => x.kind === 'record' || !packaged.has(x.id)).length,
      blockers: issues.filter((i) => i.severity === 'blocker'),
    };
  }, [config, registry]);

  return (
    <View style={styles.flex}>
      <ScrollView
        testID="presets-screen"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 96 }}>
        <Text style={caption}>{t(locale, 'presetsHint')}</Text>
        {full ? (
          <Card palette={palette}>
            <Text testID="presets-full" style={caption}>
              {t(locale, 'presetsFull', { max: MAX_SAVED_PRESETS })}
            </Text>
          </Card>
        ) : (
          <Card palette={palette}>
            <Text style={[palette.font('title', 16), { color: palette.text }]}>
              {t(locale, 'presetsNew')}
            </Text>
            <NameInput
              palette={palette}
              testID="preset-name-input"
              value={name}
              placeholder={t(locale, 'presetsNamePlaceholder')}
              onChangeText={setName}
            />
            <Text testID="preset-check-tools" style={caption}>
              {t(locale, 'presetCheckTools', { n: check.tools })}
            </Text>
            <Text testID="preset-check-summary" style={caption}>
              {check.blockers.length > 0
                ? t(locale, 'presetCheckProblems', { n: check.blockers.length })
                : t(locale, 'presetCheckOk')}
            </Text>
            {check.blockers.slice(0, 4).map((issue) => (
              <Text
                key={`${issue.code}|${issue.target}`}
                testID="preset-check-problem"
                style={caption}>
                • {issueReason(issue, config, locale)}
              </Text>
            ))}
            <Button
              palette={palette}
              testID="preset-save"
              label={t(locale, check.blockers.length > 0 ? 'presetSaveAnyway' : 'save')}
              disabled={!name.trim()}
              onPress={() => void save()}
            />
          </Card>
        )}
        {presets?.length === 0 ? (
          <Card palette={palette}>
            <Text testID="presets-none" style={caption}>
              {t(locale, 'presetsNone')}
            </Text>
          </Card>
        ) : null}
        {presets?.map((preset) => (
          <Card key={preset.id} palette={palette} testID={`preset-${preset.id}`}>
            {renaming?.id === preset.id ? (
              <>
                <NameInput
                  palette={palette}
                  testID="preset-rename-input"
                  autoFocus
                  value={renaming.name}
                  placeholder={t(locale, 'presetsNamePlaceholder')}
                  onChangeText={(text) => setRenaming({ id: preset.id, name: text })}
                />
                <View style={styles.row}>
                  <Pill
                    palette={palette}
                    testID="preset-rename-save"
                    label={t(locale, 'save')}
                    onPress={() => void rename()}
                  />
                  <Pill
                    palette={palette}
                    label={t(locale, 'cancel')}
                    onPress={() => setRenaming(null)}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={[palette.font('title', 16), { color: palette.text }]}>
                  {preset.name}
                </Text>
                <Text style={caption}>
                  {formatWhen(locale, new Date(preset.createdAt), new Date())}
                </Text>
                <View style={styles.row}>
                  <Pill
                    palette={palette}
                    testID={`preset-${preset.id}-apply`}
                    label={t(locale, 'presetApply')}
                    onPress={() => void apply(preset)}
                  />
                  <Pill
                    palette={palette}
                    testID={`preset-${preset.id}-rename`}
                    label={t(locale, 'presetRename')}
                    onPress={() => setRenaming({ id: preset.id, name: preset.name })}
                  />
                  <Pill
                    palette={palette}
                    danger
                    testID={`preset-${preset.id}-delete`}
                    label={t(locale, 'delete')}
                    onPress={() => void deletePreset(preset)}
                  />
                </View>
              </>
            )}
          </Card>
        ))}
      </ScrollView>
      <Toast palette={palette} bottom={insets.bottom + 16} />
    </View>
  );
}

function NameInput({
  palette,
  ...props
}: {
  palette: Palette;
  testID: string;
  value: string;
  placeholder: string;
  autoFocus?: boolean;
  onChangeText: (text: string) => void;
}) {
  return (
    <TextInput
      {...props}
      maxLength={MAX_PRESET_NAME}
      returnKeyType="done"
      placeholderTextColor={palette.caption}
      style={[
        palette.font('body', 16),
        styles.input,
        {
          color: palette.text,
          borderColor: palette.border,
          borderRadius: palette.controlRadius,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
});
