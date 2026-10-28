# 本地 Expo 模块（D-084）：用 iOS 自带的 Vision / VisionKit / Core Image 做文字识别和扫描。
# 只依赖 Apple 系统框架，没有第三方代码。

Pod::Spec.new do |s|
  s.name           = 'MorphVision'
  s.version        = '1.0.0'
  s.summary        = 'On-device text recognition and document scanning for Morph'
  s.description    = 'Vision text recognition, paper edge detection, perspective correction and the VisionKit document camera.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Morph contributors'
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'VisionKit', 'CoreImage', 'ImageIO'
  # DataDetection 是 iOS 26 才有的（预填用的日期和金额识别）：弱链接，更早的系统上不加载，退回 NSDataDetector。
  s.weak_frameworks = 'DataDetection'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
