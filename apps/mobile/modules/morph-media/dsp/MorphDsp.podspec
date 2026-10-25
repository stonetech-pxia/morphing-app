# 原生响度测量：libebur128 1.2.6（MIT），BSD-3 的 queue.h，见 ebur128/。
Pod::Spec.new do |s|
  s.name = 'MorphDsp'
  s.version = '1.0.0'
  s.summary = 'On-device audio loudness processing for Morph'
  s.license = 'AGPL-3.0-only'
  s.author = 'Morph contributors'
  s.homepage = 'https://github.com/jiixyj/libebur128'
  s.source = { git: '' }
  s.platforms = { :ios => '16.4' }
  s.static_framework = true
  s.source_files = 'MorphDsp.{c,h}', 'ebur128/*.{c,h}'
  s.public_header_files = 'MorphDsp.h'
  s.resource_bundles = { 'MorphDspLicenses' => ['notices/*.txt'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
