import type { Locale, RunItem, RunValue } from '@morph/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { runErrorText, t, type StringKey } from '../i18n';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Card, Pill } from '../renderer/ui';

// 结果预览（TOOLS_DESIGN §3）：图片缩略图、PDF 页数和大小、文字全文（只在本机显示）。
// 结果页始终提供保存、分享、存到相册（图片）、打印（PDF / 图片）、复制（文字）。

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface ResultActions {
  save(): Promise<void>;
  share(): Promise<void>;
  saveToPhotos(): Promise<void>;
  print(): Promise<void>;
  copy(): Promise<void>;
}

function ItemRow({ item, palette, locale }: { item: RunItem; palette: Palette; locale: Locale }) {
  const image = item.mimeType.startsWith('image/');
  const fileName = `${item.name}.${item.ext}`;
  const details = [
    item.width && item.height ? `${item.width}×${item.height}` : null,
    item.pageCount ? t(locale, 'resultPages', { n: item.pageCount }) : null,
    formatBytes(item.size),
  ].filter(Boolean);
  return (
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
  );
}

export function ResultView({
  value,
  palette,
  locale,
  actions,
}: {
  value: RunValue;
  palette: Palette;
  locale: Locale;
  actions: ResultActions;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const act = (key: string, fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
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
    fn: () => Promise<void>,
  ) => (
    <Pill
      key={key}
      palette={palette}
      testID={`result-${key}`}
      label={t(locale, done.has(key) && doneLabel ? doneLabel : label)}
      onPress={() => void act(key, fn)()}
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
  const printable = images || items.every((i) => i.mimeType === 'application/pdf');
  return (
    <Card palette={palette} testID="run-result">
      {items.length > 1 ? (
        <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>
          {t(locale, 'resultCount', { n: items.length })}
        </Text>
      ) : null}
      {items.slice(0, 30).map((item) => (
        <ItemRow key={item.uri} item={item} palette={palette} locale={locale} />
      ))}
      <View style={styles.actions}>
        {allSaved ? null : pill('save', 'resultSave', 'resultSaved', actions.save)}
        {pill('share', 'resultShare', null, actions.share)}
        {images ? pill('photos', 'resultPhotos', 'resultPhotosDone', actions.saveToPhotos) : null}
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
