# 本地 Expo 模块（D-321）：桌面小组件的画面和点按队列，放在 App Group 里。只依赖 Apple 系统框架。

Pod::Spec.new do |s|
  s.name           = 'MorphWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Home screen widgets for Morph'
  s.description    = 'Writes the widget snapshot to the App Group and reads taps queued by the widget extension.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
