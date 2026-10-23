import CoreImage
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

  public func definition() -> ModuleDefinition {
    Name("MorphVision")

    Function("isDocumentCameraSupported") { () -> Bool in
      VNDocumentCameraViewController.isSupported
    }

    // 有没有相机：没有相机时（模拟器）expo-image-picker 会抛出原生异常让 App 崩溃，所以先问一下。
    Function("isCameraAvailable") { () -> Bool in
      UIImagePickerController.isSourceTypeAvailable(.camera)
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
      return [
        "text": Self.layout(lines),
        "lines": lines.count,
        "languages": request.recognitionLanguages,
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
