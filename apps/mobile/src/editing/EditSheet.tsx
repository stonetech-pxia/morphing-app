import {
  allComponents,
  componentCollection,
  isKnownComponent,
  moveStepOp,
  type KnownComponent,
  type ComponentStyle,
  type Op,
  type Page,
} from '@morph/core';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t, type StringKey } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Button, SectionLabel } from '../renderer/ui';
import { useWorkspaceContext } from '../workspace/context';
import { useEditActions } from './actions';
import { CAPABILITIES, type StyleKey, type TextField } from './capabilities';

// 长按组件弹出的操作面板（D-052）：改文字、颜色、对齐、大小、位置、隐藏、删除。
// 每个操作先校验并加入编辑草稿；「完成」时整份草稿生成一个可撤销版本（D-054、D-235）。

const STYLE_VALUES = {
  tone: ['default', 'primary', 'secondary', 'tertiary', 'muted'],
  align: ['start', 'center'],
  size: ['small', 'medium', 'large'],
} as const;

/** 选「默认值」时清除该外观设置，而不是把默认值写进配置。 */
const DEFAULTS: Record<StyleKey, string> = { tone: 'default', align: 'start', size: 'medium' };

const STYLE_TITLES: Record<StyleKey, StringKey> = {
  tone: 'editColor',
  align: 'editAlign',
  size: 'editSize',
};

function Chip({
  palette,
  label,
  selected,
  onPress,
  danger,
  disabled,
  testID,
}: {
  palette: Palette;
  label: string;
  selected?: boolean;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const color = danger ? palette.danger : selected ? palette.onPrimary : palette.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: danger ? palette.danger : selected ? palette.primary : palette.border,
          backgroundColor: selected ? palette.primary : palette.surface,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
      ]}>
      <Text style={[palette.font('bodyBold', 14), { color }]}>{label}</Text>
    </Pressable>
  );
}

function TextForm({
  component,
  fields,
  palette,
  onCancel,
  onSave,
}: {
  component: KnownComponent;
  fields: TextField[];
  palette: Palette;
  onCancel: () => void;
  onSave: (props: Record<string, string | null>) => void;
}) {
  const { locale } = useWorkspaceContext();
  const current = component.props as Record<string, unknown>;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.prop, String(current[f.prop] ?? '')])),
  );
  const [missing, setMissing] = useState<string[]>([]);

  function save() {
    const empty = fields.filter((f) => !f.optional && !values[f.prop]!.trim()).map((f) => f.prop);
    setMissing(empty);
    if (empty.length > 0) return;
    const changes: Record<string, string | null> = {};
    for (const f of fields) {
      const value = values[f.prop]!.trim();
      const before = current[f.prop];
      if (value === '' && before !== undefined) changes[f.prop] = null;
      else if (value !== '' && value !== before) changes[f.prop] = value;
    }
    onSave(changes);
  }

  return (
    <View style={styles.form}>
      {fields.map((f) => (
        <View key={f.prop} style={styles.field}>
          <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
            {t(locale, `field_${f.prop}` as StringKey)}
            {f.optional ? `（${t(locale, 'optional')}）` : ''}
          </Text>
          <TextInput
            testID={`edit-field-${f.prop}`}
            value={values[f.prop]}
            onChangeText={(v) => setValues({ ...values, [f.prop]: v })}
            maxLength={f.max}
            multiline={f.multiline}
            autoFocus={f === fields[0]}
            style={[
              styles.input,
              f.multiline && styles.multiline,
              palette.font('body', 16),
              {
                color: palette.text,
                borderColor: missing.includes(f.prop) ? palette.danger : palette.border,
                borderRadius: palette.controlRadius,
                backgroundColor: palette.surface,
              },
            ]}
          />
          {missing.includes(f.prop) ? (
            <Text style={[palette.font('bodyMedium', 13), { color: palette.danger }]}>
              {t(locale, 'textRequired')}
            </Text>
          ) : f.rich ? (
            <Text style={[palette.font('body', 12), { color: palette.caption }]}>
              {t(locale, 'richTextHint')}
            </Text>
          ) : null}
        </View>
      ))}
      <View style={styles.formActions}>
        <Button
          palette={palette}
          testID="edit-text-cancel"
          variant="outline"
          label={t(locale, 'cancel')}
          onPress={onCancel}
          style={styles.flex}
        />
        <Button
          palette={palette}
          testID="edit-save"
          label={t(locale, 'save')}
          onPress={save}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

export function EditSheet({
  page,
  componentId,
  palette,
  onClose,
}: {
  page: Page;
  componentId: string | null;
  palette: Palette;
  onClose: () => void;
}) {
  const { locale } = useWorkspaceContext();
  const { edit, label } = useEditActions(page);
  const insets = useSafeAreaInsets();
  const [editingText, setEditingText] = useState(false);
  const component = componentId ? allComponents(page).find((c) => c.id === componentId) : undefined;

  function close() {
    setEditingText(false);
    onClose();
  }

  if (!component) return null;
  const id = component.id;
  // 更新的 App 加的组件（D-254）只能移动和删除。
  const known = isKnownComponent(component) ? component : null;
  const caps = known ? CAPABILITIES[known.type] : { text: [], style: [] };
  const target = { pageId: page.id, componentId: id };

  /** 加入编辑草稿。改外观时面板保持打开，方便多试几种。 */
  function apply(ops: Op[], { keepOpen = false } = {}) {
    if (edit(ops) && !keepOpen) close();
  }

  function setStyle(key: StyleKey, value: string) {
    const current = known?.style?.[key] ?? DEFAULTS[key];
    if (current === value) return;
    const style: Record<string, string | null> = { [key]: value === DEFAULTS[key] ? null : value };
    apply([{ op: 'setComponentStyle', ...target, style: style as ComponentStyle }], {
      keepOpen: true,
    });
  }

  function confirmDelete() {
    const message =
      known?.type === 'group' && known.children.length > 0
        ? t(locale, 'deleteGroupMessage', { count: known.children.length })
        : componentCollection(component!)
          ? t(locale, 'deleteDataMessage')
          : t(locale, 'deleteComponentMessage');
    Alert.alert(t(locale, 'deleteComponentTitle', { label: label(id) }), message, [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'delete'),
        style: 'destructive',
        onPress: () => apply([{ op: 'removeComponent', ...target }]),
      },
    ]);
  }

  const up = moveStepOp(page, id, 'up');
  const down = moveStepOp(page, id, 'down');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityLabel={t(locale, 'close')}
        />
        <View
          testID="edit-sheet"
          style={[
            styles.sheet,
            {
              backgroundColor: palette.background,
              borderTopLeftRadius: palette.radius,
              borderTopRightRadius: palette.radius,
              paddingBottom: insets.bottom + 16,
            },
          ]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.content, { padding: palette.pad }]}>
            <Text style={[palette.font('title', 18), { color: palette.text }]} numberOfLines={2}>
              {label(id)}
            </Text>
            {editingText && known ? (
              <TextForm
                component={known}
                fields={caps.text}
                palette={palette}
                onCancel={() => setEditingText(false)}
                onSave={(props) => {
                  if (Object.keys(props).length === 0) close();
                  else apply([{ op: 'setComponentProps', ...target, props }]);
                }}
              />
            ) : (
              <>
                {caps.text.length > 0 ? (
                  <Button
                    palette={palette}
                    testID="edit-text"
                    variant="outline"
                    label={t(locale, 'editText')}
                    onPress={() => setEditingText(true)}
                  />
                ) : null}
                {caps.style.map((key) => (
                  <View key={key} style={styles.section}>
                    <SectionLabel palette={palette}>{t(locale, STYLE_TITLES[key])}</SectionLabel>
                    <View style={styles.chips}>
                      {STYLE_VALUES[key].map((value) => (
                        <Chip
                          key={value}
                          palette={palette}
                          testID={`edit-${key}-${value}`}
                          label={t(locale, `${key}_${value}` as StringKey)}
                          selected={(known?.style?.[key] ?? DEFAULTS[key]) === value}
                          onPress={() => setStyle(key, value)}
                        />
                      ))}
                    </View>
                  </View>
                ))}
                <View style={[styles.chips, styles.section]}>
                  <Chip
                    palette={palette}
                    testID="edit-up"
                    label={`↑ ${t(locale, 'moveUp')}`}
                    disabled={!up}
                    onPress={() => up && apply([up])}
                  />
                  <Chip
                    palette={palette}
                    testID="edit-down"
                    label={`↓ ${t(locale, 'moveDown')}`}
                    disabled={!down}
                    onPress={() => down && apply([down])}
                  />
                </View>
                <View style={styles.chips}>
                  {known ? (
                    <Chip
                      palette={palette}
                      testID="edit-hide"
                      label={t(locale, known.hidden ? 'show' : 'hide')}
                      onPress={() =>
                        apply([{ op: 'setComponentHidden', ...target, hidden: !known.hidden }])
                      }
                    />
                  ) : null}
                  <Chip
                    palette={palette}
                    testID="edit-delete"
                    label={t(locale, 'delete')}
                    danger
                    onPress={confirmDelete}
                  />
                </View>
                <Button
                  palette={palette}
                  testID="edit-close"
                  variant="text"
                  label={t(locale, 'cancel')}
                  onPress={close}
                />
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#2A242066' },
  sheet: { maxHeight: '85%' },
  content: { gap: 14 },
  section: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 38,
    justifyContent: 'center',
  },
  form: { gap: 14 },
  field: { gap: 6 },
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', gap: 12 },
});
