import { z } from 'zod';

import type { ToolDefinition } from '../registry';
import type { Locale } from '../schema';

// 内置 PDF 工具的清单（Tool Manifest）。动作的真实实现在 packages/tool-pdf（pdf-lib）
// 和 App 运行时中；这里只声明契约，供校验、预览和 mock AI 使用。

export const PDF_TOOL_ID = 'pdf';
export const PDF_PAGE_ID = 'tool-pdf';
export const PDF_MERGE_WORKFLOW_ID = 'pdf-merge';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

export const pdfTool: ToolDefinition = {
  id: PDF_TOOL_ID,
  version: '1.0.0',
  name: { en: 'PDF', zh: 'PDF' },
  description: {
    en: 'Merge PDF files on this device.',
    zh: '在本机合并 PDF 文件。',
  },
  icon: 'document',
  aliases: ['pdf', 'pdf tool', 'pdf 工具'],
  permissions: ['files.pick', 'files.write'],
  actions: [
    {
      id: 'pdf.merge',
      label: { en: 'Merge in order', zh: '按顺序合并' },
      description: {
        en: 'Merge the PDFs into one, in the order they were chosen.',
        zh: '把多个 PDF 按选择顺序合并成一个。',
      },
      input: ['pdf'],
      output: 'pdf',
      params: z.strictObject({}),
      fields: [],
      requires: [],
    },
  ],
  createPage: (locale) => ({
    id: PDF_PAGE_ID,
    title: 'PDF',
    icon: 'document',
    toolId: PDF_TOOL_ID,
    components: [
      {
        id: 'pdf-header',
        type: 'header',
        props: { title: t(locale, 'Merge PDFs', '合并 PDF') },
      },
      {
        id: 'pdf-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Pick two or more PDFs. They are merged in the order you pick them, entirely on this device.',
            '选择两个或更多 PDF，按选择顺序合并。全部在本机处理，不会上传。',
          ),
        },
      },
      { id: 'pdf-runner', type: 'workflowRunner', props: { workflowId: PDF_MERGE_WORKFLOW_ID } },
      {
        id: 'pdf-files',
        type: 'fileList',
        props: {
          title: t(locale, 'PDF files', 'PDF 文件'),
          limit: 10,
          mimeType: 'application/pdf',
        },
      },
    ],
  }),
  createWorkflows: (locale) => [
    {
      id: PDF_MERGE_WORKFLOW_ID,
      toolId: PDF_TOOL_ID,
      name: t(locale, 'Merge PDFs', '合并 PDF'),
      steps: [
        { id: 'select', action: 'in.files', params: { accept: 'pdf', min: 2, max: 20 } },
        { id: 'merge', action: 'pdf.merge', params: {} },
        {
          id: 'name',
          action: 'file.rename',
          params: { template: t(locale, '{sourceName}-merged', '{sourceName}-合并') },
          ask: ['template'],
        },
        { id: 'save', action: 'file.save', params: {} },
      ],
    },
  ],
};
