import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { usePacks } from '@/packs/PackHost';
import { usePalette } from '@/renderer/theme';
import { PacksScreen } from '@/shell/PacksScreen';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 「设置 → 扩展包」：已下载的扩展包和占用空间（D-064）。由内核提供，AI 不能修改。 */
export default function PacksRoute() {
  const { locale, files } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const palette = usePalette(theme);
  const packs = usePacks();
  if (!packs) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'packsEmpty')}
        </Text>
      </View>
    );
  }
  return (
    <PacksScreen
      store={packs.store}
      palette={palette}
      locale={locale}
      translator={files.translator}
    />
  );
}
