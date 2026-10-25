# 本地声音处理

libebur128 1.2.6 原始源码来自 [上游 v1.2.6](https://github.com/jiixyj/libebur128/tree/v1.2.6)，用于 BS.1770/EBU R128 的 LUFS 统计和采样峰值，不读取或上传文件。
`ebur128.c`、`ebur128.h` 未改动。MIT 许可原文在 `ebur128/COPYING`；备用 `queue/sys/queue.h` 使用 BSD-3-Clause，许可在 `ebur128/QUEUE-LICENSE`。

MorphDsp 是项目自己的薄封装：自动尽量达到 −16 LUFS，手动 ±24 dB，峰值限制到 −1 dBFS；动态范围过大的音频可能无法达到目标响度。两遍流式解码，不把整个文件放进内存。短于响度测量窗口的内容不自动放大；纯静音保持静音。

## RNNoise 0.2

Upstream source: https://github.com/xiph/rnnoise/tree/v0.2 . Default model C files from https://media.xiph.org/rnnoise/models/rnnoise_data-0b50c45.tar.gz (the upstream model_version pin). Source/model BSD notices ship in RNNoise-BSD.txt. No runtime model download or upload.

The v0.2 vector kernels include an absent os_support.h. Our compatibility shim maps OPUS_CLEAR to the existing RNN_CLEAR helper; common.h and pitch.c use angle brackets for standard library includes to avoid the React Native Folly headers named Stdlib.h/Math.h on case-insensitive macOS. Other upstream files remain unchanged. ARM uses baseline NEON, no SVE/SME or runtime CPU dispatch. Each channel has its own state. Callers compensate 960 frames (20ms) latency and flush the tail, retaining original duration and audio timestamps. Best for speech; music and other desired sounds can be suppressed.
