import type { ToolDefinition } from '../registry';
import { imageTool } from './image';
import { printTool, qrTool, textTool, zipTool } from './more';
import { ocrTool } from './ocr';
import { pdfTool } from './pdf';
import { scanTool } from './scan';
import { translateTool } from './translate';

export * from './image';
export * from './more';
export * from './ocr';
export * from './pdf';
export * from './scan';
export * from './translate';

/** 随 App 发布的内置工具目录。工具代码不随历史版本恢复（§7E）。 */
export const BUILTIN_TOOLS: readonly ToolDefinition[] = [
  pdfTool,
  imageTool,
  scanTool,
  ocrTool,
  translateTool,
  zipTool,
  qrTool,
  textTool,
  printTool,
];
