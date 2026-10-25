# 本地声音处理

libebur128 1.2.6 原始源码来自 [上游 v1.2.6](https://github.com/jiixyj/libebur128/tree/v1.2.6)，用于 BS.1770/EBU R128 的 LUFS 统计和采样峰值，不读取或上传文件。
`ebur128.c`、`ebur128.h` 未改动。MIT 许可原文在 `ebur128/COPYING`；备用 `queue/sys/queue.h` 使用 BSD-3-Clause，许可在 `ebur128/QUEUE-LICENSE`。

MorphDsp 是项目自己的薄封装：自动尽量达到 −16 LUFS，手动 ±24 dB，峰值限制到 −1 dBFS；动态范围过大的音频可能无法达到目标响度。两遍流式解码，不把整个文件放进内存。短于响度测量窗口的内容不自动放大；纯静音保持静音。
