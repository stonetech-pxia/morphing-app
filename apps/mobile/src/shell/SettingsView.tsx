import { CURRENT_SCHEMA_VERSION } from '@morph/core';
import { MODELS } from '@morph/planner';
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useAISettings } from '../ai/context';
import { t } from '../i18n';
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
  const selectTab = useWorkspace((s) => s.selectTab);
  const router = useRouter();
  const aiMode = useAISettings((s) => s.mode);
  const aiModel = useAISettings((s) => s.model);
  const aiValue =
    aiMode === 'byok'
      ? t(locale, 'aiEngineByok', { model: MODELS.find((m) => m.id === aiModel)?.name ?? aiModel })
      : t(locale, aiMode === 'server' ? 'aiEngineRemote' : 'aiEngineMock');
  return (
    <ScrollView
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 160 }}>
      <PageTitle palette={palette}>{t(locale, 'settingsTitle')}</PageTitle>
      <SectionLabel palette={palette}>{t(locale, 'thisApp')}</SectionLabel>
      <ListRow
        palette={palette}
        testID="settings-ai"
        icon="sparkles"
        label={t(locale, 'changeTitle')}
        value={t(locale, 'changeRowHint')}
        onPress={() => router.push('/change')}
      />
      <ListRow
        palette={palette}
        testID="settings-history"
        icon="history"
        label={t(locale, 'openHistory')}
        value={t(locale, 'historyRowHint')}
        onPress={() => selectTab('history')}
      />
      <ListRow
        palette={palette}
        testID="settings-tools"
        icon="apps"
        label={t(locale, 'toolsTitle')}
        value={t(locale, 'toolsRowHint')}
        onPress={() => selectTab('tools')}
      />
      <ListRow
        palette={palette}
        testID="settings-packs"
        icon="archive"
        label={t(locale, 'packsTitle')}
        value={t(locale, 'packsRowHint')}
        onPress={() => router.push('/packs')}
      />
      <ListRow
        palette={palette}
        testID="settings-data"
        icon="inbox"
        label={t(locale, 'dataTitle')}
        value={t(locale, 'dataRowHint')}
        onPress={() => router.push('/data')}
      />
      <SectionLabel palette={palette}>{t(locale, 'general')}</SectionLabel>
      <ListRow palette={palette} label={t(locale, 'language')} value={t(locale, 'languageValue')} />
      <ListRow
        palette={palette}
        label={t(locale, 'aiEngine')}
        value={aiValue}
        onPress={() => router.push('/ai-settings')}
      />
      <ListRow
        palette={palette}
        label={t(locale, 'about')}
        value={t(locale, 'aboutValue', { schema: CURRENT_SCHEMA_VERSION, revision: headId })}
      />
    </ScrollView>
  );
}
