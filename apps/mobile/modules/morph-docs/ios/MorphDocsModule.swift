import ExpoModulesCore
import UIKit
import WebKit

// 办公文档转 PDF 的 iOS 实现（D-186）：WKWebView 打开文档（系统自己把 Word、Excel、PowerPoint、RTF 排成网页），
// 等排版稳定后用 UIPrintPageRenderer 按纸张分页，画进 PDF。全部在本机，网页视图不联网（只读这一个文件）。

final class DocUnreadableException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_DOC_UNREADABLE" }
  override var reason: String { "This document can't be opened: \(param)" }
}

final class DocFailedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_DOC_FAILED" }
  override var reason: String { "Converting failed: \(param)" }
}

public class MorphDocsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MorphDocs")

    AsyncFunction("toPdf") { (uri: URL, output: URL, page: [String: Double], promise: Promise) in
      Task { @MainActor in
        do {
          let renderer = DocRenderer()
          promise.resolve(try await renderer.render(uri, to: output, page: page))
        } catch let error as Exception {
          promise.reject(error)
        } catch {
          promise.reject(DocFailedException(error.localizedDescription))
        }
      }
    }
  }
}

@MainActor
private final class DocRenderer: NSObject, WKNavigationDelegate {
  private var webView: WKWebView?
  private var loaded: CheckedContinuation<Void, Error>?

  func render(_ uri: URL, to output: URL, page: [String: Double]) async throws -> [String: Any] {
    let width = page["width"] ?? 595.28
    let height = page["height"] ?? 841.89
    let margin = page["margin"] ?? 36
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    let view = WKWebView(frame: CGRect(x: 0, y: 0, width: width - margin * 2, height: height), configuration: config)
    view.navigationDelegate = self
    // 不放进窗口时有的文档不排版：放在屏幕外、透明。
    view.alpha = 0
    let window = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
    window?.insertSubview(view, at: 0)
    view.frame.origin = CGPoint(x: -10000, y: 0)
    webView = view
    defer {
      view.removeFromSuperview()
      webView = nil
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      loaded = continuation
      view.loadFileURL(uri, allowingReadAccessTo: uri)
    }
    try await waitForLayout(view)
    // Word 文档被排进一个「一页纸」的外框（固定宽度、页边距、至少一页高）：去掉外框的尺寸和边距，
    // 分页和边距交给下面的打印排版，否则短文档也会多出一张空白页。
    _ = try? await view.evaluateJavaScript(
      """
      (() => {
        const page = document.body.firstElementChild;
        if (!page || page.tagName !== 'DIV') return;
        Object.assign(page.style, { minHeight: '0', height: 'auto', width: 'auto', maxWidth: 'none', padding: '0', margin: '0' });
      })()
      """)
    let paper = CGRect(x: 0, y: 0, width: width, height: height)
    let renderer = UIPrintPageRenderer()
    renderer.addPrintFormatter(view.viewPrintFormatter(), startingAtPageAt: 0)
    renderer.setValue(paper, forKey: "paperRect")
    renderer.setValue(paper.insetBy(dx: margin, dy: margin), forKey: "printableRect")
    renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
    let pages = renderer.numberOfPages
    if pages == 0 { throw DocUnreadableException("no pages") }
    let data = NSMutableData()
    UIGraphicsBeginPDFContextToData(data, paper, nil)
    for index in 0..<pages {
      UIGraphicsBeginPDFPage()
      renderer.drawPage(at: index, in: UIGraphicsGetPDFContextBounds())
    }
    UIGraphicsEndPDFContext()
    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard data.write(to: output, atomically: true) else { throw DocFailedException("write") }
    return ["uri": output.absoluteString, "size": data.length, "pageCount": pages]
  }

  /**
   * 文档排成网页后高度还会变一会儿：等到连续两次一样（最多 5 秒）。读不到高度时（文档预览不一定执行脚本）
   * 等满 1 秒就继续，有没有内容由分页的结果判断。
   */
  private func waitForLayout(_ view: WKWebView) async throws {
    var last = -1.0
    for attempt in 0..<25 {
      try await Task.sleep(nanoseconds: 200_000_000)
      guard let height = try? await view.evaluateJavaScript("document.documentElement.scrollHeight") as? Double
      else {
        if attempt >= 4 { return }
        continue
      }
      if height > 0 && height == last { return }
      last = height
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded?.resume()
    loaded = nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loaded?.resume(throwing: DocUnreadableException(error.localizedDescription))
    loaded = nil
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    loaded?.resume(throwing: DocUnreadableException(error.localizedDescription))
    loaded = nil
  }

  /** 只允许打开这个文件本身，文档里的链接、外部图片一律不加载。 */
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
  }
}
