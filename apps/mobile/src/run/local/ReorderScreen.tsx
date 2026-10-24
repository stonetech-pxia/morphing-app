import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { Icon } from '../../renderer/Icon';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 排序和删除（TOOLS_DESIGN §4 reorder）：上移、下移、去掉。结果是保留的下标，按新顺序。

export function ReorderScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'reorder'>) {
  const [order, setOrder] = useState(() => input.items.map((_, i) => i));
  const zh = locale === 'zh';
  const move = (pos: number, delta: number) =>
    setOrder((o) => {
      const next = [...o];
      const [x] = next.splice(pos, 1);
      next.splice(pos + delta, 0, x!);
      return next;
    });
  const button = (
    icon: 'arrowUp' | 'arrowDown' | 'close',
    onPress: () => void,
    testID: string,
    disabled = false,
  ) => (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.button, { borderColor: palette.border, opacity: disabled ? 0.3 : 1 }]}>
      <Text style={[palette.font('bodyBold', 16), { color: palette.text }]}>
        {icon === 'arrowUp' ? '↑' : icon === 'arrowDown' ? '↓' : '✕'}
      </Text>
    </Pressable>
  );
  return (
    <LocalFrame
      palette={palette}
      title={zh ? '排序' : 'Order'}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'localDone')}
      onCancel={onCancel}
      onDone={() => onDone(order)}
      doneDisabled={order.length === 0}>
      <ScrollView contentContainerStyle={styles.list}>
        {order.map((index, pos) => {
          const item = input.items[index]!;
          const image = item.mimeType.startsWith('image/');
          return (
            <View
              key={item.uri}
              testID={`reorder-item-${pos}`}
              style={[
                styles.row,
                { backgroundColor: palette.surface, borderRadius: palette.controlRadius },
              ]}>
              <Text style={[palette.font('bodyBold', 15), { color: palette.muted, width: 22 }]}>
                {pos + 1}
              </Text>
              {image ? (
                <Image source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View
                  style={[styles.thumb, styles.center, { backgroundColor: palette.primaryTint }]}>
                  <Icon
                    name={
                      item.mimeType.startsWith('audio/')
                        ? 'audio'
                        : item.mimeType.startsWith('video/')
                          ? 'video'
                          : 'document'
                    }
                    size={22}
                    color={palette.primaryText}
                  />
                </View>
              )}
              <Text
                numberOfLines={1}
                style={[palette.font('body', 15), styles.flex, { color: palette.text }]}>
                {`${item.name}.${item.ext}`}
              </Text>
              {button('arrowUp', () => move(pos, -1), `reorder-up-${pos}`, pos === 0)}
              {button(
                'arrowDown',
                () => move(pos, 1),
                `reorder-down-${pos}`,
                pos === order.length - 1,
              )}
              {button(
                'close',
                () => setOrder((o) => o.filter((_, p) => p !== pos)),
                `reorder-remove-${pos}`,
              )}
            </View>
          );
        })}
      </ScrollView>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  thumb: { width: 48, height: 48, borderRadius: 6 },
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  button: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
