import type { ToolDefinition } from '../registry';
import { pdfTool } from './pdf';

export * from './pdf';

/** 随 App 发布的内置工具目录。工具代码不随历史版本恢复（§7E）。 */
export const BUILTIN_TOOLS: readonly ToolDefinition[] = [pdfTool];
