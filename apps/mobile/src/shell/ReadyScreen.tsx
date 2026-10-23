import { HOME_PAGE_ID, allComponents, type Workflow } from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SampleKind } from '../guide/samples';
import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';

/**
 * 「快捷操作做好了」（D-125）：AI 新做了一个快捷操作后打开。AI 不替用户运行（D-113），
 * 用户自己点「现在就用一次」；也说明以后在哪里找到它。
 * 新手引导做的（D-149）先给「用示例照片试一下」，不用先选自己的文件。
 */
export function ReadyScreen({ workflow, sample }: { workflow: Workflow; sample?: SampleKind }) {
  const { locale, registry } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const router = useRouter();
  const onHome = config.pages.some(
    (p) =>
      p.id === HOME_PAGE_ID &&
      allComponents(p).some(
        (c) => c.type === 'workflowRunner' && c.props.workflowId === workflow.id,
      ),
  );
  const body = [palette.font('body', 15), { color: palette.text }];

  return (
    <ScrollView
      testID="ready-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 48 }}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: palette.secondary }]}>
          <Icon name="check" size={22} color="#FFFFFF" />
        </View>
        <Text style={[palette.font('heading', 22), styles.flex, { color: palette.text }]}>
          {t(locale, 'readyTitle')}
        </Text>
      </View>
      <Card palette={palette}>
        <Text testID="ready-name" style={[palette.font('title', 17), { color: palette.text }]}>
          {workflow.name}
        </Text>
        {workflow.steps.map((step, i) => (
          <Text key={step.id} style={body}>
            {`${i + 1}. ${registry.actions.get(step.action)?.label[locale] ?? step.action}`}
          </Text>
        ))}
        <Text style={[palette.font('body', 13), { color: palette.caption }]}>
          {t(locale, onHome ? 'readyHome' : 'workflowWhere')}
        </Text>
      </Card>
      {sample ? (
        <Button
          palette={palette}
          testID="ready-sample"
          label={t(locale, sample === 'photos' ? 'readyTryPhotos' : 'readyTryPdfs')}
          onPress={() =>
            router.replace({
              pathname: '/run/[workflowId]',
              params: { workflowId: workflow.id, sample },
            })
          }
        />
      ) : null}
      <Button
        palette={palette}
        testID="ready-run"
        variant={sample ? 'outline' : 'filled'}
        label={t(locale, sample ? 'readyRunOwn' : 'readyRunNow')}
        onPress={() =>
          router.replace({ pathname: '/run/[workflowId]', params: { workflowId: workflow.id } })
        }
      />
      {sample ? null : (
        <Button
          palette={palette}
          testID="ready-later"
          variant="outline"
          label={t(locale, 'readyLater')}
          onPress={() => router.back()}
        />
      )}
      <Pressable
        testID="ready-fix"
        accessibilityRole="link"
        hitSlop={8}
        style={styles.link}
        onPress={() => router.replace({ pathname: '/change', params: { workflow: workflow.id } })}>
        <Text style={[palette.font('bodyMedium', 14), { color: palette.primaryText }]}>
          {t(locale, 'readyFix')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  link: { alignSelf: 'center', paddingVertical: 4 },
});
