import type { Registry } from '../registry';
import type { IconName } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 房间工具栏的图标（D-364）：一个工具（例如「图片处理」）有很多动作，用工具的图标时一整排都一样。
// 这里按动作给图标：先看完整的动作 ID，再看动作名（点后面那段，旋转、压缩这类各工具通用），都没有时用工具的图标。
// 这些图标只在房间里用，不在 ICON_NAMES（配置和 AI 能写的白名单）里，AI 改不了也看不到。

export const TOOL_ICON_NAMES = [
  'rotate',
  'crop',
  'pencil',
  'redact',
  'tune',
  'wand',
  'convert',
  'resize',
  'compress',
  'privacy',
  'stitch',
  'gif',
  'grid',
  'watermark',
  'enhance',
  'pdf',
  'table',
  'pages',
  'form',
  'select',
  'split',
  'number',
  'stamp',
  'lock',
  'camera',
  'trim',
  'speed',
  'music',
  'mute',
  'denoise',
  'volume',
  'captions',
  'share',
  'save',
  'preview',
] as const;
export type ToolIconName = (typeof TOOL_ICON_NAMES)[number];
export type DeskIcon = IconName | ToolIconName;

/** 完整的动作 ID（动作名在不同工具里意思不一样的）。 */
const BY_ID: Readonly<Record<string, DeskIcon>> = {
  'image.idPhoto': 'person',
  'image.printSheet': 'printer',
  'image.removeBackground': 'wand',
  'scan.detect': 'scan',
  'scan.enhance': 'enhance',
  'pdf.fromImages': 'pdf',
  'pdf.fromDocument': 'pdf',
  'pdf.toImages': 'photo',
  'pdf.extractText': 'text',
  'pdf.selectPages': 'select',
  'ocr.recognize': 'text',
  'ocr.toExcel': 'table',
  'ocr.toWord': 'document',
  'qr.read': 'qrcode',
  'video.frame': 'camera',
  'video.audio': 'music',
  'audio.fromVideo': 'audio',
  'audio.transcribe': 'note',
};

/** 动作名（点后面那段）：同一种操作在图片、PDF、视频、音频里用同一个图标。 */
const BY_VERB: Readonly<Record<string, DeskIcon>> = {
  rotate: 'rotate',
  crop: 'crop',
  annotate: 'pencil',
  redact: 'redact',
  adjust: 'tune',
  convert: 'convert',
  resize: 'resize',
  compress: 'compress',
  stripMetadata: 'privacy',
  stitch: 'stitch',
  toGif: 'gif',
  grid: 'grid',
  watermark: 'watermark',
  pages: 'pages',
  sign: 'signature',
  fillForm: 'form',
  split: 'split',
  pageNumbers: 'number',
  stamp: 'stamp',
  protect: 'lock',
  trim: 'trim',
  speed: 'speed',
  mute: 'mute',
  merge: 'merge',
  denoise: 'denoise',
  volume: 'volume',
  subtitles: 'captions',
};

/** 工具栏上一个动作的图标。 */
export function deskToolIcon(action: ActionDefinition, registry: Registry): DeskIcon {
  const verb = action.id.slice(action.id.indexOf('.') + 1);
  return (
    BY_ID[action.id] ??
    BY_VERB[verb] ??
    registry.tools.get(registry.actionOwner.get(action.id) ?? '')?.icon ??
    'bolt'
  );
}
