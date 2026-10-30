import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { usePalette } from '@/renderer/theme';
import { TableReadyScreen } from '@/shell/TableReadyScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';
import { readyNotes } from '@/draft/useApplyDraft';

/** AI 新建的数据表（D-191）。被撤销后打开时说明它已经不在了。 */
export default function TableReadyRoute() {
  const { collectionId, notes } = useLocalSearchParams<{ collectionId: string; notes?: string }>();
  const { locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const collection = config.data.tables.find((c) => c.id === collectionId);
  if (!collection) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'toolMissing')}
        </Text>
      </View>
    );
  }
  return <TableReadyScreen collection={collection} notes={readyNotes(notes)} />;
}
