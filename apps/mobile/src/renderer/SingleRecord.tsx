import {
  calendarOf,
  formatRef,
  recordToVCard,
  type BlockOf,
  type ComponentStyle,
} from '@morph/core';
import { encodePng, qrMatrix, qrToRgba } from '@morph/tool-qr';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useComputedRecords, useLinkResolver } from '../data/records';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import { useCollection } from './data';
import { openEditor } from './open-row';
import { cardColors } from './theme';
import { Button, Card } from './ui';

// 一张表的一条记录（最早加的那条，D-424）：几个字段、「编辑」，可以加这条记录的 vCard 二维码。
// 二维码画的时候现算，不存（底线 14）；看的时候什么都不写（底线 15）。

/** 手机屏幕上还扫得出来的最大边长（模块数）：再大就太密了，只写一句说明。 */
const MAX_QR_MODULES = 105;
const QR_SIDE = 240;

function qrImage(text: string): string | null {
  try {
    const matrix = qrMatrix(text, { ecc: 'L' });
    if (matrix.size > MAX_QR_MODULES) return null;
    const scale = Math.ceil((QR_SIDE * 3) / (matrix.size + 8));
    const bytes = encodePng(qrToRgba(matrix, { scale }));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x1000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x1000));
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    // 内容超过二维码的容量。
    return null;
  }
}

export function SingleRecord({
  block,
  env,
  tone,
}: {
  block: BlockOf<'single'>;
  env: RenderEnv;
  tone?: ComponentStyle['tone'];
}) {
  const { palette, locale } = env;
  const router = useRouter();
  const collection = useCollection(env, block.source.table);
  const cal = calendarOf(env.config);
  const { view, records } = useComputedRecords(env.config.data.tables, collection, cal);
  const links = useLinkResolver(view);
  const record = records && [...records].sort((a, b) => a.createdAt - b.createdAt)[0];
  const vcard =
    block.show.qr && collection && record ? recordToVCard(collection.fields, record.values) : null;
  const qr = useMemo(() => (vcard ? qrImage(vcard) : null), [vcard]);
  if (!collection || !view || records === null) return null;
  const background = cardColors(palette, tone).background;
  if (!record)
    return (
      <Card palette={palette} background={background}>
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {t(locale, 'noRecords')}
        </Text>
      </Card>
    );
  const now = new Date();
  const rows = block.show.fields.flatMap((id) => {
    const text = formatRef(record, view, id, locale, links, now, cal);
    return text ? [{ id, text, name: view.fields.find((f) => f.id === id)?.name ?? id }] : [];
  });
  return (
    <Card palette={palette} background={background} testID={`single-${record.id}`}>
      <View style={{ gap: 12 }}>
        {qr ? (
          <Image
            testID="single-qr"
            accessibilityRole="image"
            source={{ uri: qr }}
            resizeMode="contain"
            style={styles.qr}
          />
        ) : vcard ? (
          <Text
            testID="single-qr-note"
            style={[palette.font('body', 13), { color: palette.muted }]}>
            {t(locale, 'singleTooMuch')}
          </Text>
        ) : null}
        {rows.map((row, i) => (
          <View key={row.id} style={styles.field}>
            {i > 0 ? (
              <Text style={[palette.font('body', 12), { color: palette.caption }]}>{row.name}</Text>
            ) : null}
            <Text
              style={[
                i === 0 ? palette.font('title', 20) : palette.font('body', 15),
                { color: palette.text },
              ]}>
              {row.text}
            </Text>
          </View>
        ))}
        <Button
          palette={palette}
          testID="single-edit"
          variant="outline"
          label={t(locale, 'editRecord')}
          onPress={
            env.interactive
              ? (env.locked ?? (() => openEditor(router, collection.id, record.id)))
              : undefined
          }
          onLongPress={env.onLongPress}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  qr: { width: QR_SIDE, height: QR_SIDE, alignSelf: 'center' },
  field: { gap: 2 },
});
