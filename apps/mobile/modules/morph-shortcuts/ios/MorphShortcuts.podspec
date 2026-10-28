# 本地 Expo 模块（D-269）：长按 Morph 图标的菜单（Home Screen Quick Actions）。只依赖 Apple 系统框架。

Pod::Spec.new do |s|
  s.name           = 'MorphShortcuts'
  s.version        = '1.0.0'
  s.summary        = 'Home screen quick actions for Morph'
  s.description    = 'UIApplicationShortcutItem for the quick actions the user put on the home screen.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
