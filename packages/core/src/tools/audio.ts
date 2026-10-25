import { z } from 'zod';

import { AUDIO_FORMATS, AUDIO_QUALITIES } from '../audio';
import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import {
  SPEECH_LANGUAGES,
  SPEECH_LANGUAGE_NAMES,
  SPEECH_MODEL_PACKS,
  SPEECH_MODELS,
  type SpeechModel,
} from '../speech';
import type { ActionDefinition } from '../workflow/contract';

// 音频工具（D-152–D-156）：语音转文字、压小 / 转格式、剪一段、几段合成一段、从视频里取声音。
// 编码在 App 的原生模块 morph-media 里（iOS AVFoundation、Android Media3），语音转文字在 morph-speech 里
// （iOS 系统识别，Android whisper.cpp，D-150、D-151）。全部在本机处理；识别出的文字不发给 AI（D-036）。

export const AUDIO_TOOL_ID = 'audio';
export const AUDIO_PAGE_ID = 'tool-audio';

const t = (locale: Locale, en: string, zh: string) => (locale === 'zh' ? zh : en);

const formatField = {
  key: 'format',
  label: { en: 'Format', zh: '格式' },
  kind: 'choice' as const,
  options: [
    { value: 'm4a', label: { en: 'M4A (small, plays everywhere)', zh: 'M4A（小，哪里都能放）' } },
    { value: 'wav', label: { en: 'WAV (uncompressed, large)', zh: 'WAV（不压缩，很大）' } },
    {
      value: 'mp3',
      label: { en: 'MP3 (for old players and car stereos)', zh: 'MP3（老播放器、车载音响）' },
    },
  ],
};

export const AUDIO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'audio.volume',
    label: { en: 'Adjust volume', zh: '调整音量' },
    description: {
      en: 'Adjust audio or video sound locally. Normal aims for -16 LUFS; manual changes gain in dB. Gain is limited to avoid clipping (-1 dBFS sample peak), so very dynamic material may stay quieter than the target. Audio becomes M4A; video remains video (MP4, picture re-encoded). Silence stays silent.',
      zh: '在本机调整音频或视频的声音。自动尽量达到 -16 LUFS，手动按 dB 调整。增益受峰值限制（-1 dBFS）以避免削波，动态范围大的内容可能达不到目标。音频输出 M4A，视频仍输出视频（MP4，画面重新编码）。静音保持静音。',
    },
    input: ['audio', 'video'],
    output: 'same',
    params: z.strictObject({ mode: z.enum(['normal', 'db']), db: z.number().min(-24).max(24) }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Volume', zh: '音量' },
        kind: 'choice',
        options: [
          { value: 'normal', label: { en: 'Normal volume', zh: '调整到正常音量' } },
          { value: 'db', label: { en: 'Adjust manually', zh: '手动调整' } },
        ],
      },
      {
        key: 'db',
        label: { en: 'Gain (dB)', zh: '调整幅度（dB）' },
        kind: 'number',
        min: -24,
        max: 24,
        step: 1,
        showIf: { key: 'mode', equals: ['db'] },
      },
    ],
    presets: [
      {
        id: 'normal',
        label: { en: 'Normal volume', zh: '正常音量' },
        values: { mode: 'normal', db: 0 },
      },
    ],
    requires: [],
  },
  {
    id: 'audio.transcribe',
    label: { en: 'Speech to text', zh: '语音转文字' },
    description: {
      en: 'Turn recordings into text on this device (one language per run). Words may be wrong, especially with noise or accents. The first use of a language may need a download. The text stays on this device.',
      zh: '在本机把录音转成文字（每次一种语言）。有噪音或口音时可能有错字。第一次用某种语言时可能要下载。文字只留在本机。',
    },
    input: ['audio'],
    output: 'text',
    params: z.strictObject({ lang: z.enum(SPEECH_LANGUAGES), model: z.enum(SPEECH_MODELS) }),
    fields: [
      {
        key: 'lang',
        label: { en: 'Language', zh: '语言' },
        kind: 'choice',
        options: SPEECH_LANGUAGES.map((value) => ({ value, label: SPEECH_LANGUAGE_NAMES[value] })),
      },
      {
        key: 'model',
        // Android 用哪个识别模型（下载内容：更准 190 MB、更快 60 MB）；iPhone 用系统识别，不看这一项。
        label: { en: 'Recognition', zh: '识别' },
        kind: 'choice',
        options: [
          { value: 'standard', label: { en: 'More accurate', zh: '更准' } },
          { value: 'fast', label: { en: 'Faster', zh: '更快' } },
        ],
      },
    ],
    // Android 的识别模型是下载内容；iOS 用系统识别，不需要（App 的 packNotNeeded）。
    pack: SPEECH_MODEL_PACKS.standard,
    packFor: (params) => SPEECH_MODEL_PACKS[params.model as SpeechModel],
    requires: [],
  },
  {
    id: 'audio.compress',
    label: { en: 'Make audio smaller', zh: '压小音频' },
    description: {
      en: 'Make each recording smaller as an M4A: by size (at most N MB) or by quality (high / standard / voice, mono). M4A plays in WeChat, email, computers and phones.',
      zh: '把每段录音压小成 M4A：按大小（不超过 N MB）或按音质（高 / 标准 / 语音，单声道）。M4A 微信、邮件、电脑和手机都能放。',
    },
    input: ['audio'],
    output: 'audio',
    params: z.strictObject({
      by: z.enum(['size', 'quality']),
      maxMB: z.number().min(0.1).max(2000),
      quality: z.enum(AUDIO_QUALITIES),
    }),
    fields: [
      {
        key: 'by',
        label: { en: 'Make it', zh: '压缩方式' },
        kind: 'choice',
        options: [
          { value: 'size', label: { en: 'Smaller than a size', zh: '按大小' } },
          { value: 'quality', label: { en: 'Lower quality', zh: '按音质' } },
        ],
      },
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过' },
        kind: 'number',
        unit: 'MB',
        min: 0.1,
        max: 2000,
        step: 0.1,
        showIf: { key: 'by', equals: ['size'] },
      },
      {
        key: 'quality',
        label: { en: 'Quality', zh: '音质' },
        kind: 'choice',
        options: [
          { value: 'high', label: { en: 'High (music)', zh: '高（音乐）' } },
          { value: 'standard', label: { en: 'Standard', zh: '标准' } },
          { value: 'voice', label: { en: 'Voice (smallest)', zh: '语音（最小）' } },
        ],
        showIf: { key: 'by', equals: ['quality'] },
      },
    ],
    presets: [
      {
        id: '2mb',
        label: { en: '2 MB', zh: '2 MB' },
        values: { by: 'size', maxMB: 2, quality: 'standard' },
      },
      {
        id: '5mb',
        label: { en: '5 MB', zh: '5 MB' },
        values: { by: 'size', maxMB: 5, quality: 'standard' },
      },
      {
        id: '10mb',
        label: { en: '10 MB', zh: '10 MB' },
        values: { by: 'size', maxMB: 10, quality: 'standard' },
      },
      {
        id: '20mb',
        label: { en: '20 MB', zh: '20 MB' },
        values: { by: 'size', maxMB: 20, quality: 'standard' },
      },
      {
        id: 'voice',
        label: { en: 'Voice', zh: '语音' },
        values: { by: 'quality', maxMB: 2, quality: 'voice' },
      },
    ],
    requires: [],
  },
  {
    id: 'audio.convert',
    label: { en: 'Convert audio', zh: '音频转格式' },
    description: {
      en: 'Convert recordings and music (M4A, WAV, MP3, AMR, CAF, FLAC…) to M4A, which plays everywhere, to MP3 (for old players and car stereos), or to uncompressed WAV.',
      zh: '把录音和音乐（M4A、WAV、MP3、AMR、CAF、FLAC 等）转成哪里都能放的 M4A、MP3（老播放器、车载音响），或不压缩的 WAV。',
    },
    input: ['audio'],
    output: 'audio',
    params: z.strictObject({ format: z.enum(AUDIO_FORMATS) }),
    fields: [formatField],
    presets: [
      { id: 'm4a', label: { en: 'M4A', zh: 'M4A' }, values: { format: 'm4a' } },
      { id: 'wav', label: { en: 'WAV', zh: 'WAV' }, values: { format: 'wav' } },
      { id: 'mp3', label: { en: 'MP3', zh: 'MP3' }, values: { format: 'mp3' } },
    ],
    requires: [],
  },
  {
    id: 'audio.trim',
    label: { en: 'Trim audio', zh: '剪一段音频' },
    description: {
      en: 'The user picks the start and end of each recording on a waveform; only that part is kept, as an M4A.',
      zh: '用户在波形图上选每段录音的开始和结束，只留中间这一段（存成 M4A）。',
    },
    input: ['audio'],
    output: 'audio',
    params: z.strictObject({}),
    fields: [],
    local: 'trimMedia',
    requires: [],
  },
  {
    id: 'audio.merge',
    label: { en: 'Join recordings', zh: '合成一段' },
    description: {
      en: 'Join the recordings into one M4A, in their current order (put "Order" before it to change the order).',
      zh: '把几段录音按现在的顺序接成一段 M4A（前面加「排顺序」可以调整顺序）。',
    },
    input: ['audio'],
    output: 'audio',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'audio.fromVideo',
    label: { en: 'Get the sound from videos', zh: '提取视频里的声音' },
    description: {
      en: 'Save only the sound of each video as an audio file (M4A, MP3, or uncompressed WAV).',
      zh: '只要每个视频里的声音，存成音频文件（M4A、MP3，或不压缩的 WAV）。',
    },
    input: ['video'],
    output: 'audio',
    params: z.strictObject({ format: z.enum(AUDIO_FORMATS) }),
    fields: [formatField],
    presets: [
      { id: 'm4a', label: { en: 'M4A', zh: 'M4A' }, values: { format: 'm4a' } },
      { id: 'mp3', label: { en: 'MP3', zh: 'MP3' }, values: { format: 'mp3' } },
    ],
    requires: [],
  },
];

/** 默认识别语言跟随界面语言。 */
export const speechLangFor = (locale: Locale) => (locale === 'zh' ? 'zh' : 'en');

const pickAudio = (min: number, max: number) => ({
  id: 'pick',
  action: 'in.audio',
  params: { source: 'files', min, max },
});

/** 单功能工作流（D-061）：工具页上每个一个运行卡片。 */
export function audioWorkflows(locale: Locale): Workflow[] {
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    toolId: AUDIO_TOOL_ID,
    name: t(locale, ...name),
    steps,
  });
  return [
    wf(
      'audio-volume',
      ['Adjust volume', '调整音量'],
      [
        pickAudio(1, 10),
        {
          id: 'volume',
          action: 'audio.volume',
          params: { mode: 'normal', db: 0 },
          ask: ['mode', 'db'],
        },
      ],
    ),
    wf(
      'audio-transcribe',
      ['Speech to text', '语音转文字'],
      [
        { ...pickAudio(1, 10), ask: ['source'] },
        {
          id: 'text',
          action: 'audio.transcribe',
          params: { lang: speechLangFor(locale), model: 'standard' },
          ask: ['lang'],
        },
      ],
    ),
    wf(
      'audio-record',
      ['Record', '录音'],
      [{ id: 'pick', action: 'in.audio', params: { source: 'record', min: 1, max: 1 } }],
    ),
    wf(
      'audio-compress',
      ['Make audio smaller', '压小音频'],
      [
        pickAudio(1, 10),
        {
          id: 'run',
          action: 'audio.compress',
          params: { by: 'size', maxMB: 2, quality: 'standard' },
          ask: ['by', 'maxMB', 'quality'],
        },
      ],
    ),
    wf(
      'audio-convert',
      ['Convert audio', '音频转格式'],
      [
        pickAudio(1, 10),
        { id: 'run', action: 'audio.convert', params: { format: 'm4a' }, ask: ['format'] },
      ],
    ),
    wf(
      'audio-trim',
      ['Trim audio', '剪一段音频'],
      [pickAudio(1, 1), { id: 'run', action: 'audio.trim', params: {} }],
    ),
    wf(
      'audio-merge',
      ['Join recordings', '几段合成一段'],
      [
        pickAudio(2, 10),
        { id: 'order', action: 'file.order', params: {} },
        { id: 'run', action: 'audio.merge', params: {} },
      ],
    ),
    wf(
      'audio-from-video',
      ['Sound from a video', '提取视频里的声音'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'run', action: 'audio.fromVideo', params: { format: 'm4a' } },
      ],
    ),
  ];
}

export const audioTool: ToolDefinition = {
  id: AUDIO_TOOL_ID,
  version: '1.1.0',
  name: { en: 'Audio', zh: '音频' },
  description: {
    en: 'Turn recordings into text, record, make audio smaller, convert, trim and join it, on this device.',
    zh: '在本机把录音转成文字、录音、压小、转格式、剪一段、几段合成一段。',
  },
  icon: 'audio',
  aliases: [
    'audio',
    'recording',
    'voice',
    'sound',
    'speech to text',
    'transcribe',
    '音频',
    '录音',
    '语音',
    '声音',
    '语音转文字',
    '音频工具',
  ],
  permissions: ['files.pick', 'files.write', 'microphone'],
  actions: AUDIO_ACTIONS,
  createPage: (locale) => ({
    id: AUDIO_PAGE_ID,
    title: t(locale, 'Audio', '音频'),
    icon: 'audio',
    toolId: AUDIO_TOOL_ID,
    components: [
      {
        id: 'audio-header',
        type: 'header',
        props: { title: t(locale, 'Audio tools', '音频工具') },
      },
      {
        id: 'audio-intro',
        type: 'text',
        props: {
          text: t(
            locale,
            'Everything runs on this device; nothing is uploaded. Recognized text may have mistakes, so check it.',
            '全部在本机处理，不会上传。识别出的文字可能有错字，请核对。',
          ),
        },
      },
      ...audioWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        type: 'workflowRunner' as const,
        props: { workflowId: wf.id },
      })),
      {
        id: 'audio-files',
        type: 'fileList',
        props: { title: t(locale, 'Audio files', '音频文件'), limit: 10, mimeType: 'audio/*' },
      },
    ],
  }),
  createWorkflows: audioWorkflows,
};
