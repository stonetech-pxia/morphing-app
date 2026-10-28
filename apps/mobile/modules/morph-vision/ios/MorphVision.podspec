# 本地 Expo 模块（D-084）：用 iOS 自带的 Vision / VisionKit / Core Image 做扫描，
# 文字识别用 PP-OCRv6（D-269，ONNX Runtime 跑模型，MIT；Vision 只认 PP-OCRv6 不认的语言）。

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
  s.dependency 'onnxruntime-objc', '1.30.0'
  s.frameworks = 'Vision', 'VisionKit', 'CoreImage', 'ImageIO'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
