import ExpoModulesCore
import WidgetKit

// 桌面小组件（D-321–D-323）的 App 这一边：画面写进 App Group，让 WidgetKit 重画；取走小组件点了的操作。
// iOS 不能替用户把小组件放到桌面，canPin 永远是 false（用户在桌面上「编辑 → 添加小组件」）。

private let appGroup = "group.app.morph.mobile"

public class MorphWidgetsModule: Module {
  private var dir: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("widgets", isDirectory: true)
  }

  public func definition() -> ModuleDefinition {
    Name("MorphWidgets")

    Events("onQueue")

    AsyncFunction("setSnapshot") { (json: String) in
      guard let dir = self.dir else { return }
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try Data(json.utf8).write(to: dir.appendingPathComponent("snapshot.json"), options: .atomic)
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("takeQueue") { () -> [String] in
      guard let queue = self.dir?.appendingPathComponent("queue", isDirectory: true),
        let names = try? FileManager.default.contentsOfDirectory(atPath: queue.path)
      else { return [] }
      var out: [String] = []
      // 只取写完的（.json）；写到一半的 .tmp 留到下次。
      for name in names.sorted() where name.hasSuffix(".json") {
        let url = queue.appendingPathComponent(name)
        if let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) {
          out.append(text)
        }
        try? FileManager.default.removeItem(at: url)
      }
      return out
    }

    Function("canPin") { false }

    AsyncFunction("pin") { (_: String, _: String) in false }
  }
}
