import { pageTarget, toolGridToolIds, type Component, type Page } from '@morph/core';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { useWorkspace } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import { Card, IconTile } from './ui';

const COLUMNS = 3;

/**
 * toolGrid 组件（D-181）：一组工具的小图标，每行三个。点一下打开工具；还没添加的工具
 * 图标变淡、角上有「+」，点一下直接添加再打开（和工具目录一样不弹确认框，提示条上可撤销，D-105）。
 */
export function ToolGrid({
  grid,
  page,
  env,
}: {
  grid: Extract<Component, { type: 'toolGrid' }>;
  page: Page | undefined;
  env: RenderEnv;
}) {
  const { palette, locale, registry, config } = env;
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const catalog = [...registry.tools.keys()];
  const ids = page
    ? toolGridToolIds(grid, page, catalog)
    : (grid.props.toolIds ?? catalog).filter((id) => registry.tools.has(id));
  if (ids.length === 0) return null;

  async function open(toolId: string) {
    const installed = config.tools.find((x) => x.toolId === toolId);
    if (installed) {
      env.navigate(pageTarget(installed.pageId));
      return;
    }
    const def = registry.tools.get(toolId)!;
    const name = def.name[locale];
    const result = await proposeOps(
      [{ op: 'installTool', toolId }],
      t(locale, 'installSummary', { name }),
    );
    if (result.kind !== 'preview') {
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
      return;
    }
    await confirm();
    env.navigate(pageTarget(def.createPage(locale).id));
  }

  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += COLUMNS) rows.push(ids.slice(i, i + COLUMNS));
  const gap = palette.gap - 6;

  return (
    <View style={{ gap: 10 }}>
      {grid.props.title ? (
        <Text
          style={[
            palette.font('bodyBold', 12),
            { color: palette.caption, letterSpacing: 0.5 },
            grid.style?.align === 'center' && styles.textCenter,
          ]}>
          {grid.props.title.toUpperCase()}
        </Text>
      ) : null}
      {rows.map((row, r) => (
        <View key={r} style={[styles.row, { gap }]}>
          {row.map((toolId) => {
            const def = registry.tools.get(toolId)!;
            const installed = config.tools.find((x) => x.toolId === toolId);
            // 工具页被改过名字时用页面的名字（和工具卡片一样）。
            const name =
              (installed && config.pages.find((p) => p.id === installed.pageId)?.title) ??
              def.name[locale];
            return (
              <Card
                key={toolId}
                palette={palette}
                testID={`toolgrid-${toolId}`}
                accessibilityLabel={installed ? name : `${t(locale, 'install')} ${name}`}
                onPress={env.interactive ? () => void open(toolId) : undefined}
                onLongPress={env.onLongPress}
                style={styles.tile}>
                <View>
                  <IconTile
                    palette={palette}
                    icon={def.icon}
                    size={40}
                    background={installed ? palette.primaryTint : palette.border}
                    color={installed ? palette.primaryText : palette.caption}
                  />
                  {installed ? null : (
                    <View
                      testID={`toolgrid-add-${toolId}`}
                      style={[styles.badge, { backgroundColor: palette.primary }]}>
                      <Icon name="plus" size={11} color={palette.onPrimary} />
                    </View>
                  )}
                </View>
                <Text
                  numberOfLines={2}
                  style={[
                    palette.font('title', 13),
                    styles.textCenter,
                    { color: installed ? palette.text : palette.muted },
                  ]}>
                  {name}
                </Text>
              </Card>
            );
          })}
          {Array.from({ length: COLUMNS - row.length }, (_, i) => (
            <View key={`empty-${i}`} style={styles.cell} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1 },
  tile: { flex: 1, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 12 },
  textCenter: { textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
