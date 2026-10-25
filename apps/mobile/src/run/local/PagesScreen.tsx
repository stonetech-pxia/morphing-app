import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 整理 PDF 页面（TOOLS_DESIGN §4 pages）：去掉不要的页、调整顺序、旋转。
// 没有 PDF 预览包时按页码显示（方块的形状反映横竖），有预览包时显示缩略图。

type Rotation = 0 | 90 | 180 | 270;

interface Row {
  index: number;
  rotate: Rotation;
}

export function PagesScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'pages'>) {
  const [rows, setRows] = useState<Row[]>(() =>
    input.pages.map((_, index) => ({ index, rotate: 0 })),
  );
  const [removed, setRemoved] = useState<Row[]>([]);

  const move = (pos: number, delta: number) =>
    setRows((r) => {
      const next = [...r];
      const [x] = next.splice(pos, 1);
      next.splice(pos + delta, 0, x!);
      return next;
    });
  const rotate = (pos: number) =>
    setRows((r) =>
      r.map((row, i) =>
        i === pos ? { ...row, rotate: ((row.rotate + 90) % 360) as Rotation } : row,
      ),
    );
  const remove = (pos: number) => {
    setRemoved((d) => [...d, rows[pos]!]);
    setRows((r) => r.filter((_, i) => i !== pos));
  };
  const restore = () => {
    setRows((r) => [...r, ...removed].sort((a, b) => a.index - b.index));
    setRemoved([]);
  };

  const button = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={[styles.button, { borderColor: palette.border, opacity: disabled ? 0.3 : 1 }]}>
      <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <LocalFrame
      palette={palette}
      title={t(locale, 'PagesScreen_Pages_ab40b', { v0: rows.length })}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'localDone')}
      onCancel={onCancel}
      onDone={() => onDone(rows)}
      doneDisabled={rows.length === 0}>
      <ScrollView contentContainerStyle={styles.list}>
        {rows.map((row, pos) => {
          const page = input.pages[row.index]!;
          // pageInfo 的宽高已经是用户看到的方向；再转 90° 时横竖互换。
          const landscape =
            row.rotate % 180 === 90 ? page.height > page.width : page.width > page.height;
          const thumb = input.thumbnails?.[row.index];
          return (
            <View
              key={row.index}
              testID={`page-row-${pos}`}
              style={[
                styles.row,
                { backgroundColor: palette.surface, borderRadius: palette.controlRadius },
              ]}>
              <View style={styles.thumbBox}>
                {thumb ? (
                  <Image
                    source={{ uri: thumb }}
                    style={[styles.thumb, { transform: [{ rotate: `${row.rotate}deg` }] }]}
                    contentFit="contain"
                  />
                ) : (
                  <View
                    style={[
                      landscape ? styles.pageLandscape : styles.pagePortrait,
                      { borderColor: palette.border, backgroundColor: palette.background },
                    ]}>
                    <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
                      {row.index + 1}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.flex}>
                <Text style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
                  {t(locale, 'PagesScreen_Page_e76ad', { v0: row.index + 1 })}
                </Text>
                {row.rotate ? (
                  <Text style={[palette.font('body', 13), { color: palette.muted }]}>
                    {t(locale, 'PagesScreen_Rotated_41854', { v0: row.rotate })}
                  </Text>
                ) : null}
              </View>
              {button('⟳', () => rotate(pos), `page-rotate-${pos}`)}
              {button('↑', () => move(pos, -1), `page-up-${pos}`, pos === 0)}
              {button('↓', () => move(pos, 1), `page-down-${pos}`, pos === rows.length - 1)}
              {button('✕', () => remove(pos), `page-remove-${pos}`)}
            </View>
          );
        })}
        {removed.length > 0 ? (
          <Pressable testID="pages-restore" onPress={restore} style={styles.restore}>
            <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
              {t(locale, 'PagesScreen_Restore_removed_a7e1a', { v0: removed.length })}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  thumbBox: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 56, height: 56 },
  pagePortrait: {
    width: 40,
    height: 54,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageLandscape: {
    width: 54,
    height: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: 2 },
  button: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restore: { alignItems: 'center', padding: 14 },
});
