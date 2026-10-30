import Foundation

// App 写进 App Group 的小组件画面（D-321–D-323）。格式见 apps/mobile/src/widgets/types.ts，两边要一起改。
// 文字、数字都由 App 按当时的语言算好；这里只按时间选一份、按还没执行的点按选「点了以后」的那份。

let appGroup = "group.app.morph.mobile"

struct WidgetSnapshot: Decodable {
  let v: Int
  let strings: SnapshotStrings
  let colors: SnapshotColors
  let items: [SnapshotItem]
  let ops: [String: SnapshotOp]
  let states: [SnapshotState]
}

struct SnapshotStrings: Decodable {
  let stale: String
}

struct SnapshotPalette: Decodable {
  let primary: String
  let tint: String
  let onPrimary: String
}

struct SnapshotColors: Decodable {
  let light: SnapshotPalette
  let dark: SnapshotPalette
}

struct SnapshotItem: Decodable {
  let id: String
  let name: String
}

struct SnapshotOp: Decodable {
  let component: String
  let record: String?
  let hash: String
}

struct SnapshotState: Decodable {
  let from: Double
  let until: Double
  let views: [String: ItemView]
  /** after[操作][k-1]：同一个操作连点 k 次以后每个组件的画面。 */
  let after: [String: [[String: ItemView]]]
}

/** 一个组件的画面：kind 是 stat、button、list 或 message（不支持、已经删掉）。 */
struct ItemView: Decodable {
  let kind: String
  let title: String
  let value: String?
  let ratio: Double?
  let percent: String?
  let note: String?
  let icon: String?
  let op: String?
  let link: String?
  let display: String?
  let rows: [ItemRow]?
  let empty: String?
}

struct ItemRow: Decodable {
  let id: String
  let title: String
  let trailing: String?
  let op: String?
  let link: String?
  let ratio: Double?
  let full: Bool?
}

/** 点了、App 还没执行的操作（queue/ 里一个文件一个）。 */
struct QueuedOp: Codable {
  let op: String
  let component: String
  let record: String?
  let hash: String
  let at: Double
}

enum SharedFiles {
  static var dir: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("widgets", isDirectory: true)
  }

  static func snapshot() -> WidgetSnapshot? {
    guard let url = dir?.appendingPathComponent("snapshot.json"),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }

  static func queued() -> [QueuedOp] {
    guard let queue = dir?.appendingPathComponent("queue", isDirectory: true),
      let names = try? FileManager.default.contentsOfDirectory(atPath: queue.path)
    else { return [] }
    return names.filter { $0.hasSuffix(".json") }.compactMap { name in
      guard let data = try? Data(contentsOf: queue.appendingPathComponent(name)) else { return nil }
      return try? JSONDecoder().decode(QueuedOp.self, from: data)
    }.sorted { $0.at < $1.at }
  }

  /** 每次点按一个文件，写完再改名，App 读不到写了一半的。 */
  static func enqueue(_ op: QueuedOp) throws {
    guard let queue = dir?.appendingPathComponent("queue", isDirectory: true) else { return }
    try FileManager.default.createDirectory(at: queue, withIntermediateDirectories: true)
    let name = "\(Int64(op.at))-\(UUID().uuidString)"
    let temp = queue.appendingPathComponent("\(name).tmp")
    try JSONEncoder().encode(op).write(to: temp, options: .atomic)
    try FileManager.default.moveItem(at: temp, to: queue.appendingPathComponent("\(name).json"))
  }
}

/** 这个组件现在该画哪一份；stale：点过的操作算不出来（混着点了几种、点得太多、跨了天），显示提示。 */
func resolveView(_ snap: WidgetSnapshot, item: String, at date: Date, queued: [QueuedOp]) -> (
  ItemView?, Bool
) {
  let ms = date.timeIntervalSince1970 * 1000
  guard let state = snap.states.first(where: { ms < $0.until }) ?? snap.states.last else {
    return (nil, false)
  }
  let pastEnd = ms >= (snap.states.last?.until ?? 0)
  if queued.isEmpty { return (state.views[item], pastEnd) }
  let keys = Set(queued.map(\.op))
  if keys.count == 1, let key = keys.first, let list = state.after[key], queued.count <= list.count,
    queued.allSatisfy({ $0.at >= state.from })
  {
    return (list[queued.count - 1][item] ?? state.views[item], pastEnd)
  }
  return (state.views[item], true)
}
