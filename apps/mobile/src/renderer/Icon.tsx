import type { IconName, IconValue } from '@morph/core';
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

/** 系统菜单里用的 SF Symbol 名字（长按 Morph 图标的菜单，D-271）；emoji 没有。 */
export function iosSymbolName(name: IconValue): string | undefined {
  return name in SYMBOLS ? SYMBOLS[name as IconName].ios : undefined;
}

export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconValue;
  size?: number;
  color: string;
}) {
  // 不是内置图标名的就是 emoji（schema 已校验），按原样显示。
  if (!(name in SYMBOLS)) {
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
      name={SYMBOLS[name as IconName]}
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
