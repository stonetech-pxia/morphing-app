import { Canvas, Path, Text as SkiaText } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useReducer, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '../../i18n';
import { textLayout } from '../../runtime/skia';
import type { ImageAnnotation } from '../../runtime/annotations';
import { annotationPaths, annotationSvg } from '../../runtime/annotations';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';
import {
  annotationLayout,
  reduceAnnotations,
  type AnnotationState,
  type AnnotationAction,
  type AnnotationTool,
} from './annotation-state';

const COLORS = ['#EF4444', '#F59E0B', '#2563EB', '#16A34A', '#FFFFFF', '#000000'];
const TOOLS: AnnotationTool[] = ['text', 'arrow', 'box', 'pen'];

function TextMark({
  mark,
  size,
  scale,
}: {
  mark: Extract<ImageAnnotation, { kind: 'text' }>;
  size: { width: number; height: number };
  scale: number;
}) {
  const layout = textLayout(mark.text, mark.fontSize);
  const fit = Math.min(
    1,
    (size.width - mark.point.x) / layout.width,
    (size.height - mark.point.y) / layout.height,
  );
  layout.font.setSize(layout.font.getSize() * fit * scale);
  return (
    <SkiaText
      text={mark.text}
      x={(mark.point.x + 4 * fit) * scale}
      y={(mark.point.y + layout.baseline * fit) * scale}
      font={layout.font}
      color={mark.color}
    />
  );
}

export function AnnotateScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'annotate'>) {
  const { items } = input;
  const sizes = items.map((it) => ({ width: it.width ?? 1, height: it.height ?? 1 }));
  const [state, dispatch] = useReducer(
    (s: AnnotationState, a: AnnotationAction) => reduceAnnotations(s, a, sizes),
    null,
    (): AnnotationState => ({
      index: 0,
      marks: items.map(() => []),
      box: { width: 0, height: 0 },
      tool: 'arrow',
      color: COLORS[0]!,
      text: '',
      start: null,
      draft: null,
    }),
  );
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) =>
        dispatch({ type: 'grant', x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }),
      onPanResponderMove: (_e, g) => dispatch({ type: 'move', dx: g.dx, dy: g.dy }),
      onPanResponderRelease: () => dispatch({ type: 'end' }),
      onPanResponderTerminate: () => dispatch({ type: 'end' }),
    }),
  );
  const item = items[state.index]!;
  const layout = annotationLayout(state.box, sizes[state.index]!);
  const { scale } = layout;
  const marks = state.marks[state.index]!;
  const preview = state.draft ? [...marks, state.draft] : marks;
  const last = state.index === items.length - 1;
  return (
    <LocalFrame
      palette={palette}
      title={`${t(locale, 'annotateTitle')}${items.length > 1 ? ` ${state.index + 1}/${items.length}` : ''}`}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, last ? 'localDone' : 'localNext')}
      onCancel={onCancel}
      onDone={() => (last ? onDone(state.marks) : dispatch({ type: 'next' }))}
      avoidKeyboard>
      <View style={styles.tools}>
        {TOOLS.map((tool) => (
          <Pressable
            key={tool}
            testID={`annotate-tool-${tool}`}
            accessibilityRole="button"
            accessibilityState={{ selected: state.tool === tool }}
            onPress={() => dispatch({ type: 'tool', tool })}
            style={[
              styles.tool,
              { backgroundColor: state.tool === tool ? palette.primary : palette.surface },
            ]}>
            <Text
              style={[
                palette.font('bodyBold', 14),
                { color: state.tool === tool ? palette.onPrimary : palette.text },
              ]}>
              {t(
                locale,
                tool === 'text'
                  ? 'annotateText'
                  : tool === 'arrow'
                    ? 'annotateArrow'
                    : tool === 'box'
                      ? 'annotateBox'
                      : 'annotatePen',
              )}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.colors}>
        {COLORS.map((color, i) => (
          <Pressable
            key={color}
            testID={`annotate-color-${i}`}
            accessibilityRole="button"
            accessibilityLabel={t(locale, 'annotateColor', { n: i + 1 })}
            accessibilityState={{ selected: state.color === color }}
            onPress={() => dispatch({ type: 'color', color })}
            style={[
              styles.swatch,
              {
                backgroundColor: color,
                borderColor: state.color === color ? palette.primary : palette.border,
                borderWidth: state.color === color ? 3 : 1,
              },
            ]}
          />
        ))}
      </View>
      {state.tool === 'text' ? (
        <TextInput
          testID="annotate-text"
          accessibilityLabel={t(locale, 'annotateText')}
          placeholder={t(locale, 'annotateTextHint')}
          placeholderTextColor={palette.muted}
          value={state.text}
          onChangeText={(text) => dispatch({ type: 'text', text })}
          maxLength={160}
          style={[
            styles.input,
            palette.font('body', 16),
            { color: palette.text, borderColor: palette.border },
          ]}
        />
      ) : null}
      <Text style={[styles.hint, palette.font('body', 13), { color: palette.muted }]}>
        {t(locale, state.tool === 'text' ? 'annotateTap' : 'annotateDrag')}
      </Text>
      <View
        testID="annotate-area"
        style={styles.area}
        onLayout={(e) =>
          dispatch({
            type: 'layout',
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }>
        {scale > 0 ? (
          <View
            testID="annotate-drawing"
            style={[
              styles.picture,
              { left: layout.left, top: layout.top, width: layout.width, height: layout.height },
            ]}
            {...responder.panHandlers}>
            <Image
              pointerEvents="none"
              source={{ uri: item.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="fill"
            />
            <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
              {preview.flatMap((mark, i) =>
                mark.kind === 'text'
                  ? [
                      <TextMark
                        key={`text-${i}`}
                        mark={mark}
                        size={sizes[state.index]!}
                        scale={scale}
                      />,
                    ]
                  : annotationPaths(mark).map((points, j) => (
                      <Path
                        key={`${i}-${j}`}
                        path={annotationSvg(
                          points.map((p) => ({ x: p.x * scale, y: p.y * scale })),
                        )}
                        color={mark.color}
                        style="stroke"
                        strokeWidth={mark.width * scale}
                        strokeCap="round"
                        strokeJoin="round"
                      />
                    )),
              )}
            </Canvas>
            {preview.map((mark, i) =>
              mark.kind === 'text' ? (
                <View
                  key={i}
                  testID={`annotate-label-${i}`}
                  accessible
                  accessibilityLabel={mark.text}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: mark.point.x * scale,
                    top: mark.point.y * scale,
                    width: mark.fontSize * scale,
                    height: mark.fontSize * scale,
                  }}
                />
              ) : null,
            )}
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text testID="annotate-count" style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'annotateCount', { n: marks.length })}
        </Text>
        <Pressable
          testID="annotate-undo"
          disabled={!marks.length}
          onPress={() => dispatch({ type: 'undo' })}>
          <Text
            style={[
              palette.font('bodyBold', 15),
              { color: marks.length ? palette.primaryText : palette.muted },
            ]}>
            {t(locale, 'annotateUndo')}
          </Text>
        </Pressable>
      </View>
    </LocalFrame>
  );
}
const styles = StyleSheet.create({
  tools: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  tool: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  colors: { flexDirection: 'row', justifyContent: 'space-evenly', padding: 12 },
  swatch: { height: 36, width: 36, borderRadius: 18 },
  input: {
    marginHorizontal: 16,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  hint: { paddingHorizontal: 16 },
  area: { flex: 1, margin: 12, backgroundColor: '#88888822' },
  picture: { position: 'absolute', overflow: 'hidden' },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
