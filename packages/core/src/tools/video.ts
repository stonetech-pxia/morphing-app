import { t, pairText } from '../messages';
import { z } from 'zod';

import { GIF_MAX_SECONDS, VIDEO_QUALITIES } from '../media';
import { FILES_TABLE } from '../files-table';
import type { ToolDefinition } from '../registry';
import type { Locale, Workflow } from '../schema';
import {
  SPEECH_LANGUAGES,
  SPEECH_LANGUAGE_NAMES,
  SPEECH_MODEL_PACKS,
  SPEECH_MODELS,
  type SpeechModel,
} from '../speech';
import { speechLangFor } from './audio';
import type { ActionDefinition } from '../workflow/contract';

// 视频工具的清单（D-143、D-146）：压缩、转成 MP4、剪一段。编码在 App 的原生模块 morph-media 里
// （iOS AVFoundation、Android Media3，D-141）；码率和分辨率的计算在 core/media.ts。
// 编码默认 MP4（H.264 + AAC）；截帧、GIF、SRT 字幕等动作另有输出类型。

export const VIDEO_TOOL_ID = 'video';
export const VIDEO_PAGE_ID = 'tool-video';

export const VIDEO_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'video.subtitles',
    ai: '"Automatic video captions / export SRT subtitles" → this, lang = the spoken language. It DOES NOT burn text into video or return a subtitled video: say this clearly, especially when the user asks to add captions to the picture.',
    label: { en: 'Export SRT captions', zh: '导出 SRT 字幕', fr: 'Exporter les sous-titres SRT' },
    description: {
      en: 'Recognize speech in each video on this device and export a separate UTF-8 .srt file with timestamps. This first version does not burn captions into the picture and does not output a subtitled video. Choose the spoken language; the first run may need a speech model download. Review words and timings, especially long segments, whose split timing is approximate. Video files and recognized words never go to AI.',
      zh: '在本机识别每段视频中的讲话，导出带时间戳的独立 UTF-8 .srt 文件。首版不会把字幕烧进画面，也不输出带字幕视频。选择讲话语言，首次可能需要下载识别模型。请核对文字和时间，长段落拆分后的段内时间为近似值。视频和识别文字不发给 AI。',
      fr: 'Transcrivez la parole de chaque vidéo sur cet appareil et exportez un fichier .srt UTF-8 distinct, avec des horodatages. Cette première version n’incruste pas les sous-titres dans l’image et ne produit pas de vidéo sous-titrée. Choisissez la langue parlée ; au premier lancement, un modèle de reconnaissance vocale peut devoir être téléchargé. Vérifiez les mots et les horaires, surtout pour les longs segments, dont la répartition est approximative. Les fichiers vidéo et les mots reconnus ne sont jamais envoyés à l’IA.',
    },
    input: ['video'],
    output: 'files',
    params: z.strictObject({ lang: z.enum(SPEECH_LANGUAGES), model: z.enum(SPEECH_MODELS) }),
    fields: [
      {
        key: 'lang',
        label: { en: 'Spoken language', zh: '讲话语言', fr: 'Langue parlée' },
        kind: 'choice',
        options: SPEECH_LANGUAGES.map((value) => ({ value, label: SPEECH_LANGUAGE_NAMES[value] })),
      },
      {
        key: 'model',
        label: { en: 'Recognition', zh: '识别', fr: 'Reconnaissance' },
        kind: 'choice',
        options: [
          { value: 'standard', label: { en: 'More accurate', zh: '更准', fr: 'Plus précis' } },
          { value: 'fast', label: { en: 'Faster', zh: '更快', fr: 'Plus rapide' } },
        ],
      },
    ],
    presets: [
      {
        id: 'english',
        label: { en: 'English', zh: '英语', fr: 'Anglais' },
        values: { lang: 'en', model: 'standard' },
      },
    ],
    pack: SPEECH_MODEL_PACKS.standard,
    packFor: (params) => SPEECH_MODEL_PACKS[params.model as SpeechModel],
    requires: [],
  },

  {
    id: 'video.speed',
    ai: '"Speed up / slow motion / 2x" → factor; note that the pitch changes and slow motion is not smooth.',
    label: {
      en: 'Change video speed',
      zh: '视频加速或慢放',
      fr: 'Modifier la vitesse de la vidéo',
    },
    description: {
      en: 'Play each video at 0.5×–4× speed and export an MP4. 0.5× doubles the duration; 2× halves it. Sound speeds up or slows down too, and its pitch changes. This does not add new frames for smooth slow motion.',
      zh: '把每段视频改成 0.5×–4× 速度并导出 MP4。0.5× 时长翻倍，2× 时长减半；声音也随之加速或减速，音调会变高或变低。不会插入新画面来补慢动作。',
      fr: 'Lisez chaque vidéo à une vitesse de 0,5×–4× et exportez-la en MP4. 0,5× double la durée ; 2× la divise par deux. Le son accélère ou ralentit aussi, et sa hauteur change. Aucune image n’est ajoutée pour un ralenti fluide.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ factor: z.number().min(0.5).max(4) }),
    fields: [
      {
        key: 'factor',
        label: { en: 'Speed', zh: '速度', fr: 'Vitesse' },
        kind: 'choice',
        options: [
          { value: 0.5, label: { en: '0.5×', zh: '0.5×', fr: '0.5×' } },
          { value: 0.75, label: { en: '0.75×', zh: '0.75×', fr: '0.75×' } },
          { value: 1, label: { en: '1×', zh: '1×', fr: '1×' } },
          { value: 1.25, label: { en: '1.25×', zh: '1.25×', fr: '1.25×' } },
          { value: 1.5, label: { en: '1.5×', zh: '1.5×', fr: '1.5×' } },
          { value: 2, label: { en: '2×', zh: '2×', fr: '2×' } },
          { value: 4, label: { en: '4×', zh: '4×', fr: '4×' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'video.crop',
    ai: '"Crop to portrait / square / 9:16 / 1:1 / 4:5 / 16:9" → ratio.',
    label: {
      en: 'Crop video to a shape',
      zh: '视频裁成指定比例',
      fr: 'Recadrer la vidéo selon un format',
    },
    description: {
      en: 'Center-crop each video to 9:16, 1:1, 4:5 or 16:9. The outside edges are removed, not stretched. Sound and duration are kept. This version crops the center; it does not let the user reposition the crop.',
      zh: '把每段视频居中裁成 9:16、1:1、4:5 或 16:9，裁去边缘，不拉伸。声音、时长保留。此版只居中裁剪，不能手动移动位置。',
      fr: 'Recadrez chaque vidéo au centre en 9:16, 1:1, 4:5 ou 16:9. Les bords extérieurs sont retirés, sans étirement. Le son et la durée sont conservés. Cette version recadre au centre ; vous ne pouvez pas repositionner le cadrage.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ ratio: z.enum(['9:16', '1:1', '4:5', '16:9']) }),
    fields: [
      {
        key: 'ratio',
        label: { en: 'Shape', zh: '比例', fr: 'Format' },
        kind: 'choice',
        options: [
          {
            value: '9:16',
            label: { en: '9:16 · portrait', zh: '9:16 · 竖屏', fr: '9:16 · portrait' },
          },
          { value: '1:1', label: { en: '1:1 · square', zh: '1:1 · 正方形', fr: '1:1 · carré' } },
          { value: '4:5', label: { en: '4:5 · portrait', zh: '4:5 · 竖版', fr: '4:5 · portrait' } },
          {
            value: '16:9',
            label: { en: '16:9 · landscape', zh: '16:9 · 横屏', fr: '16:9 · paysage' },
          },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'video.rotate',
    ai: '"Rotate / upside-down video" → degrees (270 turns left).',
    label: { en: 'Rotate video', zh: '旋转视频', fr: 'Pivoter la vidéo' },
    description: {
      en: 'Rotate each video clockwise by 90, 180 or 270 degrees, relative to its displayed orientation. iPhone keeps the encoded video and changes its transform; Android re-encodes. Sound and duration are kept.',
      zh: '相对当前画面顺时针旋转 90、180 或 270 度。iPhone 只改旋转信息，不重新编码画面；Android 会重新编码。声音和时长保留。',
      fr: 'Faites pivoter chaque vidéo de 90, 180 ou 270 degrés dans le sens horaire, par rapport à son orientation affichée. Sur iPhone, la vidéo encodée est conservée et seule sa transformation change ; sur Android, la vidéo est réencodée. Le son et la durée sont conservés.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }),
    fields: [
      {
        key: 'degrees',
        label: { en: 'Clockwise', zh: '顺时针', fr: 'Sens horaire' },
        kind: 'choice',
        options: [
          { value: 90, label: { en: '90° (right)', zh: '90°（向右）', fr: '90° (droite)' } },
          {
            value: 180,
            label: { en: '180° (upside down)', zh: '180°（倒过来）', fr: '180° (à l’envers)' },
          },
          { value: 270, label: { en: '270° (left)', zh: '270°（向左）', fr: '270° (gauche)' } },
        ],
      },
    ],
    requires: [],
  },
  {
    id: 'video.audio',
    ai: '"Replace / add background music" → in.videos then this (the music is chosen at run time). Never add a second input action for the music.',
    label: { en: 'Change background music', zh: '换背景音乐', fr: 'Changer la musique de fond' },
    description: {
      en: 'Choose a music file locally when this runs, then use it as the soundtrack for each video. Set how much original sound to keep (0–100%) and whether shorter music repeats. Longer music is trimmed. Output keeps each video’s duration; no file paths or music content go to AI.',
      zh: '运行时在本机选一个音乐文件，为每段视频配乐。设置保留的原声音量（0–100%）以及较短音乐是否循环；较长音乐截到视频结束。结果时长不变，音乐内容和路径不发给 AI。',
      fr: 'Choisissez un fichier musical sur cet appareil au lancement, puis utilisez-le comme bande-son de chaque vidéo. Réglez le volume du son d’origine conservé (0–100 %) et si une musique plus courte doit être répétée. Une musique plus longue est coupée. La durée de chaque résultat est conservée ; ni les chemins de fichiers ni le contenu musical ne sont envoyés à l’IA.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ originalVolume: z.number().int().min(0).max(100), loop: z.boolean() }),
    fields: [
      {
        key: 'originalVolume',
        label: { en: 'Original sound', zh: '原声音量', fr: 'Son d’origine' },
        kind: 'number',
        unit: '%',
        min: 0,
        max: 100,
        step: 10,
      },
      {
        key: 'loop',
        label: {
          en: 'Repeat shorter music',
          zh: '音乐较短时循环',
          fr: 'Répéter la musique si elle est plus courte',
        },
        kind: 'toggle',
      },
    ],
    presets: [
      {
        id: 'replace',
        label: { en: 'Music only', zh: '只留音乐', fr: 'Musique seule' },
        values: { originalVolume: 0, loop: true },
      },
    ],
    requires: ['files.pick'],
  },
  {
    id: 'video.mute',
    ai: '"Remove all sound / mute a video" → in.videos then this.',
    label: { en: 'Remove video sound', zh: '去掉视频声音', fr: 'Supprimer le son de la vidéo' },
    description: {
      en: 'Remove all sound from each video and export an MP4 with no audio track. Video is re-encoded; the source file is kept.',
      zh: '去掉每段视频的全部声音，导出没有音轨的 MP4。画面会重新编码，原文件保留。',
      fr: 'Supprimez tout le son de chaque vidéo et exportez un MP4 sans piste audio. La vidéo est réencodée ; le fichier source est conservé.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'video.frame',
    ai: '"Save a photo / grab a frame from a video" → in.videos, this, optionally out.saveToPhotos.',
    label: {
      en: 'Save a video frame',
      zh: '截一帧存成照片',
      fr: 'Enregistrer une image de la vidéo',
    },
    description: {
      en: 'Choose a time in each video on the device and save the nearest decoded frame as a full-resolution JPEG, upright. Output is images, so image actions and saving to Photos can follow.',
      zh: '在手机上为每段视频选一个时间点，把最接近的画面存成原尺寸、已摆正的 JPEG。输出图片，可以继续接图片处理或存到相册。',
      fr: 'Choisissez un instant dans chaque vidéo sur l’appareil et enregistrez l’image décodée la plus proche en JPEG pleine résolution, redressée. Le résultat est une image ; vous pouvez ensuite utiliser les actions sur image ou l’enregistrer dans la photothèque.',
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
    ai: '"Join / merge several video clips" → in.videos (min 2, max 10), file.order, this.',
    label: { en: 'Join videos', zh: '拼接视频', fr: 'Fusionner les vidéos' },
    description: {
      en: 'Join 2–10 videos in order into one MP4. Put file.order before this step so the user can arrange the clips. Uses the first clip’s size and frame rate; other aspect ratios fit inside with black borders. Sound is kept; silent clips stay silent.',
      zh: '把 2–10 段视频按顺序接成一个 MP4。前面加 file.order 让用户调整顺序。尺寸、帧率以第一段为准；不同比例居中留黑边，保留完整画面。保留声音，无声片段保持静音。',
      fr: 'Fusionnez 2 à 10 vidéos dans l’ordre en un seul MP4. Ajoutez file.order avant cette étape pour pouvoir réorganiser les clips. Les dimensions et la fréquence d’images sont celles du premier clip ; les autres formats sont centrés avec des bandes noires, pour garder l’image complète. Le son est conservé ; les clips sans son restent muets.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({}),
    fields: [],
    requires: [],
  },
  {
    id: 'video.compress',
    ai: '"A video too big to send / make the video smaller / under N MB" → by "size" with maxMB, or by "quality".',
    label: { en: 'Make video smaller', zh: '压缩视频', fr: 'Compresser la vidéo' },
    description: {
      en: 'Make each video smaller: by size (at most N MB; the resolution drops as needed) or by quality (1080p / 720p / 480p). The result is an MP4 that plays everywhere.',
      zh: '把每个视频压小：按大小（不超过 N MB，需要时自动降低分辨率）或按画质（1080p / 720p / 480p）。结果是哪里都能放的 MP4。',
      fr: 'Compressez chaque vidéo : selon la taille (N Mo maximum ; la résolution baisse si nécessaire) ou selon la qualité (1080p / 720p / 480p). Le résultat est un MP4 lisible partout.',
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
        label: { en: 'Make it', zh: '压缩方式', fr: 'Mode de compression' },
        kind: 'choice',
        options: [
          { value: 'size', label: { en: 'Smaller than a size', zh: '按大小', fr: 'Par taille' } },
          {
            value: 'quality',
            label: { en: 'Lower quality', zh: '按画质', fr: 'Réduire la qualité' },
          },
        ],
      },
      {
        key: 'maxMB',
        label: { en: 'At most', zh: '不超过', fr: 'Au plus' },
        kind: 'number',
        unit: 'MB',
        min: 1,
        max: 2000,
        step: 1,
        showIf: { key: 'by', equals: ['size'] },
      },
      {
        key: 'quality',
        label: { en: 'Quality', zh: '画质', fr: 'Qualité' },
        kind: 'choice',
        options: [
          {
            value: '1080p',
            label: { en: '1080p (sharp)', zh: '1080p（清楚）', fr: '1080p (net)' },
          },
          { value: '720p', label: { en: '720p (good)', zh: '720p（够用）', fr: '720p (bien)' } },
          {
            value: '480p',
            label: { en: '480p (smallest)', zh: '480p（最小）', fr: '480p (le plus petit)' },
          },
        ],
        showIf: { key: 'by', equals: ['quality'] },
      },
    ],
    presets: [
      {
        id: '20mb',
        label: { en: '20 MB', zh: '20 MB', fr: '20 MB' },
        values: { by: 'size', maxMB: 20, quality: '720p' },
      },
      // D-199：写上常见的限制，用户一看就知道选哪个（各平台的限制上线前再核对）。
      {
        id: '10mb',
        label: { en: '10 MB · Discord', zh: '10 MB · Discord', fr: '10 MB · Discord' },
        values: { by: 'size', maxMB: 10, quality: '720p' },
      },
      {
        id: '25mb',
        label: {
          en: '25 MB · email attachment',
          zh: '25 MB · 邮件附件',
          fr: '25 Mo · pièce jointe e-mail',
        },
        values: { by: 'size', maxMB: 25, quality: '720p' },
      },
      {
        id: '50mb',
        label: { en: '50 MB', zh: '50 MB', fr: '50 MB' },
        values: { by: 'size', maxMB: 50, quality: '720p' },
      },
      {
        id: '100mb',
        label: { en: '100 MB', zh: '100 MB', fr: '100 MB' },
        values: { by: 'size', maxMB: 100, quality: '720p' },
      },
      {
        id: '720p',
        label: { en: '720p', zh: '720p', fr: '720p' },
        values: { by: 'quality', maxMB: 20, quality: '720p' },
      },
      {
        id: '480p',
        label: { en: '480p', zh: '480p', fr: '480p' },
        values: { by: 'quality', maxMB: 20, quality: '480p' },
      },
    ],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match:
          /^压缩视频$|^(?:把)?视频压小(?:一点)?$|^compress (?:the )?videos?$|^make (?:the )?videos? smaller$/i,
        step: () => ({ params: { by: 'size', maxMB: 20, quality: '720p' } }),
      },
    ],
  },
  {
    id: 'video.convert',
    ai: '"Others can\'t open it / MOV, HEVC or MKV to MP4".',
    label: { en: 'Convert to MP4', zh: '转成 MP4', fr: 'Convertir en MP4' },
    description: {
      en: 'Convert videos (MOV, HEVC…) to MP4 with H.264 so that other people can open them; quality and resolution stay about the same.',
      zh: '把视频（MOV、HEVC 等）转成 H.264 的 MP4，别人一般都能打开；画质和分辨率基本不变。',
      fr: 'Convertissez les vidéos (MOV, HEVC…) en MP4 H.264 pour que d’autres puissent les ouvrir ; la qualité et la résolution restent à peu près les mêmes.',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({ format: z.enum(['mp4']) }),
    fields: [
      {
        key: 'format',
        label: { en: 'Format', zh: '格式', fr: 'Format' },
        kind: 'choice',
        options: [
          { value: 'mp4', label: { en: 'MP4 (H.264)', zh: 'MP4（H.264）', fr: 'MP4 (H.264)' } },
        ],
      },
    ],
    presets: [{ id: 'mp4', label: { en: 'MP4', zh: 'MP4', fr: 'MP4' }, values: { format: 'mp4' } }],
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [
      {
        match: /^(?:转|转成|转换成|改成)\s*mp4(?:\s*格式)?$|^convert (?:it |them )?to mp4$/i,
        step: () => ({ params: { format: 'mp4' } }),
      },
    ],
  },
  {
    // D-184：iOS 用系统 ImageIO 写 GIF，Android 用 morph-media 里自己写的编码器（GifEncoder.kt）。
    id: 'video.toGif',
    ai: '"Turn a video (clip) into a GIF" → in.videos, video.trim, then this.',
    label: { en: 'Video to GIF', zh: '视频转 GIF', fr: 'Vidéo en GIF' },
    description: {
      en: `Turn each video into an animated GIF (at most ${GIF_MAX_SECONDS} seconds; put "Trim" before it for a longer video). GIFs have no sound and get large quickly: a smaller width and fewer frames per second keep them small.`,
      fr: `Convertissez chaque vidéo en GIF animé (au maximum ${GIF_MAX_SECONDS} secondes ; pour une vidéo plus longue, ajoutez une étape « Couper » avant celle-ci). Les GIF sont muets et deviennent vite volumineux : réduisez la largeur et le nombre d’images par seconde.`,
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
        label: { en: 'Width', zh: '宽度', fr: 'Largeur' },
        kind: 'choice',
        options: [
          {
            value: 320,
            label: { en: '320 px (small)', zh: '320 像素（小）', fr: '320 px (petit)' },
          },
          { value: 480, label: { en: '480 px', zh: '480 像素', fr: '480 px' } },
          {
            value: 640,
            label: { en: '640 px (sharp)', zh: '640 像素（清楚）', fr: '640 px (net)' },
          },
        ],
      },
      {
        key: 'fps',
        label: { en: 'Frames per second', zh: '每秒帧数', fr: 'Images par seconde' },
        kind: 'choice',
        options: [
          { value: 8, label: { en: '8 (smallest)', zh: '8（最小）', fr: '8 (le plus léger)' } },
          { value: 12, label: { en: '12', zh: '12', fr: '12' } },
          { value: 15, label: { en: '15 (smooth)', zh: '15（流畅）', fr: '15 (fluide)' } },
        ],
      },
    ],
    presets: [
      {
        id: 'small',
        label: { en: 'Small', zh: '小', fr: 'Petit' },
        values: { width: 320, fps: 8 },
      },
      {
        id: 'medium',
        label: { en: 'Medium', zh: '中', fr: 'Moyen' },
        values: { width: 480, fps: 12 },
      },
      {
        id: 'sharp',
        label: { en: 'Sharp', zh: '清楚', fr: 'Net' },
        values: { width: 640, fps: 15 },
      },
    ],
    requires: [],
  },
  {
    id: 'video.trim',
    ai: '"Cut out a part / trim". The result is always MP4.',
    label: { en: 'Trim', zh: '剪一段', fr: 'Couper' },
    description: {
      en: 'The user picks the start and end of each video on the device; only that part is kept (no re-encoding, so it is quick and keeps the quality).',
      zh: '用户在手机上选每个视频的开始和结束，只留中间这一段（不重新编码，很快，画质不变）。',
      fr: 'L’utilisateur choisit le début et la fin de chaque vidéo sur l’appareil ; seule la partie choisie est conservée (pas de réencodage, donc c’est rapide et la qualité ne change pas).',
    },
    input: ['video'],
    output: 'video',
    params: z.strictObject({}),
    fields: [],
    local: 'trimMedia',
    requires: [],
    // 内置规则认的步骤说法（D-265）。
    phrases: [{ match: /^(?:剪一段|剪视频|剪辑|截取一段)$|^trim(?: it| the video)?$/i }],
  },
];

/** 单功能工作流（D-061）：工具页上每个一个运行卡片。 */
export function videoWorkflows(locale: Locale): Workflow[] {
  const wf = (id: string, name: [string, string], steps: Workflow['steps']): Workflow => ({
    id,
    kind: 'quickAction',
    package: VIDEO_TOOL_ID,
    name: pairText(locale, name),
    steps,
  });
  return [
    wf(
      'video-subtitles',
      ['Export SRT captions', '导出 SRT 字幕'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        {
          id: 'captions',
          action: 'video.subtitles',
          params: { lang: speechLangFor(locale), model: 'standard' },
          ask: ['lang'],
        },
      ],
    ),

    wf(
      'video-speed',
      ['Change video speed', '视频加速或慢放'],
      [
        { id: 'pick', action: 'in.videos', params: { min: 1, max: 10 } },
        { id: 'speed', action: 'video.speed', params: { factor: 2 }, ask: ['factor'] },
      ],
    ),
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
  version: '1.9.0',
  name: { en: 'Video', zh: '视频', fr: 'Vidéo' },
  description: {
    en: 'Make videos smaller, convert them to MP4, trim them and turn them into GIFs, on this device.',
    zh: '在本机压缩视频、转成 MP4、剪一段、转成 GIF 动图。',
    fr: 'Compressez les vidéos, convertissez-les en MP4, coupez-les et créez des GIF animés, sur cet appareil.',
  },
  icon: 'video',
  aliases: ['video', 'videos', 'video tool', 'movie', 'gif', '视频', '视频工具', '影片', '动图'],
  permissions: ['files.pick', 'files.write', 'photos.save'],
  actions: VIDEO_ACTIONS,
  createPage: (locale) => ({
    id: VIDEO_PAGE_ID,
    title: t(locale, 'video_Video_19238'),
    icon: 'video',
    package: VIDEO_TOOL_ID,
    blocks: [
      {
        id: 'video-header',
        look: 'header',
        show: { title: t(locale, 'video_Video_tools_632fd') },
      },
      {
        id: 'video-intro',
        look: 'text',
        show: {
          text: t(locale, 'video_Everything_runs_on_this_device_nothing_d4b96'),
        },
      },
      ...videoWorkflows(locale).map((wf) => ({
        id: `${wf.id}-runner`,
        look: 'action' as const,
        tools: [{ tool: wf.id }],
      })),
      {
        id: 'video-files',
        look: 'files',
        show: { title: t(locale, 'video_Videos_0f33c') },
        source: {
          table: FILES_TABLE,
          filter: [{ field: 'kind', op: 'is', value: 'video' }],
          limit: 10,
        },
      },
    ],
  }),
  createWorkflows: videoWorkflows,
};
