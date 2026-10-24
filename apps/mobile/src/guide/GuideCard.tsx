import { GUIDE_GOALS } from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { LOOK_PROMPTS, useGuide } from './store';

/**
 * 首页上的引导卡片（D-149）。第 1 步：点一句改界面的话；第 2 步：点一句「我有什么，我想要什么」，
 * 第一句最显眼，另外两句放在「再试试」。点了都打开 AI 修改，照常预览、确认、可撤销。
 */
export function GuideCard({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const stage = useGuide((s) => s.stage);
  const setStage = useGuide((s) => s.setStage);
  const justChanged = useWorkspace((s) => s.banner?.kind === 'applied');
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

  const [first, ...more] = GUIDE_GOALS;
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
                label={prompt[locale]}
                palette={palette}
                onPress={() => open(`look-${i}`)}
              />
            ))}
          </View>
        ) : (
          <>
            {justChanged ? (
              <Text
                testID="guide-undo-hint"
                style={[palette.font('bodyMedium', 13), { color: palette.primaryText }]}>
                {t(locale, 'guideUndoHint')}
              </Text>
            ) : null}
            <Pressable
              testID={`guide-goal-${first!.id}`}
              accessibilityRole="button"
              onPress={() => open(first!.id)}
              style={({ pressed }) => [
                styles.hero,
                {
                  backgroundColor: palette.primary,
                  borderRadius: palette.controlRadius,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <Icon name="sparkles" size={18} color={palette.onPrimary} />
              <Text
                style={[palette.font('bodyBold', 16), styles.flex, { color: palette.onPrimary }]}>
                {`“${first!.text[locale]}”`}
              </Text>
            </Pressable>
            <Text style={[palette.font('bodyBold', 13), { color: palette.caption }]}>
              {t(locale, 'guideMore')}
            </Text>
            <View style={styles.chips}>
              {more.map((goal) => (
                <Chip
                  key={goal.id}
                  testID={`guide-goal-${goal.id}`}
                  label={goal.text[locale]}
                  palette={palette}
                  onPress={() => open(goal.id)}
                />
              ))}
            </View>
          </>
        )}
        <Pressable
          testID={stage === 'look' ? 'guide-skip' : 'guide-later'}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.link}
          onPress={() => void setStage(stage === 'look' ? 'done' : 'later')}>
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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
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
