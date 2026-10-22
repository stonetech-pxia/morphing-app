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
      id: 'pdf.selectFiles',
      label: { en: 'Choose PDF files', zh: '选择 PDF 文件' },
      params: z
        .strictObject({
          min: z.number().int().min(1).max(20),
          max: z.number().int().min(1).max(20),
        })
        .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
      reads: [],
      writes: ['files'],
      interactive: true,
      requires: ['files.pick'],
    },
    {
      id: 'pdf.merge',
      label: { en: 'Merge in order', zh: '按顺序合并' },
      params: z.strictObject({}),
      reads: ['files'],
      writes: ['document'],
      interactive: false,
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
        { id: 'select', action: 'pdf.selectFiles', params: { min: 2, max: 20 } },
        { id: 'merge', action: 'pdf.merge', params: {} },
        {
          id: 'name',
          action: 'ui.askFileName',
          params: { defaultTemplate: t(locale, '{sourceName}-merged', '{sourceName}-合并') },
        },
        {
          id: 'save',
          action: 'file.save',
          params: { nameTemplate: t(locale, '{sourceName}-merged', '{sourceName}-合并') },
        },
      ],
    },
  ],
};
