# LAME 3.100 的 MP3 编码器（D-183，LGPL-2.0+，见 README.md）。MorphMedia 依赖它输出 MP3。
# 单独一个 pod：LAME 的宏和内部头文件（util.h、tables.h…）只在这里，不影响别的代码。

Pod::Spec.new do |s|
  s.name           = 'MorphLame'
  s.version        = '3.100.0'
  s.summary        = 'LAME MP3 encoder (libmp3lame 3.100) for Morph'
  s.description    = 'The unmodified libmp3lame encoder sources, built without the mpglib decoder.'
  s.license        = { :type => 'LGPL-2.0-or-later', :file => 'COPYING' }
  s.author         = 'The LAME project'
  s.homepage       = 'https://lame.sourceforge.io/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.source_files = 'include/lame.h', 'libmp3lame/**/*.{c,h}'
  s.public_header_files = 'include/lame.h'
  s.compiler_flags = '-w'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/include" "$(PODS_TARGET_SRCROOT)/libmp3lame"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) STDC_HEADERS=1 HAVE_STDINT_H=1 HAVE_INTTYPES_H=1 HAVE_LIMITS_H=1 HAVE_ERRNO_H=1 HAVE_FCNTL_H=1 HAVE_UNISTD_H=1 HAVE_MEMCPY=1 HAVE_STRCHR=1 USE_FAST_LOG=1 LAME_LIBRARY_BUILD=1 ieee754_float32_t=float ieee754_float64_t=double'
  }
end
