import {
  HOME_PAGE_ID,
  HOST_API,
  ToolDownloadError,
  allComponents,
  compareVersions,
  isRevoked,
  pageTarget,
  type CatalogEntry,
  type Op,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { formatSize } from '../renderer/FileList';
import { Card, IconTile, ListRow, PageTitle, Pill } from '../renderer/ui';
import { useToolDownloads } from '../tool-download/context';
import { toolRevoked } from '../tool-download/state';
import { useWorkspace } from '../workspace/context';

/** 打开工具页时，目录超过这么久没拉就再拉一次。 */
const CATALOG_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * 工具目录（§3 旅程 B）：安装、打开、移除首页入口、卸载。所有操作都生成新版本，可撤销。
 * 只有移除先确认（会一起移除这个工具的快捷操作）；其他操作直接应用，提示条上可撤销（D-105）。
 * 目录里可以下载的工具（D-177）排在内置工具后面：点「添加」先下载、检查，再和内置工具一样添加。
 */
export function ToolsView({ env }: { env: RenderEnv }) {
  const { config, palette, locale, registry } = env;
  const router = useRouter();
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const cancel = useWorkspace((s) => s.cancel);
  const home = config.pages.find((p) => p.id === HOME_PAGE_ID)!;
  const catalog = useToolDownloads((s) => s.catalog);
  const busy = useToolDownloads((s) => s.busy);
  const refresh = useToolDownloads((s) => s.refresh);
  const download = useToolDownloads((s) => s.download);
  // 下载后注册表在原地变了；订阅这一项，下载完就重新渲染。
  const downloads = useToolDownloads((s) => s);

  useEffect(() => {
    void refresh(CATALOG_MAX_AGE_MS);
  }, [refresh]);

  /** 目录里这个工具可以下载的最新版本（停用的、App 能力不够的不算）。 */
  const offered = (id: string): CatalogEntry | undefined => {
    const entry = catalog?.tools.find((e) => e.id === id);
    if (!entry || entry.hostApi > HOST_API || isRevoked(catalog, entry.id, entry.version)) return;
    return entry;
  };

  /** 下载并检查一个工具；失败时说明原因，返回 false。 */
  async function fetchTool(entry: CatalogEntry): Promise<boolean> {
    try {
      await download(entry);
      return true;
    } catch (e) {
      const network = e instanceof ToolDownloadError && e.code === 'download';
      Alert.alert(
        t(locale, 'toolDownloadFailedTitle', { name: entry.name[locale] }),
        t(locale, network ? 'toolDownloadFailed' : 'toolDownloadRejected'),
      );
      return false;
    }
  }

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
        onPress={env.locked ?? (() => router.push('/quick-actions'))}
      />
      {[...registry.tools.values()].map((tool) => {
        const installed = config.tools.find((x) => x.toolId === tool.id);
        const card = allComponents(home).find(
          (c) => c.type === 'toolCard' && c.props.toolId === tool.id,
        );
        const name = tool.name[locale];
        const entry = tool.origin === 'download' ? offered(tool.id) : undefined;
        // 目录里有比本机更新的版本：先下载，再和内置工具一样「更新」。
        const newer = entry && compareVersions(entry.version, tool.version) > 0 ? entry : undefined;
        const revoked = tool.origin === 'download' && toolRevoked(downloads, tool.id);
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
                  {revoked ? ` · ${t(locale, 'toolRevoked')}` : ''}
                </Text>
                <Text style={[palette.font('body', 14), { color: palette.muted }]}>
                  {tool.description[locale]}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              {busy === tool.id ? (
                <Text style={[palette.font('body', 14), { color: palette.muted }]}>
                  {t(locale, 'toolDownloading')}
                </Text>
              ) : !installed ? (
                button(
                  t(locale, 'install'),
                  async () => {
                    if (newer && !(await fetchTool(newer))) return;
                    await change(
                      [{ op: 'installTool', toolId: tool.id }],
                      t(locale, 'installSummary', { name }),
                    );
                  },
                  `install-${tool.id}`,
                )
              ) : (
                [
                  button(
                    t(locale, 'open'),
                    () => env.navigate(pageTarget(installed.pageId)),
                    `open-${tool.id}`,
                  ),
                  installed.version !== tool.version || newer
                    ? button(
                        t(locale, 'updateTool'),
                        async () => {
                          if (newer && !(await fetchTool(newer))) return;
                          await change(
                            [{ op: 'updateTool', toolId: tool.id }],
                            t(locale, 'updateSummary', { name }),
                          );
                        },
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
                ]
              )}
            </View>
          </Card>
        );
      })}
      {(catalog?.tools ?? [])
        .filter((e) => !registry.tools.has(e.id) && !isRevoked(catalog, e.id, e.version))
        .map((entry) => {
          const name = entry.name[locale];
          const tooNew = entry.hostApi > HOST_API;
          return (
            <Card key={entry.id} palette={palette} testID={`catalog-${entry.id}`}>
              <View style={styles.head}>
                <IconTile
                  palette={palette}
                  icon={entry.icon}
                  background={palette.secondary}
                  color="#FFFFFF"
                />
                <View style={styles.flex}>
                  <Text style={[palette.font('title', 17), { color: palette.text }]}>{name}</Text>
                  <Text style={[palette.font('body', 14), { color: palette.muted }]}>
                    {entry.description[locale]}
                  </Text>
                  <Text style={[palette.font('body', 13), { color: palette.muted }]}>
                    {tooNew
                      ? t(locale, 'toolNeedsAppUpdate')
                      : t(locale, 'toolDownloadSize', { size: formatSize(entry.size) })}
                  </Text>
                </View>
              </View>
              {tooNew ? null : (
                <View style={styles.actions}>
                  {busy === entry.id ? (
                    <Text style={[palette.font('body', 14), { color: palette.muted }]}>
                      {t(locale, 'toolDownloading')}
                    </Text>
                  ) : (
                    <Pill
                      palette={palette}
                      testID={`install-${entry.id}`}
                      label={t(locale, 'install')}
                      onPress={async () => {
                        if (!(await fetchTool(entry))) return;
                        await change(
                          [{ op: 'installTool', toolId: entry.id }],
                          t(locale, 'installSummary', { name }),
                        );
                      }}
                    />
                  )}
                </View>
              )}
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
