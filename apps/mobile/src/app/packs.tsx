import { Text, View } from 'react-native';

import { t } from '@/i18n';
import { usePacks } from '@/packs/PackHost';
import { usePalette } from '@/renderer/theme';
import { PacksScreen } from '@/shell/PacksScreen';
import { useToolDownloads } from '@/tool-download/context';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

/** 「设置 → 扩展包」：已下载的扩展包和占用空间（D-064）。由内核提供，AI 不能修改。 */
export default function PacksRoute() {
  const { locale, files, registry } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const added = useWorkspace((s) => s.config!.tools);
  const downloaded = useToolDownloads((s) => s.downloaded);
  const removeTool = useToolDownloads((s) => s.remove);
  const tools = Object.entries(downloaded).map(([id, d]) => ({
    id,
    name: registry.tools.get(id)?.name[locale] ?? id,
    version: d.version,
    bytes: d.bytes,
    added: added.some((x) => x.toolId === id),
  }));
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
      tools={tools}
      onRemoveTool={removeTool}
    />
  );
}
