import { SAMPLE_APPS, pageTarget, sampleInfo, type SampleApp } from '@morph/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { useGuide } from './store';

/**
 * 首页上的引导卡片（D-149、D-231）。第 1、2 步是右上角 Tink 的气泡，见 GuideBubble（D-447）。第 3 步（D-260，第 2 步打开了图片或文件、或点了「以后再说」之后）：
 * 列出五个样板 App，点一个整套进草稿（D-190），看主页面，用户点「应用」才保存；选了或「以后再说」引导结束。
 */
export function GuideCard({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const stage = useGuide((s) => s.stage);
  const setStage = useGuide((s) => s.setStage);
  const draftSample = useWorkspace((s) => s.draftSample);
  const showInShell = useWorkspace((s) => s.showInShell);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const body = [palette.font('body', 14), { color: palette.muted }];

  if (stage === 'samples') {
    /** 选一个样板：整套修改进草稿，显示它的主页面；放不下时说明原因，引导留在这一步。 */
    async function pick(sample: SampleApp) {
      if (busy) return;
      setBusy(true);
      try {
        const result = await draftSample(sample);
        if (result.kind !== 'drafted') {
          const message = result.kind === 'rejected' ? result.message : t(locale, 'sampleFailed');
          Alert.alert(sampleInfo(sample, locale).name, message);
          return;
        }
        await setStage('done');
        const target = pageTarget(result.focusPageId);
        if (!showInShell(result.step.config, target))
          router.push({ pathname: '/page/[pageId]', params: { pageId: result.focusPageId } });
      } finally {
        setBusy(false);
      }
    }
    return (
      <View style={[styles.wrap, { paddingHorizontal: palette.pad }]}>
        <Card palette={palette} background={palette.surface} testID="guide-samples">
          <Text style={[palette.font('title', 16), { color: palette.text }]}>
            {t(locale, 'guideSamplesTitle')}
          </Text>
          <Text style={body}>{t(locale, 'guideSamplesBody')}</Text>
          {SAMPLE_APPS.map((id) => {
            const info = sampleInfo(id, locale);
            return (
              <Pressable
                key={id}
                testID={`guide-sample-${id}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void pick(id)}
                style={({ pressed }) => [styles.sample, { opacity: pressed || busy ? 0.6 : 1 }]}>
                <View style={[styles.sampleIcon, { backgroundColor: palette.primaryTint }]}>
                  <Icon name={info.icon} size={20} color={palette.primaryText} />
                </View>
                <View style={styles.sampleText}>
                  <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>
                    {info.name}
                  </Text>
                  <Text style={[palette.font('body', 13), { color: palette.muted }]}>
                    {info.summary}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            testID="guide-samples-later"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.link}
            onPress={() => void setStage('done')}>
            <Text style={[palette.font('bodyMedium', 13), { color: palette.caption }]}>
              {t(locale, 'guideLater')}
            </Text>
          </Pressable>
        </Card>
      </View>
    );
  }

  // 第 1、2 步是 Tink 的气泡（GuideBubble，D-447）。
  return null;
}

export function Chip({
  label,
  palette,
  onPress,
  testID,
}: {
  label: string;
  palette: Palette;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: palette.primary,
          backgroundColor: palette.primaryTint,
          opacity: pressed ? 0.6 : 1,
        },
      ]}>
      <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 左右贴着页面边距（D-454），在用的地方写。
  wrap: { paddingTop: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  link: { alignSelf: 'flex-start', paddingVertical: 2 },
  sample: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  sampleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sampleText: { flex: 1, gap: 2 },
});
