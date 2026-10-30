import {
  calendarOf,
  canRedo,
  canUndo,
  currentFiles,
  deskKindOf,
  deskToolWorkflow,
  deskToolbar,
  initialParams,
  localize,
  resolveDeskLayout,
  type AskRequest,
  type Desk,
  type DeskFile,
  type DeskStep,
  type RunEvent,
  type Workflow,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { usePalette, type Palette } from '../renderer/theme';
import { Button } from '../renderer/ui';
import { AskPanel } from '../run/AskPanel';
import { saveItems } from '../runtime/actions/io';
import { newAssetId, startRun } from '../runtime/runner';
import { useShellEnv } from '../shell/Shell';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { DeskPreview } from './DeskPreview';
import { DeskToolbar, toolEntries, type ToolEntry } from './DeskToolbar';
import { clearDesk, commitRun, deskFileUri, deskPicked, loadDesk, redo, undo } from './store';
import { useRunHost } from './useRunHost';

// 文件房间（file-room DESIGN §4，D-339）：中间是桌上文件的大预览，底部（或顶部）一排工具。
// 用一个工具或一个快捷操作，结果成为桌上的新版本，顶部能撤销、重做；「完成」里保存、分享或清空桌面。
// 布局来自配置（WorkspaceConfig.desk，D-337），没写的用默认（预览居中、工具栏在底部）。
// 工具作用到桌上和正在看的这份同一种的全部文件（多选在 R6）。文件只在本机，AI 看不到。

/** 预览占屏幕高度的比例（布局 preview 不是 fill 时）。 */
const PREVIEW_SHARE = { large: 0.62, medium: 0.45 } as const;

interface Busy {
  label: string;
  done?: number;
  total?: number;
  unit?: 'percent';
}

export function DeskScreen({ deskId }: { deskId: string }) {
  const { repo, files, registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config!);
  const revisionId = useWorkspace((s) => s.head!.id);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const bumpRecords = useWorkspace((s) => s.bumpRecords);
  const palette = usePalette(config.theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const host = useRunHost(palette, locale);
  const { navigate, locked } = useShellEnv();

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
  const signal = useRef({ cancelled: false });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void loadDesk(files, deskId).then(
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

  const layout = useMemo(() => resolveDeskLayout(config.desk), [config.desk]);
  const list = desk && desk !== 'gone' ? currentFiles(desk) : [];
  const shown = list.find((f) => f.id === shownId) ?? list[0] ?? null;
  const kind = shown ? deskKindOf(shown) : 'other';
  // 工具作用到和正在看的这份同一种的全部文件（例如 5 张照片一起转成一个 PDF）。
  const targets = shown ? list.filter((f) => deskKindOf(f) === kind) : [];
  const groups = useMemo(
    () =>
      toolEntries(
        deskToolbar(kind, layout.tools, registry, config.workflows, locale),
        targets,
        registry,
        config.workflows,
        locale,
      ),
    // targets 跟着 list 和 kind 变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, layout.tools, registry, config.workflows, locale, list],
  );

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
    localize(registry.actions.get(step.action)?.label, locale) ?? step.action;

  async function run(workflow: Workflow, by: DeskStep, on: readonly DeskFile[]) {
    const current = deskRef.current;
    if (!current || busy) return;
    setError(null);
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
      collections: config.collections,
      calendar: calendarOf({ calendar: config.calendar }),
      packs: host.packs ?? null,
      ...(host.askParams ? { askParams: host.askParams } : {}),
      ...(host.ensurePack ? { ensurePack: host.ensurePack } : {}),
      ...(host.ensurePacks ? { ensurePacks: host.ensurePacks } : {}),
      signal: signal.current,
      onEvent,
      incoming: deskPicked(files, current, on),
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
          Date.now(),
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

  function press(entry: ToolEntry) {
    if (entry.workflow) {
      void run(entry.workflow, { kind: 'workflow', workflowId: entry.workflow.id }, targets);
      return;
    }
    const item = entry.item;
    if (!('action' in item)) return;
    const action = registry.actions.get(item.action)!;
    const preset = item.preset ? action.presets?.find((p) => p.id === item.preset) : undefined;
    const params = preset ? { ...preset.values } : initialParams(action);
    const keys = action.fields.filter((f) => f.kind !== 'secret').map((f) => f.key);
    // 有参数、又不是要亲手操作的工具：先弹出参数面板，点「应用」才跑（跑完才知道结果，D-339）。
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
    applyTool(action.id, params);
  }

  function applyTool(actionId: string, params: Record<string, unknown>) {
    const workflow = deskToolWorkflow(actionId, targets, registry, params);
    if (!workflow) return;
    void run(workflow, { kind: 'action', action: actionId }, targets);
  }

  const items = () =>
    list.map((f) => ({
      uri: deskFileUri(files, desk, f.path),
      name: f.name,
      ext: f.ext,
      mimeType: f.mimeType,
      size: f.size,
    }));

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

  const systemPreview = () =>
    shown &&
    void act(() =>
      files.previewFile({
        uri: deskFileUri(files, desk, shown.path),
        mimeType: shown.mimeType,
        name: `${shown.name}.${shown.ext}`,
      }),
    );

  function confirmClear() {
    Alert.alert(t(locale, 'deskClearTitle'), t(locale, 'deskClearMessage'), [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'deskClear'),
        style: 'destructive',
        onPress: () =>
          void act(async () => {
            await clearDesk(files, deskId);
            setSheet(false);
            router.back();
          }),
      },
    ]);
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

  const headerButton = (
    id: string,
    text: string,
    onPress: () => void,
    disabled = false,
    bold = false,
  ) => (
    <Pressable
      testID={id}
      accessibilityRole="button"
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}>
      <Text style={[palette.font(bold ? 'bodyBold' : 'body', 16), { color: palette.primaryText }]}>
        {text}
      </Text>
    </Pressable>
  );

  const toolbar = (
    <View
      style={[
        styles.toolbar,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          ...(layout.toolbar === 'bottom' ? { paddingBottom: insets.bottom } : {}),
        },
      ]}>
      {targets.length > 1 ? (
        <Text
          testID="desk-targets"
          style={[palette.font('body', 12), styles.targets, { color: palette.caption }]}>
          {t(locale, 'deskTargets', { n: targets.length })}
        </Text>
      ) : null}
      {groups.length > 0 ? (
        <DeskToolbar groups={groups} palette={palette} disabled={busy !== null} onPress={press} />
      ) : (
        <Text
          testID="desk-no-tools"
          style={[palette.font('body', 13), styles.targets, { color: palette.muted }]}>
          {t(locale, 'deskNoTools')}
        </Text>
      )}
    </View>
  );

  return (
    <View
      testID="desk-screen"
      style={[styles.flex, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderColor: palette.border }]}>
        {headerButton('desk-close', '‹', () => router.back(), busy !== null, true)}
        <Text
          numberOfLines={1}
          style={[palette.font('title', 16), styles.flex, { color: palette.text }]}>
          {shown ? `${shown.name}.${shown.ext}` : ''}
        </Text>
        {headerButton(
          'desk-undo',
          t(locale, 'undo'),
          () => void undo(files, desk, Date.now()).then(setDesk),
          busy !== null || !canUndo(desk),
        )}
        {headerButton(
          'desk-redo',
          t(locale, 'tableRedo'),
          () => void redo(files, desk, Date.now()).then(setDesk),
          busy !== null || !canRedo(desk),
        )}
        {headerButton(
          'desk-done',
          t(locale, 'done'),
          () => {
            setSaved(false);
            setSheet(true);
          },
          busy !== null,
          true,
        )}
      </View>

      {layout.toolbar === 'top' ? toolbar : null}
      {slot(layout.above, 'desk-above')}
      <View
        style={
          layout.preview === 'fill'
            ? styles.flex
            : { height: Math.round(screenHeight * PREVIEW_SHARE[layout.preview]) }
        }>
        {shown ? (
          <DeskPreview
            desk={desk}
            file={shown}
            files={files}
            palette={palette}
            locale={locale}
            onSystemPreview={systemPreview}
          />
        ) : null}
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
      {layout.strip && list.length > 1 ? (
        <ScrollView
          horizontal
          testID="desk-strip"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}>
          {list.map((f, i) => {
            const on = f === shown;
            return (
              <Pressable
                key={f.id}
                testID={`desk-file-${i}`}
                onPress={() => setShownId(f.id)}
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
      {layout.toolbar === 'bottom' ? toolbar : null}

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
                {headerButton(
                  'desk-text-copy',
                  t(locale, 'resultCopy'),
                  () => void act(() => files.copyText(text)),
                )}
                {headerButton(
                  'desk-text-close',
                  t(locale, 'close'),
                  () => setText(null),
                  false,
                  true,
                )}
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
                onPress={() =>
                  void act(async () => {
                    await saveItems({ files, repo, grantee: 'desk' }, items(), {
                      now: () => new Date(),
                      newId: newAssetId,
                    });
                    bumpAssets();
                    setSaved(true);
                  })
                }
              />
              <SheetRow
                id="desk-share"
                label={t(locale, 'resultShare')}
                palette={palette}
                onPress={() => void act(() => files.shareUris(items()))}
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
                id="desk-leave"
                label={t(locale, 'deskLeave')}
                palette={palette}
                onPress={() => {
                  setSheet(false);
                  router.back();
                }}
              />
              <SheetRow
                id="desk-clear"
                label={t(locale, 'deskClear')}
                palette={palette}
                danger
                onPress={confirmClear}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
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
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  targets: { paddingHorizontal: 14, paddingTop: 6 },
  slot: { paddingHorizontal: 12, paddingVertical: 8 },
  error: { paddingHorizontal: 16, paddingVertical: 6 },
  strip: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
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
