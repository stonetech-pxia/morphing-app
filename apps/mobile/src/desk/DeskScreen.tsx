import {
  type AskRequest,
  calendarOf,
  canRedo,
  canUndo,
  currentFiles,
  type Desk,
  type DeskFile,
  deskKindOf,
  type DeskStep,
  deskToolAsks,
  deskToolbar,
  deskToolWorkflow,
  initialParams,
  stepLabel,
  quickActionsOf,
  resolveDeskLayout,
  type RunEvent,
  type Workflow,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { runErrorText, t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { Item } from '../renderer/registry';
import {
  deskReturnChoices,
  deskReturnOf,
  endDeskReturn,
  type DeskReturn,
  type DeskReturnMode,
} from '../renderer/attachment-desk';
import { usePalette, type Palette } from '../renderer/theme';
import { Button } from '../renderer/ui';
import { AskPanel } from '../run/AskPanel';
import { newAssetId, startRun } from '../runtime/runner';
import { AIEntry } from '../shell/ai-entry';
import { BannerAnchor } from '../shell/Banner';
import { useShellEnv } from '../shell/Shell';
import { useConfirmLeave } from '../shell/useConfirmLeave';
import { Toast } from '../shell/Toast';
import { deleteUserFiles } from '../storage/user-files';
import { useWorkspace, useWorkspaceContext, useAppTheme } from '../workspace/context';
import { shownConfig } from '../workspace/store';
import { DraftBar } from '../draft/DraftBar';
import type { Box, DocDoc, DocPage, TableDoc } from '@morph/tool-office';

import { DeskEditor } from './DeskEditor';
import { DeskPreview } from './DeskPreview';
import { DeskToolbar, roomEntries, toolEntries, type ToolEntry } from './DeskToolbar';
import { saveDeskFiles } from './saved-source';
import {
  clearDesk,
  commitRun,
  deskFileUri,
  deskPickedWithSources,
  loadDesk,
  recoverEditDraft,
  redo,
  undo,
} from './store';
import { useDeskEdit } from './useDeskEdit';
import { WordEditor } from './WordEditor';
import { useRunHost } from './useRunHost';

// 文件房间（file-room DESIGN §4，D-360）：中间是桌上文件的大预览，底部（或顶部）一排工具。
// 用一个工具或一个快捷操作，结果成为桌上的新版本，顶部能撤销、重做；「完成」里保存、分享或清空桌面。
// 布局来自配置（WorkspaceConfig.desk，D-358），没写的用默认（预览居中、工具栏在底部）。
// 工具作用到桌上和正在看的这份同一种的全部文件（多选在 R6）。文件只在本机，AI 看不到。
// 转 Excel、转 Word 的结果在桌上就是编辑器（R2，D-366）：选中东西时工具栏收起、换成编辑层；连续的编辑在
// 用工具、打开「完成」、离开、切文件、App 进后台时合成一个版本，顶部只有一组撤销（useDeskEdit）。

/** 现在的时间（毫秒）：放在组件外面，只在点了以后的处理里用。 */
const nowMs = () => Date.now();

/** 预览占屏幕高度的比例（布局 preview 不是 fill 时）。 */
const PREVIEW_SHARE = { large: 0.62, medium: 0.45 } as const;

/** 草稿的四个按钮占的高度（不算底部安全区）。 */
const DRAFT_BAR_SPACE = 84;

interface Busy {
  label: string;
  done?: number;
  total?: number;
  unit?: 'percent';
}

export function DeskScreen({ deskId }: { deskId: string }) {
  const { repo, files, registry, locale } = useWorkspaceContext();
  // 草稿模式里显示草稿（D-190）：AI 改的工具栏和布局在这里看（D-406）。
  const config = useWorkspace(shownConfig)!;
  const revisionId = useWorkspace((s) => s.head!.id);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const bumpRecords = useWorkspace((s) => s.bumpRecords);
  const palette = usePalette(useAppTheme(config));
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const host = useRunHost(palette, locale);
  const { navigate, locked, inDraft } = useShellEnv();

  const [desk, setDeskState] = useState<Desk | null | 'gone'>(null);
  const deskRef = useRef<Desk | null>(null);
  const setDesk = (next: Desk) => {
    deskRef.current = next;
    setDeskState(next);
  };
  const [shownId, setShownId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [panel, setPanel] = useState<(AskRequest & { entry: ToolEntry }) | null>(null);
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState(false);
  // 存到手机（复制进「文件」App 里选的文件夹）：存进了哪个文件夹。
  const [folderSaved, setFolderSaved] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const signal = useRef({ cancelled: false });
  const alive = useRef(true);
  /** 清空了桌面：离开时不再合上编辑。 */
  const cleared = useRef(false);
  /** 说过外来的文件重新生成时哪些格式不留（D-509）：这个桌面只说一次。 */
  const toldRebuilt = useRef(false);
  // 桌面不留着（D-462，取代「先留在桌上」）：离开就清掉；要留下的在「完成」里保存或分享。
  // 有没保存的改动时，离开前先问「放弃修改？」（见下面的 beforeRemove）。
  useEffect(
    () => () => {
      if (cleared.current) return;
      cleared.current = true;
      void clearDesk(files, deskId);
    },
    [files, deskId],
  );
  /** 保存时桌上是第几个版本：之后没再改过就不用问「放弃修改？」。 */
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    alive.current = true;
    void loadDesk(files, deskId)
      // 上次没合上的编辑（App 被关掉）合成一个版本。
      .then((d) => (d ? recoverEditDraft(files, d, Date.now()) : null))
      .then(
        (d) => {
          if (!alive.current) return;
          if (d) setDesk(d);
          else setDeskState('gone');
        },
        () => alive.current && setDeskState('gone'),
      );
    return () => {
      alive.current = false;
      signal.current.cancelled = true;
    };
  }, [files, deskId]);

  const layout = useMemo(() => resolveDeskLayout(config.containers.desk), [config.containers.desk]);
  const list = desk && desk !== 'gone' ? currentFiles(desk) : [];
  const shown = list.find((f) => f.id === shownId) ?? list[0] ?? null;
  const kind = shown ? deskKindOf(shown) : 'other';
  // 工具作用到和正在看的这份同一种的全部文件（例如 5 张照片一起转成一个 PDF）。
  const targets = shown ? list.filter((f) => deskKindOf(f) === kind) : [];
  const tools = useMemo(
    () =>
      toolEntries(
        deskToolbar(kind, layout.tools, registry, quickActionsOf(config), locale),
        targets,
        registry,
        quickActionsOf(config),
        locale,
      ),
    // targets 跟着 list 和 kind 变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, layout.tools, registry, config.tools, locale, list],
  );
  const groups = [...tools, roomEntries(locale, kind)];

  const edit = useDeskEdit({
    files,
    desk: deskRef,
    file: shown,
    onSealed: (next, fileId) => {
      setDesk(next);
      setShownId(fileId);
    },
  });
  // 离开房间、App 进后台时合上编辑（用最新的 edit：它的 seal 只读 ref）。
  const editRef = useRef(edit);
  useEffect(() => {
    editRef.current = edit;
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !cleared.current) void editRef.current.seal();
    });
    return () => {
      sub.remove();
      if (!cleared.current) void editRef.current.seal();
    };
  }, []);
  // 返回（按钮、手势）时有没保存的改动：先问「放弃修改？」（2026-11-06 测试：加了水印、改了格子，返回就悄悄没了）。
  const leave = useConfirmLeave(
    desk !== null && desk !== 'gone' && (edit.dirty || desk.current !== savedAt),
    'deskDiscardMessage',
    locale,
  );
  const onSelecting = useCallback((on: boolean) => setSelecting(on), []);
  // 键盘开着时导航栏在键盘下面，底部不用再让出它的高度。
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => setKeyboard(true)),
      Keyboard.addListener('keyboardDidHide', () => setKeyboard(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  if (desk === null) {
    return <ActivityIndicator style={[styles.flex, { backgroundColor: palette.background }]} />;
  }
  if (desk === 'gone') {
    return (
      <View
        testID="desk-gone"
        style={[styles.center, { backgroundColor: palette.background, paddingTop: insets.top }]}>
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'deskGone')}
        </Text>
        <Button palette={palette} label={t(locale, 'close')} onPress={() => router.back()} />
      </View>
    );
  }

  const label = (step: Workflow['steps'][number]) =>
    stepLabel(registry.actions.get(step.action), step.params, locale) ?? step.action;

  async function run(workflow: Workflow, by: DeskStep, on: readonly DeskFile[]) {
    const current = deskRef.current;
    if (!current || busy) return;
    setError(null);
    setSaved(false);
    setFolderSaved(null);
    const steps = workflow.steps;
    setBusy({ label: label(steps[Math.min(1, steps.length - 1)]!) });
    signal.current = { cancelled: false };
    const onEvent = (e: RunEvent) => {
      if (!alive.current || e.index === 0) return;
      setBusy((b) =>
        e.kind === 'step'
          ? { label: label(steps[e.index]!) }
          : {
              label: b?.label ?? label(steps[e.index]!),
              done: e.done,
              total: e.total,
              ...(e.unit ? { unit: e.unit } : {}),
            },
      );
    };
    const started = await startRun({
      workflow,
      revisionId,
      repo,
      files,
      registry,
      locale,
      now: () => new Date(),
      newId: newAssetId,
      ui: host.ui,
      collections: config.data.tables,
      calendar: calendarOf(config),
      packs: host.packs ?? null,
      ...(host.askParams ? { askParams: host.askParams } : {}),
      ...(host.ensurePack ? { ensurePack: host.ensurePack } : {}),
      ...(host.ensurePacks ? { ensurePacks: host.ensurePacks } : {}),
      signal: signal.current,
      onEvent,
      incoming: await deskPickedWithSources(files, current, on),
    });
    try {
      const result = started.result;
      if (result.status === 'succeeded') {
        const before = new Set(currentFiles(current).map((f) => f.id));
        const commit = await commitRun(
          files,
          current,
          on.map((f) => f.id),
          result.value,
          by,
          nowMs(),
        );
        if (!alive.current) return;
        if (commit.desk !== current) {
          setDesk(commit.desk);
          // 看新出来的第一份（转换、拆分的结果）。
          const fresh = currentFiles(commit.desk).find((f) => !before.has(f.id));
          if (fresh) setShownId(fresh.id);
        }
        if (commit.text !== undefined) setText(commit.text);
        if (result.saved.length > 0) bumpAssets();
      } else if (result.status === 'failed' && alive.current) {
        setError(runErrorText(locale, result.error.code, result.error.detail));
      }
      if (workflow.steps.some((s) => s.action === 'out.addRecord')) bumpRecords();
    } catch (e) {
      if (alive.current) setError(String(e instanceof Error ? e.message : e));
    } finally {
      await started.dispose();
      if (alive.current) setBusy(null);
    }
  }

  /** 合上编辑以后桌上现在的、和正在看的同一种的文件（工具作用到它们）。 */
  async function sealedTargets(): Promise<DeskFile[]> {
    const d = (await edit.seal()) ?? deskRef.current;
    return d ? currentFiles(d).filter((f) => deskKindOf(f) === kind) : [];
  }

  async function press(entry: ToolEntry) {
    if (busy) return;
    // 草稿模式里能看不能用（D-190）。
    if (locked) return locked();
    // 用别的工具、保存、分享前先把编辑合成一个版本（§11.2）。
    const on = await sealedTargets();
    if (entry.room === 'share') return void act(shareAll);
    if (entry.room === 'save') return void act(save);
    if (entry.room === 'folder') return void act(saveToPhone);
    if (entry.room === 'preview') return systemPreview();
    if (entry.workflow) {
      void run(entry.workflow, { kind: 'workflow', workflowId: entry.workflow.id }, on);
      return;
    }
    const item = entry.item;
    if (typeof item !== 'object') return;
    const action = registry.actions.get(item.action)!;
    const preset = item.preset ? action.presets?.find((p) => p.id === item.preset) : undefined;
    const params = preset ? { ...preset.values } : initialParams(action);
    const keys = deskToolAsks(action);
    // 有要问的参数、又不是要亲手操作的工具：先弹出参数面板，点「应用」才跑（跑完才知道结果，D-360）。
    // 参数都不用问的（识别类，D-278）直接跑（D-363）。
    if (!preset && !action.local && keys.length > 0) {
      setPanel({
        entry,
        step: { id: 'desk-step', action: action.id, params },
        action,
        keys,
        params,
        input: null,
      });
      return;
    }
    void applyTool(action.id, params);
  }

  async function applyTool(actionId: string, params: Record<string, unknown>) {
    const on = await sealedTargets();
    const workflow = deskToolWorkflow(actionId, on, registry, params);
    if (!workflow) return;
    void run(workflow, { kind: 'action', action: actionId }, on);
  }

  const nowFiles = () => (deskRef.current ? currentFiles(deskRef.current) : list);
  const items = () =>
    nowFiles().map((f) => ({
      uri: deskFileUri(files, desk, f.path),
      name: f.name,
      ext: f.ext,
      mimeType: f.mimeType,
      size: f.size,
    }));

  /**
   * 要存、要分享的文件里有改过的外来 docx / xlsx（重新生成的，D-509）：第一次先用一句话说清哪些格式不留，
   * 点「继续」才做，点「取消」什么都不做。没改过的外来文件存的是原件的副本，不用说。
   */
  function confirmRebuilt(list: readonly DeskFile[]): Promise<boolean> {
    const kinds = new Set(
      list.filter((f) => f.source?.imported === 'rebuilt').map((f) => f.source!.kind),
    );
    if (toldRebuilt.current || kinds.size === 0) return Promise.resolve(true);
    const message = [
      ...(kinds.has('doc') ? [t(locale, 'officeRebuiltDoc')] : []),
      ...(kinds.has('table') ? [t(locale, 'officeRebuiltSheet')] : []),
    ].join('\n\n');
    return new Promise((resolve) => {
      Alert.alert(
        t(locale, 'officeRebuiltTitle'),
        message,
        [
          { text: t(locale, 'cancel'), style: 'cancel', onPress: () => resolve(false) },
          {
            text: t(locale, 'officeRebuiltContinue'),
            onPress: () => {
              toldRebuilt.current = true;
              resolve(true);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  /** 分享桌上的文件（工具栏、「完成」里的「分享」）。 */
  async function shareAll() {
    if (await confirmRebuilt(nowFiles())) await files.shareUris(items());
  }

  /** 存成用户文件；转 Excel、转 Word 的结果带着中间格式和原图，以后还能放回桌上改（D-367）。 */
  async function save() {
    const d = deskRef.current;
    if (!d) return;
    if (!(await confirmRebuilt(currentFiles(d)))) return;
    await saveDeskFiles(files, repo, d, currentFiles(d), {
      now: () => new Date(),
      newId: newAssetId,
    });
    bumpAssets();
    setSavedAt(d.current);
    setSaved(true);
  }

  /**
   * 存到手机：每次让用户在「文件」App 里选文件夹，复制进去（D-120）；取消时什么都不变。
   * 改过的外来 docx / xlsx 和保存、分享一样先说一句哪些格式不留（D-509）。
   */
  async function saveToPhone() {
    if (!(await confirmRebuilt(nowFiles()))) return;
    const done = await files.saveToFolder(items(), 'desk', true);
    if (done) setFolderSaved(done.folder);
  }

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code
          ? runErrorText(locale, code, (e as { detail?: Record<string, string> }).detail)
          : String(e),
      );
    }
  }

  /**
   * 「用原图」（D-467）：从这一页的原图上剪下 box（原图像素）那一块，存成临时文件；合上编辑时搬进桌面。
   * 认字那张图和原图大小不一定一样，按比例换算。
   */
  async function cropOriginal(page: DocPage, box: Box): Promise<string | null> {
    const current = deskRef.current;
    if (!current || !page.source) return null;
    try {
      const size = await files.imageSize(page.source);
      const kx = size.width / page.width;
      const ky = size.height / page.height;
      const x = Math.max(0, Math.round(box.x * kx));
      const y = Math.max(0, Math.round(box.y * ky));
      const crop = {
        x,
        y,
        width: Math.max(1, Math.min(size.width - x, Math.round(box.width * kx))),
        height: Math.max(1, Math.min(size.height - y, Math.round(box.height * ky))),
      };
      const out = await files.transformImage(
        page.source,
        { crop },
        { format: 'jpeg', quality: 0.9 },
        `desk-${current.id}`,
        `original-${Date.now()}.jpg`,
      );
      return out.uri;
    } catch {
      setError(t(locale, 'wordOriginalFailed'));
      return null;
    }
  }

  const systemPreview = () =>
    shown &&
    void act(() =>
      files.previewFile({
        uri: deskFileUri(files, desk, shown.path),
        mimeType: shown.mimeType,
        name: `${shown.name}.${shown.ext}`,
      }),
    );

  /**
   * 从记录的附件放上来的桌面（D-395）：「完成」每次都问「加成新附件」还是「替换原件」；取消时照常打开「完成」，
   * 记录不变。附件满了只能替换。表单已经关掉时就是普通的桌面。
   */
  function finish() {
    const back = deskReturnOf(deskId);
    const d = deskRef.current;
    const ids = back?.ids();
    if (!back || !ids || !d) return setSheet(true);
    const can = deskReturnChoices(ids, back.assetId, currentFiles(d).length);
    Alert.alert(
      t(locale, 'deskBackTitle'),
      t(locale, can.add ? 'deskBackMessage' : can.replace ? 'deskBackFull' : 'deskBackNoRoom'),
      [
        ...(can.add
          ? [
              {
                text: t(locale, 'deskBackAdd'),
                onPress: () => void act(() => giveBack(back, 'add')),
              },
            ]
          : []),
        ...(can.replace
          ? [
              {
                text: t(locale, 'deskBackReplace'),
                onPress: () => void act(() => giveBack(back, 'replace')),
              },
            ]
          : []),
        { text: t(locale, 'cancel'), style: 'cancel' as const, onPress: () => setSheet(true) },
      ],
    );
  }

  /** 桌上的文件存成用户文件交回表单（还要用户点保存），然后清掉这个桌面、回到表单。 */
  async function giveBack(back: DeskReturn, mode: DeskReturnMode) {
    const d = deskRef.current;
    if (!d) return;
    if (!(await confirmRebuilt(currentFiles(d)))) return;
    const fresh = await saveDeskFiles(files, repo, d, currentFiles(d), {
      now: () => new Date(),
      newId: newAssetId,
    });
    bumpAssets();
    // 表单在这期间关掉了：刚存的文件没人用，删掉；桌面留着。
    if (!back.deliver(mode, fresh)) {
      await deleteUserFiles(fresh, repo, files);
      return;
    }
    endDeskReturn(deskId);
    cleared.current = true;
    await clearDesk(files, deskId);
    leave();
  }

  const allImages = list.every((f) => deskKindOf(f) === 'image');
  const printable = list.every((f) => ['image', 'pdf'].includes(deskKindOf(f)));
  const env: RenderEnv = {
    config,
    palette,
    locale,
    registry,
    interactive: true,
    navigate,
    ...(locked ? { locked } : {}),
  };
  const slot = (components: typeof layout.above, id: string) =>
    components.length > 0 ? (
      <View testID={id} style={[styles.slot, { gap: palette.gap }]}>
        {components.map((c) => (
          <Item key={c.id} component={c} env={env} />
        ))}
      </View>
    ) : null;

  const toolbar = (
    <View
      style={[
        styles.toolbar,
        palette.cardStyle(palette.surface),
        {
          borderRadius: Math.min(palette.radius + 6, 32),
          margin: 0,
          padding: 0,
          marginHorizontal: 12,
          marginVertical: 8,
          ...(layout.toolbar === 'bottom' ? { marginBottom: Math.max(insets.bottom, 12) } : {}),
        },
      ]}>
      {targets.length > 1 ? (
        <Text
          testID="desk-targets"
          style={[palette.font('body', 12), styles.targets, { color: palette.caption }]}>
          {t(locale, 'deskTargets', { n: targets.length })}
        </Text>
      ) : null}
      {tools.length === 0 ? (
        <Text
          testID="desk-no-tools"
          style={[palette.font('body', 13), styles.targets, { color: palette.muted }]}>
          {t(locale, 'deskNoTools')}
        </Text>
      ) : null}
      <DeskToolbar groups={groups} palette={palette} disabled={busy !== null} onPress={press} />
    </View>
  );

  // 顶部只有一组撤销（§10 第 4 题）：编辑没合上时一步步退编辑，否则退整个版本。
  const editHistory = edit.session?.history;
  // 页面上刚改的字还没合成一步时（D-465）也能撤销。
  const editUndo = (editHistory?.past.length ?? 0) > 0 || edit.dirty;
  const editRedo = (editHistory?.future.length ?? 0) > 0;
  const showToolbar = !selecting;
  // 底部工具栏不在时（选中了东西换成编辑层、工具栏在顶部），房间最下面让出系统导航栏（三星真机，2026-10-30）。
  const bottomInset =
    (layout.toolbar !== 'bottom' || !showToolbar) && !keyboard ? insets.bottom : 0;
  const preview = !shown ? null : shown.source && edit.session !== null ? (
    edit.session === undefined ? (
      <ActivityIndicator style={styles.flex} color={palette.primary} />
    ) : edit.session.kind === 'doc' ? (
      <WordEditor
        key={edit.session.fileId}
        doc={edit.session.history.present as DocDoc}
        palette={palette}
        locale={locale}
        width={screenWidth}
        readImage={(uri) => files.readUri(uri)}
        cropOriginal={cropOriginal}
        onApply={edit.apply}
        onSelecting={onSelecting}
        onTyping={edit.typing}
      />
    ) : (
      <DeskEditor
        key={edit.session.fileId}
        doc={edit.session.history.present as TableDoc}
        palette={palette}
        locale={locale}
        width={screenWidth}
        onApply={edit.apply}
        onSelecting={onSelecting}
      />
    )
  ) : (
    // D-488：图片、PDF 的大预览放在圆角的「纸张卡片」里（和预览页一样）：外层给阴影，里层裁圆角。
    <View
      style={[styles.paper, palette.cardStyle(palette.surface), { borderRadius: palette.radius }]}>
      <View style={[styles.paperClip, { borderRadius: Math.max(0, palette.radius - 2) }]}>
        <DeskPreview
          desk={desk}
          file={shown}
          files={files}
          palette={palette}
          locale={locale}
          onSystemPreview={systemPreview}
        />
      </View>
    </View>
  );

  return (
    // Android 也要 padding：全屏页面的窗口不跟着键盘缩小，三星键盘会盖住编辑输入框（同 AskPanel）。
    // 窗口真的缩小了时，键盘不再和页面重叠，padding 是 0。
    <KeyboardAvoidingView
      testID="desk-screen"
      behavior="padding"
      style={[styles.flex, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderColor: palette.border }]}>
        <HeaderButton
          id="desk-close"
          text="‹"
          palette={palette}
          onPress={() => router.back()}
          disabled={busy !== null}
          bold
        />
        <Text
          numberOfLines={1}
          style={[palette.font('title', 17), styles.flex, { color: palette.text }]}>
          {shown ? `${shown.name}.${shown.ext}` : ''}
        </Text>
        {busy === null ? (
          <AIEntry about={{ kind: 'desk', fileKind: kind }} palette={palette} />
        ) : null}
        <HeaderButton
          id="desk-undo"
          text="↶"
          label={t(locale, 'undo')}
          palette={palette}
          onPress={() =>
            editUndo ? edit.undo() : void undo(files, desk, Date.now()).then(setDesk)
          }
          disabled={busy !== null || !(editUndo || canUndo(desk))}
        />
        <HeaderButton
          id="desk-redo"
          text="↷"
          label={t(locale, 'tableRedo')}
          palette={palette}
          onPress={() =>
            editRedo ? edit.redo() : void redo(files, desk, Date.now()).then(setDesk)
          }
          disabled={busy !== null || !(editRedo || (!edit.dirty && canRedo(desk)))}
        />
        <HeaderButton
          id="desk-done"
          text={t(locale, 'done')}
          primary
          palette={palette}
          onPress={() =>
            void edit.seal().then(() => {
              setSaved(false);
              setFolderSaved(null);
              finish();
            })
          }
          disabled={busy !== null}
          bold
        />
      </View>

      {inDraft ? null : <BannerAnchor palette={palette} />}
      {layout.toolbar === 'top' && showToolbar ? toolbar : null}
      {slot(layout.above, 'desk-above')}
      <View
        style={
          layout.preview === 'fill'
            ? styles.flex
            : { height: Math.round(screenHeight * PREVIEW_SHARE[layout.preview]) }
        }>
        {preview}
        {busy ? (
          <BusyCover
            busy={busy}
            palette={palette}
            locale={locale}
            onCancel={() => {
              signal.current.cancelled = true;
            }}
          />
        ) : null}
      </View>
      {error ? (
        <Text
          testID="desk-error"
          style={[palette.font('bodyMedium', 14), styles.error, { color: palette.danger }]}>
          {error}
        </Text>
      ) : null}
      {saved && !sheet ? (
        <Text
          testID="desk-saved"
          style={[palette.font('bodyMedium', 14), styles.error, { color: palette.caption }]}>
          {t(locale, 'resultSaved')}
        </Text>
      ) : null}
      {folderSaved && !sheet ? (
        <Text
          testID="desk-folder-saved"
          style={[palette.font('bodyMedium', 14), styles.error, { color: palette.caption }]}>
          {t(locale, 'resultFolderDone', { name: folderSaved })}
        </Text>
      ) : null}
      {layout.strip && list.length > 1 ? (
        <ScrollView
          horizontal
          testID="desk-strip"
          // 一行普通高度（横向 ScrollView 默认 flexGrow: 1，会被撑开）。
          style={styles.bar}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}>
          {list.map((f, i) => {
            const on = f === shown;
            return (
              <Pressable
                key={f.id}
                testID={`desk-file-${i}`}
                onPress={() => void edit.seal().then(() => setShownId(f.id))}
                style={[
                  styles.chip,
                  {
                    borderColor: on ? palette.primary : palette.border,
                    backgroundColor: on ? palette.primaryTint : palette.surface,
                  },
                ]}>
                <Text
                  numberOfLines={1}
                  style={[palette.font(on ? 'bodyBold' : 'body', 13), { color: palette.text }]}>
                  {`${f.name}.${f.ext}`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {slot(layout.below, 'desk-below')}
      {layout.preview === 'fill' ? null : <View style={styles.flex} />}
      {layout.toolbar === 'bottom' && showToolbar ? toolbar : null}
      {bottomInset > 0 ? <View testID="desk-bottom-inset" style={{ height: bottomInset }} /> : null}
      {/* 草稿的四个按钮不盖住工具栏：工具栏就是要看的东西。 */}
      {inDraft ? <View style={{ height: DRAFT_BAR_SPACE + insets.bottom }} /> : null}

      {panel ? (
        <AskPanel
          request={panel}
          palette={palette}
          locale={locale}
          now={new Date()}
          okLabel={t(locale, 'deskApply')}
          onAnswer={(answer) => {
            const p = panel;
            setPanel(null);
            if (answer) {
              // 密码不在参数结构里，跑的时候执行器会再问（D-194）。
              const params = { ...p.params, ...answer };
              for (const f of p.action.fields) if (f.kind === 'secret') delete params[f.key];
              applyTool(p.action.id, params);
            }
          }}
        />
      ) : null}
      {host.elements}

      {text !== null ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setText(null)}>
          <View style={styles.backdrop}>
            <View
              style={[
                styles.dialog,
                { backgroundColor: palette.surface, borderRadius: palette.radius },
              ]}>
              <Text style={[palette.font('title', 18), { color: palette.text }]}>
                {t(locale, 'deskTextTitle')}
              </Text>
              <ScrollView style={styles.textScroll}>
                <Text
                  selectable
                  testID="desk-text"
                  style={[palette.font('body', 15), { color: palette.text }]}>
                  {text}
                </Text>
              </ScrollView>
              <Text style={[palette.font('body', 13), { color: palette.caption }]}>
                {t(locale, 'resultTextNote')}
              </Text>
              <View style={styles.actions}>
                <HeaderButton
                  id="desk-text-copy"
                  text={t(locale, 'resultCopy')}
                  palette={palette}
                  onPress={() => void act(() => files.copyText(text))}
                />
                <HeaderButton
                  id="desk-text-close"
                  text={t(locale, 'close')}
                  palette={palette}
                  onPress={() => setText(null)}
                  bold
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {sheet ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSheet(false)}>
          <View style={styles.sheetRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setSheet(false)}
              testID="desk-sheet-backdrop"
            />
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  paddingBottom: insets.bottom + 8,
                },
              ]}>
              <SheetRow
                id="desk-save"
                label={t(locale, saved ? 'resultSaved' : 'resultSave')}
                palette={palette}
                disabled={saved}
                onPress={() => void act(save)}
              />
              <SheetRow
                id="desk-folder"
                label={
                  folderSaved
                    ? t(locale, 'resultFolderDone', { name: folderSaved })
                    : t(locale, 'resultFolder')
                }
                palette={palette}
                onPress={() => void act(saveToPhone)}
              />
              <SheetRow
                id="desk-share"
                label={t(locale, 'resultShare')}
                palette={palette}
                onPress={() => void act(shareAll)}
              />
              {allImages ? (
                <SheetRow
                  id="desk-photos"
                  label={t(locale, 'resultPhotos')}
                  palette={palette}
                  onPress={() => void act(() => files.saveToPhotos(items().map((i) => i.uri)))}
                />
              ) : null}
              {printable ? (
                <SheetRow
                  id="desk-print"
                  label={t(locale, 'resultPrint')}
                  palette={palette}
                  onPress={() =>
                    void act(async () => {
                      for (const item of items()) await files.print(item);
                    })
                  }
                />
              ) : null}
              <SheetRow
                id="desk-sheet-preview"
                label={t(locale, 'deskSystemPreview')}
                palette={palette}
                onPress={() => {
                  setSheet(false);
                  systemPreview();
                }}
              />
              <SheetRow
                id="desk-sheet-cancel"
                label={t(locale, 'cancel')}
                palette={palette}
                onPress={() => setSheet(false)}
              />
            </View>
          </View>
        </Modal>
      ) : null}
      {inDraft ? (
        <>
          <DraftBar palette={palette} bottom={insets.bottom + 12} />
          <Toast palette={palette} bottom={insets.bottom + DRAFT_BAR_SPACE} />
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * 顶栏的按钮（D-488）：返回和撤销、重做是浅色圆底的小按钮，「完成」是主色实心的药丸（主操作）。
 * text 是显示的字；disabled 时变淡。
 */
function HeaderButton({
  id,
  text,
  palette,
  onPress,
  disabled = false,
  bold = false,
  primary = false,
  label,
}: {
  id: string;
  text: string;
  palette: Palette;
  onPress: () => void;
  disabled?: boolean;
  bold?: boolean;
  /** 主操作：主色实心。 */
  primary?: boolean;
  /** 读屏的名字（text 是符号时用）。 */
  label?: string;
}) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
      hitSlop={6}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerButton,
        { backgroundColor: primary ? palette.primary : palette.primaryTint },
        { opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}>
      <Text
        style={[
          palette.font(bold || primary ? 'bodyBold' : 'bodyMedium', primary ? 15 : 16),
          { color: primary ? palette.onPrimary : palette.primaryText },
        ]}>
        {text}
      </Text>
    </Pressable>
  );
}

function SheetRow({
  id,
  label,
  palette,
  onPress,
  danger,
  disabled,
}: {
  id: string;
  label: string;
  palette: Palette;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetRow, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}>
      <Text style={[palette.font('body', 16), { color: danger ? palette.danger : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 跑工具时盖在预览上：这一步的名字、进度、停止。 */
function BusyCover({
  busy,
  palette,
  locale,
  onCancel,
}: {
  busy: Busy;
  palette: Palette;
  locale: 'en' | 'zh' | 'fr';
  onCancel: () => void;
}) {
  const amount =
    busy.total && busy.total > 0
      ? ` · ${t(locale, busy.unit === 'percent' ? 'runPercent' : 'runProgress', {
          done: busy.done ?? 0,
          total: busy.total,
        })}`
      : '';
  return (
    <View testID="desk-busy" style={[StyleSheet.absoluteFill, styles.cover]}>
      <View
        style={[
          styles.busyCard,
          { backgroundColor: palette.surface, borderRadius: palette.radius },
        ]}>
        <ActivityIndicator color={palette.primary} />
        <Text style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
          {`${busy.label}${amount}`}
        </Text>
        <Button
          palette={palette}
          variant="outline"
          testID="desk-cancel"
          label={t(locale, 'runCancel')}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    // 和页面栈的导航栏（预览页用的）一样高，从预览页进桌面时顶栏不跳。
    minHeight: Platform.OS === 'ios' ? 44 : 56,
  },
  headerButton: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: { marginHorizontal: 12, marginVertical: 8, overflow: 'hidden' },
  paper: { flex: 1, marginHorizontal: 12, marginTop: 2 },
  paperClip: { flex: 1, overflow: 'hidden' },
  targets: { paddingHorizontal: 14, paddingTop: 6 },
  slot: { paddingHorizontal: 12, paddingVertical: 8 },
  error: { paddingHorizontal: 16, paddingVertical: 6 },
  bar: { flexGrow: 0, flexShrink: 0 },
  strip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: 'center',
    maxWidth: 200,
  },
  cover: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A242055' },
  busyCard: { padding: 20, gap: 12, alignItems: 'center', minWidth: 220 },
  backdrop: { flex: 1, backgroundColor: '#2A242080', justifyContent: 'center', padding: 24 },
  dialog: { padding: 22, gap: 14, maxHeight: '100%' },
  textScroll: { flexGrow: 0, flexShrink: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheetRow: { minHeight: 48, justifyContent: 'center' },
});
