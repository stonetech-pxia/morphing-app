import {
  deskKindOf,
  quickActionsOf,
  sharedSizeProblem,
  type DeskFile,
  type IconName,
  type Workflow,
} from '@morph/core';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocDoc } from '@morph/tool-office';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeskPreview } from '../desk/DeskPreview';
import { placeAssetOnDesk, savedWordDoc } from '../desk/saved-source';
import { loadDesk, placeOnDesk } from '../desk/store';
import { runErrorText, t, type StringKey } from '../i18n';
import { useFileBundleOffer } from '../packs/FileBundleOffer';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Card, SectionLabel } from '../renderer/ui';
import { baseName, extOf, mimeOf } from '../runtime/actions/helpers';
import { AIEntryButton } from '../shell/ai-entry';
import type { SucceededRuns } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { releaseShare, useIncoming } from './incoming';
import { RecordChooser, useSaveAsRecord } from './RecordChooser';
import { shareRecommendations } from './recommendations';

const now = () => Date.now();

/** 一个快捷操作在「更多」里归哪一类：先看有没有转格式，再看整理页面，再看识别、压缩这类处理。 */
function previewCategory(wf: Workflow): 'convert' | 'process' | 'manage' | 'quick' {
  const actions = wf.steps.map((st) => st.action).filter((id) => !/^(in|out)\./.test(id));
  const any = (re: RegExp) => actions.some((id) => re.test(id));
  if (any(/\.(to[A-Z]\w*|from[A-Z]\w*|convert)$/)) return 'convert';
  if (
    any(/\.(merge|split|pages|selectPages|rotate|protect|unlock|sign|fillForm|pageNumbers|stamp)$/)
  )
    return 'manage';
  if (
    any(
      /^(ocr|translate|scan)\.|\.(compress|resize|adjust|redact|removeBackground|extractText|enhance)$/,
    )
  )
    return 'process';
  return 'quick';
}

type Panel = 'share' | 'record' | 'more';

/**
 * 一份文件的预览页（D-457）：收到一份文件（分享、选择器、扫描后继续）时直接打开，取代收件页面。
 * 它是一个容器（D-428）：只读地显示这一份文件，进来什么都不跑；底下的按钮只引用工具，点了才运行或打开——
 * 编辑 PDF 打开桌面、转 Word 运行内设的快捷操作（做完直接进 Word，返回就舍弃）、存记录和快捷操作、工具在弹出的面板里。
 * 都是 push，返回回到这一页，收到的文件还在（运行页面带 keep，不释放这一批）。
 * 文件只在本机显示，不发给 AI。由内核提供，AI 不能修改。
 *
 * `index` 有值时是从多个文件的收件页面点进来看其中一个：只看，不放工具，也不管这一批的释放。
 */
export function FilePreviewScreen({ index }: { index?: number }) {
  const { repo, files, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const share = useIncoming((s) => s.share);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const member = index !== undefined;
  const file = share?.files[index ?? 0];
  // 分享或打开文件后，一次问完文件处理包（D-456）；问过就不再问。多个文件时收件页面已经问过。
  const bundle = useFileBundleOffer(palette, locale);
  const fromOutside = !member && !!share && share.files.length > 0 && share.source !== 'result';
  useEffect(() => {
    if (fromOutside) bundle.offer();
    // 每批文件只看一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share?.id]);

  // AI 做好新的快捷操作后回到这里（D-129）：新的排在最前面、标「刚做好」，面板直接打开让用户看到。
  const { made } = useLocalSearchParams<{ made?: string }>();
  const [panel, setPanel] = useState<Panel | null>(made && !member ? 'more' : null);
  const [busy, setBusy] = useState(false);
  // 这一页放上桌的那个桌面：返回再点「编辑」继续同一个，不再每次复制一份。
  const [deskId, setDeskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const record = useSaveAsRecord(share?.files ?? [], () => setPanel(null));
  // 读到使用次数之前不排推荐，同收件页面。
  const [usage, setUsage] = useState<SucceededRuns | null>(null);
  useEffect(() => {
    if (member) return;
    let alive = true;
    void repo
      .countSucceededRuns()
      .then((counts) => alive && setUsage(counts))
      .catch(() => alive && setUsage(new Map()));
    return () => {
      alive = false;
    };
  }, [repo, share?.id, member]);
  // 离开这一页就释放收到的这一批（D-116）；运行页面和桌面是 push 上去的，这一页还在，不会提前释放。
  // 交给 AI 时为 true：AI 的修改应用后会再打开一个预览页带着这一批，这里不删文件（同收件页面）。
  const handed = useRef(false);
  useFocusEffect(
    useCallback(() => {
      handed.current = false;
    }, []),
  );
  useEffect(() => {
    const id = share?.id;
    handed.current = false;
    return () => {
      if (!member && !handed.current && id !== undefined) void releaseShare(files, id);
    };
  }, [files, share?.id, member]);

  // 存过的 Word（D-470）：按它的中间格式显示，和编辑页一样。
  const [wordDoc, setWordDoc] = useState<DocDoc | null>(null);
  const assetId = file?.assetId;
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    void repo
      .getAsset(assetId)
      .then((asset) => (asset ? savedWordDoc(files, asset) : null))
      .then((doc) => alive && setWordDoc(doc))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [repo, files, assetId]);

  const info = useMemo(
    () =>
      file
        ? { name: file.name, mimeType: mimeOf(file.name, file.mimeType), size: file.size }
        : null,
    [file],
  );
  const shown = useMemo<DeskFile | null>(() => {
    if (!file || !info) return null;
    const ext = extOf(file.name);
    return {
      id: 'preview',
      name: baseName(file.name) || file.name,
      ext,
      mimeType: info.mimeType,
      size: file.size ?? 0,
      path: '',
      ...(file.width && file.height ? { width: file.width, height: file.height } : {}),
    };
  }, [file, info]);

  if (!share || !file || !info || !shown) {
    return (
      <View style={[styles.empty, { padding: palette.pad }]} testID="share-screen">
        <Stack.Screen options={{ title: '' }} />
        <Text style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'shareGone')}
        </Text>
      </View>
    );
  }

  const kind = deskKindOf(shown);
  const sizeProblem = sharedSizeProblem([info]);
  const wordId = kind === 'pdf' ? 'pdf-doc-word' : kind === 'image' ? 'image-doc-word' : null;

  const systemPreview = async () => {
    setError(null);
    try {
      await files.previewFile({ uri: file.uri, mimeType: info.mimeType, name: file.name });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code ? runErrorText(locale, code) : String(e));
    }
  };

  /** 放到桌上改：第一次复制一份工作副本，原件和收到的这一批不动。返回回到这一页。 */
  async function edit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const existing = deskId ? await loadDesk(files, deskId) : null;
      // 文档库里存过的 xlsx / docx 带着中间格式（D-367）：放上桌还能改（2026-11-06 三星：存了 Word 再从最近文件打开、
      // 点编辑，只剩「这个文件显示不了」，D-470）。
      const asset =
        !existing && file!.assetId && /\.(xlsx|docx)$/i.test(file!.name)
          ? await repo.getAsset(file!.assetId)
          : null;
      const desk =
        existing ??
        (asset ? await placeAssetOnDesk(files, asset, now()) : null) ??
        (await placeOnDesk(files, [file!], now()));
      setDeskId(desk.id);
      router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code
          ? runErrorText(locale, code, (e as { detail?: Record<string, string> }).detail)
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  /** 运行一个快捷操作：用这一份文件做第一步的输入；返回回到这一页。 */
  function run(workflowId: string, then?: 'desk') {
    setPanel(null);
    router.push({
      pathname: '/run/[workflowId]',
      params: { workflowId, shared: String(share!.id), keep: '1', ...(then ? { then } : {}) },
    });
  }

  function askAI() {
    handed.current = true;
    router.push({ pathname: '/change', params: { shared: String(share!.id) } });
  }

  const { all } = shareRecommendations(quickActionsOf(config), [info], usage ?? new Map(), locale);
  const fitting = usage === null ? [] : all.filter(({ fit }) => fit.ok);

  const button = (
    id: string,
    icon: IconName,
    label: string,
    onPress: () => void,
    disabled?: boolean,
  ) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={22} color={palette.primaryText} />
      <Text
        numberOfLines={2}
        style={[palette.font('body', 11), styles.toolLabel, { color: palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );

  /** 分享、存到文件夹、存到相册、打印、系统预览：对这份文件做的事，每次都是用户点了才做（D-457）。 */
  const out = { uri: file.uri, name: shown.name, ext: shown.ext, mimeType: info.mimeType };
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setPanel(null);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPanel(null);
      setError(code ? runErrorText(locale, code) : String(e));
    }
  }
  const shareRow = (id: string, label: string, onPress: () => void) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.6 }]}>
      <Text style={[palette.font('body', 16), { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
  const shareRows = () => (
    <>
      {shareRow(
        'preview-share-send',
        t(locale, 'previewShareSend'),
        () => void act(() => files.shareUris([out])),
      )}
      {shareRow(
        'preview-share-folder',
        t(locale, 'resultFolder'),
        () => void act(() => files.saveToFolder([out], 'preview', true)),
      )}
      {kind === 'image'
        ? shareRow(
            'preview-share-photos',
            t(locale, 'resultPhotos'),
            () => void act(() => files.saveToPhotos([file.uri])),
          )
        : null}
      {kind === 'image' || kind === 'pdf'
        ? shareRow(
            'preview-share-print',
            t(locale, 'resultPrint'),
            () => void act(() => files.print(out)),
          )
        : null}
      {shareRow(
        'preview-share-system',
        t(locale, 'deskSystemPreview'),
        () => void act(systemPreview),
      )}
    </>
  );

  /** 「更多」里的快捷操作和工具，按做的事分成几类，一行四个（和别的文档 App 的「更多」一样）。 */
  const moreSections = () => {
    const sections: { id: string; title: StringKey; list: Workflow[] }[] = [
      { id: 'convert', title: 'previewCatConvert', list: [] },
      { id: 'process', title: 'previewCatProcess', list: [] },
      { id: 'manage', title: 'previewCatManage', list: [] },
      { id: 'quick', title: 'previewQuick', list: [] },
    ];
    for (const { wf } of fitting) sections.find((x) => x.id === previewCategory(wf))!.list.push(wf);
    const shown = sections.filter((x) => x.list.length > 0);
    if (shown.length === 0) {
      return (
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'previewNothing')}
        </Text>
      );
    }
    return shown.map((x) => (
      <View key={x.id} testID={`preview-more-${x.id}`}>
        <SectionLabel palette={palette}>{t(locale, x.title)}</SectionLabel>
        <View style={styles.grid}>
          {x.list.map((wf) => (
            <View key={wf.id} style={styles.cell} testID={`share-workflow-${wf.id}`}>
              <Pressable
                testID={`share-run-${wf.id}`}
                accessibilityRole="button"
                accessibilityLabel={wf.name}
                onPress={() => run(wf.id)}
                style={({ pressed }) => [styles.cellPress, pressed && { opacity: 0.6 }]}>
                <View style={[styles.cellIcon, { backgroundColor: palette.primaryTint }]}>
                  <Icon name={wf.icon ?? 'workflow'} size={24} color={palette.primaryText} />
                </View>
                <Text
                  numberOfLines={2}
                  style={[palette.font('body', 12), styles.toolLabel, { color: palette.text }]}>
                  {wf.name}
                  {made && wf.id === made && !wf.package
                    ? t(locale, 'ShareScreen_just_made_ed6c1')
                    : ''}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </View>
    ));
  };

  return (
    <View style={styles.flex} testID="share-screen">
      <Stack.Screen
        options={{
          title: file.name,
          ...(member
            ? {}
            : {
                headerRight: () => (
                  <AIEntryButton palette={palette} locale={locale} onPress={askAI} />
                ),
              }),
        }}
      />
      <View style={styles.flex} testID="file-preview">
        <DeskPreview
          uri={file.uri}
          file={shown}
          files={files}
          palette={palette}
          locale={locale}
          onSystemPreview={() => void systemPreview()}
          wordDoc={wordDoc}
        />
      </View>
      {error || record.error ? (
        <Text
          testID="share-preview-error"
          style={[palette.font('bodyMedium', 14), styles.error, { color: palette.danger }]}>
          {error ?? record.error}
        </Text>
      ) : null}
      {member ? null : sizeProblem ? (
        <Text
          testID="share-too-large"
          style={[
            palette.font('bodyMedium', 15),
            styles.error,
            { color: palette.danger, paddingBottom: insets.bottom + 12 },
          ]}>
          {runErrorText(locale, sizeProblem.code, sizeProblem.detail)}
        </Text>
      ) : (
        <View
          testID="preview-bar"
          style={[
            styles.bar,
            {
              borderColor: palette.border,
              paddingBottom: insets.bottom + 6,
            },
          ]}>
          {button(
            'preview-edit',
            'signature',
            t(locale, kind === 'pdf' ? 'previewEditPdf' : 'previewEdit'),
            () => void edit(),
            busy,
          )}
          {wordId
            ? button('preview-word', 'text', t(locale, 'previewToWord'), () => run(wordId, 'desk'))
            : null}
          {button('preview-share', 'share', t(locale, 'previewShare'), () => setPanel('share'))}
          {button('preview-record', 'note', t(locale, 'previewRecord'), () => setPanel('record'))}
          {button('preview-more', 'apps', t(locale, 'previewMore'), () => setPanel('more'))}
        </View>
      )}
      {panel ? (
        <Modal visible transparent animationType="none" onRequestClose={() => setPanel(null)}>
          <Pressable
            style={styles.backdrop}
            testID="preview-panel-backdrop"
            onPress={() => setPanel(null)}
          />
          <View
            testID={`preview-panel-${panel}`}
            style={[
              styles.panel,
              { backgroundColor: palette.surface, paddingBottom: insets.bottom + 12 },
            ]}>
            <Text style={[palette.font('title', 17), { color: palette.text }]}>
              {t(
                locale,
                panel === 'record'
                  ? 'previewRecord'
                  : panel === 'share'
                    ? 'previewShare'
                    : 'previewMore',
              )}
            </Text>
            <ScrollView style={styles.panelBody}>
              {panel === 'record' ? (
                <Card palette={palette}>
                  <RecordChooser
                    count={share.files.length}
                    files={share.files}
                    placing={record.placing}
                    palette={palette}
                    locale={locale}
                    onChoose={(choice) => void record.saveAsRecord(choice)}
                  />
                </Card>
              ) : panel === 'share' ? (
                shareRows()
              ) : (
                moreSections()
              )}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
      {bundle.element}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  empty: { flex: 1, gap: 16, justifyContent: 'center' },
  error: { paddingHorizontal: 16, paddingVertical: 6 },
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  // 和桌面的工具栏一样（DeskToolbar）：22 的图标用主色，11 的文字。
  tool: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 2 },
  toolLabel: { textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    maxHeight: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 8,
  },
  panelBody: { flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '25%', paddingVertical: 6 },
  cellPress: { alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  cellIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRow: { gap: 2, minHeight: 56, justifyContent: 'center', paddingVertical: 6 },
});
