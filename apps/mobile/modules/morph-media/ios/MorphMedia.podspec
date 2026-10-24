# 本地 Expo 模块（D-141）：在本机压缩、转格式、剪切视频和音频，取画面。
# 用 Apple 系统框架（AVFoundation）；MP3 用 LAME 编码器（MorphLame，../lame，D-183）。

Pod::Spec.new do |s|
  s.name           = 'MorphMedia'
  s.version        = '1.0.0'
  s.summary        = 'On-device video and audio processing for Morph'
  s.description    = 'AVAssetReader / AVAssetWriter transcoding, passthrough trimming and frame grabbing.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MorphLame'
  s.frameworks = 'AVFoundation', 'CoreMedia', 'VideoToolbox', 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
