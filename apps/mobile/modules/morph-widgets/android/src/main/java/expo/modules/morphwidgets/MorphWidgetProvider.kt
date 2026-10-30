package expo.modules.morphwidgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

// Morph 的桌面小组件（D-321）：RemoteViews 画 App 算好的画面。点按钮或圆块发 ACTION_OP 给自己，
// 记进队列、马上用「点了以后」那份重画，App 开着时通知它马上执行（D-323）；不打开 App。
// 放到桌面时系统回调 ACTION_BIND，记下这个小组件显示哪个组件。跨天用 AlarmManager 的非精确闹钟换上明天那份（D-322）。

const val ACTION_OP = "expo.modules.morphwidgets.OP"
const val ACTION_BIND = "expo.modules.morphwidgets.BIND"
const val ACTION_TICK = "expo.modules.morphwidgets.TICK"
const val EXTRA_OP = "op"
const val EXTRA_ITEM = "item"

class MorphWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) WidgetRender.update(ctx, manager, id)
    WidgetRender.scheduleNext(ctx)
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    WidgetRender.update(ctx, manager, id)
  }

  override fun onDeleted(ctx: Context, ids: IntArray) {
    for (id in ids) WidgetStore.unbind(ctx, id)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      ACTION_OP -> {
        val op = intent.getStringExtra(EXTRA_OP) ?: return
        val def = WidgetStore.snapshot(ctx)?.optJSONObject("ops")?.optJSONObject(op) ?: return
        val entry = JSONObject()
          .put("op", op)
          .put("component", def.getString("component"))
          .put("hash", def.getString("hash"))
          .put("at", System.currentTimeMillis())
        if (def.has("record")) entry.put("record", def.getString("record"))
        WidgetStore.enqueue(ctx, entry)
        WidgetRender.updateAll(ctx)
        MorphWidgetsModule.notifyQueue()
      }
      ACTION_BIND -> {
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val item = intent.getStringExtra(EXTRA_ITEM)
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID && item != null) {
          WidgetStore.bind(ctx, id, item)
          WidgetRender.update(ctx, AppWidgetManager.getInstance(ctx), id)
        }
      }
      ACTION_TICK -> {
        WidgetRender.updateAll(ctx)
        WidgetRender.scheduleNext(ctx)
      }
      else -> super.onReceive(ctx, intent)
    }
  }
}

object WidgetRender {
  private fun provider(ctx: Context) = ComponentName(ctx, MorphWidgetProvider::class.java)

  fun updateAll(ctx: Context) {
    val manager = AppWidgetManager.getInstance(ctx)
    for (id in manager.getAppWidgetIds(provider(ctx))) update(ctx, manager, id)
  }

  /** 到下一份画面开始的时间（明天零点）重画；非精确闹钟，不需要权限，晚几分钟没关系。 */
  fun scheduleNext(ctx: Context) {
    val states = WidgetStore.snapshot(ctx)?.optJSONArray("states") ?: return
    val now = System.currentTimeMillis().toDouble()
    var next: Double? = null
    for (i in 0 until states.length()) {
      val from = states.getJSONObject(i).getDouble("from")
      if (from > now) { next = from; break }
    }
    val at = next ?: return
    val alarm = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(ctx, MorphWidgetProvider::class.java).setAction(ACTION_TICK)
    val pending = PendingIntent.getBroadcast(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    alarm.set(AlarmManager.RTC, at.toLong() + 1000, pending)
  }

  private fun dp(ctx: Context, v: Float) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics)

  private fun night(ctx: Context) =
    (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  private fun color(snap: JSONObject, dark: Boolean, key: String, fallback: Int): Int =
    try {
      Color.parseColor(snap.getJSONObject("colors").getJSONObject(if (dark) "dark" else "light").getString(key))
    } catch (e: Exception) {
      fallback
    }

  /** 主色：Android 12 起交给桌面按深浅色选；更早的按现在的模式。 */
  private fun setPrimary(views: RemoteViews, id: Int, method: String, snap: JSONObject, ctx: Context, key: String = "primary") {
    val light = color(snap, false, key, Color.parseColor("#C2603A"))
    val dark = color(snap, true, key, light)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) views.setColorInt(id, method, light, dark)
    else views.setInt(id, method, if (night(ctx)) dark else light)
  }

  private fun linkIntent(ctx: Context, link: String): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(ctx, link.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun opIntent(ctx: Context, widgetId: Int, op: String): PendingIntent {
    val intent = Intent(ctx, MorphWidgetProvider::class.java)
      .setAction(ACTION_OP)
      .setData(Uri.parse("morph-widget://op/$widgetId/${Uri.encode(op)}"))
      .putExtra(EXTRA_OP, op)
    return PendingIntent.getBroadcast(ctx, "$widgetId:$op".hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** 进度环（统计的目标）或圆块（tiles）：画成一张小图。 */
  private fun circleBitmap(ctx: Context, sizeDp: Float, ratio: Double?, full: Boolean, primary: Int, tint: Int, onPrimary: Int, ringOnly: Boolean): Bitmap {
    val size = dp(ctx, sizeDp).toInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val stroke = dp(ctx, if (ringOnly) 5f else 3f)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val inset = stroke / 2
    val box = RectF(inset, inset, size - inset, size - inset)
    if (ratio != null) {
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = stroke
      paint.strokeCap = Paint.Cap.ROUND
      paint.color = primary
      paint.alpha = 50
      canvas.drawArc(box, 0f, 360f, false, paint)
      paint.alpha = 255
      canvas.drawArc(box, -90f, (360 * ratio.coerceIn(0.0, 1.0)).toFloat(), false, paint)
    }
    if (!ringOnly) {
      val gap = if (ratio != null) stroke + dp(ctx, 3f) else 0f
      paint.style = Paint.Style.FILL
      paint.color = if (full) primary else tint
      canvas.drawOval(RectF(gap, gap, size - gap, size - gap), paint)
      if (full) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(ctx, 2.5f)
        paint.color = onPrimary
        val c = size / 2f
        val u = size / 8f
        val path = Path().apply { moveTo(c - 1.5f * u, c); lineTo(c - 0.3f * u, c + 1.2f * u); lineTo(c + 1.6f * u, c - 1.2f * u) }
        canvas.drawPath(path, paint)
      }
    }
    return bmp
  }

  fun update(ctx: Context, manager: AppWidgetManager, widgetId: Int) {
    val views = RemoteViews(ctx.packageName, R.layout.morph_widget)
    val snap = WidgetStore.snapshot(ctx)
    val item = snap?.let { WidgetStore.itemFor(ctx, widgetId, it) }
    val resolved = if (snap != null && item != null) resolveView(snap, item, System.currentTimeMillis().toDouble(), WidgetStore.queued(ctx)) else null
    val view = resolved?.view
    if (snap == null || view == null) {
      // 还没放过组件：说明怎么放；点一下打开 App。
      views.setOnClickPendingIntent(R.id.widget_root, linkIntent(ctx, "morph://"))
      manager.updateAppWidget(widgetId, views)
      return
    }
    val dark = night(ctx)
    val primary = color(snap, dark, "primary", Color.parseColor("#C2603A"))
    val tint = color(snap, dark, "tint", Color.LTGRAY)
    val onPrimary = color(snap, dark, "onPrimary", Color.WHITE)
    val options = manager.getAppWidgetOptions(widgetId)
    val tall = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) >= 250
    val wide = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) >= 200

    val kind = view.optString("kind")
    val title = view.optString("title")
    views.setTextViewText(R.id.widget_title, if (kind == "message") title else title.uppercase())
    if (kind != "message") setPrimary(views, R.id.widget_title, "setTextColor", snap, ctx)
    val note = view.optString("note", "")
    views.setTextViewText(R.id.widget_note, note)
    views.setViewVisibility(R.id.widget_note, if (note.isEmpty()) View.GONE else View.VISIBLE)
    if (resolved.stale) {
      views.setTextViewText(R.id.widget_stale, snap.optJSONObject("strings")?.optString("stale") ?: "")
      views.setViewVisibility(R.id.widget_stale, View.VISIBLE)
    }
    view.optString("link").takeIf { it.isNotEmpty() }?.let {
      views.setOnClickPendingIntent(R.id.widget_root, linkIntent(ctx, it))
    }

    when (kind) {
      "stat" -> {
        val rows = view.optJSONArray("rows")
        if (rows != null) {
          addRows(ctx, views, rows, if (tall) 7 else 3, widgetId)
        } else {
          views.setViewVisibility(R.id.widget_stat, View.VISIBLE)
          views.setTextViewText(R.id.widget_value, view.optString("value", "—"))
          if (view.has("ratio")) {
            views.setViewVisibility(R.id.widget_ring, View.VISIBLE)
            views.setImageViewBitmap(R.id.widget_ring, circleBitmap(ctx, 48f, view.getDouble("ratio"), false, primary, tint, onPrimary, true))
            views.setContentDescription(R.id.widget_ring, view.optString("percent"))
          }
        }
      }
      "button" -> {
        views.setViewVisibility(R.id.widget_button, View.VISIBLE)
        views.setTextViewText(R.id.widget_button, title)
        views.setViewVisibility(R.id.widget_title, View.GONE)
        setPrimary(views, R.id.widget_button, "setTextColor", snap, ctx, "onPrimary")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          views.setColorStateList(R.id.widget_button, "setBackgroundTintList",
            android.content.res.ColorStateList.valueOf(color(snap, false, "primary", primary)),
            android.content.res.ColorStateList.valueOf(color(snap, true, "primary", primary)))
        } else {
          views.setInt(R.id.widget_button, "setBackgroundColor", primary)
        }
        val op = view.optString("op")
        val link = view.optString("link")
        when {
          op.isNotEmpty() -> views.setOnClickPendingIntent(R.id.widget_button, opIntent(ctx, widgetId, op))
          link.isNotEmpty() -> views.setOnClickPendingIntent(R.id.widget_button, linkIntent(ctx, link))
        }
      }
      "list" -> {
        val rows = view.optJSONArray("rows")
        if (rows == null || rows.length() == 0) {
          views.setTextViewText(R.id.widget_note, view.optString("empty", ""))
          views.setViewVisibility(R.id.widget_note, View.VISIBLE)
        } else if (view.optString("display") == "tiles") {
          views.setViewVisibility(R.id.widget_tiles, View.VISIBLE)
          views.removeAllViews(R.id.widget_tiles)
          val columns = if (wide) 4 else 2
          val limit = minOf(rows.length(), if (tall) 8 else 4)
          var line: RemoteViews? = null
          for (i in 0 until limit) {
            if (i % columns == 0) {
              line?.let { views.addView(R.id.widget_tiles, it) }
              line = RemoteViews(ctx.packageName, R.layout.morph_widget_tile_row)
            }
            val row = rows.getJSONObject(i)
            val tile = RemoteViews(ctx.packageName, R.layout.morph_widget_tile)
            tile.setTextViewText(R.id.tile_title, row.optString("title"))
            val ratio = if (row.has("ratio")) row.getDouble("ratio") else null
            tile.setImageViewBitmap(R.id.tile_circle, circleBitmap(ctx, 44f, ratio, row.optBoolean("full"), primary, tint, onPrimary, false))
            tile.setContentDescription(R.id.tile_circle, row.optString("title"))
            val op = row.optString("op")
            val link = row.optString("link")
            when {
              op.isNotEmpty() -> tile.setOnClickPendingIntent(R.id.tile, opIntent(ctx, widgetId, op))
              link.isNotEmpty() -> tile.setOnClickPendingIntent(R.id.tile, linkIntent(ctx, link))
            }
            line!!.addView(R.id.tile_row, tile)
          }
          // 最后一行不满时补空位，圆块不被拉宽。
          val rest = (columns - limit % columns) % columns
          repeat(rest) { line!!.addView(R.id.tile_row, RemoteViews(ctx.packageName, R.layout.morph_widget_tile)) }
          line?.let { views.addView(R.id.widget_tiles, it) }
        } else {
          addRows(ctx, views, rows, if (tall) 7 else 3, widgetId)
        }
      }
    }
    manager.updateAppWidget(widgetId, views)
  }

  private fun addRows(ctx: Context, views: RemoteViews, rows: org.json.JSONArray, max: Int, widgetId: Int) {
    views.setViewVisibility(R.id.widget_rows, View.VISIBLE)
    views.removeAllViews(R.id.widget_rows)
    for (i in 0 until minOf(rows.length(), max)) {
      val row = rows.getJSONObject(i)
      val line = RemoteViews(ctx.packageName, R.layout.morph_widget_row)
      line.setTextViewText(R.id.row_title, row.optString("title"))
      line.setTextViewText(R.id.row_trailing, row.optString("trailing", ""))
      row.optString("link").takeIf { it.isNotEmpty() }?.let { line.setOnClickPendingIntent(R.id.row, linkIntent(ctx, it)) }
      views.addView(R.id.widget_rows, line)
    }
  }
}
