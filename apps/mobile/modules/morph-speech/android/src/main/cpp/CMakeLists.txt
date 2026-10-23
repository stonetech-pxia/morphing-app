# Android 语音转文字（D-151）：把 whisper.cpp（MIT）编进 App；模型是第一次用时下载的下载内容（core/packs.ts）。
# whisper.cpp 的源码在构建时按固定版本和 SHA-256 下载（不放进仓库）；换版本时同时改 URL 和哈希。
cmake_minimum_required(VERSION 3.22)
project(morphwhisper LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
# 调试版的 App 里也要优化过的 whisper：不优化时慢几十倍，没法在调试版里试。
set(CMAKE_BUILD_TYPE Release)

# Android 15 起 Google Play 要求原生库按 16 KB 页对齐（whisper、ggml 的库也一样）。
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")
set(CMAKE_MODULE_LINKER_FLAGS "${CMAKE_MODULE_LINKER_FLAGS} -Wl,-z,max-page-size=16384")

include(FetchContent)
FetchContent_Declare(
  whisper
  URL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz
  URL_HASH SHA256=ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720
)

set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_SDL2 OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

if(ANDROID_ABI STREQUAL "arm64-v8a")
  # 手机 CPU 差别很大（老的千元机只有 armv8.0，新的有 dotprod / fp16 / i8mm / SVE）：
  # 编出几种 CPU 后端，运行时挑这台手机能用的最快的一种（morph_whisper.cpp 的 load_backends）。
  set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
  set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
  set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
else()
  # 32 位 ARM、x86（模拟器）只编一种通用的。
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
endif()

FetchContent_MakeAvailable(whisper)

add_library(morphwhisper SHARED morph_whisper.cpp)
target_link_libraries(morphwhisper PRIVATE whisper ggml log)
if(ANDROID_ABI STREQUAL "arm64-v8a")
  target_compile_definitions(morphwhisper PRIVATE MORPH_GGML_DL=1)
endif()
target_compile_options(morphwhisper PRIVATE -O3 -fvisibility=hidden)
