import AppIntents
import SwiftUI
import WidgetKit

// Morph 的桌面小组件（D-321）。用户在 App 里长按组件选「放到桌面」，组件就出现在「编辑小组件」的列表里；
// 没选时显示最近放的那个。点按钮或圆块：RunWidgetOp 把操作写进 App Group 的 queue/，不打开 App（D-323）；
// 系统随后重画，画面换成 App 预先算好的「点了以后」那份。

// MARK: - 选哪个组件

struct WidgetItemEntity: AppEntity {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Component"
  static var defaultQuery = WidgetItemQuery()
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct WidgetItemQuery: EntityQuery {
  private func all() -> [WidgetItemEntity] {
    (SharedFiles.snapshot()?.items ?? []).map { WidgetItemEntity(id: $0.id, name: $0.name) }
  }
  func entities(for identifiers: [String]) async throws -> [WidgetItemEntity] {
    all().filter { identifiers.contains($0.id) }
  }
  func suggestedEntities() async throws -> [WidgetItemEntity] { all().reversed() }
  func defaultResult() async -> WidgetItemEntity? { all().last }
}

struct PickWidgetItem: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose a component"
  static var description = IntentDescription("Components you added to the Home Screen in Morph.")

  @Parameter(title: "Component")
  var item: WidgetItemEntity?
}

// MARK: - 点一下

struct RunWidgetOp: AppIntent {
  static var title: LocalizedStringResource = "Record in Morph"
  static var isDiscoverable = false

  @Parameter(title: "Action")
  var op: String

  init() {}
  init(op: String) { self.op = op }

  func perform() async throws -> some IntentResult {
    // 只记下点了什么；值在 App 打开时按点的时间算（D-323）。
    if let def = SharedFiles.snapshot()?.ops[op] {
      try SharedFiles.enqueue(
        QueuedOp(
          op: op, component: def.component, record: def.record, hash: def.hash,
          at: Date().timeIntervalSince1970 * 1000))
    }
    return .result()
  }
}

// MARK: - 时间线

struct MorphEntry: TimelineEntry {
  let date: Date
  let view: ItemView?
  let stale: Bool
  let staleText: String
  let palette: SnapshotColors?
  /** 没放过任何组件（或还没打开过 App）。 */
  let empty: Bool
}

struct MorphProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> MorphEntry {
    MorphEntry(date: Date(), view: nil, stale: false, staleText: "", palette: nil, empty: true)
  }

  func snapshot(for configuration: PickWidgetItem, in context: Context) async -> MorphEntry {
    entry(for: configuration, at: Date())
  }

  func timeline(for configuration: PickWidgetItem, in context: Context) async -> Timeline<
    MorphEntry
  > {
    let now = Date()
    var entries = [entry(for: configuration, at: now)]
    // App 预先算好了明天的那份（跨天，D-322）：到点换上，不用等 App 打开。
    for state in SharedFiles.snapshot()?.states ?? [] where state.from > now.timeIntervalSince1970 * 1000 {
      entries.append(entry(for: configuration, at: Date(timeIntervalSince1970: state.from / 1000)))
    }
    return Timeline(entries: entries, policy: .atEnd)
  }

  private func entry(for configuration: PickWidgetItem, at date: Date) -> MorphEntry {
    guard let snap = SharedFiles.snapshot(), let fallback = snap.items.last else {
      return MorphEntry(date: date, view: nil, stale: false, staleText: "", palette: nil, empty: true)
    }
    let id = configuration.item?.id ?? fallback.id
    let (view, stale) = resolveView(snap, item: id, at: date, queued: SharedFiles.queued())
    return MorphEntry(
      date: date, view: view, stale: stale, staleText: snap.strings.stale, palette: snap.colors,
      empty: view == nil)
  }
}

// MARK: - 小组件

struct MorphWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "MorphWidget", intent: PickWidgetItem.self, provider: MorphProvider()) {
      entry in
      MorphWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Morph")
    .description("A stat, button or list from your Morph pages.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct MorphWidgetBundle: WidgetBundle {
  var body: some Widget { MorphWidget() }
}
