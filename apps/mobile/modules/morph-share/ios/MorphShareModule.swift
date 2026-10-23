import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

// 分享和存到文件夹的 iOS 实现（D-100、D-101）：
// - 分享：UIActivityViewController 一次带上全部文件（微信、WhatsApp、邮件、隔空投送、存到「文件」…）。
// - 存到文件夹：UIDocumentPickerViewController 让用户选一个文件夹（可以新建；iCloud 云盘、Google Drive、
//   Dropbox 等「文件」提供者由它们自己的 App 同步），再用 NSFileCoordinator 把文件复制进去，重名时加序号。
//   不用导出模式：模拟器实测文件夹里已有同名文件时，导出选择器报 OSStatus -8072、什么也不存。
// Morph 只把本机文件交给系统界面，不联网；文件夹的访问权限用完就放掉，不保存用户选的位置。

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

public class MorphShareModule: Module {
  private var folderDelegate: FolderDelegate?
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

    // mimeTypes 只给 Android 用。
    AsyncFunction("exportFiles") { (uris: [URL], names: [String], _: [String], promise: Promise) in
      guard !self.busy else {
        promise.reject(SheetBusyException())
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
        // 复制放到后台，不卡界面。
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            promise.resolve(try Self.copy(uris, names: names, into: folder))
          } catch let error as Exception {
            promise.reject(error)
          } catch {
            promise.reject(ExportFailedException(error.localizedDescription))
          }
        }
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
