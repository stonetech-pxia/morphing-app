import { MAX_ATTACHMENTS, MEDIA_LIMITS, RunError, attachmentIds } from '@morph/core';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { runErrorText, t, type StringKey } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
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

const IMPORT_PROBLEMS: Record<ImportProblem, StringKey> = {
  tooLarge: 'fileSlotTooLarge',
  noSpace: 'fileSlotNoSpace',
  copyFailed: 'fileSlotCopyFailed',
};

/**
 * 问从哪里选（拍照、相册、「文件」），选好的（最多 max 个，由 pick 限制）复制进 App（和文件入口一样，slot-file.ts）。
 * 返回存好的文件 ID；取消时为空。出了问题会提示，已经存好的照样返回。
 */
export function chooseAttachments(
  locale: RenderEnv['locale'],
  title: string,
  pick: (source: SlotSource) => Promise<FilesImport>,
): Promise<string[]> {
  return new Promise((resolve) => {
    const run = async (source: SlotSource) => {
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
        return resolve([]);
      }
      if (result.kind === 'cancelled') return resolve([]);
      if (result.problem)
        Alert.alert(
          title,
          t(locale, IMPORT_PROBLEMS[result.problem], {
            gb: MEDIA_LIMITS.maxFileBytes / 1024 / 1024 / 1024,
          }),
        );
      resolve(result.assetIds);
    };
    Alert.alert(title, undefined, [
      { text: t(locale, 'attachmentTakePhoto'), onPress: () => void run('camera') },
      { text: t(locale, 'fileSlotFromPhotos'), onPress: () => void run('photos') },
      { text: t(locale, 'fileSlotFromFiles'), onPress: () => void run('files') },
      { text: t(locale, 'cancel'), style: 'cancel', onPress: () => resolve([]) },
    ]);
  });
}

/**
 * 附件字段的输入（D-263）：列出每个文件，可以添加（拍照、相册、「文件」）、调整顺序、去掉。
 * 点文件名打开分享面板（用别的 App 看）。去掉只是不再放在这条记录里，文件本身还在「存储空间」里。
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

  async function add() {
    const added = await chooseAttachments(locale, field.name, (source) =>
      importUserFiles(source, room, files, repo),
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
              onPress={() => asset && void files.share(asset.path, asset.mimeType)}
              style={[styles.flex, styles.row]}>
              <Icon name="document" size={18} color={palette.secondary} />
              <Text
                numberOfLines={1}
                style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
                {asset ? asset.name : asset === null ? t(locale, 'attachmentMissing') : ''}
              </Text>
            </Pressable>
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
      {room > 0 ? (
        <Pressable
          testID={`${testID}-add`}
          disabled={disabled}
          onPress={() => void add()}
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
});
