import { z } from 'zod';

import { GIF_MAX_SECONDS, VIDEO_QUALITIES } from '../media';
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
    id: 'video.crop',
    label: { en: 'Crop video to a shape', zh: '视频裁成指定比例' },
    description: {
      en: 'Center-crop each video to 9:16, 1:1, 4:5 or 16:9. The outside edges are removed, not stretched. Sound and duration are kept. This version crops the center; it does not let the user reposition the crop.',
      zh: '把每段视频居中裁成 9:16、1:1、4:5 或 16:9，裁去边缘，不拉伸。声音、时长保留。此版只居中裁剪，不能手动移动位置。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ ratio: z.enum(['9:16', '1:1', '4:5', '16:9']) }),
    fields: [
      {
        key: 'ratio',
        label: { en: 'Shape', zh: '比例' },
        kind: 'choice',
        options: [
          { value: '9:16', label: { en: '9:16 · portrait', zh: '9:16 · 竖屏' } },
          { value: '1:1', label: { en: '1:1 · square', zh: '1:1 · 正方形' } },
          { value: '4:5', label: { en: '4:5 · portrait', zh: '4:5 · 竖版' } },
          { value: '16:9', label: { en: '16:9 · landscape', zh: '16:9 · 横屏' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'video.rotate',
    label: { en: 'Rotate video', zh: '旋转视频' },
    description: {
      en: 'Rotate each video clockwise by 90, 180 or 270 degrees, relative to its displayed orientation. iPhone keeps the encoded video and changes its transform; Android re-encodes. Sound and duration are kept.',
      zh: '相对当前画面顺时针旋转 90、180 或 270 度。iPhone 只改旋转信息，不重新编码画面；Android 会重新编码。声音和时长保留。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
    fields: [
      {
        key: 'degrees',
        label: { en: 'Clockwise', zh: '顺时针' },
        kind: 'choice',
        options: [
          { value: 90, label: { en: '90° (right)', zh: '90°（向右）' } },
          { value: 180, label: { en: '180° (upside down)', zh: '180°（倒过来）' } },
          { value: 270, label: { en: '270° (left)', zh: '270°（向左）' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'video.audio',
    label: { en: 'Change background music', zh: '换背景音乐' },
    description: {
      en: 'Choose a music file locally when this runs, then use it as the soundtrack for each video. Set how much original sound to keep (0–100%) and whether shorter music repeats. Longer music is trimmed. Output keeps each video’s duration; no file paths or music content go to AI.',
      zh: '运行时在本机选一个音乐文件，为每段视频配乐。设置保留的原声音量（0–100%）以及较短音乐是否循环；较长音乐截到视频结束。结果时长不变，音乐内容和路径不发给 AI。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ originalVolume: z.number().int().min(0).max(100), loop: z.boolean() }),
    fields: [
      {
        key: 'originalVolume',
        label: { en: 'Original sound', zh: '原声音量' },
        kind: 'number',
        unit: '%',
        min: 0,
        max: 100,
        step: 10,
      },
      { key: 'loop', label: { en: 'Repeat shorter music', zh: '音乐较短时循环' }, kind: 'toggle' },
    ],
    presets: [
      {
        id: 'replace',
        label: { en: 'Music only', zh: '只留音乐' },
        values: { originalVolume: 0, loop: true },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'video.mute',
    label: { en: 'Remove video sound', zh: '去掉视频声音' },
    description: {
      en: 'Remove all sound from each video and export an MP4 with no audio track. Video is re-encoded; the source file is kept.',
      zh: '去掉每段视频的全部声音，导出没有音轨的 MP4。画面会重新编码，原文件保留。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'video.frame',
    label: { en: 'Save a video frame', zh: '截一帧存成照片' },
    description: {
      en: 'Choose a time in each video on the device and save the nearest decoded frame as a full-resolution JPEG, upright. Output is images, so image actions and saving to Photos can follow.',
      zh: '在手机上为每段视频选一个时间点，把最接近的画面存成原尺寸、已摆正的 JPEG。输出图片，可以继续接图片处理或存到相册。',
    },
    input: ['video'],
    output: 'images',
    params: z.strictObject({}),
    fields: [],
    local: 'frameMedia',
    requires: [],
  },
  {
    id: 'video.merge',
    label: { en: 'Join videos', zh: '拼接视频' },
    description: {
      en: 'Join 2–10 videos in order into one MP4. Put file.order before this step so the user can arrange the clips. Uses the first clip’s size and frame rate; other aspect ratios fit inside with black borders. Sound is kept; silent clips stay silent.',
      zh: '把 2–10 段视频按顺序接成一个 MP4。前面加 file.order 让用户调整顺序。尺寸、帧率以第一段为准；不同比例居中留黑边，保留完整画面。保留声音，无声片段保持静音。',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
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
      // D-199：写上常见的限制，用户一看就知道选哪个（各平台的限制上线前再核对）。
      {
        id: '10mb',
        label: { en: '10 MB · Discord', zh: '10 MB · Discord' },
        values: { by: 'size', maxMB: 10, quality: '720p' },
      },
      {
        id: '25mb',
        label: { en: '25 MB · email attachment', zh: '25 MB · 邮件附件' },
        values: { by: 'size', maxMB: 25, quality: '720p' },
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
    // D-184：iOS 用系统 ImageIO 写 GIF，Android 用 morph-media 里自己写的编码器（GifEncoder.kt）。
    id: 'video.toGif',
    label: { en: 'Video to GIF', zh: '视频转 GIF' },
    description: {
      en: `Turn each video into an animated GIF (at most ${GIF_MAX_SECONDS} seconds; put "Trim" before it for a longer video). GIFs have no sound and get large quickly: a smaller width and fewer frames per second keep them small.`,
      zh: `把每个视频变成动图 GIF（最长 ${GIF_MAX_SECONDS} 秒；视频更长时前面加「剪一段」）。GIF 没有声音，而且很容易变大：宽度小一些、每秒帧数少一些就会小很多。`,
    },
    input: ['video'],
    output: 'images',
    params: z.strictObject({
      width: z.number().int().min(160).max(800),
      fps: z.number().int().min(4).max(20),
    }),
    fields: [
      {
        key: 'width',
        label: { en: 'Width', zh: '宽度' },
        kind: 'choice',
        options: [
          { value: 320, label: { en: '320 px (small)', zh: '320 像素（小）' } },
          { value: 480, label: { en: '480 px', zh: '480 像素' } },
          { value: 640, label: { en: '640 px (sharp)', zh: '640 像素（清楚）' } },
        ],
      },
      {
        key: 'fps',
        label: { en: 'Frames per second', zh: '每秒帧数' },
        kind: 'choice',
        options: [
          { value: 8, label: { en: '8 (smallest)', zh: '8（最小）' } },
          { value: 12, label: { en: '12', zh: '12' } },
          { value: 15, label: { en: '15 (smooth)', zh: '15（流畅）' } },
        ],
      },
    ],
    presets: [
      { id: 'small', label: { en: 'Small', zh: '小' }, values: { width: 320, fps: 8 } },
      { id: 'medium', label: { en: 'Medium', zh: '中' }, values: { width: 480, fps: 12 } },
      { id: 'sharp', label: { en: 'Sharp', zh: '清楚' }, values: { width: 640, fps: 15 } },
    ],
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
      'video-crop',
      ['Crop video to a shape', '视频裁成指定比例'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'crop', action: 'video.crop', params: { ratio: '9:16' }, ask: ['ratio'] },
      ],
    ),
    wf(
      'video-rotate',
      ['Rotate video', '旋转视频'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'rotate', action: 'video.rotate', params: { degrees: 90 }, ask: ['degrees'] },
      ],
    ),
    wf(
      'video-audio',
      ['Change background music', '换背景音乐'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        {
          id: 'music',
          action: 'video.audio',
          params: { originalVolume: 0, loop: true },
          ask: ['originalVolume', 'loop'],
        },
      ],
    ),
    wf(
      'video-mute',
      ['Remove video sound', '去掉视频声音'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'mute', action: 'video.mute', params: {} },
      ],
    ),
    wf(
      'video-frame',
      ['Save a video frame', '截一帧存成照片'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'frame', action: 'video.frame', params: {} },
      ],
    ),
    wf(
      'video-merge',
      ['Join videos', '拼接视频'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 2, max: 10 } },
        { id: 'order', action: 'file.order', params: {} },
        { id: 'merge', action: 'video.merge', params: {} },
      ],
    ),
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
        // 每次问从相册还是从「文件」选：电脑上下载的 MKV、AVI 一般在「文件」里（D-185）。
        {
          id: 'pick',
          action: 'in.videos',
          params: { source: 'library', min: 1, max: 10 },
          ask: ['source'],
        },
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
    wf(
      'video-gif',
      ['Video to GIF', '视频转 GIF'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 1 } },
        { id: 'trim', action: 'video.trim', params: {} },
        { id: 'run', action: 'video.toGif', params: { width: 480, fps: 12 }, ask: ['width'] },
      ],
    ),
  ];
}

export const videoTool: ToolDefinition = {
  id: VIDEO_TOOL_ID,
  version: '1.7.0',
  name: { en: 'Video', zh: '视频' },
  description: {
    en: 'Make videos smaller, convert them to MP4, trim them and turn them into GIFs, on this device.',
    zh: '在本机压缩视频、转成 MP4、剪一段、转成 GIF 动图。',
  },
  icon: 'video',
  aliases: ['video', 'videos', 'video tool', 'movie', 'gif', '视频', '视频工具', '影片', '动图'],
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
            'Everything runs on this device; nothing is uploaded.',
            '全部在本机处理，不会上传。',
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
