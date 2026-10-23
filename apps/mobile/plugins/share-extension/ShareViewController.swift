// Morph 的 iOS 分享扩展（D-114、D-118）：别的 App 分享文件给 Morph 时运行。
// 按分享的顺序逐个把文件复制到 App Group 共享目录，全部复制完再用 morph:// 深链唤起主 App。
// 数据格式和 expo-share-intent 主 App 模块读取的一致（UserDefaults 里 morphShareKey 下的 JSON）。
// 只收文件（照片、视频、PDF、任意文件），不收文字和网址；不访问网络，不读相册以外的任何东西。
// 由 plugins/with-share-extension.js 在 prebuild 时替换 expo-share-intent 生成的同名文件。

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
  /** 和 expo-share-intent 约定的键：`<scheme>ShareKey`。 */
  private let scheme = "morph"
  private var sharedKey: String { "\(scheme)ShareKey" }

  /** 和 expo-share-intent 的 SharedMediaFile 相同的字段（type：0 图片、1 视频、2 文件）。 */
  private struct SharedFile: Codable {
    var path: String
    var thumbnail: String?
    var fileName: String
    var fileSize: Int?
    var width: Int?
    var height: Int?
    var duration: Double?
    var mimeType: String
    var type: Int
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // 不显示界面：直接收文件、跳回主 App（收件页面在主 App 里）。
    view.backgroundColor = .clear
    view.isOpaque = false
    Task { await receive() }
  }

  private func receive() async {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else {
      finish()
      return
    }
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    var files: [SharedFile] = []
    // 一个一个来：保持分享时的顺序，而且全部复制完才跳转。
    for provider in providers {
      if let file = await copy(provider, into: container) { files.append(file) }
    }
    guard !files.isEmpty, let data = try? JSONEncoder().encode(files) else {
      finish()
      return
    }
    let defaults = UserDefaults(suiteName: group)
    defaults?.set(data, forKey: sharedKey)
    defaults?.synchronize()
    let kind = files.allSatisfy { $0.type <= 1 } ? "media" : "file"
    openHostApp("\(scheme)://dataUrl=\(sharedKey)?nonce=\(UUID().uuidString)#\(kind)")
    finish()
  }

  /** 选一个文件类型：优先原始文件（照片的 HEIC / JPEG、视频的 MOV / MP4、PDF…），其次任意数据。 */
  private func fileType(of provider: NSItemProvider) -> String? {
    let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
    let usable = types.filter { $0.conforms(to: .data) && !$0.conforms(to: .text) }
    return (usable.first { $0.conforms(to: .image) }
      ?? usable.first { $0.conforms(to: .audiovisualContent) }
      ?? usable.first)?.identifier
  }

  private func copy(_ provider: NSItemProvider, into dir: URL) async -> SharedFile? {
    if let typeId = fileType(of: provider),
      let file = await copyFileRepresentation(provider, typeId: typeId, into: dir)
    {
      return file
    }
    // 只在内存里的图片（例如截图编辑器直接分享）：存成 PNG。
    if provider.canLoadObject(ofClass: UIImage.self),
      let image = await loadImage(provider), let png = image.pngData()
    {
      let dest = dir.appendingPathComponent("\(UUID().uuidString).png")
      guard (try? png.write(to: dest)) != nil else { return nil }
      return describe(dest, name: "\(provider.suggestedName ?? "Image").png")
    }
    return nil
  }

  private func copyFileRepresentation(_ provider: NSItemProvider, typeId: String, into dir: URL)
    async -> SharedFile?
  {
    await withCheckedContinuation { continuation in
      _ = provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, _ in
        // 系统给的临时文件只在这个回调里有效，必须在这里复制。
        guard let url else {
          continuation.resume(returning: nil)
          return
        }
        var ext = url.pathExtension
        if ext.isEmpty { ext = UTType(typeId)?.preferredFilenameExtension ?? "bin" }
        let dest = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
        do {
          try FileManager.default.copyItem(at: url, to: dest)
        } catch {
          continuation.resume(returning: nil)
          return
        }
        var name = provider.suggestedName ?? url.deletingPathExtension().lastPathComponent
        if !name.lowercased().hasSuffix(".\(ext.lowercased())") { name += ".\(ext)" }
        continuation.resume(returning: self.describe(dest, name: name))
      }
    }
  }

  private func loadImage(_ provider: NSItemProvider) async -> UIImage? {
    await withCheckedContinuation { continuation in
      _ = provider.loadObject(ofClass: UIImage.self) { image, _ in
        continuation.resume(returning: image as? UIImage)
      }
    }
  }

  nonisolated private func describe(_ url: URL, name: String) -> SharedFile {
    let type = UTType(filenameExtension: url.pathExtension)
    let isImage = type?.conforms(to: .image) ?? false
    var width: Int?
    var height: Int?
    if isImage, let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    {
      width = props[kCGImagePropertyPixelWidth] as? Int
      height = props[kCGImagePropertyPixelHeight] as? Int
      // 方向 5–8 是转了 90°：宽高对调（和摆正后的尺寸一致）。
      if let orientation = props[kCGImagePropertyOrientation] as? Int, orientation > 4 {
        swap(&width, &height)
      }
    }
    let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
    return SharedFile(
      path: url.absoluteString, thumbnail: nil, fileName: name, fileSize: size,
      width: width, height: height, duration: nil,
      mimeType: type?.preferredMIMEType ?? "application/octet-stream",
      type: isImage ? 0 : (type?.conforms(to: .movie) ?? false) ? 1 : 2)
  }

  /** 扩展不能直接打开 URL，沿响应链找到 UIApplication 打开主 App。 */
  private func openHostApp(_ link: String) {
    guard let url = URL(string: link) else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url, options: [:], completionHandler: nil)
        return
      }
      responder = current.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
