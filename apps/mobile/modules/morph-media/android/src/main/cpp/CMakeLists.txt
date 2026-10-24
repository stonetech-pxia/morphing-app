# MP3 输出（D-183）：把 LAME 3.100 的编码器（LGPL-2.0+，源码在 ../../../../lame，iOS 编的是同一份）
# 和一层很薄的 JNI（morph_mp3.c）编成 libmorphmp3.so。宏的说明见 lame/README.md。
cmake_minimum_required(VERSION 3.22)
project(morphmp3 LANGUAGES C)

# 调试版的 App 里也要优化过的编码器：不优化时慢很多。
set(CMAKE_BUILD_TYPE Release)

# Android 15 起 Google Play 要求原生库按 16 KB 页对齐。
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")

set(LAME_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../lame)
file(GLOB LAME_SOURCES ${LAME_DIR}/libmp3lame/*.c)

add_library(morphmp3 SHARED morph_mp3.c ${LAME_SOURCES})
target_include_directories(morphmp3 PRIVATE ${LAME_DIR}/include ${LAME_DIR}/libmp3lame)
target_compile_definitions(morphmp3 PRIVATE
  STDC_HEADERS=1 HAVE_STDINT_H=1 HAVE_INTTYPES_H=1 HAVE_LIMITS_H=1 HAVE_ERRNO_H=1 HAVE_FCNTL_H=1
  HAVE_UNISTD_H=1 HAVE_MEMCPY=1 HAVE_STRCHR=1 USE_FAST_LOG=1 LAME_LIBRARY_BUILD=1
  ieee754_float32_t=float ieee754_float64_t=double)
target_compile_options(morphmp3 PRIVATE -O3 -w -fvisibility=hidden)
target_link_libraries(morphmp3 PRIVATE m)
