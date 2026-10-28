import ExpoModulesCore
import UIKit

// 长按 Morph 图标的菜单（D-271）：iOS Home Screen Quick Actions。菜单项的 type 是快捷操作的 ID。
// 点了菜单项：SDK 58 的 ExpoAppSceneDelegate 把冷启动（connectionOptions.shortcutItem）和 App 开着时的点按
// 都转成 application(_:performActionFor:)，由下面的订阅者收到。JS 还没准备好（冷启动）时先记着，
// 启动完由 takeLaunched 取走；JS 在听时直接发 onOpen。

let morphShortcutOpened = Notification.Name("MorphShortcutsOpened")

/** 订阅者（主线程）和 JS 线程都会读写，用锁保护。 */
final class ShortcutLaunch {
  static let shared = ShortcutLaunch()
  private let lock = NSLock()
  private var pending: String?
  private var listening = false

  func setListening(_ on: Bool) {
    lock.lock()
    listening = on
    lock.unlock()
  }

  /** JS 在听就返回 true（由调用方发通知）；不在听就记下来，等 takeLaunched 取走。 */
  func deliver(_ id: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if listening { return true }
    pending = id
    return false
  }

  func take() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let id = pending
    pending = nil
    return id
  }
}

struct ShortcutItemRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var symbol: String? = nil
}

public class MorphShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MorphShortcuts")

    Events("onOpen")

    AsyncFunction("setItems") { (items: [ShortcutItemRecord], _: String) in
      UIApplication.shared.shortcutItems = items.map { item in
        UIApplicationShortcutItem(
          type: item.id,
          localizedTitle: item.title,
          localizedSubtitle: nil,
          icon: item.symbol.map { UIApplicationShortcutIcon(systemImageName: $0) },
          userInfo: nil
        )
      }
    }.runOnQueue(.main)

    // iOS 没有让 App 在桌面上放图标的接口。
    Function("canPin") { false }

    AsyncFunction("pin") { (_: ShortcutItemRecord) in false }

    Function("takeLaunched") { () -> String? in
      ShortcutLaunch.shared.take()
    }

    OnStartObserving {
      ShortcutLaunch.shared.setListening(true)
      NotificationCenter.default.addObserver(
        self, selector: #selector(self.opened(_:)), name: morphShortcutOpened, object: nil)
    }

    OnStopObserving {
      ShortcutLaunch.shared.setListening(false)
      NotificationCenter.default.removeObserver(self, name: morphShortcutOpened, object: nil)
    }
  }

  @objc
  func opened(_ notification: Notification) {
    guard let id = notification.object as? String else { return }
    sendEvent("onOpen", ["id": id])
  }
}

public class MorphShortcutsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let id = shortcutItem.type
    if ShortcutLaunch.shared.deliver(id) {
      NotificationCenter.default.post(name: morphShortcutOpened, object: id)
    }
    completionHandler(true)
  }
}
