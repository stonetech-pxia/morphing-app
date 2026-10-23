import { RunError, isFileValue, type AskRequest, type RunResult, type Workflow } from '@morph/core';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { runErrorText, t } from '../i18n';
import { Icon } from '../renderer/Icon';
import { usePalette, type Palette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { saveItems } from '../runtime/actions/io';
import type { LocalKind, LocalSteps, LocalUi } from '../runtime/local';
import { granteeOf, newAssetId, startRun, type Run } from '../runtime/runner';
import { PackGate } from '../packs/PackGate';
import { usePacks } from '../packs/PackHost';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { AskPanel } from './AskPanel';
import { LOCAL_SCREENS } from './local';
import { ResultView } from './ResultView';

// 运行页面（TOOLS_DESIGN §3）：每一步的进度、取消、运行时询问、本地操作界面、结果预览。
// 打开即开始运行；关闭时取消并删除本次的临时文件。

export interface LocalScreenProps<K extends LocalKind> {
  input: LocalSteps[K]['in'];
  palette: Palette;
  locale: 'en' | 'zh';
  onDone: (out: LocalSteps[K]['out']) => void;
  onCancel: () => void;
}

interface Pending<T> {
  resolve: (value: T) => void;
}

type LocalPending = {
  [K in LocalKind]: { kind: K; input: LocalSteps[K]['in'] } & Pending<LocalSteps[K]['out'] | null>;
}[LocalKind];

/** 运行页面弹出动画的时长（iOS 模态约 350 毫秒）。 */
const START_DELAY_MS = 450;

export function RunScreen({ workflow, onEdit }: { workflow: Workflow; onEdit?: () => void }) {
  const { repo, files, registry, locale } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const collections = useWorkspace((s) => s.config!.collections);
  const revisionId = useWorkspace((s) => s.head!.id);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const palette = usePalette(theme);
  // 打开即开始运行，所以初始状态就是第 1 步。
  const [current, setCurrent] = useState<{ index: number; done?: number; total?: number } | null>({
    index: 0,
  });
  const [outcome, setOutcome] = useState<RunResult | null>(null);
  const [ask, setAsk] = useState<(AskRequest & Pending<Record<string, unknown> | null>) | null>(
    null,
  );
  const [local, setLocal] = useState<LocalPending | null>(null);
  const packs = usePacks();
  const [packAsk, setPackAsk] = useState<({ packId: string } & Pending<boolean>) | null>(null);
  const signal = useRef({ cancelled: false });
  const run = useRef<Run | null>(null);
  const label = (action: string) => registry.actions.get(action)?.label[locale] ?? action;

  const ui: LocalUi = {
    confirm: (title, ok, cancel) =>
      new Promise((resolve) =>
        Alert.alert(
          title,
          undefined,
          [
            { text: cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: ok, onPress: () => resolve(true) },
          ],
          { cancelable: false },
        ),
      ),
    open: (kind, input) =>
      new Promise((resolve) => setLocal({ kind, input, resolve } as unknown as LocalPending)),
  };

  /** 「再来一次」：清掉上一次的结果再运行。 */
  async function restart() {
    signal.current = { cancelled: false };
    setOutcome(null);
    setCurrent({ index: 0 });
    await run.current?.dispose();
    run.current = null;
    await execute();
  }

  async function execute() {
    const started = await startRun({
      workflow,
      revisionId,
      repo,
      files,
      registry,
      locale,
      now: () => new Date(),
      newId: newAssetId,
      ui,
      collections,
      packs: packs
        ? { runtime: packs.bridge, isInstalled: (id) => packs.store.isInstalled(id) }
        : null,
      // 需要扩展包时先问用户（D-064）；已安装就直接继续。
      ensurePack: async (packId) => {
        if (!packs) throw new RunError('packFailed', { detail: packId });
        if (await packs.store.isInstalled(packId)) return true;
        return new Promise((resolve) => setPackAsk({ packId, resolve }));
      },
      signal: signal.current,
      askParams: (request) => new Promise((resolve) => setAsk({ ...request, resolve })),
      onEvent: (e) =>
        setCurrent(
          e.kind === 'step' ? { index: e.index } : { index: e.index, done: e.done, total: e.total },
        ),
    });
    run.current = started;
    setCurrent(null);
    setOutcome(started.result);
    if (started.result.status === 'succeeded' && started.result.saved.length > 0) bumpAssets();
  }

  useEffect(() => {
    // 等运行页面弹出的动画结束再开始：动画进行中系统不会弹出照片 / 文件选择器（会一直停在第 1 步）。
    const timer = setTimeout(() => void execute(), START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      signal.current.cancelled = true;
      void run.current?.dispose();
      // 扫描包和文字识别包的页面占几十 MB 内存，离开运行页面就关掉（下次用时再加载）。
      packs?.bridge.close('scan');
      packs?.bridge.close('ocr');
    };
    // 只在打开时运行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = current !== null;
  const failedAt = outcome?.status === 'failed' ? outcome.stepIndex : null;
  const value = outcome?.status === 'succeeded' ? outcome.value : null;

  async function saveResult() {
    if (!isFileValue(value) || !run.current) return;
    const items = await saveItems({ files, repo, grantee: granteeOf(workflow) }, value.items, {
      now: () => new Date(),
      newId: newAssetId,
    });
    setOutcome({
      status: 'succeeded',
      value: { ...value, items },
      saved: items.flatMap((i) => i.assetId ?? []),
    });
    bumpAssets();
  }

  const LocalScreen = local
    ? (LOCAL_SCREENS[local.kind] as ComponentType<LocalScreenProps<LocalKind>> | undefined)
    : undefined;

  return (
    <ScrollView
      testID="run-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 80 }}>
      <Card palette={palette}>
        {workflow.steps.map((s, i) => {
          const state =
            failedAt === i
              ? 'failed'
              : current?.index === i
                ? 'current'
                : (current && i < current.index) ||
                    outcome?.status === 'succeeded' ||
                    (failedAt !== null && i < failedAt)
                  ? 'done'
                  : 'pending';
          return (
            <View key={s.id} style={styles.step} testID={`run-step-${s.id}`}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      state === 'current'
                        ? palette.primary
                        : state === 'failed'
                          ? palette.danger
                          : state === 'done'
                            ? palette.secondary
                            : palette.primaryTint,
                  },
                ]}>
                {state === 'done' ? (
                  <Icon name="check" size={14} color="#FFFFFF" />
                ) : (
                  <Text
                    style={[
                      palette.font('bodyBold', 12),
                      { color: state === 'pending' ? palette.primaryText : '#FFFFFF' },
                    ]}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  palette.font(state === 'current' ? 'bodyBold' : 'body', 15),
                  styles.flex,
                  { color: state === 'pending' ? palette.muted : palette.text },
                ]}>
                {label(s.action)}
                {state === 'current' && current?.total
                  ? `  ${t(locale, 'runProgress', { done: current.done ?? 0, total: current.total })}`
                  : ''}
              </Text>
            </View>
          );
        })}
      </Card>

      {running ? (
        <Button
          palette={palette}
          testID="run-cancel"
          variant="outline"
          label={t(locale, 'runCancel')}
          onPress={() => {
            signal.current.cancelled = true;
          }}
        />
      ) : null}

      {outcome?.status === 'cancelled' ? (
        <Text testID="run-cancelled" style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'runCancelled')}
        </Text>
      ) : null}
      {outcome?.status === 'failed' ? (
        <Card palette={palette}>
          {outcome.stepIndex !== null ? (
            <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>
              {t(locale, 'runFailedAt', { n: outcome.stepIndex + 1 })}
            </Text>
          ) : null}
          <Text
            testID="run-error"
            style={[palette.font('bodyMedium', 15), { color: palette.danger }]}>
            {runErrorText(locale, outcome.error.code, outcome.error.detail)}
          </Text>
        </Card>
      ) : null}
      {value ? (
        <ResultView
          value={value}
          palette={palette}
          locale={locale}
          actions={{
            save: saveResult,
            share: async () => {
              if (isFileValue(value)) await files.shareUris(value.items);
            },
            saveToFolder: async () =>
              isFileValue(value) && (await files.saveToFolder(value.items)) !== null,
            saveToPhotos: async () => {
              if (isFileValue(value)) await files.saveToPhotos(value.items.map((i) => i.uri));
            },
            print: async () => {
              if (isFileValue(value)) for (const item of value.items) await files.print(item);
            },
            copy: async () => {
              if (value.type === 'text') await files.copyText(value.text);
            },
          }}
        />
      ) : null}

      {!running ? (
        <View style={styles.row}>
          <Button
            palette={palette}
            testID="run-again"
            label={t(locale, 'runAgain')}
            onPress={() => void restart()}
            style={styles.flex}
          />
          {onEdit ? (
            <Button
              palette={palette}
              testID="run-edit"
              variant="outline"
              label={t(locale, 'runEdit')}
              onPress={onEdit}
              style={styles.flex}
            />
          ) : null}
        </View>
      ) : null}

      {ask ? (
        <AskPanel
          request={ask}
          palette={palette}
          locale={locale}
          now={new Date()}
          onAnswer={(answer) => {
            ask.resolve(answer);
            setAsk(null);
          }}
        />
      ) : null}
      {packAsk && packs ? (
        <PackGate
          packId={packAsk.packId}
          store={packs.store}
          palette={palette}
          locale={locale}
          onDone={(installed) => {
            packAsk.resolve(installed);
            setPackAsk(null);
          }}
        />
      ) : null}
      {local && LocalScreen ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => {
            local.resolve(null);
            setLocal(null);
          }}>
          <LocalScreen
            input={local.input}
            palette={palette}
            locale={locale}
            onDone={(out) => {
              (local.resolve as (v: unknown) => void)(out);
              setLocal(null);
            }}
            onCancel={() => {
              local.resolve(null);
              setLocal(null);
            }}
          />
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
});
