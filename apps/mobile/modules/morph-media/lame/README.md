# LAME 3.100（MP3 编码器）

Morph 输出 MP3 用的编码库（D-183，推翻 P-020 的「不做」）。iOS（`MorphLame.podspec`）和 Android
（`../android/src/main/cpp/CMakeLists.txt`）编译的是这同一份源码。

- 来源：<https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz>
  （SHA-256 `ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e`，和 Homebrew 记录的一致）
- 许可证：LGPL-2.0 或更新版本（`COPYING`、`LICENSE`）。Morph 公开全部源码（AGPL-3.0），用户可以换掉这个库重新编译，
  满足 LGPL 对静态链接的要求。MP3 的专利已在 2017 年到期。
- 只放了编码器需要的文件：`include/lame.h`、`libmp3lame/` 的 `.c` / `.h`（不含 `mpglib_interface.c` 和 x86 的
  `i386/`、`vector/xmm_quantize_sub.c`）、`libmp3lame/vector/lame_intrin.h`。**源码一个字没改**。
- 不用 autoconf 生成的 `config.h`：两边都不定义 `HAVE_CONFIG_H`，改用编译参数定义同样的宏（见 podspec 和 CMakeLists）：
  `STDC_HEADERS HAVE_STDINT_H HAVE_INTTYPES_H HAVE_LIMITS_H HAVE_ERRNO_H HAVE_FCNTL_H HAVE_UNISTD_H HAVE_MEMCPY HAVE_STRCHR USE_FAST_LOG LAME_LIBRARY_BUILD`，
  以及 `ieee754_float32_t=float`、`ieee754_float64_t=double`（configure 本来会把这两个 typedef 写进 config.h）。
  不定义 `DECODE_ON_THE_FLY`、`HAVE_MPGLIB`（不带解码器）。

换版本时：换掉这些文件，更新上面的地址和哈希，再在 Mac 上编一遍、编码一段 WAV 用 `afinfo` 检查。
