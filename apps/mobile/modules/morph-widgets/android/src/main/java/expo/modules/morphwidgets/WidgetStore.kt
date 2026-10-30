package expo.modules.morphwidgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

// 桌面小组件的两份文件（D-321–D-323），在 App 自己的 files/widgets 里：snapshot.json 是 App 算好的画面
// （格式见 src/widgets/types.ts），queue/ 是小组件上点了、App 还没执行的操作，一次点按一个文件。
// 哪个小组件显示哪个组件记在 SharedPreferences 里（放到桌面时绑定，只在本机）。

object WidgetStore {
  private const val PREFS = "morph_widgets"

  private fun dir(ctx: Context) = File(ctx.filesDir, "widgets")
  private fun queueDir(ctx: Context) = File(dir(ctx), "queue")

  fun writeSnapshot(ctx: Context, json: String) {
    val d = dir(ctx).apply { mkdirs() }
    val temp = File(d, "snapshot.json.tmp")
    temp.writeText(json)
    temp.renameTo(File(d, "snapshot.json"))
  }

  fun snapshot(ctx: Context): JSONObject? =
    try {
      File(dir(ctx), "snapshot.json").takeIf { it.exists() }?.readText()?.let { JSONObject(it) }
    } catch (e: Exception) {
      null
    }

  /** 记下一次点按：写完再改名，App 读不到写了一半的。 */
  fun enqueue(ctx: Context, entry: JSONObject) {
    val q = queueDir(ctx).apply { mkdirs() }
    val name = "${entry.getLong("at")}-${UUID.randomUUID()}"
    val temp = File(q, "$name.tmp")
    temp.writeText(entry.toString())
    temp.renameTo(File(q, "$name.json"))
  }

  fun queued(ctx: Context): List<JSONObject> =
    (queueDir(ctx).listFiles() ?: emptyArray())
      .filter { it.name.endsWith(".json") }
      .mapNotNull { f -> try { JSONObject(f.readText()) } catch (e: Exception) { null } }
      .sortedBy { it.optDouble("at") }

  /** App 取走点了的操作；取完就删。 */
  fun takeQueue(ctx: Context): List<String> {
    val files = (queueDir(ctx).listFiles() ?: emptyArray())
      .filter { it.name.endsWith(".json") }
      .sortedBy { it.name }
    return files.mapNotNull { f ->
      val text = try { f.readText() } catch (e: Exception) { null }
      f.delete()
      text
    }
  }

  fun bind(ctx: Context, widgetId: Int, itemId: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("w$widgetId", itemId).apply()
  }

  fun unbind(ctx: Context, widgetId: Int) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("w$widgetId").apply()
  }

  /** 这个小组件显示哪个组件：放到桌面时绑定的；从桌面的小组件列表直接加的，显示最近放的那个。 */
  fun itemFor(ctx: Context, widgetId: Int, snap: JSONObject): String? {
    val bound = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("w$widgetId", null)
    val items = snap.optJSONArray("items") ?: JSONArray()
    if (bound != null) return bound
    return if (items.length() > 0) items.getJSONObject(items.length() - 1).getString("id") else null
  }
}

/** 这个组件现在该画哪一份；stale：点过的操作算不出来（混着点了几种、点得太多、跨了天）。和 iOS 的 resolveView 一样。 */
data class Resolved(val view: JSONObject?, val stale: Boolean)

fun resolveView(snap: JSONObject, item: String, nowMs: Double, queued: List<JSONObject>): Resolved {
  val states = snap.optJSONArray("states") ?: return Resolved(null, false)
  if (states.length() == 0) return Resolved(null, false)
  var state: JSONObject = states.getJSONObject(states.length() - 1)
  for (i in 0 until states.length()) {
    val s = states.getJSONObject(i)
    if (nowMs < s.getDouble("until")) { state = s; break }
  }
  val pastEnd = nowMs >= states.getJSONObject(states.length() - 1).getDouble("until")
  val base = state.getJSONObject("views").optJSONObject(item)
  if (queued.isEmpty()) return Resolved(base, pastEnd)
  val keys = queued.map { it.getString("op") }.toSet()
  val list = if (keys.size == 1) state.getJSONObject("after").optJSONArray(keys.first()) else null
  val from = state.getDouble("from")
  if (list != null && queued.size <= list.length() && queued.all { it.getDouble("at") >= from }) {
    return Resolved(list.getJSONObject(queued.size - 1).optJSONObject(item) ?: base, pastEnd)
  }
  return Resolved(base, true)
}
