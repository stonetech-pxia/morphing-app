import AppIntents
import SwiftUI
import WidgetKit

// 小组件的画法：统计（值、目标进度环）、按钮（点一下执行）、记录列表（列表几行，或 tiles 的几个圆）。
// 颜色用 App 风格的主色（深色模式用深色那份），底色用系统的。

extension Color {
  init(hex: String) {
    var v: UInt64 = 0
    Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&v)
    self.init(
      red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255)
  }
}

struct Ring: View {
  let ratio: Double
  let color: Color
  let width: CGFloat
  var body: some View {
    ZStack {
      Circle().stroke(color.opacity(0.2), lineWidth: width)
      Circle().trim(from: 0, to: min(max(ratio, 0), 1))
        .stroke(color, style: StrokeStyle(lineWidth: width, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
  }
}

struct MorphWidgetView: View {
  let entry: MorphEntry
  @Environment(\.widgetFamily) var family
  @Environment(\.colorScheme) var scheme

  private var palette: SnapshotPalette? {
    entry.palette.map { scheme == .dark ? $0.dark : $0.light }
  }
  private var primary: Color { palette.map { Color(hex: $0.primary) } ?? .accentColor }
  private var tint: Color { palette.map { Color(hex: $0.tint) } ?? .accentColor.opacity(0.2) }
  private var onPrimary: Color { palette.map { Color(hex: $0.onPrimary) } ?? .white }
  private var rowLimit: Int { family == .systemLarge ? 7 : 3 }
  private var tileLimit: Int {
    switch family {
    case .systemSmall: return 4
    case .systemMedium: return 4
    default: return 8
    }
  }

  var body: some View {
    if entry.empty || entry.view == nil {
      VStack(alignment: .leading, spacing: 6) {
        Text("Morph").font(.headline)
        Text("In Morph, long-press a stat, button or list and choose Add to Home Screen.")
          .font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else if let view = entry.view {
      VStack(alignment: .leading, spacing: 6) {
        content(view)
        if entry.stale {
          Text(entry.staleText).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .widgetURL(view.link.flatMap(URL.init(string:)))
    }
  }

  @ViewBuilder
  private func content(_ view: ItemView) -> some View {
    switch view.kind {
    case "stat": stat(view)
    case "button": button(view)
    case "list": list(view)
    default:
      Text(view.title).font(.headline).lineLimit(2)
      Text(view.note ?? "").font(.caption).foregroundStyle(.secondary)
    }
  }

  private func heading(_ text: String) -> some View {
    Text(text.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(primary).lineLimit(1)
  }

  @ViewBuilder
  private func stat(_ view: ItemView) -> some View {
    heading(view.title)
    if let rows = view.rows {
      // 按单选分组的统计：每个选项一行。
      ForEach(rows.prefix(rowLimit), id: \.id) { row in
        HStack {
          Text(row.title).font(.subheadline).lineLimit(1)
          Spacer()
          Text(row.trailing ?? "").font(.subheadline.weight(.semibold)).lineLimit(1)
        }
      }
    } else {
      Spacer(minLength: 0)
      HStack(alignment: .center, spacing: 8) {
        Text(view.value ?? "—").font(.system(size: 26, weight: .bold, design: .rounded))
          .minimumScaleFactor(0.5).lineLimit(2)
        Spacer(minLength: 0)
        if let ratio = view.ratio {
          ZStack {
            Ring(ratio: ratio, color: primary, width: 5)
            Text(view.percent ?? "").font(.caption2.weight(.bold)).minimumScaleFactor(0.6)
          }
          .frame(width: 46, height: 46)
        }
      }
      if let note = view.note {
        Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(2)
      }
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private func button(_ view: ItemView) -> some View {
    let label = HStack(spacing: 6) {
      if let icon = view.icon { Image(systemName: icon) }
      Text(view.title).lineLimit(2).minimumScaleFactor(0.7)
    }
    .font(.headline)
    .foregroundStyle(onPrimary)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(primary, in: RoundedRectangle(cornerRadius: 16))

    if let op = view.op {
      Button(intent: RunWidgetOp(op: op)) { label }.buttonStyle(.plain)
    } else if let link = view.link.flatMap(URL.init(string:)) {
      Link(destination: link) { label }
    } else {
      label
    }
    if let note = view.note {
      Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
  }

  @ViewBuilder
  private func list(_ view: ItemView) -> some View {
    heading(view.title)
    let rows = view.rows ?? []
    if rows.isEmpty {
      Text(view.empty ?? "").font(.caption).foregroundStyle(.secondary)
    } else if view.display == "tiles" {
      let shown = Array(rows.prefix(tileLimit))
      let columns = family == .systemSmall ? 2 : 4
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: columns), spacing: 6
      ) {
        ForEach(shown, id: \.id) { row in tile(row) }
      }
    } else {
      ForEach(rows.prefix(rowLimit), id: \.id) { row in
        let line = HStack {
          Text(row.title).font(.subheadline).lineLimit(1)
          Spacer()
          Text(row.trailing ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
        if let link = row.link.flatMap(URL.init(string:)) {
          Link(destination: link) { line }
        } else {
          line
        }
      }
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private func tile(_ row: ItemRow) -> some View {
    let size: CGFloat = family == .systemSmall ? 40 : 46
    let full = row.full ?? false
    let circle = VStack(spacing: 2) {
      ZStack {
        if let ratio = row.ratio { Ring(ratio: ratio, color: primary, width: 3) }
        Circle().fill(full ? primary : tint).padding(row.ratio == nil ? 0 : 5)
        if full {
          Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(onPrimary)
        }
      }
      .frame(width: size, height: size)
      Text(row.title).font(.caption2).lineLimit(1)
    }
    if let op = row.op {
      Button(intent: RunWidgetOp(op: op)) { circle }.buttonStyle(.plain)
    } else if let link = row.link.flatMap(URL.init(string:)) {
      Link(destination: link) { circle }
    } else {
      circle
    }
  }
}
