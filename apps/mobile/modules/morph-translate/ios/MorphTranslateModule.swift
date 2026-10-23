import ExpoModulesCore
import NaturalLanguage
import SwiftUI
import Translation
import UIKit

// 本机翻译（D-170）：只用 iOS 自带的 Translation 框架（iOS 18 起）和 NaturalLanguage（识别语言），
// 全部在本机处理，文字不写日志。
// - iOS 26 起，两种语言都已下载时直接创建 TranslationSession(installedSource:target:)，不需要界面；
// - 其他情况（要下载语言、iOS 18–25）只能通过 SwiftUI 的 .translationTask 拿到会话：在当前页面上挂一个
//   1×1、透明、不接收触摸的 SwiftUI 视图，系统需要下载时由它弹出下载确认，翻完就移除。

final class TranslateCancelledException: Exception, @unchecked Sendable {
  override var code: String { "ERR_TRANSLATE_CANCELLED" }
  override var reason: String { "The user cancelled the language download" }
}

final class TranslateUnsupportedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_TRANSLATE_UNSUPPORTED" }
  override var reason: String { "Translation is not available for \(param)" }
}

final class TranslateFailedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_TRANSLATE_FAILED" }
  override var reason: String { "Translation failed: \(param)" }
}

public class MorphTranslateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MorphTranslate")

    Function("isSupported") { () -> Bool in
      if #available(iOS 18.0, *) { return true }
      return false
    }

    // 每段文字的语言（BCP 47，例如 en、zh-Hans、ja）；太短、拿不准时返回 nil，由 App 按全文最多的语言处理。
    AsyncFunction("detectLanguages") { (texts: [String]) -> [String?] in
      texts.map { text in
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        guard let best = recognizer.languageHypotheses(withMaximum: 1).first,
          best.key != .undetermined, best.value >= 0.5
        else { return nil }
        return best.key.rawValue
      }
    }

    // 系统能翻译的语言（排查用；Android 没有对应的列表）。
    AsyncFunction("supportedLanguages") { () async -> [String] in
      guard #available(iOS 18.0, *) else { return [] }
      return await LanguageAvailability().supportedLanguages.map { $0.maximalIdentifier }
    }

    AsyncFunction("status") { (from: String, to: String) async throws -> [String: Any] in
      guard #available(iOS 18.0, *) else { throw TranslateUnsupportedException("iOS < 18") }
      guard let (source, target) = await Self.resolve(from, to) else {
        return ["status": "unsupported"]
      }
      switch await LanguageAvailability().status(from: source, to: target) {
      case .installed: return ["status": "installed"]
      case .supported: return ["status": "download"]
      default: return ["status": "unsupported"]
      }
    }

    AsyncFunction("translate") { (texts: [String], from: String, to: String) async throws -> [String] in
      guard #available(iOS 18.0, *) else { throw TranslateUnsupportedException("iOS < 18") }
      guard let (source, target) = await Self.resolve(from, to) else {
        throw TranslateUnsupportedException("\(from) → \(to)")
      }
      if texts.isEmpty { return [] }
      let requests = texts.enumerated().map {
        TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
      }
      do {
        let responses: [TranslationSession.Response]
        if #available(iOS 26.0, *),
          await LanguageAvailability().status(from: source, to: target) == .installed
        {
          let session = TranslationSession(installedSource: source, target: target)
          responses = try await session.translations(from: requests)
        } else {
          responses = try await self.translateWithHost(requests, source: source, target: target)
        }
        var out = texts
        for response in responses {
          if let id = response.clientIdentifier, let i = Int(id), i < out.count {
            out[i] = response.targetText
          }
        }
        return out
      } catch let error as Exception {
        throw error
      } catch {
        // 下载被取消（或没下完）时语言仍然没装好。
        if await LanguageAvailability().status(from: source, to: target) != .installed {
          throw TranslateCancelledException()
        }
        if TranslationError.unsupportedLanguagePairing ~= error
          || TranslationError.unsupportedSourceLanguage ~= error
          || TranslationError.unsupportedTargetLanguage ~= error
        {
          throw TranslateUnsupportedException("\(from) → \(to)")
        }
        throw TranslateFailedException(error.localizedDescription)
      }
    }
  }

  /**
   系统支持的语言里找和 App 的代码对应的：主语言和文字（简体 / 繁体）相同；同一种语言有几个地区时
   优先这种语言的默认地区（美国英语、巴西葡萄牙语）。列表顺序不可靠（模拟器上英语第一个是 en-IN）。
   */
  @available(iOS 18.0, *)
  private static func resolve(_ from: String, _ to: String) async -> (Locale.Language, Locale.Language)? {
    let supported = await LanguageAvailability().supportedLanguages
    func find(_ code: String) -> Locale.Language? {
      // 先找默认地区（en → en-Latn-US，pt → pt-Latn-BR，zh-Hans → zh-Hans-CN），再找同语言同文字的。
      let maximal = Locale.Language(identifier: code).maximalIdentifier
      let wanted = Locale.Language(identifier: maximal)
      if let exact = supported.first(where: { $0.maximalIdentifier == maximal }) { return exact }
      return supported.first { lang in
        let full = Locale.Language(identifier: lang.maximalIdentifier)
        return full.languageCode == wanted.languageCode && full.script == wanted.script
      }
    }
    // 列表是空的（拿不到）时直接交给系统判断。
    if supported.isEmpty { return (Locale.Language(identifier: from), Locale.Language(identifier: to)) }
    guard let source = find(from), let target = find(to) else { return nil }
    return (source, target)
  }

  /** 挂一个看不见的 SwiftUI 视图拿到会话（需要下载时系统从这里弹窗），翻完移除。 */
  @available(iOS 18.0, *)
  @MainActor
  private func translateWithHost(
    _ requests: [TranslationSession.Request],
    source: Locale.Language,
    target: Locale.Language
  ) async throws -> [TranslationSession.Response] {
    guard let parent = appContext?.utilities?.currentViewController() else {
      throw TranslateFailedException("no view controller")
    }
    return try await withCheckedThrowingContinuation { continuation in
      let once = Once(continuation)
      var host: UIHostingController<TranslationHost>?
      let remove = {
        host?.willMove(toParent: nil)
        host?.view.removeFromSuperview()
        host?.removeFromParent()
        host = nil
      }
      let view = TranslationHost(
        configuration: TranslationSession.Configuration(source: source, target: target),
        work: { session in
          do {
            once.resume(.success(try await session.translations(from: requests)))
          } catch {
            once.resume(.failure(error))
          }
          await MainActor.run { remove() }
        },
        gone: { once.resume(.failure(CancellationError())) })
      let controller = UIHostingController(rootView: view)
      controller.view.backgroundColor = .clear
      controller.view.isUserInteractionEnabled = false
      controller.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
      parent.addChild(controller)
      parent.view.addSubview(controller.view)
      controller.didMove(toParent: parent)
      host = controller
    }
  }
}

/** 只恢复一次（视图消失和翻译完成可能都会来）。 */
private final class Once<T>: @unchecked Sendable {
  private var continuation: CheckedContinuation<T, Error>?
  private let lock = NSLock()
  init(_ continuation: CheckedContinuation<T, Error>) { self.continuation = continuation }
  func resume(_ result: Result<T, Error>) {
    lock.lock()
    let c = continuation
    continuation = nil
    lock.unlock()
    c?.resume(with: result)
  }
}

@available(iOS 18.0, *)
private struct TranslationHost: View {
  let configuration: TranslationSession.Configuration
  let work: (TranslationSession) async -> Void
  let gone: () -> Void

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .translationTask(configuration) { session in await work(session) }
      .onDisappear(perform: gone)
  }
}
