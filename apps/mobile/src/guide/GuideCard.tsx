import { homeFileEntryOps, localize } from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { LOOK_PROMPTS, useGuide } from './store';

/**
 * 首页上的引导卡片（D-149、D-231）。第 1 步：首页是空的，点那句话打开 AI 修改，填进输入框由用户自己发送，
 * 两个文件入口直接加上（不进预览，可撤销）；「跳过引导」也直接加上。第 2 步：只有一句说明，
 * 让用户点首页上的「打开相册」「打开文件」（打开后引导结束）。
 */
export function GuideCard({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const stage = useGuide((s) => s.stage);
  const setStage = useGuide((s) => s.setStage);
  const justChanged = useWorkspace((s) => s.banner?.kind === 'applied');
  const config = useWorkspace((s) => s.config)!;
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const router = useRouter();
  const open = (guide: string) => router.push({ pathname: '/change', params: { guide } });
  const body = [palette.font('body', 14), { color: palette.muted }];

  if (stage === 'later') {
    return (
      <View style={styles.wrap}>
        <Pressable
          testID="guide-task"
          accessibilityRole="button"
          onPress={() => void setStage('goal')}
          style={[
            styles.task,
            palette.cardStyle(palette.primaryTint),
            { borderRadius: palette.controlRadius },
          ]}>
          <Icon name="sparkles" size={18} color={palette.primaryText} />
          <Text style={[palette.font('bodyMedium', 14), styles.flex, { color: palette.text }]}>
            {t(locale, 'guideTask')}
          </Text>
          <Pressable
            testID="guide-task-close"
            accessibilityLabel={t(locale, 'close')}
            hitSlop={10}
            onPress={() => void setStage('done')}>
            <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>✕</Text>
          </Pressable>
        </Pressable>
      </View>
    );
  }
  if (stage !== 'look' && stage !== 'goal') return null;

  /** 跳过引导（D-231）：直接加上两个文件入口（不进预览），顶部照常「已改好 · 撤销」。 */
  async function skip() {
    const ops = homeFileEntryOps(config);
    if (ops.length > 0) {
      const proposed = await proposeOps(ops, localize(LOOK_PROMPTS[0]!, locale));
      if (proposed.kind === 'preview') await confirm();
    }
    await setStage('done');
  }

  return (
    <View style={styles.wrap}>
      <Card palette={palette} background={palette.surface} testID={`guide-${stage}`}>
        <Text style={[palette.font('title', 16), { color: palette.text }]}>
          {t(locale, stage === 'look' ? 'guideLookTitle' : 'guideGoalTitle')}
        </Text>
        <Text style={body}>{t(locale, stage === 'look' ? 'guideLookBody' : 'guideGoalBody')}</Text>
        {stage === 'look' ? (
          <View style={styles.chips}>
            {LOOK_PROMPTS.map((prompt, i) => (
              <Chip
                key={prompt.en}
                testID={`guide-look-${i}`}
                label={localize(prompt, locale)}
                palette={palette}
                onPress={() => open(`look-${i}`)}
              />
            ))}
          </View>
        ) : justChanged ? (
          <Text
            testID="guide-undo-hint"
            style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
            {t(locale, 'guideUndoHint')}
          </Text>
        ) : null}
        <Pressable
          testID={stage === 'look' ? 'guide-skip' : 'guide-later'}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.link}
          onPress={() => void (stage === 'look' ? skip() : setStage('done'))}>
          <Text style={[palette.font('bodyMedium', 13), { color: palette.caption }]}>
            {t(locale, stage === 'look' ? 'guideSkipAll' : 'guideLater')}
          </Text>
        </Pressable>
      </Card>
    </View>
  );
}

function Chip({
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
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  link: { alignSelf: 'flex-start', paddingVertical: 2 },
});
