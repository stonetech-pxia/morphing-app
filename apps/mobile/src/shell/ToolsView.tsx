import { HOME_PAGE_ID, type Op } from '@morph/core';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { useWorkspace } from '../workspace/context';

/** 工具目录（§3 旅程 B）：安装、打开、移除首页入口、卸载。所有操作都生成新版本，可撤销。 */
export function ToolsView({ env }: { env: RenderEnv }) {
  const { config, palette, locale, registry } = env;
  const router = useRouter();
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID)!;

  async function change(ops: Op[], summary: string) {
    const result = await proposeOps(ops, summary);
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      return;
    }
    Alert.alert(t(locale, 'confirmTitle'), result.proposal.lines.join('\n\n'), [
      { text: t(locale, 'cancel'), style: 'cancel', onPress: () => void cancel() },
      { text: t(locale, 'apply'), onPress: () => void confirm() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={[styles.title, { color: palette.text }]}>{t(locale, 'toolsTitle')}</Text>
      {[...registry.tools.values()].map((tool) => {
        const installed = config.tools.find((x) => x.toolId === tool.id);
        const card = home.components.find(
          (c) => c.type === 'toolCard' && c.props.toolId === tool.id,
        );
        const name = tool.name[locale];
        const button = (label: string, onPress: () => void, testID: string, danger = false) => (
          <Pressable
            key={testID}
            testID={testID}
            onPress={onPress}
            style={[styles.button, { borderColor: danger ? palette.danger : palette.primary }]}>
            <Text style={{ color: danger ? palette.danger : palette.primary, fontWeight: '600' }}>
              {label}
            </Text>
          </Pressable>
        );
        return (
          <View
            key={tool.id}
            style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.cardTitle, { color: palette.text }]}>
              {name}
              {installed ? ` · ${t(locale, 'installed')}` : ''}
            </Text>
            <Text style={{ color: palette.subtext }}>{tool.description[locale]}</Text>
            <View style={styles.actions}>
              {!installed
                ? button(
                    t(locale, 'install'),
                    () =>
                      change(
                        [{ op: 'installTool', toolId: tool.id }],
                        t(locale, 'installSummary', { name }),
                      ),
                    `install-${tool.id}`,
                  )
                : [
                    button(
                      t(locale, 'open'),
                      () =>
                        router.push({
                          pathname: '/page/[pageId]',
                          params: { pageId: installed.pageId },
                        }),
                      `open-${tool.id}`,
                    ),
                    card
                      ? button(
                          t(locale, 'removeFromHome'),
                          () =>
                            change(
                              [
                                {
                                  op: 'removeComponent',
                                  pageId: HOME_PAGE_ID,
                                  componentId: card.id,
                                },
                              ],
                              t(locale, 'removeCardSummary', { name }),
                            ),
                          `remove-card-${tool.id}`,
                        )
                      : button(
                          t(locale, 'addToHome'),
                          () =>
                            change(
                              [
                                {
                                  op: 'addComponent',
                                  pageId: HOME_PAGE_ID,
                                  index: 1,
                                  component: {
                                    id: `card-${tool.id}`,
                                    type: 'toolCard',
                                    props: { toolId: tool.id },
                                  },
                                },
                              ],
                              t(locale, 'addCardSummary', { name }),
                            ),
                          `add-card-${tool.id}`,
                        ),
                    button(
                      t(locale, 'uninstall'),
                      () =>
                        change(
                          [{ op: 'uninstallTool', toolId: tool.id }],
                          t(locale, 'uninstallSummary', { name }),
                        ),
                      `uninstall-${tool.id}`,
                      true,
                    ),
                  ]}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: 160 },
  title: { fontSize: 28, fontWeight: '700', paddingVertical: 8 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
});
