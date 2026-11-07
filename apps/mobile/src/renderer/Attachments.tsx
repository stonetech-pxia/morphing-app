import {
  MAX_ATTACHMENTS,
  MEDIA_LIMITS,
  RunError,
  attachmentIds,
  type Collection,
  type DataRecord,
} from '@morph/core';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { placeAssetOnDesk } from '../desk/saved-source';
import { placeOnDesk } from '../desk/store';
import { runErrorText, t, type StringKey } from '../i18n';
import { FileViewer, type ViewerItem } from '../share/FileViewer';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { applyDeskReturn, holdDeskReturn } from './attachment-desk';
import type { RenderEnv } from './components';
import { Icon } from './Icon';
import {
  importUserFiles,
  type FilesImport,
  type ImportProblem,
  type SlotSource,
} from './slot-file';
import type { Palette } from './theme';

// 附件字段（D-187、D-263）：值是一组 Morph 的文件 ID。文件名只在本机显示，不进配置，也不发给 AI。

/** 读一组用户文件。还没读到的是 undefined，不在这台设备上的（已删除）是 null。 */
export function useAssets(ids: readonly string[]): Map<string, AssetRecord | null> {
  const { repo } = useWorkspaceContext();
  const key = ids.join(',');
  const [loaded, setLoaded] = useState<{ key: string; assets: Map<string, AssetRecord | null> }>({
    key: '',
    assets: new Map(),
  });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void Promise.all(key.split(',').map((id) => repo.getAsset(id))).then((list) => {
      if (alive)
        setLoaded({ key, assets: new Map(key.split(',').map((id, i) => [id, list[i] ?? null])) });
    });
    return () => {
      alive = false;
    };
  }, [repo, key]);
  return loaded.key === key ? loaded.assets : new Map();
}

/** 照片和视频在 App 里全屏左右翻看（和收件页面一样，D-238）；别的文件交给系统预览。 */
const inViewer = (a: AssetRecord) =>
  a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/');

/** Morph 保存的全部用户文件（文件 ID → 文件），文件有增删时重新读。列表一次读完，不逐条查。 */
export function useAssetIndex(): Map<string, AssetRecord> | null {
  const { repo } = useWorkspaceContext();
  const version = useWorkspace((s) => s.assetsVersion);
  const [index, setIndex] = useState<Map<string, AssetRecord> | null>(null);
  useEffect(() => {
    let alive = true;
    void repo.listAssets().then((all) => alive && setIndex(new Map(all.map((a) => [a.id, a]))));
    return () => {
      alive = false;
    };
  }, [repo, version]);
  return index;
}

/** 一条记录附件里的第一张图片（按字段顺序、再按文件顺序）；没有时为 null。 */
export function firstImage(
  record: DataRecord,
  collection: Collection,
  index: ReadonlyMap<string, AssetRecord>,
): AssetRecord | null {
  for (const f of collection.fields) {
    if (f.type !== 'file') continue;
    for (const id of attachmentIds(record.values[f.id])) {
      const a = index.get(id);
      if (a?.mimeType.startsWith('image/')) return a;
    }
  }
  return null;
}

/**
 * 缩略图：expo-image 按显示的大小解码（allowDownscaling，Android 的 Glide 解码时就缩小），
 * 几千万像素的照片也不会整张读进内存。
 */
export function AttachmentThumb({
  asset,
  size,
  radius,
  testID,
}: {
  asset: AssetRecord;
  size: number;
  radius: number;
  testID?: string;
}) {
  const { files } = useWorkspaceContext();
  return (
    <Image
      testID={testID}
      source={{ uri: files.fileUri(asset.path) }}
      contentFit="cover"
      allowDownscaling
      recyclingKey={asset.id}
      style={{ width: size, height: size, borderRadius: radius }}
    />
  );
}

export const IMPORT_PROBLEMS: Record<ImportProblem, StringKey> = {
  tooLarge: 'fileSlotTooLarge',
  noSpace: 'fileSlotNoSpace',
  copyFailed: 'fileSlotCopyFailed',
};

/**
 * 从选好的地方（拍照、相册、「文件」）选，选好的（最多 max 个，由 pick 限制）复制进 App（和文件入口一样，slot-file.ts）。
 * 返回存好的文件 ID；取消时为空。出了问题会提示，已经存好的照样返回。
 * 问从哪里选的是下面的 SourceChoice：不用系统弹窗，因为安卓的系统弹窗最多三个按钮，「取消」会被丢掉。
 */
async function importChosen(
  locale: RenderEnv['locale'],
  title: string,
  pick: (source: SlotSource) => Promise<FilesImport>,
  source: SlotSource,
): Promise<string[]> {
  let result: FilesImport;
  try {
    result = await pick(source);
  } catch (e) {
    // 没有相机、没给权限。
    Alert.alert(
      title,
      e instanceof RunError
        ? runErrorText(locale, e.code, e.detail)
        : t(locale, 'fileSlotCopyFailed'),
    );
    return [];
  }
  if (result.kind === 'cancelled') return [];
  if (result.problem)
    Alert.alert(
      title,
      t(locale, IMPORT_PROBLEMS[result.problem], {
        gb: MEDIA_LIMITS.maxFileBytes / 1024 / 1024 / 1024,
      }),
    );
  return result.assetIds;
}

/** 问从哪里选：拍照、相册、「文件」和「取消」，点空白处也取消。 */
function SourceChoice({
  title,
  palette,
  locale,
  onChoose,
  onCancel,
}: {
  title: string;
  palette: Palette;
  locale: RenderEnv['locale'];
  onChoose: (source: SlotSource) => void;
  onCancel: () => void;
}) {
  const option = (id: string, label: StringKey, source: SlotSource) => (
    <Pressable
      key={id}
      testID={`attachment-source-${id}`}
      accessibilityRole="button"
      onPress={() => onChoose(source)}
      style={styles.option}>
      <Text style={[palette.font('bodyMedium', 16), { color: palette.text }]}>
        {t(locale, label)}
      </Text>
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        testID="attachment-source-backdrop"
        style={styles.backdrop}
        onPress={onCancel}
        accessibilityLabel={t(locale, 'cancel')}
      />
      <View
        testID="attachment-source"
        style={[styles.sheet, { backgroundColor: palette.surface, borderRadius: palette.radius }]}>
        <Text style={[palette.font('title', 17), { color: palette.text }]}>{title}</Text>
        {option('camera', 'attachmentTakePhoto', 'camera')}
        {option('photos', 'fileSlotFromPhotos', 'photos')}
        {option('files', 'fileSlotFromFiles', 'files')}
        <Pressable
          testID="attachment-source-cancel"
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.option}>
          <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
            {t(locale, 'cancel')}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/**
 * 记录页给表单里新建的用户文件（D-395：桌上改好交回来的）：没保存就离开时记录页删掉没用上的，
 * 和收件页面复制来的副本一样（D-392）。只有记录页提供；没有时不能把附件放到桌上。
 */
export const FormFilesContext = createContext<{ hold(ids: readonly string[]): void } | null>(null);

/**
 * 附件字段的输入（D-263）：列出每个文件，可以添加（拍照、相册、「文件」）、调整顺序、去掉。
 * 点一个文件预览（照片、视频全屏翻看，别的用系统预览）。去掉只是不再放在这条记录里，文件本身还在「存储空间」里。
 * 「…」里分享，或放到桌上改（D-395）。
 */
export function AttachmentsInput({
  field,
  value,
  onChange,
  palette,
  locale,
  disabled,
  testID,
}: {
  field: { name: string };
  value: unknown;
  onChange: (value: unknown) => void;
  palette: Palette;
  locale: RenderEnv['locale'];
  disabled?: boolean | undefined;
  testID: string;
}) {
  const { files, repo } = useWorkspaceContext();
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const ids = attachmentIds(value);
  const assets = useAssets(ids);
  const room = MAX_ATTACHMENTS - ids.length;
  const [viewing, setViewing] = useState<{ items: ViewerItem[]; start: number } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const router = useRouter();
  const formFiles = useContext(FormFilesContext);
  // 桌上改完交回来时用最新的值和 onChange（表单在桌面下面，期间可能重新渲染过）。
  const latest = useRef({ ids, onChange });
  useEffect(() => {
    latest.current = { ids, onChange };
  });
  const mounted = useRef(true);
  const releases = useRef<(() => void)[]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const release of releases.current) release();
      releases.current = [];
    };
  }, []);

  // 点一个文件：照片和视频全屏左右翻看这个字段里所有的照片和视频；别的文件用系统预览
  // （iOS QuickLook，Android 交给能打开的 App），和文件入口一样。
  async function open(asset: AssetRecord) {
    if (inViewer(asset)) {
      const media = ids.flatMap((id) => {
        const a = assets.get(id);
        return a && inViewer(a) ? [a] : [];
      });
      setViewing({
        items: media.map((a) => ({
          uri: files.fileUri(a.path),
          kind: a.mimeType.startsWith('video/') ? 'video' : 'image',
        })),
        start: media.findIndex((a) => a.id === asset.id),
      });
      return;
    }
    try {
      await files.previewFile({
        uri: files.fileUri(asset.path),
        mimeType: asset.mimeType,
        name: asset.name,
      });
    } catch (e) {
      Alert.alert(
        field.name,
        e instanceof RunError
          ? runErrorText(locale, e.code, e.detail)
          : runErrorText(locale, 'previewFailed'),
      );
    }
  }

  // 「…」（D-395）：分享这个文件，或放到桌上改。
  function more(asset: AssetRecord) {
    Alert.alert(asset.name, undefined, [
      { text: t(locale, 'resultShare'), onPress: () => void share(asset) },
      ...(formFiles ? [{ text: t(locale, 'deskPlace'), onPress: () => void toDesk(asset) }] : []),
      { text: t(locale, 'cancel'), style: 'cancel' as const },
    ]);
  }

  // 分享存着的这个文件：用户文件存在 assets/<id>/<名字>，分享出去就是这个名字。
  async function share(asset: AssetRecord) {
    try {
      await files.shareUris([{ uri: files.fileUri(asset.path), mimeType: asset.mimeType }]);
    } catch (e) {
      Alert.alert(
        field.name,
        e instanceof RunError ? runErrorText(locale, e.code, e.detail) : String(e),
      );
    }
  }

  // 放到桌上：复制一份进新桌面（记录里的文件不动；房间里存过的 xlsx / docx 带着中间格式，D-367），
  // 在桌上点「完成」时问怎么放回来（DeskScreen），交回的文件进表单，还要点保存。
  async function toDesk(asset: AssetRecord) {
    try {
      const now = Date.now();
      const desk =
        (/\.(xlsx|docx)$/i.test(asset.name) ? await placeAssetOnDesk(files, asset, now) : null) ??
        (await placeOnDesk(
          files,
          [
            {
              uri: files.fileUri(asset.path),
              name: asset.name,
              mimeType: asset.mimeType,
              size: asset.size,
            },
          ],
          now,
        ));
      releases.current.push(
        holdDeskReturn(desk.id, {
          assetId: asset.id,
          ids: () => (mounted.current ? latest.current.ids : null),
          deliver: (mode, fresh) => {
            if (!mounted.current) return false;
            formFiles?.hold(fresh);
            latest.current.onChange(applyDeskReturn(latest.current.ids, asset.id, mode, fresh));
            return true;
          },
        }),
      );
      router.push({ pathname: '/desk/[deskId]', params: { deskId: desk.id } });
    } catch (e) {
      Alert.alert(
        field.name,
        e instanceof RunError ? runErrorText(locale, e.code, e.detail) : String(e),
      );
    }
  }

  async function add(source: SlotSource) {
    setChoosing(false);
    const added = await importChosen(
      locale,
      field.name,
      (src) => importUserFiles(src, room, files, repo),
      source,
    );
    if (added.length === 0) return;
    bumpAssets();
    onChange([...ids, ...added].slice(0, MAX_ATTACHMENTS));
  }

  const move = (from: number, to: number) => {
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id!);
    onChange(next);
  };
  const action = (label: StringKey, id: string, onPress: () => void, show = true) =>
    show ? (
      <Pressable testID={id} disabled={disabled} hitSlop={8} onPress={onPress}>
        <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
          {t(locale, label)}
        </Text>
      </Pressable>
    ) : null;

  return (
    <View style={styles.list}>
      {ids.length === 0 ? (
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {t(locale, 'noAttachment')}
        </Text>
      ) : null}
      {ids.map((id, i) => {
        const asset = assets.get(id);
        return (
          <View key={id} style={styles.row}>
            <Pressable
              testID={`${testID}-file-${i}`}
              disabled={!asset}
              onPress={() => asset && void open(asset)}
              style={[styles.flex, styles.row]}>
              {asset?.mimeType.startsWith('image/') ? (
                <AttachmentThumb
                  asset={asset}
                  size={40}
                  radius={6}
                  testID={`${testID}-thumb-${i}`}
                />
              ) : (
                <Icon
                  name={asset?.mimeType.startsWith('video/') ? 'video' : 'document'}
                  size={18}
                  color={palette.secondary}
                />
              )}
              <Text
                numberOfLines={1}
                style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
                {asset ? asset.name : asset === null ? t(locale, 'attachmentMissing') : ''}
              </Text>
            </Pressable>
            {asset ? (
              <Pressable
                testID={`${testID}-more-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t(locale, 'attachmentMore', { name: asset.name })}
                disabled={disabled}
                hitSlop={8}
                onPress={() => more(asset)}>
                <Text style={[palette.font('bodyBold', 15), { color: palette.muted }]}>…</Text>
              </Pressable>
            ) : null}
            {action('attachmentMoveUp', `${testID}-up-${i}`, () => move(i, i - 1), i > 0)}
            {action(
              'attachmentMoveDown',
              `${testID}-down-${i}`,
              () => move(i, i + 1),
              i < ids.length - 1,
            )}
            {action('removeAttachment', `${testID}-remove-${i}`, () =>
              onChange(ids.filter((x) => x !== id)),
            )}
          </View>
        );
      })}
      {viewing ? (
        <FileViewer
          items={viewing.items}
          start={viewing.start}
          onClose={() => setViewing(null)}
          palette={palette}
          locale={locale}
        />
      ) : null}
      {choosing ? (
        <SourceChoice
          title={field.name}
          palette={palette}
          locale={locale}
          onChoose={(source) => void add(source)}
          onCancel={() => setChoosing(false)}
        />
      ) : null}
      {room > 0 ? (
        <Pressable
          testID={`${testID}-add`}
          disabled={disabled}
          onPress={() => setChoosing(true)}
          style={styles.row}>
          <Icon name="plus" size={18} color={palette.primaryText} />
          <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>
            {t(locale, 'attachmentAdd')}
          </Text>
        </Pressable>
      ) : (
        <Text style={[palette.font('body', 13), { color: palette.caption }]}>
          {t(locale, 'attachmentsFull', { n: MAX_ATTACHMENTS })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#2A242080' },
  sheet: { position: 'absolute', left: 16, right: 16, bottom: 24, padding: 16, gap: 4 },
  option: { minHeight: 48, justifyContent: 'center' },
});
