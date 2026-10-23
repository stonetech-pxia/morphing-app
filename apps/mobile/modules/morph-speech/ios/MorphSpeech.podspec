# 本地 Expo 模块（D-150）：用 iOS 自带的 Speech 框架在本机把录音转成文字。
# 只依赖 Apple 系统框架，没有第三方代码。

Pod::Spec.new do |s|
  s.name           = 'MorphSpeech'
  s.version        = '1.0.0'
  s.summary        = 'On-device speech to text for Morph'
  s.description    = 'Transcribes audio files with SpeechAnalyzer (iOS 26+) or on-device SFSpeechRecognizer.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFoundation', 'CryptoKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
