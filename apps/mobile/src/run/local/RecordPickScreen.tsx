import { recordTitle } from '@morph/core';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '../../i18n';
import { useCalendar } from '../../workspace/context';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 放进已有的记录（D-443）：运行到「记一笔」的这一步时，从这张表现有的记录里选一条。只显示每条的标题
// （和别处一样，没有标题字段时是日期），最近改过的在前；记录多的时候可以按标题搜。选完才能确定，取消什么都不改。

/** 多于这个数才显示搜索框。 */
const SEARCH_FROM = 8;

export function RecordPickScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'recordPick'>) {
  const { collection, records } = input;
  const cal = useCalendar();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useMemo(() => {
    const now = new Date();
    return records
      .map((r) => ({
        id: r.id,
        title: recordTitle(r, collection, locale, now, cal),
        at: r.updatedAt,
      }))
      .sort((a, b) => b.at - a.at);
  }, [records, collection, locale, cal]);
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;
  return (
    <LocalFrame
      palette={palette}
      title={collection.name}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'recordPickChoose')}
      doneDisabled={selected === null}
      onCancel={onCancel}
      onDone={() => selected !== null && onDone({ recordId: selected })}
      avoidKeyboard>
      {rows.length > SEARCH_FROM ? (
        <TextInput
          testID="pick-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t(locale, 'recordPickSearch')}
          placeholderTextColor={palette.caption}
          autoCorrect={false}
          style={[
            palette.font('body', 16),
            styles.search,
            {
              color: palette.text,
              borderColor: palette.border,
              borderRadius: palette.controlRadius,
            },
          ]}
        />
      ) : null}
      {shown.length === 0 ? (
        <Text
          testID="pick-none"
          style={[palette.font('body', 15), styles.none, { color: palette.muted }]}>
          {t(locale, 'recordPickNone')}
        </Text>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const on = item.id === selected;
            return (
              <Pressable
                testID={`pick-row-${item.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setSelected(item.id)}
                style={[
                  styles.row,
                  {
                    borderColor: on ? palette.primary : palette.border,
                    borderRadius: palette.controlRadius,
                    backgroundColor: on ? palette.surface : 'transparent',
                  },
                ]}>
                <View style={styles.titleBox}>
                  <Text
                    numberOfLines={2}
                    style={[palette.font(on ? 'bodyBold' : 'body', 16), { color: palette.text }]}>
                    {item.title}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  none: { textAlign: 'center', padding: 24 },
  list: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  row: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  titleBox: { flexShrink: 1 },
});
