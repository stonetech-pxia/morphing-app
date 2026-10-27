import type { ToolDefinition } from '../registry';
import { audioTool } from './audio';
import { imageTool } from './image';
import { printTool, qrTool, splitTool, textTool, zipTool } from './more';
import { ocrTool } from './ocr';
import { pdfTool } from './pdf';
import { scanTool } from './scan';
import { translateTool } from './translate';
import { videoTool } from './video';

export * from './audio';
export * from './image';
export * from './more';
export * from './ocr';
export * from './pdf';
export * from './scan';
export * from './translate';
export * from './video';

/** 随 App 发布的内置工具目录。工具代码不随历史版本恢复（§7E）。 */
export const BUILTIN_TOOLS: readonly ToolDefinition[] = [
  pdfTool,
  imageTool,
  videoTool,
  audioTool,
  scanTool,
  ocrTool,
  translateTool,
  zipTool,
  qrTool,
  textTool,
  printTool,
  splitTool,
];
