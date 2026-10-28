# 本地 Expo 模块（D-270）：用 iOS 自带的 AVSpeechSynthesizer 在本机把文字读成音频文件。
# 只依赖 Apple 系统框架，没有第三方代码。

Pod::Spec.new do |s|
  s.name           = 'MorphTTS'
  s.version        = '1.0.0'
  s.summary        = 'On-device text to speech files for Morph'
  s.description    = 'Writes AVSpeechSynthesizer output (write(_:toBufferCallback:)) to a WAV file.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
