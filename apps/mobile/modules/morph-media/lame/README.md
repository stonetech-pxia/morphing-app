# LAME 3.100 (MP3 encoder)

The encoder library Morph uses to output MP3 (D-183, which overturned the "won't do" of P-020). iOS (`MorphLame.podspec`) and Android
(`../android/src/main/cpp/CMakeLists.txt`) compile this same source.

- Source: <https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz>
  (SHA-256 `ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e`, matching the Homebrew record)
- License: LGPL-2.0 or later (`COPYING`, `LICENSE`). Morph publishes all its source (AGPL-3.0), and users can swap this library and rebuild,
  which satisfies the LGPL requirement for static linking. The MP3 patents expired in 2017.
- Only the files the encoder needs are included: `include/lame.h`, the `.c` / `.h` files of `libmp3lame/` (without `mpglib_interface.c` and the x86
  `i386/`, `vector/xmm_quantize_sub.c`), and `libmp3lame/vector/lame_intrin.h`. **Not one character of the source was changed**.
- The autoconf-generated `config.h` is not used: neither side defines `HAVE_CONFIG_H`. Instead the same macros are defined through compiler flags (see the podspec and CMakeLists):
  `STDC_HEADERS HAVE_STDINT_H HAVE_INTTYPES_H HAVE_LIMITS_H HAVE_ERRNO_H HAVE_FCNTL_H HAVE_UNISTD_H HAVE_MEMCPY HAVE_STRCHR USE_FAST_LOG LAME_LIBRARY_BUILD`,
  plus `ieee754_float32_t=float` and `ieee754_float64_t=double` (configure would normally write these two typedefs into config.h).
  `DECODE_ON_THE_FLY` and `HAVE_MPGLIB` are not defined (no decoder).

When changing the version: replace these files, update the address and hash above, then build once on a Mac and encode a WAV clip, checking it with `afinfo`.
