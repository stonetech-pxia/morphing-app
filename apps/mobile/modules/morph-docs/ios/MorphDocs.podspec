# 本地 Expo 模块（D-186）：用系统的文档预览（WKWebView）和打印排版，在本机把 Word、Excel、PowerPoint 转成 PDF。
# 只依赖 Apple 系统框架，没有第三方代码。

Pod::Spec.new do |s|
  s.name           = 'MorphDocs'
  s.version        = '1.0.0'
  s.summary        = 'On-device Office documents to PDF for Morph'
  s.description    = 'Renders Word, Excel, PowerPoint and RTF files with WKWebView and paginates them with UIPrintPageRenderer.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WebKit', 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
