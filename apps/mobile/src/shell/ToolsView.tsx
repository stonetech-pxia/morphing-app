import { HOME_PAGE_ID, allComponents, pageTarget, type Op } from '@morph/core';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { Card, IconTile, ListRow, PageTitle, Pill } from '../renderer/ui';
import { useWorkspace } from '../workspace/context';

/**
 * 工具目录（§3 旅程 B）：安装、打开、移除首页入口、卸载。所有操作都生成新版本，可撤销。
 * 只有移除先确认（会一起移除这个工具的快捷操作）；其他操作直接应用，提示条上可撤销（D-105）。
 */
export function ToolsView({ env }: { env: RenderEnv }) {
  const { config, palette, locale, registry } = env;
  const router = useRouter();
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID)!;

  /** askTitle：要先确认的操作（只有移除工具）用这个标题。 */
  async function change(ops: Op[], summary: string, askTitle?: string) {
    if (env.locked) return env.locked();
    const result = await proposeOps(ops, summary);
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      return;
    }
    if (!askTitle) {
      await confirm();
      return;
    }
    Alert.alert(askTitle, result.proposal.lines.join('\n\n'), [
      { text: t(locale, 'cancel'), style: 'cancel', onPress: () => void cancel() },
      { text: t(locale, 'apply'), onPress: () => void confirm() },
    ]);
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 160 }}>
      <PageTitle palette={palette}>{t(locale, 'toolsTitle')}</PageTitle>
      <ListRow
        palette={palette}
        testID="tools-workflows"
        icon="workflow"
        label={t(locale, 'workflowsTitle')}
        value={t(locale, 'workflowsRowHint')}
        onPress={env.locked ?? (() => router.push('/workflows'))}
      />
      {[...registry.tools.values()].map((tool) => {
        const installed = config.tools.find((x) => x.toolId === tool.id);
        const card = allComponents(home).find(
          (c) => c.type === 'toolCard' && c.props.toolId === tool.id,
        );
        const name = tool.name[locale];
        const button = (label: string, onPress: () => void, testID: string, danger = false) => (
          <Pill
            key={testID}
            palette={palette}
            testID={testID}
            onPress={onPress}
            label={label}
            danger={danger}
          />
        );
        return (
          <Card key={tool.id} palette={palette}>
            <View style={styles.head}>
              <IconTile
                palette={palette}
                icon={tool.icon}
                background={installed ? palette.primary : palette.secondary}
                color="#FFFFFF"
              />
              <View style={styles.flex}>
                <Text style={[palette.font('title', 17), { color: palette.text }]}>
                  {name}
                  {installed ? ` · ${t(locale, 'installed')}` : ''}
                </Text>
                <Text style={[palette.font('body', 14), { color: palette.muted }]}>
                  {tool.description[locale]}
                </Text>
              </View>
            </View>
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
                      () => env.navigate(pageTarget(installed.pageId)),
                      `open-${tool.id}`,
                    ),
                    installed.version !== tool.version
                      ? button(
                          t(locale, 'updateTool'),
                          () =>
                            change(
                              [{ op: 'updateTool', toolId: tool.id }],
                              t(locale, 'updateSummary', { name }),
                            ),
                          `update-${tool.id}`,
                        )
                      : null,
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
                          t(locale, 'uninstallTitle', { name }),
                        ),
                      `uninstall-${tool.id}`,
                      true,
                    ),
                  ]}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flex: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
