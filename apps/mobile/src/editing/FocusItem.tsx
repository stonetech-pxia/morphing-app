import type { Component } from '@morph/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { t } from '../i18n';
import { LONG_PRESS_MS, type RenderEnv } from '../renderer/components';
import { Pill } from '../renderer/ui';

/** 单组件编辑不改变页面排版；分组里选中子项时，分组本身不变淡。 */
export function FocusItem({
  component,
  env,
  style,
  children,
}: {
  component: Component;
  env: RenderEnv;
  style?: StyleProp<ViewStyle>;
  children: (env: RenderEnv) => ReactNode;
}) {
  const focus = env.focus!;
  const active = focus.selectedId !== null;
  const selected = focus.selectedId === component.id;
  const contains =
    component.type === 'group' && component.children.some((c) => c.id === focus.selectedId);
  const open = () => env.edit?.(component.id);
  const { palette } = env;
  return (
    <Pressable
      testID={`component-${component.id}`}
      accessible={false}
      onPress={active ? () => undefined : undefined}
      onLongPress={open}
      delayLongPress={LONG_PRESS_MS}
      style={[style, { zIndex: selected || contains ? 10 : 0 }]}>
      <View
        pointerEvents={active && component.type !== 'group' ? 'none' : 'auto'}
        style={{ opacity: active && !selected && !contains ? 0.5 : 1 }}>
        {children({ ...env, interactive: active ? false : env.interactive, onLongPress: open })}
      </View>
      {selected ? (
        <>
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderWidth: 2,
                borderColor: palette.primary,
                borderRadius: palette.radius,
                transform: [{ scale: 1.03 }],
                shadowColor: '#000000',
                shadowOpacity: 0.15,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
              },
            ]}
          />
          <View
            testID={`single-toolbar-${component.id}`}
            style={[
              styles.toolbar,
              { backgroundColor: palette.surface, borderRadius: palette.controlRadius },
            ]}>
            <Pill
              palette={palette}
              label={t(env.locale, 'editPage')}
              testID={`single-edit-${component.id}`}
              onPress={() => focus.onEdit(component.id)}
            />
            <Pill
              palette={palette}
              label={t(env.locale, 'done')}
              testID={`single-done-${component.id}`}
              onPress={focus.onDone}
            />
          </View>
        </>
      ) : null}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  toolbar: {
    position: 'absolute',
    top: -18,
    right: 0,
    flexDirection: 'row',
    gap: 8,
    padding: 4,
    zIndex: 20,
  },
});
