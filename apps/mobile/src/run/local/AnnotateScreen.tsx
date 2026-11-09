import { Canvas, Group, Paragraph, Path, Rect } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useEffect, useReducer, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { t } from '../../i18n';
import { textLayout } from '../../runtime/skia';
import type { ImageAnnotation } from '../../runtime/annotations';
import { annotationPaths, annotationSvg, markRect } from '../../runtime/annotations';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';
import { Slider } from './Slider';
import {
  annotationLayout,
  reduceAnnotations,
  type AnnotationState,
  type AnnotationAction,
  type AnnotationTool,
  type Measure,
} from './annotation-state';

const COLORS = ['#EF4444', '#F59E0B', '#2563EB', '#16A34A', '#FFFFFF', '#000000', '#FACC15'];
const TOOLS: AnnotationTool[] = [
  'text',
  'note',
  'arrow',
  'box',
  'pen',
  'highlight',
  'erase',
  'mosaic',
];
const TOOL_LABEL = {
  text: 'annotateText',
  note: 'annotateNote',
  arrow: 'annotateArrow',
  box: 'annotateBox',
  pen: 'annotatePen',
  highlight: 'annotateHighlight',
  erase: 'annotateErase',
  mosaic: 'annotateMosaic',
} as const;

/** 文字框的大小（原图点），预览、点选、导出用同一个排版。 */
const measure: Measure = (text, fontSize) => {
  const { width, height } = textLayout(text, fontSize);
  return { width, height };
};

function TextMark({
  mark,
  scale,
  selected,
}: {
  mark: Extract<ImageAnnotation, { kind: 'text' }>;
  scale: number;
  selected: boolean;
}) {
  const layout = textLayout(mark.text, mark.fontSize * scale, mark.color);
  const x = mark.point.x * scale;
  const y = mark.point.y * scale;
  return (
    <Group
      transform={[{ rotate: ((mark.rotation ?? 0) * Math.PI) / 180 }]}
      origin={{ x: x + layout.width / 2, y: y + layout.height / 2 }}>
      {mark.fill ? (
        <Rect x={x} y={y} width={layout.width} height={layout.height} color={mark.fill} />
      ) : null}
      <Paragraph paragraph={layout.paragraph} x={x + layout.pad} y={y + layout.pad} width={1e5} />
      {selected ? (
        <Rect
          x={x}
          y={y}
          width={layout.width}
          height={layout.height}
          color="#14B8A6"
          style="stroke"
          strokeWidth={2}
        />
      ) : null}
    </Group>
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
  const defaultText = t(locale, 'annotateDefaultText');
  const [state, dispatch] = useReducer(
    (s: AnnotationState, a: AnnotationAction) => reduceAnnotations(s, a, sizes, measure),
    null,
    (): AnnotationState => ({
      index: 0,
      marks: items.map(() => []),
      box: { width: 0, height: 0 },
      tool: input.tool ?? 'arrow',
      color: COLORS[0]!,
      text: '',
      start: null,
      draft: null,
      selected: null,
    }),
  );
  // 这一页认出的行（原图点）：新写的字照最近的一行定字号。只在本机认、只在用文字工具时认，不存不发。
  const textTool = state.tool === 'text' || state.tool === 'note';
  const pageLines = state.lines?.[state.index];
  useEffect(() => {
    if (!textTool || !input.lines || pageLines) return;
    const at = state.index;
    dispatch({ type: 'lines', index: at, lines: [] });
    void input.lines(at).then(
      (found) => dispatch({ type: 'lines', index: at, lines: found }),
      () => undefined,
    );
  }, [textTool, state.index, pageLines, input]);
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) =>
        dispatch({
          type: 'grant',
          x: e.nativeEvent.locationX,
          y: e.nativeEvent.locationY,
          defaultText,
          ...(input.document ? { document: true } : {}),
        }),
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
  const picked = state.selected != null ? marks[state.selected] : undefined;
  const selected = picked?.kind === 'text' ? picked : null;
  const maxFont = Math.min(sizes[state.index]!.width, sizes[state.index]!.height) * 0.3;
  const activeColor = selected ? selected.color : state.color;
  const boxTool = state.tool === 'erase' || state.tool === 'mosaic';
  return (
    <LocalFrame
      palette={palette}
      title={`${t(locale, 'annotateTitle')}${items.length > 1 ? ` ${state.index + 1}/${items.length}` : ''}`}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, last ? 'localDone' : 'localNext')}
      onCancel={onCancel}
      // 弹键盘时不把页面挤小：唯一的输入框在最上面，键盘盖住的是页面下半截（2026-11-09 用户测试：
      // 页面一缩、整屏重排，正在打的字丢了）。
      onDone={() => (last ? onDone(state.marks) : dispatch({ type: 'next' }))}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolScroll}
        contentContainerStyle={styles.tools}>
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
              {t(locale, TOOL_LABEL[tool as keyof typeof TOOL_LABEL])}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {boxTool ? null : (
        <View style={styles.colors}>
          {COLORS.map((color, i) => (
            <Pressable
              key={color}
              testID={`annotate-color-${i}`}
              accessibilityRole="button"
              accessibilityLabel={t(locale, 'annotateColor', { n: i + 1 })}
              accessibilityState={{ selected: activeColor === color }}
              onPress={() =>
                selected
                  ? dispatch({ type: 'style', patch: { color } })
                  : dispatch({ type: 'color', color })
              }
              style={[
                styles.swatch,
                {
                  backgroundColor: color,
                  borderColor: activeColor === color ? palette.primary : palette.border,
                  borderWidth: activeColor === color ? 3 : 1,
                },
              ]}
            />
          ))}
        </View>
      )}
      {textTool ? (
        // 只有这一个输入框：没选中时写要放的字，选中时改选中的那段。不用 value 控制（屏幕重画时不会把正在打的字
        // 改回旧的），换了选中的那段就换一个输入框（key）显示它的字。
        <TextInput
          key={selected ? `mark-${state.index}-${state.selected}` : `draft-${state.index}`}
          testID="annotate-text"
          accessibilityLabel={t(locale, 'annotateText')}
          placeholder={t(locale, 'annotateTextHint')}
          placeholderTextColor={palette.muted}
          defaultValue={selected ? selected.text : state.text}
          onChangeText={(text) =>
            selected
              ? dispatch({ type: 'style', patch: { text } })
              : dispatch({ type: 'text', text })
          }
          returnKeyType="done"
          maxLength={160}
          style={[
            styles.input,
            palette.font('body', 16),
            { color: palette.text, borderColor: palette.border },
          ]}
        />
      ) : null}
      <Text style={[styles.hint, palette.font('body', 13), { color: palette.muted }]}>
        {t(locale, textTool ? 'annotateTap' : boxTool ? 'annotateDragBox' : 'annotateDrag')}
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
                        scale={scale}
                        selected={i === state.selected}
                      />,
                    ]
                  : mark.kind === 'erase' || mark.kind === 'mosaic'
                    ? [
                        <Rect
                          key={`${mark.kind}-${i}`}
                          x={markRect(mark).x * scale}
                          y={markRect(mark).y * scale}
                          width={markRect(mark).width * scale}
                          height={markRect(mark).height * scale}
                          color={mark.kind === 'erase' ? '#FFFFFF' : '#80808099'}
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
      {textTool ? (
        // 样式区一直占着位置（没选中时点不了）：放好一段字时页面不会被挤小、挪位置。
        <View
          testID="annotate-style"
          pointerEvents={selected ? 'auto' : 'none'}
          style={[styles.style, selected ? null : styles.idle]}>
          <View style={styles.row}>
            <Text style={[palette.font('body', 14), styles.rowLabel, { color: palette.text }]}>
              {t(locale, 'annotateSize')}
            </Text>
            <View style={styles.rowSlider}>
              <Slider
                testID="annotate-size"
                label={t(locale, 'annotateSize')}
                palette={palette}
                min={10}
                max={maxFont}
                value={selected?.fontSize ?? 10}
                onChange={(fontSize) => dispatch({ type: 'style', patch: { fontSize } })}
              />
            </View>
          </View>
          <View style={styles.row}>
            <Text style={[palette.font('body', 14), styles.rowLabel, { color: palette.text }]}>
              {t(locale, 'annotateRotate')} {Math.round(selected?.rotation ?? 0)}°
            </Text>
            <View style={styles.rowSlider}>
              <Slider
                testID="annotate-rotation"
                label={t(locale, 'annotateRotate')}
                palette={palette}
                min={0}
                max={359}
                value={selected?.rotation ?? 0}
                onChange={(rotation) => dispatch({ type: 'style', patch: { rotation } })}
              />
            </View>
          </View>
          <Pressable
            testID="annotate-delete"
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'remove' })}>
            <Text style={[palette.font('bodyBold', 15), { color: palette.danger }]}>
              {t(locale, 'annotateDelete')}
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  toolScroll: { flexGrow: 0 },
  tools: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  tool: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  style: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  idle: { opacity: 0.35 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { width: 76 },
  rowSlider: { flex: 1 },
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
