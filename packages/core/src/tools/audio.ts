import { t, pairText } from '../messages';
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
import { SPEAK_LANGUAGES, SPEAK_LANGUAGE_NAMES, SPEAK_RATE_MAX, SPEAK_RATE_MIN } from '../speak';
import type { ActionDefinition } from '../workflow/contract';

// 音频工具（D-152–D-156）：语音转文字、压小 / 转格式、剪一段、几段合成一段、从视频里取声音。
// 编码在 App 的原生模块 morph-media 里（iOS AVFoundation、Android Media3），语音转文字在 morph-speech 里
// （iOS 系统识别，Android whisper.cpp，D-150、D-151），文字转语音在 morph-tts 里（系统声音，D-270）。
// 全部在本机处理；识别出的文字、要朗读的文字都不发给 AI（D-036）。

export const AUDIO_TOOL_ID = 'audio';
export const AUDIO_PAGE_ID = 'tool-audio';

const formatField = {
  key: 'format',
  label: { en: 'Format', zh: '格式', fr: 'Format' },
  kind: 'choice' as const,
  options: [
    {
      value: 'm4a',
      label: {
        en: 'M4A (small, plays everywhere)',
        zh: 'M4A（小，哪里都能放）',
        fr: 'M4A (petit, lisible partout)',
      },
    },
    {
      value: 'wav',
      label: {
        en: 'WAV (uncompressed, large)',
        zh: 'WAV（不压缩，很大）',
        fr: 'WAV (non compressé, volumineux)',
      },
    },
    {
      value: 'mp3',
      label: {
        en: 'MP3 (for old players and car stereos)',
        zh: 'MP3（老播放器、车载音响）',
        fr: 'MP3 (pour les anciens lecteurs et autoradios)',
      },
    },
  ],
};

export const AUDIO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'audio.denoise',
    ai: '"Reduce speech noise / noisy voice recording" → this; mention that it is for speech and may suppress music.',
    label: { en: 'Reduce speech noise', zh: '人声降噪', fr: 'Réduire le bruit de la voix' },
    description: {
      en: 'Reduce background noise around speech in audio or video on this device with RNNoise. Best for spoken recordings; music and other wanted sounds can be suppressed. Mono/stereo only. Audio becomes M4A; video keeps its picture (MP4, re-encoded). No speech recognition or upload.',
      zh: '使用本机 RNNoise 减少音频或视频中人声周围的背景噪声。适合讲话录音，音乐和其他想保留的声音也可能被削弱。支持单声道/立体声。音频输出 M4A，视频保留画面（MP4，重新编码）。不识别或上传内容。',
      fr: 'Réduisez le bruit de fond autour de la voix dans un fichier audio ou vidéo, sur cet appareil, avec RNNoise. Idéal pour les enregistrements parlés ; la musique et les autres sons voulus peuvent être atténués. Mono et stéréo uniquement. L’audio devient du M4A ; la vidéo garde son image (MP4, réencodé). Pas de reconnaissance vocale ni d’envoi.',
    },
    input: ['audio', 'video'],
    output: 'same',
    params: z.strictObject({}),
    fields: [],
    requires: [],
    presets: [{ id: 'speech', label: { en: 'Speech', zh: '人声', fr: 'Voix' }, values: {} }],
  },
  {
    id: 'audio.volume',
    ai: '"Too quiet / normal volume" → mode "normal", db 0; explicit ±dB → mode "db", db as asked.',
    label: { en: 'Adjust volume', zh: '调整音量', fr: 'Ajuster le volume' },
    description: {
      en: 'Adjust audio or video sound locally. Normal aims for -16 LUFS; manual changes gain in dB. Gain is limited to avoid clipping (-1 dBFS sample peak), so very dynamic material may stay quieter than the target. Audio becomes M4A; video remains video (MP4, picture re-encoded). Silence stays silent.',
      zh: '在本机调整音频或视频的声音。自动尽量达到 -16 LUFS，手动按 dB 调整。增益受峰值限制（-1 dBFS）以避免削波，动态范围大的内容可能达不到目标。音频输出 M4A，视频仍输出视频（MP4，画面重新编码）。静音保持静音。',
      fr: 'Ajustez le volume de l’audio ou de la vidéo, sur cet appareil. Normal vise -16 LUFS ; manuel modifie le gain en dB. Le gain est limité pour éviter l’écrêtage (-1 dBFS en crête d’échantillon), donc un contenu très dynamique peut rester plus faible que la cible. L’audio devient du M4A ; la vidéo reste une vidéo (MP4, image réencodée). Le silence reste silencieux.',
    },
    input: ['audio', 'video'],
    output: 'same',
    params: z.strictObject({ mode: z.enum(['normal', 'db']), db: z.number().min(-24).max(24) }),
    fields: [
      {
        key: 'mode',
        label: { en: 'Volume', zh: '音量', fr: 'Volume' },
        kind: 'choice',
        options: [
          {
            value: 'normal',
            label: { en: 'Normal volume', zh: '调整到正常音量', fr: 'Volume normal' },
          },
          { value: 'db', label: { en: 'Adjust manually', zh: '手动调整', fr: 'Réglage manuel' } },
        ],
      },
      {
        key: 'db',
        label: { en: 'Gain (dB)', zh: '调整幅度（dB）', fr: 'Gain (dB)' },
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
        label: { en: 'Normal volume', zh: '正常音量', fr: 'Volume normal' },
        values: { mode: 'normal', db: 0 },
      },
    ],
    requires: [],
  },
  {
    id: 'audio.transcribe',
    ai: '"Turn a recording into text / transcribe / notes from a lecture or meeting recording" → lang = the language spoken, usually followed by text.toPdf or text.toFile.',
    label: { en: 'Speech to text', zh: '语音转文字', fr: 'Transcription' },
    description: {
      en: 'Turn recordings into text on this device (one language per run). Words may be wrong, especially with noise or accents. The first use of a language may need a download. The text stays on this device.',
      zh: '在本机把录音转成文字（每次一种语言）。有噪音或口音时可能有错字。第一次用某种语言时可能要下载。文字只留在本机。',
      fr: 'Transcrivez les enregistrements sur cet appareil (une langue à la fois). Il peut y avoir des erreurs, surtout avec du bruit ou un accent. La première utilisation d’une langue peut nécessiter un téléchargement. Le texte reste sur cet appareil.',
    },
    input: ['audio'],
    output: 'text',
    params: z.strictObject({ lang: z.enum(SPEECH_LANGUAGES), model: z.enum(SPEECH_MODELS) }),
    fields: [
      {
        key: 'lang',
        label: { en: 'Language', zh: '语言', fr: 'Langue' },
        kind: 'choice',
        options: SPEECH_LANGUAGES.map((value) => ({ value, label: SPEECH_LANGUAGE_NAMES[value] })),
      },
      {
        key: 'model',
        // Android 用哪个识别模型（下载内容：更准 190 MB、更快 60 MB）；iPhone 用系统识别，不看这一项。
        label: { en: 'Recognition', zh: '识别', fr: 'Reconnaissance' },
        kind: 'choice',
        options: [
          { value: 'standard', label: { en: 'More accurate', zh: '更准', fr: 'Plus précis' } },
          { value: 'fast', label: { en: 'Faster', zh: '更快', fr: 'Plus rapide' } },
        ],
      },
    ],
    // Android 的识别模型是下载内容；iOS 用系统识别，不需要（App 的 packNotNeeded）。
    pack: SPEECH_MODEL_PACKS.standard,
    packFor: (params) => SPEECH_MODEL_PACKS[params.model as SpeechModel],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match:
          /^(?:语音转文字|录音转文字|转成文字|转文字|变成文字|识别语音|听写)$|^(?:transcribe(?: it| them)?|speech to text|turn (?:it|them) into text)$/i,
        step: (_m, locale) => ({
          params: {
            lang: locale === 'zh' ? 'zh' : locale === 'fr' ? 'fr' : 'en',
            model: 'standard',
          },
          ask: ['lang'],
        }),
      },
    ],
  },
  {
    id: 'audio.compress',
    ai: '"A recording too big to send / under N MB" → by "size" with maxMB, or by "quality".',
    label: { en: 'Make audio smaller', zh: '压小音频', fr: 'Réduire la taille de l’audio' },
    description: {
      en: 'Make each recording smaller as an M4A: by size (at most N MB) or by quality (high / standard / voice, mono). M4A plays in WeChat, email, computers and phones.',
      zh: '把每段录音压小成 M4A：按大小（不超过 N MB）或按音质（高 / 标准 / 语音，单声道）。M4A 微信、邮件、电脑和手机都能放。',
      fr: 'Réduisez la taille de chaque enregistrement en M4A : selon la taille (au maximum N Mo) ou selon la qualité (haute / standard / voix, mono). Le M4A se lit dans WeChat, par e-mail, sur ordinateur et sur téléphone.',
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
        label: { en: 'Make it', zh: '压缩方式', fr: 'Mode de compression' },
        kind: 'choice',
        options: [
          { value: 'size', label: { en: 'Smaller than a size', zh: '按大小', fr: 'Par taille' } },
          { value: 'quality', label: { en: 'Lower quality', zh: '按音质', fr: 'Par qualité' } },
        ],
      },
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过', fr: 'Au plus' },
        kind: 'number',
        unit: 'MB',
        min: 0.1,
        max: 2000,
        step: 0.1,
        showIf: { key: 'by', equals: ['size'] },
      },
      {
        key: 'quality',
        label: { en: 'Quality', zh: '音质', fr: 'Qualité' },
        kind: 'choice',
        options: [
          {
            value: 'high',
            label: { en: 'High (music)', zh: '高（音乐）', fr: 'Élevée (musique)' },
          },
          { value: 'standard', label: { en: 'Standard', zh: '标准', fr: 'Standard' } },
          {
            value: 'voice',
            label: { en: 'Voice (smallest)', zh: '语音（最小）', fr: 'Voix (taille minimale)' },
          },
        ],
        showIf: { key: 'by', equals: ['quality'] },
      },
    ],
    presets: [
      {
        id: '2mb',
        label: { en: '2 MB', zh: '2 MB', fr: '2 MB' },
        values: { by: 'size', maxMB: 2, quality: 'standard' },
      },
      {
        id: '5mb',
        label: { en: '5 MB', zh: '5 MB', fr: '5 MB' },
        values: { by: 'size', maxMB: 5, quality: 'standard' },
      },
      {
        id: '10mb',
        label: { en: '10 MB', zh: '10 MB', fr: '10 MB' },
        values: { by: 'size', maxMB: 10, quality: 'standard' },
      },
      {
        id: '20mb',
        label: { en: '20 MB', zh: '20 MB', fr: '20 MB' },
        values: { by: 'size', maxMB: 20, quality: 'standard' },
      },
      {
        id: 'voice',
        label: { en: 'Voice', zh: '语音', fr: 'Voix' },
        values: { by: 'quality', maxMB: 2, quality: 'voice' },
      },
    ],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match:
          /^(?:压缩|压小)(?:音频|录音|语音)$|^(?:把)?(?:音频|录音|语音)压小(?:一点)?$|^compress (?:the )?(?:audio|recordings?)$|^make (?:the )?(?:audio|recordings?) smaller$/i,
        step: () => ({ params: { by: 'size', maxMB: 2, quality: 'standard' } }),
      },
    ],
  },
  {
    id: 'audio.convert',
    ai: '"Convert to M4A / WAV / MP3" → format.',
    label: { en: 'Convert audio', zh: '音频转格式', fr: 'Convertir l’audio' },
    description: {
      en: 'Convert recordings and music (M4A, WAV, MP3, AMR, CAF, FLAC…) to M4A, which plays everywhere, to MP3 (for old players and car stereos), or to uncompressed WAV.',
      zh: '把录音和音乐（M4A、WAV、MP3、AMR、CAF、FLAC 等）转成哪里都能放的 M4A、MP3（老播放器、车载音响），或不压缩的 WAV。',
      fr: 'Convertissez enregistrements et musiques (M4A, WAV, MP3, AMR, CAF, FLAC…) en M4A, lisible partout, en MP3 (anciens lecteurs et autoradios), ou en WAV non compressé.',
    },
    input: ['audio'],
    output: 'audio',
    params: z.strictObject({ format: z.enum(AUDIO_FORMATS) }),
    fields: [formatField],
    presets: [
      { id: 'm4a', label: { en: 'M4A', zh: 'M4A', fr: 'M4A' }, values: { format: 'm4a' } },
      { id: 'wav', label: { en: 'WAV', zh: 'WAV', fr: 'WAV' }, values: { format: 'wav' } },
      { id: 'mp3', label: { en: 'MP3', zh: 'MP3', fr: 'MP3' }, values: { format: 'mp3' } },
    ],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      // MP3 输出（D-183）；跟在视频后面时换成「提取视频里的声音」（fitToPrevious）。
      {
        match:
          /^(?:转|转成|转换成|改成|存成)\s*(m4a|wav|mp3)(?:\s*格式)?$|^(?:convert (?:it |them )?to|save (?:it |them )?as) (m4a|wav|mp3)$/i,
        step: (m) => ({ params: { format: (m[1] ?? m[2]!).toLowerCase() } }),
      },
    ],
  },
  {
    id: 'audio.trim',
    ai: '"Cut out a part / a ringtone" (local step on a waveform; an iPhone app can\'t set ringtones, so say so in a note when they ask for one).',
    label: { en: 'Trim audio', zh: '剪一段音频', fr: 'Couper l’audio' },
    description: {
      en: 'The user picks the start and end of each recording on a waveform; only that part is kept, as an M4A.',
      zh: '用户在波形图上选每段录音的开始和结束，只留中间这一段（存成 M4A）。',
      fr: 'Vous choisissez le début et la fin de chaque enregistrement sur la forme d’onde ; seule cette partie est conservée, au format M4A.',
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
    ai: '"Join several recordings into one" → file.order then this.',
    label: { en: 'Join recordings', zh: '合成一段', fr: 'Fusionner des enregistrements' },
    description: {
      en: 'Join the recordings into one M4A, in their current order (put "Order" before it to change the order).',
      zh: '把几段录音按现在的顺序接成一段 M4A（前面加「排顺序」可以调整顺序）。',
      fr: 'Fusionnez les enregistrements en un seul M4A, dans leur ordre actuel (ajoutez « Ordre » avant pour le modifier).',
    },
    input: ['audio'],
    output: 'audio',
    params: z.strictObject({}),
    fields: [],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match:
          /^(?:合成|接成|拼成|合并成)(?:一段|一个)(?:录音|音频)?$|^合并录音$|^join (?:them |the recordings )?(?:into one)?$/i,
      },
    ],
  },
  {
    id: 'audio.fromVideo',
    ai: '"Keep the sound / music of a video" (also "video to MP3") → in.videos then this (format "mp3" when they say MP3).',
    label: {
      en: 'Get the sound from videos',
      zh: '提取视频里的声音',
      fr: 'Extraire le son des vidéos',
    },
    description: {
      en: 'Save only the sound of each video as an audio file (M4A, MP3, or uncompressed WAV).',
      zh: '只要每个视频里的声音，存成音频文件（M4A、MP3，或不压缩的 WAV）。',
      fr: 'Enregistrez uniquement le son de chaque vidéo sous forme de fichier audio (M4A, MP3 ou WAV non compressé).',
    },
    input: ['video'],
    output: 'audio',
    params: z.strictObject({ format: z.enum(AUDIO_FORMATS) }),
    fields: [formatField],
    presets: [
      { id: 'm4a', label: { en: 'M4A', zh: 'M4A', fr: 'M4A' }, values: { format: 'm4a' } },
      { id: 'mp3', label: { en: 'MP3', zh: 'MP3', fr: 'MP3' }, values: { format: 'mp3' } },
    ],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match:
          /^(?:提取|取出|只要|存下)(?:视频(?:里|的|里的)?)?(?:声音|音频|背景音乐)$|^(?:extract|keep|get) (?:the )?(?:audio|sound|music)(?: of the video| from the video)?$/i,
        step: () => ({ params: { format: 'm4a' } }),
      },
    ],
  },
  {
    id: 'audio.fromText',
    ai: '"Read a PDF / paper document / text aloud as an audio file, listen to it instead of reading, text to speech" → after the step that gets the text (pdf.extractText, scan.detect → ocr.recognize, in.text, translate.text); lang "auto" unless they name the language, rate 1 unless they want it slower or faster, format "m4a" unless they ask for WAV; then out.share or out.saveToFolder. It only makes an audio file with the phone\'s own voice (no player, no highlighting, no AI voices); a sentence they type in the request and want read out is an errand.',
    label: { en: 'Text to speech', zh: '文字转语音', fr: 'Synthèse vocale' },
    description: {
      en: 'Read the text aloud with the phone’s own voice on this device and save it as an audio file (M4A or WAV). Auto picks one language for the whole text; names and numbers may be read wrong. The text stays on this device.',
      zh: '在本机用手机自带的声音把文字读出来，存成音频文件（M4A 或 WAV）。「自动识别」整段用一种语言读；人名、数字可能读错。文字只留在本机。',
      fr: 'Lisez le texte à voix haute avec la voix du téléphone, sur cet appareil, et enregistrez-le en fichier audio (M4A ou WAV). La détection automatique choisit une seule langue pour tout le texte ; les noms et les nombres peuvent être mal lus. Le texte reste sur cet appareil.',
    },
    input: ['text'],
    output: 'audio',
    params: z.strictObject({
      lang: z.enum(['auto', ...SPEAK_LANGUAGES]),
      rate: z.number().min(SPEAK_RATE_MIN).max(SPEAK_RATE_MAX),
      format: z.enum(['m4a', 'wav']),
    }),
    fields: [
      {
        key: 'lang',
        label: { en: 'Language', zh: '语言', fr: 'Langue' },
        kind: 'choice',
        options: [
          {
            value: 'auto',
            label: { en: 'Auto-detect', zh: '自动识别', fr: 'Détection automatique' },
          },
          ...SPEAK_LANGUAGES.map((value) => ({ value, label: SPEAK_LANGUAGE_NAMES[value] })),
        ],
      },
      {
        key: 'rate',
        label: { en: 'Speed (1 = normal)', zh: '语速（1 是正常）', fr: 'Vitesse (1 = normale)' },
        kind: 'number',
        min: SPEAK_RATE_MIN,
        max: SPEAK_RATE_MAX,
        step: 0.1,
      },
      { ...formatField, options: formatField.options.filter((o) => o.value !== 'mp3') },
    ],
    requires: [],
    // 内置规则认的步骤说法（D-265、D-270）。
    phrases: [
      {
        match:
          /^(?:转成|变成|转换成|做成|生成)(?:语音|有声书|朗读音频)$|^(?:文字转语音|朗读|朗读出来|读出来)$|^(?:text to speech|read (?:it |them |the text )?(?:aloud|out loud)|turn (?:it |them |the text )?into (?:speech|an audio file)|convert (?:it |them )?to speech)$/i,
        step: () => ({ params: { lang: 'auto', rate: 1, format: 'm4a' } }),
      },
    ],
  },
];

/** 默认识别语言跟随界面语言。 */
export const speechLangFor = (locale: Locale) =>
  locale === 'zh' ? 'zh' : locale === 'fr' ? 'fr' : 'en';

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
    name: pairText(locale, name),
    steps,
  });
  return [
    wf(
      'audio-denoise',
      ['Reduce speech noise', '人声降噪'],
      [pickAudio(1, 10), { id: 'denoise', action: 'audio.denoise', params: {} }],
    ),
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
      'audio-from-text',
      ['Text to speech', '文字转语音'],
      [
        { id: 'type', action: 'in.text', params: { text: '' }, ask: ['text'] },
        {
          id: 'run',
          action: 'audio.fromText',
          params: { lang: 'auto', rate: 1, format: 'm4a' },
          ask: ['lang', 'rate'],
        },
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
  version: '1.3.0',
  name: { en: 'Audio', zh: '音频', fr: 'Audio' },
  description: {
    en: 'Turn recordings into text and text into speech, record, make audio smaller, convert, trim and join it, on this device.',
    zh: '在本机把录音转成文字、把文字读成音频、录音、压小、转格式、剪一段、几段合成一段。',
    fr: 'Transcrivez des enregistrements, lisez du texte à voix haute, enregistrez, compressez l’audio, convertissez, coupez et fusionnez, sur cet appareil.',
  },
  icon: 'audio',
  aliases: [
    'audio',
    'recording',
    'voice',
    'sound',
    'speech to text',
    'transcribe',
    'text to speech',
    'read aloud',
    '音频',
    '录音',
    '语音',
    '声音',
    '语音转文字',
    '文字转语音',
    '朗读',
    '音频工具',
  ],
  permissions: ['files.pick', 'files.write', 'microphone'],
  actions: AUDIO_ACTIONS,
  createPage: (locale) => ({
    id: AUDIO_PAGE_ID,
    title: t(locale, 'audio_Audio_2bfdb'),
    icon: 'audio',
    toolId: AUDIO_TOOL_ID,
    components: [
      {
        id: 'audio-header',
        type: 'header',
        props: { title: t(locale, 'audio_Audio_tools_ca3ac') },
      },
      {
        id: 'audio-intro',
        type: 'text',
        props: {
          text: t(locale, 'audio_Everything_runs_on_this_device_nothing_de468'),
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
        props: { title: t(locale, 'audio_Audio_files_185dc'), limit: 10, mimeType: 'audio/*' },
      },
    ],
  }),
  createWorkflows: audioWorkflows,
};
