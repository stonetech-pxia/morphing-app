package expo.modules.morphwidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// 桌面小组件（D-321–D-323）的 App 这一边：写画面并重画、取走点了的操作、请求把小组件放到桌面。
// 小组件上点了操作时 App 开着，发 onQueue 让 JS 马上取走执行。

class MorphWidgetsModule : Module() {
  companion object {
    @Volatile private var current: MorphWidgetsModule? = null

    fun notifyQueue() {
      current?.sendEvent("onQueue", mapOf<String, Any>())
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  override fun definition() = ModuleDefinition {
    Name("MorphWidgets")

    Events("onQueue")

    OnCreate { current = this@MorphWidgetsModule }
    OnDestroy { if (current === this@MorphWidgetsModule) current = null }

    AsyncFunction("setSnapshot") { json: String ->
      val ctx = context
      WidgetStore.writeSnapshot(ctx, json)
      WidgetRender.updateAll(ctx)
      WidgetRender.scheduleNext(ctx)
    }

    AsyncFunction("takeQueue") { WidgetStore.takeQueue(context) }

    Function("canPin") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported
    }

    // 系统弹确认框（有的桌面直接放上去），用户决定；放好后系统回调 ACTION_BIND，记下显示哪个组件。
    AsyncFunction("pin") { itemId: String, _: String ->
      val ctx = context
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction false
      val manager = AppWidgetManager.getInstance(ctx)
      if (!manager.isRequestPinAppWidgetSupported) return@AsyncFunction false
      val callback = Intent(ctx, MorphWidgetProvider::class.java)
        .setAction(ACTION_BIND)
        .setData(Uri.parse("morph-widget://bind/${Uri.encode(itemId)}"))
        .putExtra(EXTRA_ITEM, itemId)
      // 系统要往回调里填小组件的 ID，所以是 MUTABLE。
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
      val pending = PendingIntent.getBroadcast(ctx, itemId.hashCode(), callback, flags)
      manager.requestPinAppWidget(ComponentName(ctx, MorphWidgetProvider::class.java), null, pending)
    }
  }
}
