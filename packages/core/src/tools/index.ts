import type { ToolDefinition } from '../registry';
import { imageTool } from './image';
import { ocrTool } from './ocr';
import { pdfTool } from './pdf';
import { scanTool } from './scan';

export * from './image';
export * from './ocr';
export * from './pdf';
export * from './scan';

/** 随 App 发布的内置工具目录。工具代码不随历史版本恢复（§7E）。 */
export const BUILTIN_TOOLS: readonly ToolDefinition[] = [pdfTool, imageTool, scanTool, ocrTool];
