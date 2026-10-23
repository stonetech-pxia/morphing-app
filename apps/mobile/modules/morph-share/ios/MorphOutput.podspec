# 本地 Expo 模块（D-119）：用 iOS 自带的分享面板和文档选择器一次分享多个文件、存到「文件」里的文件夹。
# 只依赖 Apple 系统框架，没有第三方代码。
# pod 名叫 MorphOutput，不叫 MorphShare：iOS 分享扩展的 target 叫 MorphShare（D-114），同名的 Swift 模块会冲突。

Pod::Spec.new do |s|
  s.name           = 'MorphOutput'
  s.version        = '1.0.0'
  s.summary        = 'Share several files at once and save them to a folder for Morph'
  s.description    = 'UIActivityViewController with several files and a UIDocumentPickerViewController folder picker.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'UniformTypeIdentifiers'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
