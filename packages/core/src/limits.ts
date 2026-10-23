// 文件大小上限（DECISIONS P-006）。pdf-lib 会把整份文件读入内存，手机上必须限制。
export const FILE_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
} as const;

/**
 * 视频和音频的上限（D-142）：由原生模块边读边写，不进 JS 内存，所以不受上面 50 MB 的限制。
 * 单个不超过 4 GB，一次最多 10 个；开始前另外检查手机剩余空间。
 */
export const MEDIA_LIMITS = {
  maxFileBytes: 4 * 1024 * 1024 * 1024,
  maxCount: 10,
} as const;
