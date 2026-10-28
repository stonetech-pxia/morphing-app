import CoreImage
#if canImport(DataDetection)
import DataDetection
#endif
import ExpoModulesCore
import ImageIO
import UIKit
import Vision
import VisionKit

// 文字识别和扫描（D-084）：只用 iOS 自带的 Vision / VisionKit / Core Image，全部在本机处理。
// 坐标约定和 JS 一致：像素，原点在左上角（Vision 和 Core Image 的原点在左下角，在这里换算）。
// 识别出的文字只返回给 App，不写日志。

final class VisionFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "Vision failed: \(param)" }
}

final class UnreadableImageException: Exception, @unchecked Sendable {
  override var reason: String { "Could not read the image" }
}

final class UnsupportedLanguageException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "Text recognition does not support \(param)" }
}

final class DocumentCameraUnavailableException: Exception, @unchecked Sendable {
  override var reason: String { "The document camera is not available on this device" }
}

/** cancelClassify(taskId) 取消了（JS 按 error.code 认）。 */
private func classifyCancelled() -> Exception {
  Exception(name: "VisionCancelled", description: "Cancelled", code: "ERR_VISION_CANCELLED")
}

struct ClassifyOptions: Record {
  @Field var maxResults: Int = 10
  @Field var minConfidence: Double = 0.1
}

struct PointRecord: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
}

struct QuadRecord: Record {
  @Field var tl = PointRecord()
  @Field var tr = PointRecord()
  @Field var br = PointRecord()
  @Field var bl = PointRecord()
}

public class MorphVisionModule: Module {
  private lazy var ciContext = CIContext(options: [.useSoftwareRenderer: false])
  private var cameraDelegate: DocumentCameraDelegate?
  /** 正在进行的图像分类，取消用（用 classifyLock 保护）。 */
  private var classifying: [String: VNRequest] = [:]
  private var cancelledClassify: Set<String> = []
  private let classifyLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("MorphVision")

    Function("isDocumentCameraSupported") { () -> Bool in
      VNDocumentCameraViewController.isSupported
    }

    // 有没有相机：没有相机时（模拟器）expo-image-picker 会抛出原生异常让 App 崩溃，所以先问一下。
    Function("isCameraAvailable") { () -> Bool in
      UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    Function("backgroundRemovalSupported") { () -> Bool in
      if #available(iOS 17.0, *) { return true }
      return false
    }

    AsyncFunction("backgroundStatus") { () -> String in
      if #available(iOS 17.0, *) { return "ready" }
      return "unsupported"
    }

    AsyncFunction("downloadBackgroundModel") { () -> Void in }

    AsyncFunction("removeBackground") { (uri: URL, background: String, output: URL) -> [String: Any] in
      return try self.removeBackground(uri, background: background, output: output)
    }

    // 「记一笔」预填用的系统识别，只做规则的补充（D-244）：iOS 26 起 DataDetection 认日期和金额，
    // 更早的系统用 NSDataDetector，只认日期。不需要下载，language 只是提示。
    AsyncFunction("detectData") { (text: String, language: String, _: Bool) async -> [[String: Any]] in
      await Self.detectData(text, language: language)
    }

    Function("dataDetectionStatus") { (_: String) -> String in
      "ready"
    }

    // 照片里是什么（没有文字的照片做推荐用，还没接进推荐）：Vision 自带的图像分类，不下载模型。
    // 标签是 Vision 自己的英文标识，和 Android 的 ML Kit 不是一套词。
    AsyncFunction("classifyImage") { (taskId: String, uri: URL, options: ClassifyOptions) -> [String: Any] in
      return try self.classifyImage(taskId, uri: uri, options: options)
    }

    Function("cancelClassify") { (taskId: String) in
      self.cancelClassify(taskId)
    }

    // 证件照（D-252）：人脸框（像素，原点在左上角，已按 EXIF 摆正）和只保留人像、换成纯色背景。
    AsyncFunction("detectFaces") { (uri: URL) -> [String: Any] in
      return try self.detectFaces(uri)
    }

    AsyncFunction("replacePersonBackground") { (uri: URL, color: String, output: URL) -> [String: Any] in
      return try self.replacePersonBackground(uri, color: color, output: output)
    }

    AsyncFunction("adjustImage") { (uri: URL, options: [String: Any], format: String, output: URL) -> [String: Any] in
      return try self.adjustImage(uri, options: options, format: format, output: output)
    }

    // iOS 能找纸张的四个角（Android 的 ML Kit 不能）。
    Function("canFindPaper") { () -> Bool in
      true
    }

    // 某种语言（BCP 47）系统能不能识别；不能的话 App 退回文字识别包。
    Function("supportsLanguage") { (code: String) -> Bool in
      let supported = (try? VNRecognizeTextRequest().supportedRecognitionLanguages()) ?? []
      return Self.match(code, in: supported) != nil
    }

    AsyncFunction("supportedLanguages") { () -> [String] in
      try VNRecognizeTextRequest().supportedRecognitionLanguages()
    }

    // 识别文字：accurate 级别 + 语言纠错。languages 是 BCP 47 代码，按顺序优先。
    AsyncFunction("recognizeText") { (uri: URL, languages: [String]) -> [String: Any] in
      let image = try self.loadImage(uri)
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      let supported = try request.supportedRecognitionLanguages()
      var chosen: [String] = []
      for code in languages {
        if let found = Self.match(code, in: supported), !chosen.contains(found) { chosen.append(found) }
      }
      // 第一种是用户选的语言，必须支持；后面的（英文）只是补充。
      if Self.match(languages.first ?? "", in: supported) == nil { throw UnsupportedLanguageException(languages.joined(separator: ",")) }
      request.recognitionLanguages = chosen
      do {
        try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
      } catch {
        throw VisionFailedException(error.localizedDescription)
      }
      let lines = (request.results ?? []).compactMap { obs -> TextLine? in
        guard let best = obs.topCandidates(1).first else { return nil }
        return TextLine(text: best.string, box: obs.boundingBox, confidence: best.confidence)
      }
      // 每行的位置（D-195，可搜索 PDF 的文字层）：像素，原点在左上角（Vision 的框是 0–1、原点在左下角）。
      let size = image.extent.size
      let items = lines.map { line -> [String: Any] in
        [
          "text": line.text,
          "x": line.box.minX * size.width,
          "y": (1 - line.box.maxY) * size.height,
          "width": line.box.width * size.width,
          "height": line.box.height * size.height,
        ]
      }
      return [
        "text": Self.layout(lines),
        "lines": lines.count,
        "languages": request.recognitionLanguages,
        "width": size.width,
        "height": size.height,
        "items": items,
      ]
    }

    // 找纸张的四个角：文档分割（专门找纸张）和矩形检测都做一遍再挑（见 pickPaper）。没找到时 quad 为 null。
    AsyncFunction("detectDocument") { (uri: URL) -> [String: Any] in
      let image = try self.loadImage(uri)
      let size = image.extent.size
      let handler = VNImageRequestHandler(ciImage: image, options: [:])
      let segmentation = VNDetectDocumentSegmentationRequest()
      let rectangles = VNDetectRectanglesRequest()
      rectangles.maximumObservations = 1
      rectangles.minimumSize = 0.2
      rectangles.minimumConfidence = 0.5
      rectangles.minimumAspectRatio = 0.2
      rectangles.maximumAspectRatio = 1.0
      rectangles.quadratureTolerance = 30
      _ = try? handler.perform([segmentation])
      _ = try? handler.perform([rectangles])
      let (found, method) = Self.pickPaper(
        segmentation: segmentation.results?.first.flatMap { $0.confidence >= 0.5 ? $0 : nil },
        rectangle: rectangles.results?.first)
      var result: [String: Any] = [
        "confidence": Double(found?.confidence ?? 0),
        "width": Int(size.width.rounded()),
        "height": Int(size.height.rounded()),
        "method": method,
      ]
      if let obs = found {
        let p = { (n: CGPoint) -> [String: Double] in
          ["x": Double(n.x * size.width), "y": Double((1 - n.y) * size.height)]
        }
        result["quad"] = [
          "tl": p(obs.topLeft), "tr": p(obs.topRight),
          "br": p(obs.bottomRight), "bl": p(obs.bottomLeft),
        ]
      } else {
        result["quad"] = NSNull()
      }
      return result
    }

    // 按四个角拉正（Core Image 透视矫正），缩放到 width × height，存成 JPG。
    AsyncFunction("straighten") {
      (uri: URL, quad: QuadRecord, width: Int, height: Int, quality: Double, output: URL) -> [String: Any] in
      let image = try self.loadImage(uri)
      let h = image.extent.height
      let vector = { (p: PointRecord) in CIVector(x: CGFloat(p.x), y: h - CGFloat(p.y)) }
      guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
        throw VisionFailedException("CIPerspectiveCorrection")
      }
      filter.setValue(image, forKey: kCIInputImageKey)
      filter.setValue(vector(quad.tl), forKey: "inputTopLeft")
      filter.setValue(vector(quad.tr), forKey: "inputTopRight")
      filter.setValue(vector(quad.br), forKey: "inputBottomRight")
      filter.setValue(vector(quad.bl), forKey: "inputBottomLeft")
      guard let corrected = filter.outputImage, corrected.extent.width >= 1, corrected.extent.height >= 1 else {
        throw VisionFailedException("perspective correction")
      }
      let w = CGFloat(max(1, width))
      let ht = CGFloat(max(1, height))
      let moved = corrected.transformed(
        by: CGAffineTransform(translationX: -corrected.extent.minX, y: -corrected.extent.minY))
      let scaled = moved
        .transformed(by: CGAffineTransform(scaleX: w / moved.extent.width, y: ht / moved.extent.height))
        .cropped(to: CGRect(x: 0, y: 0, width: w, height: ht))
      try self.writeJpeg(scaled, to: output, quality: quality)
      return ["width": Int(w), "height": Int(ht), "size": Self.fileSize(output)]
    }

    // 系统的文档相机（VisionKit）：实时找边、自动拍摄、多页，拍完已经拉正。
    // 每页存成 JPG（长边不超过 maxSide）放在 directory 里；用户取消时返回 null。
    AsyncFunction("scanDocuments") { (directory: URL, maxSide: Int, quality: Double, promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject(DocumentCameraUnavailableException())
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(DocumentCameraUnavailableException())
        return
      }
      let camera = VNDocumentCameraViewController()
      // 完成后清掉 cameraDelegate，打破 self ↔ delegate 的引用环。
      let delegate = DocumentCameraDelegate { result in
        camera.dismiss(animated: true)
        self.cameraDelegate = nil
        switch result {
        case .cancelled:
          promise.resolve(nil)
        case .failed(let error):
          promise.reject(VisionFailedException(error.localizedDescription))
        case .finished(let scan):
          // 编码放到后台，不卡界面。
          DispatchQueue.global(qos: .userInitiated).async {
            do {
              promise.resolve(try self.savePages(scan, directory: directory, maxSide: maxSide, quality: quality))
            } catch {
              promise.reject(error)
            }
          }
        }
      }
      self.cameraDelegate = delegate
      camera.delegate = delegate
      presenter.present(camera, animated: true)
    }
    .runOnQueue(DispatchQueue.main)
  }

  // MARK: - Helpers

  /**
   挑一个结果：一般用文档分割的；但如果它有两个以上的角贴着照片边缘，而矩形检测找到的框在照片里面，
   就用矩形的。模拟器上文档分割常常给出贴着照片底边的一条（置信度还很高），在 Mac 上同一张图是对的。
   */
  static func pickPaper(
    segmentation: VNRectangleObservation?, rectangle: VNRectangleObservation?
  ) -> (VNRectangleObservation?, String) {
    func onBorder(_ o: VNRectangleObservation) -> Int {
      let corners: [CGPoint] = [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft]
      var count = 0
      for p in corners where min(p.x, p.y) < 0.01 || max(p.x, p.y) > 0.99 { count += 1 }
      return count
    }
    if let seg = segmentation {
      if let rect = rectangle, onBorder(seg) >= 2, onBorder(rect) < 2 { return (rect, "rectangles") }
      return (seg, "segmentation")
    }
    if let rect = rectangle { return (rect, "rectangles") }
    return (nil, "none")
  }

  private func adjustImage(_ uri: URL, options: [String: Any], format: String, output: URL) throws -> [String: Any] {
    let image = try loadImage(uri)
    let automatic = options["mode"] as? String == "auto"
    var result = image
    if automatic {
      for filter in image.autoAdjustmentFilters(options: [.enhance: true, .redEye: false]) {
        filter.setValue(result, forKey: kCIInputImageKey)
        if let adjusted = filter.outputImage { result = adjusted }
      }
    } else {
      let brightness = (options["brightness"] as? NSNumber)?.doubleValue ?? 0
      let contrast = (options["contrast"] as? NSNumber)?.doubleValue ?? 100
      let saturation = (options["saturation"] as? NSNumber)?.doubleValue ?? 100
      guard brightness.isFinite, contrast.isFinite, saturation.isFinite, (-100...100).contains(brightness), (0...200).contains(contrast), (0...200).contains(saturation) else { throw VisionFailedException("invalid adjustment") }
      result = image.applyingFilter("CIColorControls", parameters: [kCIInputBrightnessKey: brightness/100, kCIInputContrastKey: contrast/100, kCIInputSaturationKey: saturation/100])
    }
    result = result.cropped(to: image.extent)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    if format == "png" {
      try ciContext.writePNGRepresentation(of: result, to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    } else {
      try writeJpeg(result, to: output, quality: 0.92)
    }
    return ["width": Int(result.extent.width), "height": Int(result.extent.height), "size": (try FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.intValue ?? 0]
  }

  private func removeBackground(_ uri: URL, background: String, output: URL) throws -> [String: Any] {
    guard #available(iOS 17.0, *) else { throw VisionFailedException("iOS 17 required") }
    let image = try loadImage(uri)
    let handler = VNImageRequestHandler(ciImage: image, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    do { try handler.perform([request]) } catch { throw VisionFailedException(error.localizedDescription) }
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else { throw VisionFailedException("no subject") }
    let buffer = try observation.generateMaskedImage(ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: false)
    return try writeCutout(CIImage(cvPixelBuffer: buffer), background: background, output: output)
  }

  private func detectFaces(_ uri: URL) throws -> [String: Any] {
    let image = try loadImage(uri)
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(ciImage: image, options: [:])
    do { try handler.perform([request]) } catch { throw VisionFailedException(error.localizedDescription) }
    let width = image.extent.width
    let height = image.extent.height
    // Vision 的框是 0–1 的比例，原点在左下角：换成像素、原点在左上角。
    let faces: [[String: Double]] = (request.results ?? []).map { face in
      let box = face.boundingBox
      return [
        "x": Double(box.minX * width),
        "y": Double((1 - box.maxY) * height),
        "width": Double(box.width * width),
        "height": Double(box.height * height),
      ]
    }
    return ["width": Int(width), "height": Int(height), "faces": faces]
  }

  /**
   * 人像分割（iOS 15 起，VNGeneratePersonSegmentationRequest，accurate）：人留下，其余换成纯色，输出 PNG。
   * 遮罩比原图小，放大到原图大小再混合；发丝边缘是半透明的过渡。
   */
  private func replacePersonBackground(_ uri: URL, color: String, output: URL) throws -> [String: Any] {
    guard color.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil,
          let rgb = UInt32(color.dropFirst(), radix: 16) else { throw VisionFailedException("invalid color") }
    let image = try loadImage(uri)
    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .accurate
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    let handler = VNImageRequestHandler(ciImage: image, options: [:])
    do { try handler.perform([request]) } catch { throw VisionFailedException(error.localizedDescription) }
    guard let buffer = request.results?.first?.pixelBuffer else { throw VisionFailedException("no person") }
    var mask = CIImage(cvPixelBuffer: buffer)
    mask = mask.transformed(by: CGAffineTransform(
      scaleX: image.extent.width / mask.extent.width, y: image.extent.height / mask.extent.height))
    let fill = CIImage(color: CIColor(
      red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255
    )).cropped(to: image.extent)
    guard let blend = CIFilter(name: "CIBlendWithMask", parameters: [
      kCIInputImageKey: image, kCIInputBackgroundImageKey: fill, kCIInputMaskImageKey: mask,
    ])?.outputImage?.cropped(to: image.extent) else { throw VisionFailedException("blend") }
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    try ciContext.writePNGRepresentation(of: blend, to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    return ["width": Int(blend.extent.width), "height": Int(blend.extent.height), "size": Self.fileSize(output)]
  }

  private func writeCutout(_ foreground: CIImage, background: String, output: URL) throws -> [String: Any] {
    let result: CIImage
    if background == "transparent" {
      result = foreground
    } else {
      guard background.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil,
            let rgb = UInt32(background.dropFirst(), radix: 16) else { throw VisionFailedException("invalid color") }
      let color = CIColor(red: CGFloat((rgb >> 16) & 255)/255, green: CGFloat((rgb >> 8) & 255)/255, blue: CGFloat(rgb & 255)/255)
      result = foreground.composited(over: CIImage(color: color).cropped(to: foreground.extent))
    }
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    try ciContext.writePNGRepresentation(of: result, to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    return ["width": Int(result.extent.width), "height": Int(result.extent.height), "size": (try FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.intValue ?? 0]
  }

  /**
   * 位置是 UTF-16（和 JS 字符串一样）；日期按识别出的时区（没有时用本机时区）写成 YYYY-MM-DD，
   * 金额给系统读出的数（JS 还会按原文再统一一遍）。文字不写日志。
   */
  private static func detectData(_ text: String, language: String) async -> [[String: Any]] {
    #if canImport(DataDetection)
    if #available(iOS 26.0, *) {
      var options = DataDetector.Options()
      if !language.isEmpty { options.documentLanguageCode = Locale.LanguageCode(language) }
      var out: [[String: Any]] = []
      for await match in text.dataDetectorMatches([.moneyAmount, .calendarEvent], options: options) {
        guard let range = match.range else { continue }
        let start = text.utf16.distance(from: text.utf16.startIndex, to: range.lowerBound)
        let end = text.utf16.distance(from: text.utf16.startIndex, to: range.upperBound)
        switch match.details {
        case .moneyAmount(let money):
          out.append(["kind": "amount", "start": start, "end": end, "value": "\(money.amount)"])
        case .calendarEvent(let event):
          if let date = event.startDate {
            out.append(["kind": "date", "start": start, "end": end, "value": dayString(date, event.startTimeZone)])
          }
        default:
          break
        }
      }
      return out
    }
    #endif
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) else { return [] }
    let whole = NSRange(text.startIndex..., in: text)
    return detector.matches(in: text, range: whole).compactMap { match -> [String: Any]? in
      guard let date = match.date else { return nil }
      return [
        "kind": "date", "start": match.range.location, "end": match.range.location + match.range.length,
        "value": dayString(date, match.timeZone),
      ]
    }
  }

  private static func dayString(_ date: Date, _ zone: TimeZone?) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone ?? .current
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  /** 分类用的图：长边 1024 足够（模型自己还会再缩小），原图 200 MP 也不用整张解码。 */
  private static let classifyMaxSide = 1024

  /**
   * 不写中间文件，缩小的图只在内存里。cancelClassify 取消 Vision 的请求并让这次以 ERR_VISION_CANCELLED 结束；
   * 还没开始或已经结束的取消不起作用（JS 那边自己先结束 Promise）。
   */
  private func classifyImage(_ taskId: String, uri: URL, options: ClassifyOptions) throws -> [String: Any] {
    let request = VNClassifyImageRequest()
    classifyLock.lock()
    classifying[taskId] = request
    classifyLock.unlock()
    defer {
      classifyLock.lock()
      classifying[taskId] = nil
      cancelledClassify.remove(taskId)
      classifyLock.unlock()
    }
    let image = try loadThumbnail(uri, maxSide: Self.classifyMaxSide)
    if isClassifyCancelled(taskId) { throw classifyCancelled() }
    do {
      try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
      if isClassifyCancelled(taskId) { throw classifyCancelled() }
      throw VisionFailedException(error.localizedDescription)
    }
    if isClassifyCancelled(taskId) { throw classifyCancelled() }
    let labels = (request.results ?? [])
      .filter { Double($0.confidence) >= options.minConfidence }
      .sorted { $0.confidence > $1.confidence }
      .prefix(max(0, options.maxResults))
      .map { ["id": $0.identifier, "confidence": Double($0.confidence)] as [String: Any] }
    return ["labels": Array(labels), "width": image.width, "height": image.height]
  }

  private func cancelClassify(_ taskId: String) {
    classifyLock.lock()
    defer { classifyLock.unlock() }
    guard let request = classifying[taskId] else { return }
    cancelledClassify.insert(taskId)
    request.cancel()
  }

  private func isClassifyCancelled(_ taskId: String) -> Bool {
    classifyLock.lock()
    defer { classifyLock.unlock() }
    return cancelledClassify.contains(taskId)
  }

  /** 按 EXIF 摆正，并在解码时就缩到长边 maxSide（ImageIO 的缩略图，不先解码整张原图）。 */
  private func loadThumbnail(_ uri: URL, maxSide: Int) throws -> CGImage {
    let options = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxSide,
      kCGImageSourceShouldCacheImmediately: true,
    ] as CFDictionary
    guard let source = CGImageSourceCreateWithURL(uri as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
      throw UnreadableImageException()
    }
    return image
  }

  private func loadImage(_ uri: URL) throws -> CIImage {
    // 按 EXIF 方向摆正，和 App 里看到的方向一致。
    guard let image = CIImage(contentsOf: uri, options: [.applyOrientationProperty: true]) else {
      throw UnreadableImageException()
    }
    // 原点移到 (0, 0)。
    return image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
  }

  private func writeJpeg(_ image: CIImage, to url: URL, quality: Double) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    let options = [
      CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality
    ]
    do {
      try ciContext.writeJPEGRepresentation(of: image, to: url, colorSpace: colorSpace, options: options)
    } catch {
      throw VisionFailedException(error.localizedDescription)
    }
  }

  private func savePages(_ scan: VNDocumentCameraScan, directory: URL, maxSide: Int, quality: Double) throws -> [[String: Any]] {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var pages: [[String: Any]] = []
    for i in 0..<scan.pageCount {
      var image = CIImage(image: scan.imageOfPage(at: i)) ?? CIImage()
      let side = max(image.extent.width, image.extent.height)
      if side > CGFloat(maxSide) {
        let k = CGFloat(maxSide) / side
        image = image.transformed(by: CGAffineTransform(scaleX: k, y: k))
      }
      let w = image.extent.width.rounded(.down)
      let h = image.extent.height.rounded(.down)
      image = image
        .transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
        .cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
      let url = directory.appendingPathComponent("page-\(i + 1).jpg")
      try? FileManager.default.removeItem(at: url)
      try writeJpeg(image, to: url, quality: quality)
      pages.append(["uri": url.absoluteString, "width": Int(w), "height": Int(h), "size": Self.fileSize(url)])
    }
    return pages
  }

  private static func fileSize(_ url: URL) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
  }

  /** 「vi」能匹配系统支持的「vi-VT」；「zh-Hans」完全匹配。 */
  static func match(_ code: String, in supported: [String]) -> String? {
    if supported.contains(code) { return code }
    let prefix = code.split(separator: "-").first.map(String.init) ?? code
    return supported.first { $0 == prefix || $0.hasPrefix(prefix + "-") }
  }

  struct TextLine {
    let text: String
    let box: CGRect
    let confidence: Float
  }

  /**
   把识别出的一段段文字排成行：同一高度的几段（收据上的品名和价格）放在一行，用空格隔开；
   行距明显变大时空一行（分段）。Vision 的坐标原点在左下角，y 越大越靠上。
   */
  static func layout(_ lines: [TextLine]) -> String {
    let sorted = lines.sorted { $0.box.midY > $1.box.midY }
    var rows: [[TextLine]] = []
    for line in sorted {
      if let last = rows.last, let first = last.first {
        let overlap = min(first.box.maxY, line.box.maxY) - max(first.box.minY, line.box.minY)
        if overlap >= 0.5 * min(first.box.height, line.box.height) {
          rows[rows.count - 1].append(line)
          continue
        }
      }
      rows.append([line])
    }
    let heights = sorted.map { $0.box.height }.sorted()
    let typical = heights.isEmpty ? 0 : heights[heights.count / 2]
    var out: [String] = []
    var previous: CGRect?
    for row in rows {
      let text = row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: " ")
      let box = row.map(\.box).reduce(row[0].box) { $0.union($1) }
      if let prev = previous, prev.minY - box.maxY > 1.2 * typical {
        out.append("")
      }
      out.append(text)
      previous = box
    }
    return out.joined(separator: "\n")
  }
}

enum DocumentCameraResult {
  case finished(VNDocumentCameraScan)
  case cancelled
  case failed(Error)
}

final class DocumentCameraDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  private let onDone: (DocumentCameraResult) -> Void

  init(onDone: @escaping (DocumentCameraResult) -> Void) {
    self.onDone = onDone
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    onDone(.finished(scan))
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    onDone(.cancelled)
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    onDone(.failed(error))
  }
}
