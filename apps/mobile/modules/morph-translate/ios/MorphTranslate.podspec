# 本地 Expo 模块（D-170）：用 iOS 自带的 Translation 框架在本机翻译，NaturalLanguage 识别语言。
# 只依赖 Apple 系统框架，没有第三方代码。Translation 从 iOS 18 起才有，弱链接，更早的系统上 isSupported 为 false。

Pod::Spec.new do |s|
  s.name           = 'MorphTranslate'
  s.version        = '1.0.0'
  s.summary        = 'On-device translation for Morph'
  s.description    = 'Apple Translation framework sessions (with the system download prompt) and NaturalLanguage language detection.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NaturalLanguage', 'SwiftUI'
  s.weak_frameworks = 'Translation'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
