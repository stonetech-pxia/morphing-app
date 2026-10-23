import { z } from 'zod';

import { VIDEO_QUALITIES } from '../media';
import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import type { ActionDefinition } from '../workflow/contract';

// 视频工具的清单（D-143、D-146）：压缩、转成 MP4、剪一段。编码在 App 的原生模块 morph-media 里
// （iOS AVFoundation、Android Media3，D-141）；码率和分辨率的计算在 core/media.ts。
// 输出一律是 MP4（H.264 + AAC），微信、邮件、电脑和老手机都能放（D-143）。

export const VIDEO_TOOL_ID = 'video';
export const VIDEO_PAGE_ID = 'tool-video';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

export const VIDEO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'video.compress',
    label: { en: 'Make video smaller', zh: '压缩视频' },
    description: {
      en: 'Make each video smaller: by size (at most N MB; the resolution drops as needed) or by quality (1080p / 720p / 480p). The result is an MP4 that plays everywhere.',
      zh: '把每个视频压小：按大小（不超过 N MB，需要时自动降低分辨率）或按画质（1080p / 720p / 480p）。结果是哪里都能放的 MP4。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({
      by: z.enum(['size', 'quality']),
      maxMB: z.number().min(1).max(2000),
      quality: z.enum(VIDEO_QUALITIES),
    }),
    fields: [
      {
        key: 'by',
        label: { en: 'Make it', zh: '压缩方式' },
        kind: 'choice',
        options: [
          { value: 'size', label: { en: 'Smaller than a size', zh: '按大小' } },
          { value: 'quality', label: { en: 'Lower quality', zh: '按画质' } },
        ],
      },
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过' },
        kind: 'number',
        unit: 'MB',
        min: 1,
        max: 2000,
        step: 1,
        showIf: { key: 'by', equals: ['size'] },
      },
      {
        key: 'quality',
        label: { en: 'Quality', zh: '画质' },
        kind: 'choice',
        options: [
          { value: '1080p', label: { en: '1080p (sharp)', zh: '1080p（清楚）' } },
          { value: '720p', label: { en: '720p (good)', zh: '720p（够用）' } },
          { value: '480p', label: { en: '480p (smallest)', zh: '480p（最小）' } },
        ],
        showIf: { key: 'by', equals: ['quality'] },
      },
    ],
    presets: [
      {
        id: '20mb',
        label: { en: '20 MB', zh: '20 MB' },
        values: { by: 'size', maxMB: 20, quality: '720p' },
      },
      {
        id: '10mb',
        label: { en: '10 MB', zh: '10 MB' },
        values: { by: 'size', maxMB: 10, quality: '720p' },
      },
      {
        id: '50mb',
        label: { en: '50 MB', zh: '50 MB' },
        values: { by: 'size', maxMB: 50, quality: '720p' },
      },
      {
        id: '100mb',
        label: { en: '100 MB', zh: '100 MB' },
        values: { by: 'size', maxMB: 100, quality: '720p' },
      },
      {
        id: '720p',
        label: { en: '720p', zh: '720p' },
        values: { by: 'quality', maxMB: 20, quality: '720p' },
      },
      {
        id: '480p',
        label: { en: '480p', zh: '480p' },
        values: { by: 'quality', maxMB: 20, quality: '480p' },
      },
    ],
    requires: [],
  },
  {
    id: 'video.convert',
    label: { en: 'Convert to MP4', zh: '转成 MP4' },
    description: {
      en: 'Convert videos (MOV, HEVC…) to MP4 with H.264 so that other people can open them; quality and resolution stay about the same.',
      zh: '把视频（MOV、HEVC 等）转成 H.264 的 MP4，别人一般都能打开；画质和分辨率基本不变。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ format: z.enum(['mp4']) }),
    fields: [
      {
        key: 'format',
        label: { en: 'Format', zh: '格式' },
        kind: 'choice',
        options: [{ value: 'mp4', label: { en: 'MP4 (H.264)', zh: 'MP4（H.264）' } }],
      },
    ],
    presets: [{ id: 'mp4', label: { en: 'MP4', zh: 'MP4' }, values: { format: 'mp4' } }],
    requires: [],
  },
  {
    id: 'video.trim',
    label: { en: 'Trim', zh: '剪一段' },
    description: {
      en: 'The user picks the start and end of each video on the device; only that part is kept (no re-encoding, so it is quick and keeps the quality).',
      zh: '用户在手机上选每个视频的开始和结束，只留中间这一段（不重新编码，很快，画质不变）。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({}),
    fields: [],
    local: 'trimMedia',
    requires: [],
  },
];

/** 单功能工作流（D-061）：工具页上每个一个运行卡片。 */
export function videoWorkflows(locale: Locale): Workflow[] {
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    toolId: VIDEO_TOOL_ID,
    name: t(locale, ...name),
    steps,
  });
  return [
    wf(
      'video-compress',
      ['Make videos smaller', '压缩视频'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        {
          id: 'run',
          action: 'video.compress',
          params: { by: 'size', maxMB: 20, quality: '720p' },
          ask: ['by', 'maxMB', 'quality'],
        },
      ],
    ),
    wf(
      'video-convert',
      ['Convert to MP4', '转成 MP4'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'run', action: 'video.convert', params: { format: 'mp4' } },
      ],
    ),
    wf(
      'video-trim',
      ['Trim a video', '剪一段'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 1 } },
        { id: 'run', action: 'video.trim', params: {} },
      ],
    ),
  ];
}

export const videoTool: ToolDefinition = {
  id: VIDEO_TOOL_ID,
  version: '1.0.0',
  name: { en: 'Video', zh: '视频' },
  description: {
    en: 'Make videos smaller, convert them to MP4 and trim them, on this device.',
    zh: '在本机压缩视频、转成 MP4、剪一段。',
  },
  icon: 'video',
  aliases: ['video', 'videos', 'video tool', 'movie', '视频', '视频工具', '影片'],
  permissions: ['files.pick', 'files.write', 'photos.save'],
  actions: VIDEO_ACTIONS,
  createPage: (locale) => ({
    id: VIDEO_PAGE_ID,
    title: t(locale, 'Video', '视频'),
    icon: 'video',
    toolId: VIDEO_TOOL_ID,
    components: [
      {
        id: 'video-header',
        type: 'header',
        props: { title: t(locale, 'Video tools', '视频工具') },
      },
      {
        id: 'video-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Everything runs on this device; nothing is uploaded. Stay in Morph while a video is being processed.',
            '全部在本机处理，不会上传。处理视频时请留在 Morph 里。',
          ),
        },
      },
      ...videoWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
      {
        id: 'video-files',
        type: 'fileList',
        props: { title: t(locale, 'Videos', '视频文件'), limit: 10, mimeType: 'video/*' },
      },
    ],
  }),
  createWorkflows: videoWorkflows,
};
