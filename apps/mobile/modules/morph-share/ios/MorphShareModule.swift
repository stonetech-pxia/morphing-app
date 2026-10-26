import ExpoModulesCore
import QuickLook
import UIKit
import UniformTypeIdentifiers

// 分享和存到文件夹的 iOS 实现（D-119、D-120）：
// - 分享：UIActivityViewController 一次带上全部文件（微信、WhatsApp、邮件、隔空投送、存到「文件」…）。
// - 存到文件夹：UIDocumentPickerViewController 让用户选一个文件夹（可以新建；iCloud 云盘、Google Drive、
//   Dropbox 等「文件」提供者由它们自己的 App 同步），再用 NSFileCoordinator 把文件复制进去，重名时加序号。
//   不用导出模式：模拟器实测文件夹里已有同名文件时，导出选择器报 OSStatus -8072、什么也不存。
// 记住上次选的文件夹（P-019、D-123）：存成书签（UserDefaults），下次直接存进去；文件夹没了就重新让用户选。
// 每个快捷操作记自己的文件夹（D-196）：「快捷操作 ID → 书签」另存一份；还没有时用最后选过的那个并记给它。
// - 预览（D-238）：QLPreviewController 显示收件页面上的一个文件（PDF、办公文档等），系统自带缩放和翻页。
// Morph 只把本机文件交给系统界面和用户选的文件夹，不联网。

final class PresenterMissingException: Exception, @unchecked Sendable {
  override var reason: String { "There is no screen to show the sheet on" }
}

final class SheetBusyException: Exception, @unchecked Sendable {
  override var reason: String { "Another share or save sheet is open" }
}

final class FolderNotWritableException: Exception, @unchecked Sendable {
  override var code: String { "ERR_FOLDER_NOT_WRITABLE" }
  override var reason: String { "Files can't be saved into this folder" }
}

final class ExportFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "Saving failed: \(param)" }
}

private let folderBookmarkKey = "morph.share.folderBookmark"
private let folderBookmarksKey = "morph.share.folderBookmarks"

public class MorphShareModule: Module {
  private var folderDelegate: FolderDelegate?
  private var previewSource: PreviewSource?
  private var busy = false

  public func definition() -> ModuleDefinition {
    Name("MorphShare")

    AsyncFunction("shareFiles") { (uris: [URL], _: [String], promise: Promise) in
      guard !self.busy else {
        promise.reject(SheetBusyException())
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(PresenterMissingException())
        return
      }
      let sheet = UIActivityViewController(activityItems: uris, applicationActivities: nil)
      sheet.completionWithItemsHandler = { _, _, _, _ in
        self.busy = false
        promise.resolve(nil)
      }
      Self.anchor(sheet, on: presenter)
      self.busy = true
      presenter.present(sheet, animated: true)
    }
    .runOnQueue(DispatchQueue.main)

    // 打开系统预览后就返回，不等用户关掉；mimeType 只给 Android 用。name 是原来的文件名：分享扩展存的副本
    // 是 UUID 文件名，标题要显示原来的。
    AsyncFunction("previewFile") { (uri: URL, _: String, name: String, promise: Promise) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(PresenterMissingException())
        return
      }
      let source = PreviewSource(uri, title: name)
      self.previewSource = source
      let preview = QLPreviewController()
      preview.dataSource = source
      presenter.present(preview, animated: true)
      promise.resolve(nil)
    }
    .runOnQueue(DispatchQueue.main)

    Function("rememberedFolder") { (key: String) -> String? in
      Self.rememberedFolder(for: key, adopt: false)?.lastPathComponent
    }

    Function("forgetFolders") { (keep: [String]) in
      let kept = Self.bookmarks().filter { keep.contains($0.key) }
      UserDefaults.standard.set(kept, forKey: folderBookmarksKey)
    }

    // mimeTypes 只给 Android 用。useRemembered：有记住的文件夹就直接存进去，不弹选择器。key：快捷操作 ID。
    AsyncFunction("exportFiles") { (uris: [URL], names: [String], _: [String], useRemembered: Bool, key: String, promise: Promise) in
      guard !self.busy else {
        promise.reject(SheetBusyException())
        return
      }
      if useRemembered, let folder = Self.rememberedFolder(for: key, adopt: true) {
        Self.copyInBackground(uris, names: names, into: folder, promise: promise)
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(PresenterMissingException())
        return
      }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
      // 完成后清掉 folderDelegate，打破 self ↔ delegate 的引用环。
      let delegate = FolderDelegate { folder in
        self.folderDelegate = nil
        self.busy = false
        guard let folder else {
          promise.resolve(nil)
          return
        }
        Self.remember(folder, for: key)
        Self.copyInBackground(uris, names: names, into: folder, promise: promise)
      }
      self.folderDelegate = delegate
      picker.delegate = delegate
      picker.presentationController?.delegate = delegate
      Self.anchor(picker, on: presenter)
      self.busy = true
      presenter.present(picker, animated: true)
    }
    .runOnQueue(DispatchQueue.main)
  }

  /** 复制放到后台，不卡界面。结果：存了几个、文件夹名。 */
  private static func copyInBackground(_ uris: [URL], names: [String], into folder: URL, promise: Promise) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let saved = try copy(uris, names: names, into: folder)
        promise.resolve(["saved": saved, "folder": folder.lastPathComponent])
      } catch let error as Exception {
        promise.reject(error)
      } catch {
        promise.reject(ExportFailedException(error.localizedDescription))
      }
    }
  }

  /** 每个快捷操作的书签：快捷操作 ID → 书签。 */
  private static func bookmarks() -> [String: Data] {
    UserDefaults.standard.dictionary(forKey: folderBookmarksKey) as? [String: Data] ?? [:]
  }

  private static func setBookmark(_ data: Data?, for key: String) {
    var all = bookmarks()
    all[key] = data
    UserDefaults.standard.set(all, forKey: folderBookmarksKey)
  }

  /**
   * 快捷操作 key 的文件夹：它自己的，没有时是最后选过的（adopt 为 true 时记给它，真正要存的时候才记）。
   * 都没有、书签失效或文件夹已经不在了时返回 nil（并忘掉失效的那个）。
   */
  private static func rememberedFolder(for key: String, adopt: Bool) -> URL? {
    if let data = bookmarks()[key] {
      if let url = resolve(data, save: { setBookmark($0, for: key) }) { return url }
      setBookmark(nil, for: key)
    }
    guard let data = UserDefaults.standard.data(forKey: folderBookmarkKey) else { return nil }
    guard let url = resolve(data, save: { UserDefaults.standard.set($0, forKey: folderBookmarkKey) }) else {
      UserDefaults.standard.removeObject(forKey: folderBookmarkKey)
      return nil
    }
    if adopt { setBookmark(UserDefaults.standard.data(forKey: folderBookmarkKey), for: key) }
    return url
  }

  /** 解析书签；书签失效或文件夹已经不在了时返回 nil。书签过期时用 save 存新的。 */
  private static func resolve(_ data: Data, save: (Data) -> Void) -> URL? {
    var stale = false
    guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
          url.startAccessingSecurityScopedResource() else {
      return nil
    }
    defer { url.stopAccessingSecurityScopedResource() }
    // 书签会跟着文件夹走：被删进「最近删除」（.Trash）时也能解析出来，这时当作文件夹已经不在了。
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue,
          !url.pathComponents.contains(".Trash") else {
      return nil
    }
    if stale, let fresh = try? url.bookmarkData() {
      save(fresh)
    }
    return url
  }

  /** 记给这个快捷操作，也记成最后选过的。 */
  private static func remember(_ folder: URL, for key: String) {
    guard folder.startAccessingSecurityScopedResource() else { return }
    defer { folder.stopAccessingSecurityScopedResource() }
    if let data = try? folder.bookmarkData() {
      UserDefaults.standard.set(data, forKey: folderBookmarkKey)
      setBookmark(data, for: key)
    }
  }

  private static func copy(_ sources: [URL], names: [String], into folder: URL) throws -> Int {
    guard folder.startAccessingSecurityScopedResource() else { throw FolderNotWritableException() }
    defer { folder.stopAccessingSecurityScopedResource() }
    let coordinator = NSFileCoordinator()
    for (i, source) in sources.enumerated() {
      let dest = freeURL(in: folder, name: i < names.count ? names[i] : source.lastPathComponent)
      var coordinatorError: NSError?
      var copyError: Error?
      // iCloud 云盘等「文件」提供者要求经过文件协调再写。
      coordinator.coordinate(writingItemAt: dest, options: .forReplacing, error: &coordinatorError) { url in
        do {
          try FileManager.default.copyItem(at: source, to: url)
        } catch {
          copyError = error
        }
      }
      if let error = coordinatorError ?? copyError {
        let code = (error as NSError).code
        if code == NSFileWriteNoPermissionError || code == NSFileWriteVolumeReadOnlyError {
          throw FolderNotWritableException()
        }
        throw ExportFailedException(error.localizedDescription)
      }
    }
    return sources.count
  }

  /** 不覆盖已有的文件：「报告.pdf」被占用时依次试「报告 2.pdf」「报告 3.pdf」（和「文件」App 一样）。 */
  private static func freeURL(in dir: URL, name: String) -> URL {
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var url = dir.appendingPathComponent(name)
    var n = 2
    while FileManager.default.fileExists(atPath: url.path) {
      let candidate = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
      url = dir.appendingPathComponent(candidate)
      n += 1
    }
    return url
  }

  /** iPad 上以弹出框显示，要给一个位置（屏幕中间）。 */
  private static func anchor(_ controller: UIViewController, on presenter: UIViewController) {
    guard let popover = controller.popoverPresentationController else { return }
    popover.sourceView = presenter.view
    popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
    popover.permittedArrowDirections = []
  }
}

final class FolderDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var onDone: ((URL?) -> Void)?

  init(onDone: @escaping (URL?) -> Void) {
    self.onDone = onDone
  }

  private func finish(_ folder: URL?) {
    onDone?(folder)
    onDone = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(nil)
  }

  // 向下滑动关掉选择器也算取消。
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(nil)
  }
}

final class PreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(_ url: URL, title: String) {
    previewItemURL = url
    previewItemTitle = title
  }
}

final class PreviewSource: NSObject, QLPreviewControllerDataSource {
  private let item: PreviewItem

  init(_ url: URL, title: String) {
    item = PreviewItem(url, title: title)
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    item
  }
}
