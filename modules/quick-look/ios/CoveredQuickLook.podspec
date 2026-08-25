Pod::Spec.new do |s|
  # Deliberately NOT named QuickLook. DEFINES_MODULE builds a Swift module under
  # the pod's name, so a pod called QuickLook shadows Apple's framework of the
  # same name and `import QuickLook` resolves to this pod — every QL type then
  # reads as "cannot find type in scope".
  s.name           = 'CoveredQuickLook'
  s.version        = '1.0.0'
  s.summary        = 'Apple Quick Look (QLPreviewController) for photos and PDFs.'
  s.description    = 'Presents QLPreviewController so attachments open the way Files and Mail show them.'
  s.author         = 'Plenum'
  s.homepage       = 'https://plenum.gr'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'QuickLook', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
