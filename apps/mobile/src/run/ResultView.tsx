import {
  formatFileSize,
  type Locale,
  mediaKindOf,
  totalSize,
  type RunItem,
  type RunValue,
} from '@morph/core';

import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { runErrorText, t, type StringKey } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Card, Pill } from '../renderer/ui';
import { FileViewer } from '../share/FileViewer';
import { MediaRow } from './MediaRow';

// 结果预览（TOOLS_DESIGN §3）：图片缩略图、PDF 页数和大小、文字全文（只在本机显示）。
// 结果页始终提供保存、分享、存到文件夹、存到相册（图片）、打印（PDF / 图片）、复制（文字）。

export const formatBytes = (bytes: number, locale: Locale = 'en') => formatFileSize(bytes, locale);

export interface ResultActions {
  save(): Promise<void>;
  share(): Promise<void>;
  /** choose：换一个文件夹（否则存到记住的文件夹）。返回文件夹名，用户取消时返回 null（按钮不显示「已存」）。 */
  saveToFolder(choose: boolean): Promise<string | null>;
  /** 记住的文件夹的名字（D-123）。 */
  rememberedFolder(): string | null;
  saveToPhotos(): Promise<void>;
  print(): Promise<void>;
  copy(): Promise<void>;
  continueProcessing?(): Promise<void>;
  /** 用系统预览打开一个结果文件（PDF 等，D-277）；图片在 App 里全屏看。 */
  preview?(item: RunItem): Promise<void>;
}

function ItemRow({
  item,
  palette,
  locale,
  onOpen,
}: {
  item: RunItem;
  palette: Palette;
  locale: Locale;
  /** 点缩略图或这一行：全屏看图，其他文件用系统预览（D-277）。 */
  onOpen?: () => void;
}) {
  const image = item.mimeType.startsWith('image/');
  const fileName = `${item.name}.${item.ext}`;
  const details = [
    item.width && item.height ? `${item.width}×${item.height}` : null,
    item.pageCount ? t(locale, 'resultPages', { n: item.pageCount }) : null,
    formatBytes(item.size, locale),
  ].filter(Boolean);
  const kind = mediaKindOf(item.mimeType, item.ext);
  if (kind === 'video' || kind === 'audio') {
    return <MediaRow item={item} palette={palette} locale={locale} detail={details.join(' · ')} />;
  }
  return (
    <Pressable
      style={styles.item}
      testID={`result-open-${fileName}`}
      accessibilityRole="imagebutton"
      disabled={!onOpen}
      onPress={onOpen}>
      <View style={styles.item} testID={`result-item-${fileName}`}>
        {image ? (
          <Image
            source={{ uri: item.uri }}
            style={[styles.thumb, { borderRadius: 8 }]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.thumb,
              styles.icon,
              { backgroundColor: palette.primaryTint, borderRadius: 8 },
            ]}>
            <Icon name="document" size={24} color={palette.primaryText} />
          </View>
        )}
        <View style={styles.flex}>
          <Text numberOfLines={2} style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
            {item.assetId && item.pageCount
              ? t(locale, 'runDone', { name: fileName, pages: item.pageCount })
              : item.assetId
                ? `${t(locale, 'resultSaved')} · ${fileName}`
                : fileName}
          </Text>
          <Text style={[palette.font('body', 13), { color: palette.muted }]}>
            {details.join(' · ')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function ResultView({
  value,
  palette,
  locale,
  actions,
  inputSize = 0,
}: {
  value: RunValue;
  palette: Palette;
  locale: Locale;
  actions: ResultActions;
  /** 输入文件的总大小；结果变小了（压缩、缩小）时显示「原来 X，现在 Y」。 */
  inputSize?: number;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState(() => actions.rememberedFolder());
  /** 全屏看的那一张（结果里所有图片中的序号）。 */
  const [viewing, setViewing] = useState<number | null>(null);
  const act = (key: string, fn: () => Promise<void | boolean>) => async () => {
    setError(null);
    try {
      if ((await fn()) === false) return;
      setDone((d) => new Set(d).add(key));
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code
          ? runErrorText(locale, code, (e as { detail?: Record<string, string> }).detail)
          : String(e),
      );
    }
  };
  const pill = (
    key: string,
    label: StringKey,
    doneLabel: StringKey | null,
    fn: () => Promise<void | boolean>,
  ) => (
    <Pill
      key={key}
      palette={palette}
      testID={`result-${key}`}
      label={t(locale, done.has(key) && doneLabel ? doneLabel : label)}
      onPress={() => void act(key, fn)()}
    />
  );

  // 存到记住的文件夹，或换一个（D-123）；两个按钮共用「已存」状态。
  const folderPill = (key: 'folder' | 'folderChange', choose: boolean) => (
    <Pill
      key={key}
      palette={palette}
      testID={`result-${key}`}
      label={
        choose
          ? t(locale, 'resultFolderChange')
          : done.has('folder') && folder
            ? t(locale, 'resultFolderDone', { name: folder })
            : folder
              ? t(locale, 'resultFolderNamed', { name: folder })
              : t(locale, 'resultFolder')
      }
      onPress={() =>
        void act('folder', async () => {
          const name = await actions.saveToFolder(choose);
          if (name === null) {
            // 取消了：记住的文件夹可能已经不在了（被删、授权被收回），按钮跟着更新。
            setFolder(actions.rememberedFolder());
            return false;
          }
          setFolder(name);
        })()
      }
    />
  );

  if (value.type === 'text') {
    return (
      <Card palette={palette} testID="run-result">
        <ScrollView style={styles.text}>
          <Text
            selectable
            testID="result-text"
            style={[palette.font('body', 15), { color: palette.text }]}>
            {value.text}
          </Text>
        </ScrollView>
        <Text style={[palette.font('body', 13), { color: palette.caption }]}>
          {t(locale, 'resultTextNote')}
        </Text>
        <View style={styles.actions}>
          {pill('copy', 'resultCopy', 'resultCopied', actions.copy)}
        </View>
      </Card>
    );
  }

  if (value.type === 'records') {
    // 记录只用来生成 PDF；工作流停在这里时只显示条数。
    return (
      <Card palette={palette} testID="run-result">
        <Text style={[palette.font('body', 15), { color: palette.text }]}>
          {t(locale, 'resultRecords', { n: value.records.length })}
        </Text>
      </Card>
    );
  }

  const items = value.items;
  const allSaved = items.every((i) => i.assetId);
  const images = items.every((i) => i.mimeType.startsWith('image/'));
  // 存到相册：图片和视频（D-140）。
  const photos = items.every((i) => {
    const kind = mediaKindOf(i.mimeType, i.ext);
    return kind === 'image' || kind === 'video';
  });
  const printable = images || items.every((i) => i.mimeType === 'application/pdf');
  const outputSize = totalSize(value);
  // 全屏看图：结果里的全部图片，左右滑（D-277）。
  const viewable = items
    .filter((i) => mediaKindOf(i.mimeType, i.ext) === 'image')
    .map((i) => ({ uri: i.uri, kind: 'image' as const }));
  return (
    <Card palette={palette} testID="run-result">
      {items.length > 1 ? (
        <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>
          {t(locale, 'resultCount', { n: items.length })}
        </Text>
      ) : null}
      {items.slice(0, 30).map((item) => (
        <ItemRow
          key={item.uri}
          item={item}
          palette={palette}
          locale={locale}
          onOpen={
            mediaKindOf(item.mimeType, item.ext) === 'image'
              ? () => setViewing(viewable.findIndex((v) => v.uri === item.uri))
              : actions.preview
                ? () => void act('preview', () => actions.preview!(item))()
                : undefined
          }
        />
      ))}
      {viewing !== null ? (
        <FileViewer
          items={viewable}
          start={viewing}
          onClose={() => setViewing(null)}
          palette={palette}
          locale={locale}
        />
      ) : null}
      {inputSize > 0 && outputSize < inputSize ? (
        <Text
          testID="result-smaller"
          style={[palette.font('bodyMedium', 14), { color: palette.muted }]}>
          {t(locale, 'resultSmaller', {
            from: formatBytes(inputSize, locale),
            to: formatBytes(outputSize, locale),
          })}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {allSaved ? null : pill('save', 'resultSave', 'resultSaved', actions.save)}
        {items.length && actions.continueProcessing
          ? pill('continue', 'resultContinue', null, actions.continueProcessing)
          : null}
        {pill('share', 'resultShare', null, actions.share)}
        {folderPill('folder', false)}
        {folder ? folderPill('folderChange', true) : null}
        {photos ? pill('photos', 'resultPhotos', 'resultPhotosDone', actions.saveToPhotos) : null}
        {printable ? pill('print', 'resultPrint', null, actions.print) : null}
      </View>
      {error ? (
        <Text style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>{error}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 52, height: 52 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  text: { maxHeight: 360 },
});
