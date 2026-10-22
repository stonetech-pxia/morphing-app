import type { Component, Locale, Page, Registry, WorkspaceConfig } from '@morph/core';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { FileList } from './FileList';
import type { Palette } from './theme';
import { WorkflowRunner } from './WorkflowRunner';

// 白名单渲染器（§5.2、§7A）：配置中的每种组件类型对应这里的一个真实组件。
// 配置只提供数据，不包含任何可执行内容。新增组件类型必须同时修改 core 的 schema 和这里。

export interface RenderEnv {
  config: WorkspaceConfig;
  palette: Palette;
  locale: Locale;
  registry: Registry;
  /** 预览时为 false：组件只展示，不响应点击。 */
  interactive: boolean;
  onOpenTools: () => void;
}

function Card({
  env,
  children,
  onPress,
}: {
  env: RenderEnv;
  children: ReactNode;
  onPress?: () => void;
}) {
  const style = [
    styles.card,
    { backgroundColor: env.palette.card, borderColor: env.palette.border },
  ];
  if (!onPress || !env.interactive) return <View style={style}>{children}</View>;
  return (
    <Pressable style={({ pressed }) => [style, pressed && { opacity: 0.7 }]} onPress={onPress}>
      {children}
    </Pressable>
  );
}

function ToolCard({ toolId, env }: { toolId: string; env: RenderEnv }) {
  const router = useRouter();
  const def = env.registry.tools.get(toolId);
  const installed = env.config.tools.find((t) => t.toolId === toolId);
  if (!def || !installed) {
    return (
      <Card env={env}>
        <Text style={{ color: env.palette.subtext }}>{t(env.locale, 'toolMissing')}</Text>
      </Card>
    );
  }
  const page = env.config.pages.find((p) => p.id === installed.pageId);
  return (
    <Card
      env={env}
      onPress={() =>
        router.push({ pathname: '/page/[pageId]', params: { pageId: installed.pageId } })
      }>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: env.palette.primary }]}>
          <Text style={[styles.badgeText, { color: env.palette.onPrimary }]}>
            {def.name[env.locale].slice(0, 3)}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text style={[styles.cardTitle, { color: env.palette.text }]}>
            {page?.title ?? def.name[env.locale]}
          </Text>
          <Text style={{ color: env.palette.subtext }}>{def.description[env.locale]}</Text>
        </View>
      </View>
    </Card>
  );
}

export function ComponentView({ component, env }: { component: Component; env: RenderEnv }) {
  switch (component.type) {
    case 'header':
      return (
        <View style={styles.header}>
          <Text style={[styles.title, { color: env.palette.text }]}>{component.props.title}</Text>
          {component.props.subtitle ? (
            <Text style={[styles.subtitle, { color: env.palette.subtext }]}>
              {component.props.subtitle}
            </Text>
          ) : null}
        </View>
      );
    case 'text':
      return (
        <Text style={[styles.body, { color: env.palette.subtext }]}>{component.props.text}</Text>
      );
    case 'toolCard':
      return <ToolCard toolId={component.props.toolId} env={env} />;
    case 'catalogLink':
      return (
        <Card env={env} onPress={env.onOpenTools}>
          <Text style={[styles.cardTitle, { color: env.palette.primary }]}>
            ＋ {component.props.title}
          </Text>
        </Card>
      );
    case 'fileList':
      return (
        <FileList
          title={component.props.title}
          limit={component.props.limit}
          mimeType={component.props.mimeType}
          env={env}
        />
      );
    case 'workflowRunner':
      return <WorkflowRunner workflowId={component.props.workflowId} env={env} />;
  }
}

export function PageView({
  page,
  env,
  bottomInset = 0,
}: {
  page: Page;
  env: RenderEnv;
  bottomInset?: number;
}) {
  return (
    <ScrollView
      style={{ backgroundColor: env.palette.background }}
      contentContainerStyle={[styles.page, { paddingBottom: 24 + bottomInset }]}>
      {page.components
        .filter((c) => !c.hidden)
        .map((c) => (
          <View key={c.id} testID={`component-${c.id}`}>
            <ComponentView component={c} env={env} />
          </View>
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  header: { paddingVertical: 8, gap: 4 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15 },
  body: { fontSize: 15, lineHeight: 21 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 6 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 2 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontWeight: '700' },
});
