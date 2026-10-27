import { sampleInfo, type SampleApp } from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Card } from '../renderer/ui';
import { useWorkspaceContext } from '../workspace/context';
import { Chip } from './GuideCard';

// 样板 App 应用之后（D-260）：回到它的主页面，顶部照常有「已改好 · 撤销」，下面一张小卡片提示可以用 AI 接着改。
// 只在这次打开 App 时显示，不存盘；点「用 AI 接着改」把一句开头填进 AI 输入框，由用户自己写完、发送。

interface SampleHintState {
  hint: { sample: SampleApp; pageId: string } | null;
  show(sample: SampleApp, pageId: string): void;
  dismiss(): void;
}

export const useSampleHint = create<SampleHintState>()((set) => ({
  hint: null,
  show: (sample, pageId) => set({ hint: { sample, pageId } }),
  dismiss: () => set({ hint: null }),
}));

export function SampleHint({ pageId, palette }: { pageId: string; palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const hint = useSampleHint((s) => s.hint);
  const dismiss = useSampleHint((s) => s.dismiss);
  const router = useRouter();
  if (!hint || hint.pageId !== pageId) return null;
  const name = sampleInfo(hint.sample, locale).name;

  function change() {
    dismiss();
    router.push({
      pathname: '/change',
      params: { text: t(locale, 'sampleContinuePrompt', { name }) },
    });
  }

  return (
    <View style={styles.wrap}>
      <Card palette={palette} background={palette.surface} testID="sample-hint">
        <Text style={[palette.font('title', 16), { color: palette.text }]}>
          {t(locale, 'sampleReadyTitle', { name })}
        </Text>
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'sampleReadyBody')}
        </Text>
        <View style={styles.actions}>
          <Chip
            testID="sample-hint-change"
            label={t(locale, 'sampleReadyChange')}
            palette={palette}
            onPress={change}
          />
          <Pressable
            testID="sample-hint-dismiss"
            accessibilityRole="button"
            hitSlop={8}
            onPress={dismiss}>
            <Text style={[palette.font('bodyMedium', 13), { color: palette.caption }]}>
              {t(locale, 'sampleReadyDismiss')}
            </Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
});
