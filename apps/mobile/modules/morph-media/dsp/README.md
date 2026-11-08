# Local audio processing

The original libebur128 1.2.6 source comes from [upstream v1.2.6](https://github.com/jiixyj/libebur128/tree/v1.2.6). It is used for BS.1770/EBU R128 LUFS statistics and sample peaks, and does not read or upload files.
`ebur128.c` and `ebur128.h` are unmodified. The MIT license text is in `ebur128/COPYING`; the fallback `queue/sys/queue.h` uses BSD-3-Clause, with its license in `ebur128/QUEUE-LICENSE`.

MorphDsp is the project's own thin wrapper: automatic mode aims for −16 LUFS where possible, manual mode allows ±24 dB, and peaks are limited to −1 dBFS; audio with too large a dynamic range may not reach the target loudness. Decoding is two-pass and streaming, so the whole file is never held in memory. Content shorter than the loudness measurement window is not amplified automatically; pure silence stays silent.

## RNNoise 0.2

Upstream source: https://github.com/xiph/rnnoise/tree/v0.2 . Default model C files from https://media.xiph.org/rnnoise/models/rnnoise_data-0b50c45.tar.gz (the upstream model_version pin). Source/model BSD notices ship in RNNoise-BSD.txt. No runtime model download or upload.

The v0.2 vector kernels include an absent os_support.h. Our compatibility shim maps OPUS_CLEAR to the existing RNN_CLEAR helper; common.h and pitch.c use angle brackets for standard library includes to avoid the React Native Folly headers named Stdlib.h/Math.h on case-insensitive macOS. Other upstream files remain unchanged. ARM uses baseline NEON, no SVE/SME or runtime CPU dispatch. Each channel has its own state. Callers compensate 960 frames (20ms) latency and flush the tail, retaining original duration and audio timestamps. Best for speech; music and other desired sounds can be suppressed.
