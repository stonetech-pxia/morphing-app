import { MEDIA_LIMITS, RunError, isFileTarget, type BlockOf } from '@morph/core';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { runErrorText, t, type StringKey } from '../i18n';
import type { AssetRecord } from '../storage/types';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { importSlotFile, type SlotImport, type SlotSource } from './slot-file';
import { Tile } from './Tile';

// 文件入口（D-257）：AI 只放空位；用户点空位从相册或「文件」选一个文件，复制一份存成用户文件，
// 配置里只记录文件 ID。之后点一下用系统预览打开；换文件、移除文件在长按编辑里。
// 文件名只在本机显示，不进配置，也不发给 AI。

const IMPORT_ERRORS: Record<Exclude<SlotImport['kind'], 'saved' | 'cancelled'>, StringKey> = {
  tooLarge: 'fileSlotTooLarge',
  noSpace: 'fileSlotNoSpace',
  copyFailed: 'fileSlotCopyFailed',
};

/** 问从哪里选，选好后复制进 App。返回新的用户文件 ID；取消或出错（已提示）时返回 null。 */
export function chooseSlotFile(
  locale: RenderEnv['locale'],
  title: string,
  pick: (source: Exclude<SlotSource, 'camera'>) => Promise<SlotImport>,
): Promise<string | null> {
  return new Promise((resolve) => {
    const run = async (source: Exclude<SlotSource, 'camera'>) => {
      const result = await pick(source).catch((): SlotImport => ({ kind: 'copyFailed' }));
      if (result.kind === 'saved') return resolve(result.assetId);
      if (result.kind !== 'cancelled')
        Alert.alert(
          title,
          t(locale, IMPORT_ERRORS[result.kind], {
            gb: MEDIA_LIMITS.maxFileBytes / 1024 / 1024 / 1024,
          }),
        );
      resolve(null);
    };
    Alert.alert(title, undefined, [
      { text: t(locale, 'fileSlotFromPhotos'), onPress: () => void run('photos') },
      { text: t(locale, 'fileSlotFromFiles'), onPress: () => void run('files') },
      { text: t(locale, 'cancel'), style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

/** 读一个文件入口指向的用户文件。undefined：读取中；null：没有或不在这台设备上。 */
export function useSlotAsset(assetId: string | null | undefined): AssetRecord | null | undefined {
  const { repo } = useWorkspaceContext();
  const [loaded, setLoaded] = useState<{ id: string; asset: AssetRecord | null } | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    void repo.getAsset(assetId).then((asset) => alive && setLoaded({ id: assetId, asset }));
    return () => {
      alive = false;
    };
  }, [repo, assetId]);
  if (!assetId) return null;
  return loaded?.id === assetId ? loaded.asset : undefined;
}

export function FileSlot({ component, env }: { component: BlockOf<'entry'>; env: RenderEnv }) {
  const { locale } = env;
  // 文件位是 opens 为 {file} 的入口（原 fileSlot）。
  const show = component.show ?? {};
  const title = show.title ?? '';
  const assetId = isFileTarget(component.opens) ? component.opens.file : null;
  const { repo, files } = useWorkspaceContext();
  const proposeOps = useWorkspace((s) => s.proposeOps);
  const confirm = useWorkspace((s) => s.confirm);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const asset = useSlotAsset(assetId);

  async function setFile(assetId: string) {
    if (!env.pageId) return;
    const result = await proposeOps(
      [
        {
          op: 'updateContainer',
          page: env.pageId,
          block: component.id,
          changes: { opens: { file: assetId } },
        },
      ],
      t(locale, 'setFileSummary'),
    );
    if (result.kind === 'preview') await confirm();
    else
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
  }

  async function choose() {
    const id = await chooseSlotFile(locale, title, (source) => importSlotFile(source, files, repo));
    if (!id) return;
    bumpAssets();
    await setFile(id);
  }

  async function open(a: AssetRecord) {
    try {
      await files.previewFile({ uri: files.fileUri(a.path), mimeType: a.mimeType, name: a.name });
    } catch (e) {
      Alert.alert(
        title,
        e instanceof RunError
          ? runErrorText(locale, e.code, e.detail)
          : runErrorText(locale, 'previewFailed'),
      );
    }
  }

  const subtitle = asset
    ? asset.name
    : asset === null && assetId
      ? t(locale, 'fileSlotMissing')
      : asset === undefined
        ? undefined
        : (show.hint ?? t(locale, 'fileSlotPlaceholder'));
  return (
    <Tile
      env={env}
      style={component.style}
      icon={show.icon ?? 'document'}
      title={title}
      subtitle={subtitle}
      testID={`file-slot-${component.id}`}
      onPress={() => {
        if (env.locked) return env.locked();
        if (asset) void open(asset);
        else if (asset === null) void choose();
      }}
      look={show.shape ?? 'row'}
    />
  );
}
