// 文件大小上限（DECISIONS P-006）。pdf-lib 会把整份文件读入内存，手机上必须限制。
export const FILE_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
} as const;
