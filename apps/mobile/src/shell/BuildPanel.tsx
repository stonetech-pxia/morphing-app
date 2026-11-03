import { issueReason, sessionProblems, type Locale } from '@morph/core';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { UiIcon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { BuildRun, BuildRunStep } from '../workspace/store';

/** App 进后台就停在手上这一步之后（D-415）：回来由用户点继续，不自动接着做（底线 16）。 */
export function useStopBuildInBackground() {
  const { store } = useWorkspaceContext();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && store.getState().build?.phase === 'running')
        void store.getState().stopBuild();
    });
    return () => sub.remove();
  }, [store]);
}

/**
 * 大工程的搭建计划（D-415）：先看计划，可以删掉某步，点「开始」；然后是进度；一步失败时选重试、跳过或停止；
 * 全部结束后是整体检查的结果。系统层的界面，不在配置里，AI 改不了（底线 8）。
 */
export function BuildPanel({
  build,
  palette,
  onSeeLook,
  onFix,
}: {
  build: BuildRun;
  palette: Palette;
  /** 打开草稿看外观，离开这个页面。 */
  onSeeLook: () => void;
  /** 「把这些补上」（D-418）。 */
  onFix: () => void;
}) {
  const { locale } = useWorkspaceContext();
  const body = [palette.font('body', 14), { color: palette.muted }];
  const active = build.steps.filter((s) => s.status !== 'skipped');
  const current = active.findIndex((s) => s.status === 'running');
  const stuck = build.steps.find((s) => s.status === 'failed');
  const left = active.filter((s) => s.status !== 'done').length;
  return (
    <Card palette={palette} background={palette.surface} testID="build-panel">
      <Text style={[palette.font('bodyMedium', 12), { color: palette.caption }]}>
        {t(locale, 'buildPlanTitle')}
      </Text>
      <Text style={[palette.font('title', 17), { color: palette.text }]}>{build.summary}</Text>
      {build.phase === 'review' ? <Text style={body}>{t(locale, 'buildPlanHint')}</Text> : null}
      {build.phase === 'running' && current >= 0 ? (
        <Text testID="build-progress" style={body}>
          {t(locale, 'buildStepOf', { n: current + 1, total: active.length })}
        </Text>
      ) : null}

      <View style={styles.steps}>
        {build.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            palette={palette}
            removable={build.phase === 'review'}
          />
        ))}
      </View>

      {build.phase === 'review' ? <ReviewButtons palette={palette} /> : null}
      {build.phase === 'running' ? <RunningButtons palette={palette} /> : null}
      {build.phase === 'failed' && stuck ? <StuckPart step={stuck} palette={palette} /> : null}
      {build.phase === 'paused' ? <PausedPart left={left} palette={palette} /> : null}
      {build.phase === 'finished' ? (
        <FinishedPart palette={palette} locale={locale} onSeeLook={onSeeLook} onFix={onFix} />
      ) : null}
    </Card>
  );
}

function StepRow({
  step,
  palette,
  removable,
}: {
  step: BuildRunStep;
  palette: Palette;
  removable: boolean;
}) {
  const { locale } = useWorkspaceContext();
  const removeBuildStep = useWorkspace((s) => s.removeBuildStep);
  const failed = step.status === 'failed';
  const skipped = step.status === 'skipped';
  return (
    <View testID={`build-step-${step.id}`} style={styles.step}>
      <View style={styles.status}>
        {step.status === 'running' ? (
          <ActivityIndicator size="small" color={palette.primary} />
        ) : step.status === 'done' ? (
          <UiIcon name="done" size={18} color={palette.primary} />
        ) : failed ? (
          <Text style={[palette.font('bodyBold', 15), { color: palette.danger }]}>!</Text>
        ) : (
          <View style={[styles.dot, { borderColor: skipped ? palette.border : palette.caption }]} />
        )}
      </View>
      <Text
        style={[
          palette.font('body', 15),
          styles.flex,
          { color: skipped ? palette.caption : palette.text },
          skipped && styles.struck,
        ]}>
        {step.title}
      </Text>
      {removable ? (
        <Pressable
          testID={`build-step-remove-${step.id}`}
          accessibilityRole="button"
          accessibilityLabel={t(locale, 'buildRemoveStep')}
          hitSlop={10}
          onPress={() => void removeBuildStep(step.id)}>
          <UiIcon name="close" size={18} color={palette.caption} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ReviewButtons({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const startBuild = useWorkspace((s) => s.startBuild);
  const endBuild = useWorkspace((s) => s.endBuild);
  return (
    <View style={styles.row}>
      <Button
        palette={palette}
        testID="build-start"
        label={t(locale, 'buildStart')}
        onPress={() => void startBuild()}
        style={styles.flex}
      />
      <Button
        palette={palette}
        testID="build-discard"
        variant="outline"
        label={t(locale, 'buildDiscard')}
        onPress={() => void endBuild()}
      />
    </View>
  );
}

function RunningButtons({ palette }: { palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const stopBuild = useWorkspace((s) => s.stopBuild);
  return (
    <Button
      palette={palette}
      testID="build-stop"
      variant="outline"
      label={t(locale, 'buildStop')}
      onPress={() => void stopBuild()}
    />
  );
}

function StuckPart({ step, palette }: { step: BuildRunStep; palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const resumeBuild = useWorkspace((s) => s.resumeBuild);
  const skipBuildStep = useWorkspace((s) => s.skipBuildStep);
  const stopBuild = useWorkspace((s) => s.stopBuild);
  const applyDraftForBuild = useWorkspace((s) => s.applyDraftForBuild);
  return (
    <>
      <Text testID="build-stuck" style={[palette.font('bodyBold', 14), { color: palette.danger }]}>
        {t(locale, 'buildStuck', { title: step.title })}
      </Text>
      {step.reason ? (
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>{step.reason}</Text>
      ) : null}
      {step.needsDraft ? (
        <Button
          palette={palette}
          testID="build-apply-draft"
          label={t(locale, 'draftApplyContinue')}
          onPress={() => void applyDraftForBuild()}
        />
      ) : (
        <Button
          palette={palette}
          testID="build-retry"
          label={t(locale, 'buildRetry')}
          onPress={() => void resumeBuild()}
        />
      )}
      <View style={styles.row}>
        <Button
          palette={palette}
          testID="build-skip"
          variant="outline"
          label={t(locale, 'buildSkip')}
          onPress={() => void skipBuildStep()}
          style={styles.flex}
        />
        <Button
          palette={palette}
          testID="build-stop"
          variant="outline"
          label={t(locale, 'buildStop')}
          onPress={() => void stopBuild()}
          style={styles.flex}
        />
      </View>
    </>
  );
}

function PausedPart({ left, palette }: { left: number; palette: Palette }) {
  const { locale } = useWorkspaceContext();
  const resumeBuild = useWorkspace((s) => s.resumeBuild);
  const endBuild = useWorkspace((s) => s.endBuild);
  return (
    <>
      <Text testID="build-paused" style={[palette.font('body', 14), { color: palette.muted }]}>
        {t(locale, 'buildStoppedHint', { n: left })}
      </Text>
      <View style={styles.row}>
        <Button
          palette={palette}
          testID="build-resume"
          label={t(locale, 'buildResume')}
          onPress={() => void resumeBuild()}
          style={styles.flex}
        />
        <Button
          palette={palette}
          testID="build-end"
          variant="outline"
          label={t(locale, 'buildEnd')}
          onPress={() => void endBuild()}
        />
      </View>
    </>
  );
}

function FinishedPart({
  palette,
  locale,
  onSeeLook,
  onFix,
}: {
  palette: Palette;
  locale: Locale;
  onSeeLook: () => void;
  onFix: () => void;
}) {
  const { registry } = useWorkspaceContext();
  const endBuild = useWorkspace((s) => s.endBuild);
  const hasDraft = useWorkspace((s) => !!s.draft);
  // 整体检查看用户确认草稿后会看到的样子。
  const planned = useWorkspace((s) => s.draft?.steps.at(-1)?.config ?? s.config!);
  const session = useWorkspace((s) => s.session);
  const busy = useWorkspace((s) => s.busy);
  // 只算这个会话新增的（D-418）：开始前就有的问题不怪这次搭建。
  const blockers = sessionProblems(session, planned, registry);
  const body = [palette.font('body', 14), { color: palette.muted }];
  return (
    <>
      <Text style={[palette.font('title', 15), { color: palette.text }]}>
        {t(locale, 'buildDoneTitle')}
      </Text>
      <Text testID="build-check" style={body}>
        {blockers.length > 0
          ? t(locale, 'buildCheckProblems', { n: blockers.length })
          : t(locale, 'buildCheckOk')}
      </Text>
      {blockers.slice(0, 4).map((issue) => (
        <Text key={`${issue.code}|${issue.target}`} testID="build-check-problem" style={body}>
          • {issueReason(issue, planned, locale)}
        </Text>
      ))}
      {blockers.length > 0 ? (
        <Button
          palette={palette}
          testID="build-fix"
          label={t(locale, 'fixProblems')}
          loading={busy}
          disabled={busy}
          onPress={onFix}
        />
      ) : null}
      <Text style={body}>{t(locale, 'buildUndoHint')}</Text>
      {hasDraft ? <Text style={body}>{t(locale, 'buildLookInDraft')}</Text> : null}
      <Text testID="build-preset-hint" style={body}>
        {t(locale, 'buildPresetHint')}
      </Text>
      <View style={styles.row}>
        {hasDraft ? (
          <Button
            palette={palette}
            testID="build-see-look"
            variant={blockers.length > 0 ? 'outline' : 'filled'}
            label={t(locale, 'buildSeeLook')}
            onPress={onSeeLook}
            style={styles.flex}
          />
        ) : null}
        <Button
          palette={palette}
          testID="build-finish"
          variant={hasDraft || blockers.length > 0 ? 'outline' : 'filled'}
          label={t(locale, 'buildFinish')}
          onPress={() => void endBuild()}
          style={hasDraft ? undefined : styles.flex}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  steps: { gap: 10, marginVertical: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { width: 22, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  struck: { textDecorationLine: 'line-through' },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
