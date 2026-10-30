import type { IconName, IconValue, ToolIconName } from '@morph/core';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Text } from 'react-native';

// 图标白名单（core 的 ICON_NAMES）→ 系统图标：iOS 用 SF Symbols，Android 用 Material Symbols。

type SymbolName = Extract<SymbolViewProps['name'], { ios?: unknown }>;

const SYMBOLS: Record<IconName, SymbolName> = {
  home: { ios: 'house.fill', android: 'home' },
  apps: { ios: 'square.grid.2x2.fill', android: 'apps' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  settings: { ios: 'gearshape.fill', android: 'settings' },
  document: { ios: 'doc.fill', android: 'description' },
  folder: { ios: 'folder.fill', android: 'folder' },
  star: { ios: 'star.fill', android: 'star' },
  heart: { ios: 'heart.fill', android: 'favorite' },
  bolt: { ios: 'bolt.fill', android: 'bolt' },
  calendar: { ios: 'calendar', android: 'calendar_month' },
  bookmark: { ios: 'bookmark.fill', android: 'bookmark' },
  inbox: { ios: 'tray.fill', android: 'inbox' },
  chart: { ios: 'chart.bar.fill', android: 'bar_chart' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  info: { ios: 'info.circle.fill', android: 'info' },
  lightbulb: { ios: 'lightbulb.fill', android: 'lightbulb' },
  merge: { ios: 'arrow.triangle.merge', android: 'merge' },
  link: { ios: 'link', android: 'link' },
  person: { ios: 'person.fill', android: 'person' },
  plus: { ios: 'plus', android: 'add' },
  search: { ios: 'magnifyingglass', android: 'search' },
  photo: { ios: 'photo.fill', android: 'image' },
  scan: { ios: 'doc.viewfinder', android: 'document_scanner' },
  text: { ios: 'text.viewfinder', android: 'text_fields' },
  qrcode: { ios: 'qrcode', android: 'qr_code' },
  archive: { ios: 'archivebox.fill', android: 'archive' },
  printer: { ios: 'printer.fill', android: 'print' },
  signature: { ios: 'signature', android: 'draw' },
  workflow: { ios: 'arrow.triangle.branch', android: 'account_tree' },
  video: { ios: 'video.fill', android: 'videocam' },
  audio: { ios: 'waveform', android: 'graphic_eq' },
  translate: { ios: 'translate', android: 'translate' },
  note: { ios: 'note.text', android: 'notes' },
};

/** 房间工具栏的动作图标（core 的 TOOL_ICON_NAMES，D-343）：不在白名单里，配置和 AI 用不到。 */
const TOOL_SYMBOLS: Record<ToolIconName, SymbolName> = {
  rotate: { ios: 'rotate.right', android: 'rotate_right' },
  crop: { ios: 'crop', android: 'crop' },
  pencil: { ios: 'pencil.tip', android: 'edit' },
  redact: { ios: 'eye.slash.fill', android: 'visibility_off' },
  tune: { ios: 'slider.horizontal.3', android: 'tune' },
  wand: { ios: 'wand.and.stars', android: 'auto_fix_high' },
  convert: { ios: 'arrow.triangle.2.circlepath', android: 'sync_alt' },
  resize: { ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full' },
  compress: { ios: 'arrow.down.right.and.arrow.up.left', android: 'compress' },
  privacy: { ios: 'location.slash.fill', android: 'location_off' },
  stitch: { ios: 'rectangle.split.1x2.fill', android: 'view_agenda' },
  gif: { ios: 'photo.stack.fill', android: 'gif_box' },
  grid: { ios: 'square.grid.3x3.fill', android: 'grid_on' },
  watermark: { ios: 'drop.fill', android: 'water_drop' },
  enhance: { ios: 'camera.filters', android: 'filter' },
  pdf: { ios: 'doc.richtext.fill', android: 'picture_as_pdf' },
  table: { ios: 'tablecells', android: 'table_chart' },
  pages: { ios: 'doc.on.doc.fill', android: 'auto_stories' },
  form: { ios: 'list.bullet.rectangle.fill', android: 'edit_note' },
  select: { ios: 'checklist', android: 'checklist' },
  split: { ios: 'square.split.2x1.fill', android: 'call_split' },
  number: { ios: 'number', android: 'format_list_numbered' },
  stamp: { ios: 'seal.fill', android: 'approval' },
  lock: { ios: 'lock.fill', android: 'lock' },
  camera: { ios: 'camera.viewfinder', android: 'photo_camera' },
  trim: { ios: 'scissors', android: 'content_cut' },
  speed: { ios: 'hare.fill', android: 'speed' },
  music: { ios: 'music.note', android: 'music_note' },
  mute: { ios: 'speaker.slash.fill', android: 'volume_off' },
  denoise: { ios: 'ear', android: 'hearing' },
  volume: { ios: 'speaker.wave.2.fill', android: 'volume_up' },
  captions: { ios: 'captions.bubble.fill', android: 'closed_caption' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  save: { ios: 'square.and.arrow.down', android: 'download' },
  preview: { ios: 'eye.fill', android: 'visibility' },
};

/** 系统菜单里用的 SF Symbol 名字（长按 Morph 图标的菜单，D-271）；emoji 没有。 */
export function iosSymbolName(name: IconValue): string | undefined {
  return name in SYMBOLS ? SYMBOLS[name as IconName].ios : undefined;
}

export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconValue | ToolIconName;
  size?: number;
  color: string;
}) {
  const symbol =
    name in SYMBOLS
      ? SYMBOLS[name as IconName]
      : name in TOOL_SYMBOLS
        ? TOOL_SYMBOLS[name as ToolIconName]
        : null;
  // 不是内置图标名的就是 emoji（schema 已校验），按原样显示。
  if (!symbol) {
    return (
      <Text
        allowFontScaling={false}
        style={{
          fontSize: Math.round(size * 0.92),
          lineHeight: Math.round(size * 1.15),
          textAlign: 'center',
          minWidth: size,
        }}>
        {name}
      </Text>
    );
  }
  return (
    <SymbolView
      name={symbol}
      size={size}
      tintColor={color}
      // 平台不支持系统图标时（例如 Web），用一个圆点占位，保证布局不变。
      fallback={<Text style={{ width: size, height: size, color, fontSize: size * 0.6 }}>●</Text>}
    />
  );
}

/**
 * 内核界面自己用的图标（草稿模式的按钮、发送、划屏介绍的示意图等，D-190）。不在 core 的白名单里：AI 和配置用不到它们。
 */
const UI_SYMBOLS = {
  chat: { ios: 'bubble.left.fill', android: 'chat' },
  undo: { ios: 'arrow.uturn.backward', android: 'undo' },
  done: { ios: 'checkmark', android: 'check' },
  close: { ios: 'xmark', android: 'close' },
  send: { ios: 'arrow.up', android: 'arrow_upward' },
  palette: { ios: 'paintpalette.fill', android: 'palette' },
  arrowRight: { ios: 'arrow.right', android: 'arrow_forward' },
  arrowDown: { ios: 'arrow.down', android: 'arrow_downward' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  edit: { ios: 'pencil', android: 'edit' },
  add: { ios: 'plus', android: 'add' },
} satisfies Record<string, SymbolName>;

export type UiIconName = keyof typeof UI_SYMBOLS;

export function UiIcon({
  name,
  size = 22,
  color,
}: {
  name: UiIconName;
  size?: number;
  color: string;
}) {
  return (
    <SymbolView
      name={UI_SYMBOLS[name]}
      size={size}
      tintColor={color}
      fallback={<Text style={{ width: size, height: size, color, fontSize: size * 0.6 }}>●</Text>}
    />
  );
}
