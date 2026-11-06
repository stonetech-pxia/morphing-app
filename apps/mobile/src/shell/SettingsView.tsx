import { CURRENT_SCHEMA_VERSION, remindersOf } from '@morph/core';
import { MODELS } from '@morph/planner';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { useAISettings } from '../ai/context';
import { useLanguage } from '../language';
import { t, type StringKey } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { ListRow, PageTitle, SectionLabel } from '../renderer/ui';
import { useWorkspace } from '../workspace/context';

/**
 * 设置页由内核固定提供「AI 修改」「历史版本」「工具」入口（§5.1）：
 * 导航栏和浮动按钮里可以没有它们，但设置本身必须始终可达，所以随时都能修改和撤销。
 */
export function SettingsView({ env }: { env: RenderEnv }) {
  const { palette, locale } = env;
  const headId = useWorkspace((s) => s.head!.id);
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const preference = useLanguage((s) => s.preference);
  const aiMode = useAISettings((s) => s.mode);
  const aiModel = useAISettings((s) => s.model);
  const aiProvider = useAISettings((s) => s.provider);
  const aiCustomModel = useAISettings((s) => s.customModel);
  const aiValue =
    aiMode === 'byok'
      ? t(locale, 'aiEngineByok', {
          model:
            aiProvider === 'openai'
              ? aiCustomModel
              : (MODELS.find((m) => m.id === aiModel)?.name ?? aiModel),
        })
      : t(locale, aiMode === 'server' ? 'aiEngineRemote' : 'aiEngineMock');
  return (
    <ScrollView
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 160 }}>
      <PageTitle palette={palette}>{t(locale, 'settingsTitle')}</PageTitle>
      <SectionLabel palette={palette}>{t(locale, 'thisApp')}</SectionLabel>
      <ListRow
        palette={palette}
        testID="settings-ai"
        icon="tink"
        label={t(locale, 'changeTitle')}
        value={t(locale, 'changeRowHint')}
        onPress={env.locked ?? (() => router.push('/change'))}
      />
      <ListRow
        palette={palette}
        testID="settings-history"
        icon="history"
        label={t(locale, 'openHistory')}
        value={t(locale, 'historyRowHint')}
        onPress={() => router.push('/history')}
      />
      {remindersOf(env.config).length > 0 ? (
        <ListRow
          palette={palette}
          testID="settings-reminders"
          icon="calendar"
          label={t(locale, 'remindersTitle')}
          value={t(locale, 'remindersRowHint', { n: remindersOf(env.config).length })}
          onPress={env.locked ?? (() => router.push('/reminders'))}
        />
      ) : null}
      <ListRow
        palette={palette}
        testID="settings-more"
        icon="folder"
        label={t(locale, 'settingsMoreTitle')}
        value={t(locale, 'settingsMoreHint')}
        onPress={() => setMoreOpen((open) => !open)}
      />
      {/* 点开才看到：我的预设、数据、存储空间、已下载内容。 */}
      {moreOpen ? (
        <>
          <ListRow
            palette={palette}
            testID="settings-presets"
            icon="bookmark"
            label={t(locale, 'presetsTitle')}
            value={t(locale, 'presetsRowHint')}
            onPress={env.locked ?? (() => router.push('/presets'))}
          />
          <ListRow
            palette={palette}
            testID="settings-data"
            icon="inbox"
            label={t(locale, 'dataTitle')}
            value={t(locale, 'dataRowHint')}
            onPress={env.locked ?? (() => router.push('/data'))}
          />
          <ListRow
            palette={palette}
            testID="settings-storage"
            icon="folder"
            label={t(locale, 'storageTitle')}
            value={t(locale, 'storageRowHint')}
            onPress={env.locked ?? (() => router.push('/storage'))}
          />
          <ListRow
            palette={palette}
            testID="settings-packs"
            icon="archive"
            label={t(locale, 'packsTitle')}
            value={t(locale, 'packsRowHint')}
            onPress={env.locked ?? (() => router.push('/packs'))}
          />
        </>
      ) : null}
      <SectionLabel palette={palette}>{t(locale, 'general')}</SectionLabel>
      <ListRow
        palette={palette}
        testID="settings-language"
        label={t(locale, 'language')}
        value={t(locale, `languageValue_${preference}` as StringKey)}
        onPress={() => router.push('/language')}
      />
      <ListRow
        palette={palette}
        label={t(locale, 'aiEngine')}
        value={aiValue}
        onPress={env.locked ?? (() => router.push('/ai-settings'))}
      />
      <ListRow
        palette={palette}
        label={t(locale, 'about')}
        value={t(locale, 'aboutValue', { schema: CURRENT_SCHEMA_VERSION, revision: headId })}
      />
      <Text
        testID="settings-trust"
        style={[palette.font('body', 13), { color: palette.muted, lineHeight: 20 }]}>
        {t(locale, 'trustNote')}
      </Text>
    </ScrollView>
  );
}
