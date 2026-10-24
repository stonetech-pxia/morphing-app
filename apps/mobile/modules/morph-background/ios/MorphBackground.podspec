# 本地 Expo 模块（D-160–D-163）：长任务切到后台也继续。iOS 26 的 BGContinuedProcessingTask（默认关着）。
# 只依赖 Apple 系统框架（BackgroundTasks），没有第三方代码。

Pod::Spec.new do |s|
  s.name           = 'MorphBackground'
  s.version        = '1.0.0'
  s.summary        = 'Keep long media jobs running in the background for Morph'
  s.description    = 'BGContinuedProcessingTask (iOS 26+) around user-started video and audio jobs.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'BackgroundTasks'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
