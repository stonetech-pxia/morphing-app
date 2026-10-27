import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// AA 分摊（D-259）：一行一个人，填名字和付了多少。只在这一次运行里用，不保存、不发给 AI。

const MAX_PEOPLE = 30;

interface Row {
  key: number;
  name: string;
  paid: string;
}

/** 金额：空着算 0；法语习惯用逗号作小数点。负数、不是数字、太大都不行。 */
export function parsePaid(text: string): number | null {
  const s = text.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 1e9 ? n : null;
}

export function SplitBillScreen({
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'splitBill'>) {
  const [rows, setRows] = useState<Row[]>([
    { key: 0, name: '', paid: '' },
    { key: 1, name: '', paid: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const update = (key: number, change: Partial<Row>) => {
    setError(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  };

  function done() {
    const filled = rows.filter((r) => r.name.trim() !== '' || r.paid.trim() !== '');
    if (filled.length < 2) return setError(t(locale, 'splitNeedTwo'));
    if (filled.some((r) => r.name.trim() === '')) return setError(t(locale, 'splitNeedName'));
    const seen = new Set<string>();
    for (const r of filled) {
      const name = r.name.trim();
      if (seen.has(name)) return setError(t(locale, 'splitSameName', { name }));
      seen.add(name);
    }
    const people = [];
    for (const r of filled) {
      const paid = parsePaid(r.paid);
      if (paid === null) return setError(t(locale, 'splitBadAmount', { name: r.name.trim() }));
      people.push({ name: r.name.trim(), paid });
    }
    onDone({ people });
  }

  const input = [
    styles.input,
    palette.font('body', 16),
    {
      color: palette.text,
      borderColor: palette.border,
      borderRadius: palette.controlRadius,
      backgroundColor: palette.surface,
    },
  ];
  return (
    <LocalFrame
      palette={palette}
      title={t(locale, 'splitTitle')}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'splitWorkOut')}
      onCancel={onCancel}
      onDone={done}
      avoidKeyboard>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'splitIntro')}
        </Text>
        {rows.map((r, i) => (
          <View key={r.key} style={styles.row} testID={`split-row-${i}`}>
            <TextInput
              testID={`split-name-${i}`}
              value={r.name}
              onChangeText={(name) => update(r.key, { name })}
              placeholder={t(locale, 'splitName')}
              placeholderTextColor={palette.caption}
              maxLength={40}
              style={[input, styles.name]}
            />
            <TextInput
              testID={`split-paid-${i}`}
              value={r.paid}
              onChangeText={(paid) => update(r.key, { paid })}
              placeholder={t(locale, 'splitPaid')}
              placeholderTextColor={palette.caption}
              keyboardType="decimal-pad"
              maxLength={13}
              style={[input, styles.paid]}
            />
            {rows.length > 2 ? (
              <Pressable
                testID={`split-remove-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t(locale, 'splitRemovePerson')}
                hitSlop={8}
                onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Text style={[palette.font('bodyBold', 18), { color: palette.muted }]}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {rows.length < MAX_PEOPLE ? (
          <Pressable
            testID="split-add"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.add}
            onPress={() =>
              setRows((rs) => [
                ...rs,
                { key: Math.max(...rs.map((x) => x.key)) + 1, name: '', paid: '' },
              ])
            }>
            <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
              + {t(locale, 'splitAddPerson')}
            </Text>
          </Pressable>
        ) : null}
        {error ? (
          <Text
            testID="split-error"
            style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10 },
  name: { flex: 3 },
  paid: { flex: 2, textAlign: 'right' },
  add: { alignSelf: 'flex-start', paddingVertical: 6 },
});
