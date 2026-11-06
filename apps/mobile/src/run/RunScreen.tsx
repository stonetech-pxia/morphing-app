import {
  calendarOf,
  localize,
  RunError,
  isFileValue,
  type AskedAnswer,
  type AskRequest,
  type HandedFiles,
  type PackNeed,
  type RunResult,
  type RunValue,
  type Workflow,
} from '@morph/core';

import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { workflowEntry } from '../shell/ai-entry';
import { runErrorText, t } from '../i18n';
import { Icon } from '../renderer/Icon';
import { usePalette, type Palette } from '../renderer/theme';
import { Button, Card } from '../renderer/ui';
import { saveItems } from '../runtime/actions/io';
import type { LocalKind, LocalSteps, LocalUi } from '../runtime/local';
import { granteeOf, isBackgroundAction, newAssetId, startRun, type Run } from '../runtime/runner';
import { ensureRunPacks } from '../packs/file-bundle';
import { useFileBundleOffer } from '../packs/FileBundleOffer';
import { PackGate } from '../packs/PackGate';
import { copyResults, releaseShare, useIncoming, type IncomingShare } from '../share/incoming';
import { usePacks } from '../packs/PackHost';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { clearDesk, placeResultsOnDesk } from '../desk/store';
import { AskPanel } from './AskPanel';
import { ChainCard } from './ChainCard';
import { HabitCard } from './HabitCard';
import { LOCAL_SCREENS } from './local';
import { canEditTable, canEditWord } from './office-items';
import { ResultView } from './ResultView';

/** 问话框淡出要多久（毫秒）。 */
const ASK_DISMISS_MS = 400;

// 运行页面（TOOLS_DESIGN §3）：每一步的进度、取消、运行时询问、本地操作界面、结果预览。
// 打开即开始运行；关闭时取消并删除本次的临时文件。

export interface LocalScreenProps<K extends LocalKind> {
  input: LocalSteps[K]['in'];
  palette: Palette;
  locale: 'en' | 'zh' | 'fr';
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

export function RunScreen({
  workflow,
  onEdit,
  onAskAI,
  incoming,
  keepIncoming,
  thenDesk,
  handed,
}: {
  workflow: Workflow;
  onEdit?: () => void;
  /** 「让 AI 改这个」：带着这个快捷操作打开 AI 修改（D-126）。 */
  onAskAI?: () => void;
  /** 分享进来的文件（D-115）：第一步用它们，不打开选择器。关闭运行页面时删掉。 */
  incoming?: IncomingShare;
  /** 预览页打开的（D-457）：关闭时不删收到的文件，返回就回到预览页，文件还在。 */
  keepIncoming?: boolean;
  /** 预览页「转 Word」（D-457）：做好后直接放到桌上进编辑，返回就舍弃这份 Word。 */
  thenDesk?: boolean;
  /** 容器交的值（D-428）：记录页的这一条、这个字段的值、列表选出的记录。 */
  handed?: RunValue | HandedFiles;
}) {
  const { repo, files, registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config!);
  const theme = config.theme;
  const collections = useWorkspace((s) => s.config!.data.tables);
  const calendarSettings = useWorkspace((s) => s.config!.data.calendar);
  const revisionId = useWorkspace((s) => s.head!.id);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const bumpRecords = useWorkspace((s) => s.bumpRecords);
  const palette = usePalette(theme);
  const router = useRouter();
  // 打开即开始运行，所以初始状态就是第 1 步。
  const [current, setCurrent] = useState<{
    index: number;
    done?: number;
    total?: number;
    unit?: 'percent';
    items?: number;
    images?: boolean;
  } | null>({
    index: 0,
  });
  const [outcome, setOutcome] = useState<RunResult | null>(null);
  const [ask, setAsk] = useState<(AskRequest & Pending<Record<string, unknown> | null>) | null>(
    null,
  );
  const [local, setLocal] = useState<LocalPending | null>(null);
  const packs = usePacks();
  const bundle = useFileBundleOffer(palette, locale);
  const [packAsk, setPackAsk] = useState<
    ({ needs: readonly PackNeed[] } & Pending<string[] | null>) | null
  >(null);
  const alive = useRef(true);
  const transferring = useRef(false);
  const [transferBusy, setTransferBusy] = useState(false);
  // 转进预览页失败了：照常停在结果页。
  const [noPreview, setNoPreview] = useState(false);
  const signal = useRef({ cancelled: false });
  const run = useRef<Run | null>(null);
  // 这次运行里「每次运行时问」的回答，结果页据此提议做成快捷操作（D-127）。
  const answers = useRef<AskedAnswer[]>([]);
  const [runCount, setRunCount] = useState(0);
  const label = (action: string, index: number) =>
    incoming && index === 0
      ? t(locale, 'shareInputStep', { n: incoming.files.length })
      : (localize(registry.actions.get(action)?.label, locale) ?? action);

  const ui: LocalUi = {
    confirm: (title, ok, cancel, message) =>
      new Promise((resolve) =>
        Alert.alert(
          title,
          message,
          [
            { text: cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: ok, onPress: () => resolve(true) },
          ],
          { cancelable: false },
        ),
      ),
    choose: (title, message, options) =>
      new Promise((resolve) =>
        Alert.alert(
          title,
          message,
          [
            ...options.map((text, i) => ({ text, onPress: () => resolve(i) })),
            { text: t(locale, 'cancel'), style: 'cancel' as const, onPress: () => resolve(null) },
          ],
          { cancelable: false },
        ),
      ),
    open: (kind, input) =>
      new Promise((resolve) => setLocal({ kind, input, resolve } as unknown as LocalPending)),
  };

  /**
   * 当前这一步的进度文字（D-276）：按百分比报的写百分比；处理多个文件、进度按文件数报时写「第 n/N 张」
   * （正在处理的那一张，所以第一张还没做完时就显示第 1 张）；别的计数写「done/total」。
   */
  function progressText(c: NonNullable<typeof current>): string {
    if (c.unit === 'percent' && c.total) {
      return `  ${t(locale, 'runPercent', { done: c.done ?? 0, total: c.total })}`;
    }
    if (c.items && c.items > 1 && (c.total === undefined || c.total === c.items)) {
      const n = Math.min((c.done ?? 0) + 1, c.items);
      return ` · ${t(locale, c.images ? 'runItemImage' : 'runItemFile', { n, total: c.items })}`;
    }
    return c.total ? `  ${t(locale, 'runProgress', { done: c.done ?? 0, total: c.total })}` : '';
  }

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
    answers.current = [];
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
      calendar: calendarOf({ data: { tables: [], calendar: calendarSettings } }),
      packs: packs
        ? { runtime: packs.bridge, isInstalled: (id) => packs.store.isInstalled(id) }
        : null,
      // 需要扩展包时先问用户（D-064）；已安装就直接继续。第一次要时一次问完这次运行要的（D-299）。
      ensurePacks: async (needs) => {
        if (!packs) throw new RunError('packFailed', { detail: needs[0]?.pack });
        // 可选的没装就跳过，只为必需的弹框（D-456）。
        return ensureRunPacks(
          packs.store,
          needs,
          (ask) => new Promise((resolve) => setPackAsk({ needs: ask, resolve })),
        );
      },
      ensurePack: async (packId, options) => {
        if (!packs) throw new RunError('packFailed', { detail: packId });
        if (await packs.store.isInstalled(packId)) return true;
        // 可选的没装就不用它，不在运行时问（D-456）。
        if (options?.optional === true) return false;
        const left = await new Promise<string[] | null>((resolve) =>
          setPackAsk({ needs: [{ pack: packId, optional: options?.optional === true }], resolve }),
        );
        return left !== null && !left.includes(packId);
      },
      signal: signal.current,
      incoming: incoming?.files ?? null,
      handed: handed ?? null,
      askParams: async (request) => {
        const answer = await new Promise<Record<string, unknown> | null>((resolve) =>
          setAsk({ ...request, resolve }),
        );
        if (answer) {
          // 密码不留下来（D-194）。
          const secret = (k: string) =>
            request.action.fields.find((f) => f.key === k)?.kind === 'secret';
          const values = Object.fromEntries(
            request.keys.filter((k) => k in answer && !secret(k)).map((k) => [k, answer[k]]),
          );
          answers.current.push({ stepId: request.step.id, values });
        }
        return answer;
      },
      onEvent: (e) =>
        setCurrent((prev) =>
          e.kind === 'step'
            ? {
                index: e.index,
                ...(e.items !== undefined ? { items: e.items, images: e.images === true } : {}),
              }
            : {
                // 同一步里保留这一步要处理几个文件（「第 n/N 张」要用）。
                ...(prev?.index === e.index && prev.items !== undefined
                  ? { items: prev.items, images: prev.images }
                  : {}),
                index: e.index,
                done: e.done,
                total: e.total,
                ...(e.unit ? { unit: e.unit } : {}),
              },
        ),
    });
    if (!alive.current) {
      await started.dispose();
      return;
    }
    run.current = started;
    setCurrent(null);
    setOutcome(started.result);
    setRunCount((n) => n + 1);
    if (started.result.status === 'succeeded' && started.result.saved.length > 0) bumpAssets();
    // 第一次扫描完、或处理完分享进来的文件：一次问完文件处理包（D-456）。
    if (
      started.result.status === 'succeeded' &&
      (incoming || workflow.steps.some((s) => s.action.startsWith('scan.')))
    )
      bundle.offer();
    const made = started.result.status === 'succeeded' ? started.result.value : null;
    if (thenDesk && isFileValue(made) && made.items[0]) {
      void placeResultsOnDesk(files, [made.items[0]], Date.now()).then(
        (desk) => {
          if (!alive.current) return void clearDesk(files, desk.id);
          router.replace({ pathname: '/desk/[deskId]', params: { deskId: desk.id, discard: '1' } });
        },
        () => undefined,
      );
    }
    // 记一笔（D-187）直接写数据库：页面上的列表和统计要重新读（停在中途也可能已经记了几笔）。
    if (workflow.steps.some((s) => s.action === 'out.addRecord')) bumpRecords();
  }

  useEffect(() => {
    // 等运行页面弹出的动画结束再开始：动画进行中系统不会弹出照片 / 文件选择器（会一直停在第 1 步）。
    alive.current = true;
    const timer = setTimeout(() => void execute(), START_DELAY_MS);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      signal.current.cancelled = true;
      void run.current?.dispose();
      if (incoming && !keepIncoming) void releaseShare(files, incoming.id);
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
  // 结果只有一个文件：不停在结果页，直接进它的预览页（D-457）。限两种：拍照扫描做出来的，和在收到的文件上
  // 运行的（从预览页、收件页面来的）。自己会发出去、存起来、记下来的快捷操作（有 out. 步骤）、容器交值的运行和
  // 「转 Word」进桌面的照旧；工具页里自己选文件的运行也照旧，它们的结果页管保存和文件夹。
  const first = workflow.steps[0];
  const scans = first?.action === 'in.photos' && first.params.source === 'scanner';
  const forwarding =
    !noPreview &&
    (scans || incoming !== undefined) &&
    // 接在上一个结果后面运行的，结果页上有「合成一个快捷操作」（ChainCard），照旧停在结果页。
    !incoming?.result &&
    !thenDesk &&
    !handed &&
    isFileValue(value) &&
    value.items.length === 1 &&
    // 能在桌上改的 Excel、Word（带识别出的表格、文档）照旧停在结果页：预览页的「编辑」只复制文件，改不了。
    !canEditTable(value.items[0]!) &&
    !canEditWord(value.items[0]!) &&
    !workflow.steps.some((st) => st.action.startsWith('out.'));

  // 转 Word 进桌面、扫描、在收到的文件上运行的：运行时不摆出「快捷操作」的步骤列表，只说一句在做什么，做完
  // 直接进桌面或预览页（D-457）。失败、取消、结果有好几个文件时才露出完整的运行页面。
  const couldForward =
    !noPreview &&
    !handed &&
    !workflow.steps.some((st) => st.action.startsWith('out.')) &&
    (thenDesk || ((scans || incoming !== undefined) && !incoming?.result));
  const compact =
    couldForward &&
    (outcome === null || (outcome.status === 'succeeded' && (thenDesk || forwarding)));

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
      inputSize: outcome?.status === 'succeeded' ? outcome.inputSize : 0,
    });
    bumpAssets();
  }

  async function continueProcessing(auto = false) {
    if (!isFileValue(value) || transferring.current) return;
    transferring.current = true;
    setTransferBusy(true);
    const runId = newAssetId();
    const previous = useIncoming.getState().share?.id;
    try {
      const picked = await copyResults(files, value.items, runId, run.current?.runId);
      if (!alive.current || previous !== useIncoming.getState().share?.id) {
        await files.removeRun(runId);
        if (auto && alive.current) setNoPreview(true);
        return;
      }
      useIncoming.getState().receive(picked, [], 'result', { runId, workflow });
      try {
        // 从预览页进来的：这一页关掉，下面那个预览页换成结果；别的情况换成预览页。
        if (auto && keepIncoming) router.back();
        else router.replace('/share');
      } catch (error) {
        await releaseShare(files, useIncoming.getState().share!.id);
        throw error;
      }
    } catch (error) {
      if (!auto) throw error;
      if (alive.current) setNoPreview(true);
    } finally {
      transferring.current = false;
      if (alive.current) setTransferBusy(false);
    }
  }

  useEffect(() => {
    if (!forwarding) return;
    const timer = setTimeout(() => void continueProcessing(true), 0);
    return () => clearTimeout(timer);
    // 只在「要转进预览页」变成真时做一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwarding]);

  const LocalScreen = local
    ? (LOCAL_SCREENS[local.kind] as ComponentType<LocalScreenProps<LocalKind>> | undefined)
    : undefined;

  return (
    <ScrollView
      testID="run-screen"
      // 问话面板（Modal）也在这棵树里：不加这个，键盘开着时点「确定」只会收起键盘。
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap, paddingBottom: 80 }}>
      {/* 运行结束才有 AI 入口（D-406）：运行中离开这一页会打断它。 */}
      <Stack.Screen
        options={{
          ...(compact ? { title: '' } : {}),
          headerRight:
            outcome && !compact ? workflowEntry(config, workflow.id, palette) : () => null,
        }}
      />
      {compact ? (
        <View testID="run-compact" style={styles.compact}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text
            testID="run-compact-name"
            style={[palette.font('title', 18), { color: palette.text, textAlign: 'center' }]}>
            {workflow.name}
          </Text>
          <Text
            testID="run-compact-step"
            style={[palette.font('body', 14), { color: palette.muted, textAlign: 'center' }]}>
            {current
              ? `${label(workflow.steps[current.index]?.action ?? '', current.index)}${progressText(current)}`
              : ''}
          </Text>
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
        </View>
      ) : (
        <>
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
                    {label(s.action, i)}
                    {state === 'current' && current ? progressText(current) : ''}
                  </Text>
                  {state === 'current' && !outcome ? (
                    // 正在处理（D-276）：问参数、等用户确认时也在这一步，转圈只说明还没做完。
                    <ActivityIndicator
                      testID={`run-busy-${s.id}`}
                      size="small"
                      color={palette.primary}
                    />
                  ) : null}
                </View>
              );
            })}
          </Card>

          {/* 长步骤（视频、音频）运行时说一句能不能切走（D-160、D-148）。 */}
          {current && isBackgroundAction(workflow.steps[current.index]?.action ?? '') ? (
            <Text
              testID="run-background-hint"
              style={[palette.font('body', 13), { color: palette.caption }]}>
              {t(
                locale,
                files.background?.continuesInBackground ? 'runCanLeave' : 'runStayInMorph',
              )}
            </Text>
          ) : null}

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
            <Text
              testID="run-cancelled"
              style={[palette.font('body', 15), { color: palette.muted }]}>
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
          {/* 翻译的结果下面说明一句（D-172）：本机翻译适合看懂意思，正式文件找专业翻译。 */}
          {value && workflow.steps.some((st) => st.action === 'translate.text') ? (
            <Text
              testID="translate-note"
              style={[palette.font('body', 13), { color: palette.caption }]}>
              {t(locale, 'translateNote')}
            </Text>
          ) : null}
          {/* 语音转文字的结果上面说明一句（D-150）：本机自动识别，可能有错字，请核对。 */}
          {value &&
          workflow.steps.some(
            (st) => st.action === 'audio.transcribe' || st.action === 'video.subtitles',
          ) ? (
            <Text
              testID="speech-note"
              style={[palette.font('body', 13), { color: palette.caption }]}>
              {t(locale, 'speechNote')}
            </Text>
          ) : null}
          {value && workflow.steps.some((st) => st.action === 'video.subtitles') ? (
            <Text
              testID="subtitles-note"
              style={[palette.font('body', 13), { color: palette.caption }]}>
              {t(locale, 'subtitlesNote')}
            </Text>
          ) : null}
          {value && !forwarding ? (
            <ResultView
              // 编辑后换成了新文件：「已保存」之类的状态从头算。
              key={isFileValue(value) ? value.items.map((i) => i.uri).join('|') : 'value'}
              value={value}
              inputSize={outcome?.status === 'succeeded' ? outcome.inputSize : 0}
              palette={palette}
              locale={locale}
              actions={{
                save: saveResult,
                continueProcessing,
                // 放到桌上改（D-366）：复制一份进新桌面，结果页上的这一份不动。
                putOnDesk: async (item) => {
                  const desk = await placeResultsOnDesk(files, [item], Date.now());
                  router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } });
                },
                share: async () => {
                  if (isFileValue(value)) await files.shareUris(value.items);
                },
                saveToFolder: async (choose) =>
                  isFileValue(value)
                    ? ((await files.saveToFolder(value.items, workflow.id, choose))?.folder ?? null)
                    : null,
                rememberedFolder: () => files.rememberedFolder(workflow.id),
                saveToPhotos: async () => {
                  if (isFileValue(value)) await files.saveToPhotos(value.items.map((i) => i.uri));
                },
                print: async () => {
                  if (isFileValue(value)) for (const item of value.items) await files.print(item);
                },
                copy: async () => {
                  if (value.type === 'text') await files.copyText(value.text);
                },
                preview: (item) =>
                  files.previewFile({
                    uri: item.uri,
                    mimeType: item.mimeType,
                    name: `${item.name}.${item.ext}`,
                  }),
              }}
            />
          ) : null}

          {outcome?.status === 'succeeded' && !forwarding && incoming?.result ? (
            <ChainCard
              key={`chain-${runCount}`}
              source={incoming.result}
              workflow={workflow}
              palette={palette}
            />
          ) : null}

          {outcome?.status === 'succeeded' && !handed && !forwarding ? (
            <HabitCard
              key={runCount}
              workflow={workflow}
              answers={answers.current}
              palette={palette}
            />
          ) : null}

          {/* 结果页：「完成」关闭页面；「再来一次」次要；改设置是一个小链接（D-111）。 */}
          {!running && !forwarding ? (
            <>
              <View style={styles.row}>
                <Button
                  palette={palette}
                  testID="run-again"
                  disabled={transferBusy}
                  variant="outline"
                  label={t(locale, 'runAgain')}
                  onPress={() => void restart()}
                  style={styles.flex}
                />
                <Button
                  palette={palette}
                  testID="run-done"
                  disabled={transferBusy}
                  label={t(locale, outcome?.status === 'succeeded' ? 'done' : 'close')}
                  onPress={() => (keepIncoming ? router.dismissAll() : router.back())}
                  style={styles.flex}
                />
              </View>
              <View style={styles.links}>
                {onEdit ? (
                  <Pressable
                    testID="run-edit"
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={onEdit}
                    style={styles.editLink}>
                    <Text style={[palette.font('bodyMedium', 14), { color: palette.primaryText }]}>
                      {t(locale, 'runEdit')}
                    </Text>
                  </Pressable>
                ) : null}
                {onAskAI ? (
                  <Pressable
                    testID="run-ask-ai"
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={onAskAI}
                    style={styles.editLink}>
                    <Text style={[palette.font('bodyMedium', 14), { color: palette.primaryText }]}>
                      {t(locale, 'askAIChange')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </>
      )}

      {ask ? (
        <AskPanel
          request={ask}
          palette={palette}
          locale={locale}
          now={new Date()}
          onAnswer={(answer) => {
            setAsk(null);
            // 问完马上打开系统选择器（第一步问「从文件选 / 录音」时）：iOS 上问话框还在淡出，
            // 这时弹出的选择器会被系统悄悄丢掉、运行卡住。等它关完再继续。
            if (Platform.OS === 'ios') setTimeout(() => ask.resolve(answer), ASK_DISMISS_MS);
            else ask.resolve(answer);
          }}
        />
      ) : null}
      {bundle.element}
      {packAsk && packs ? (
        <PackGate
          needs={packAsk.needs}
          store={packs.store}
          palette={palette}
          locale={locale}
          onDone={(left) => {
            packAsk.resolve(left);
            setPackAsk(null);
          }}
        />
      ) : null}
      {local && LocalScreen ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="overFullScreen"
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
  compact: { alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 120 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  editLink: { paddingVertical: 4 },
});
