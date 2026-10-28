package expo.modules.morphshortcuts

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// 长按 Morph 图标的菜单和桌面上单独的图标（D-269）。快捷方式的 ID 是快捷操作的 ID；点了打开 App 的主界面，
// intent 的 action 是 ACTION_OPEN、extra 里是 ID。冷启动时 JS 启动完用 takeLaunched 取，
// App 开着时（singleTask，走 onNewIntent）发 onOpen。图标用 App 自己的图标。

private const val ACTION_OPEN = "app.morph.mobile.OPEN_QUICK_ACTION"
private const val EXTRA_ID = "morphQuickAction"

class ShortcutItemRecord : Record {
  @Field val id: String = ""
  @Field val title: String = ""
  @Field val symbol: String? = null
}

class MorphShortcutsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  override fun definition() = ModuleDefinition {
    Name("MorphShortcuts")

    Events("onOpen")

    AsyncFunction("setItems") { items: List<ShortcutItemRecord>, disabledMessage: String ->
      val ctx = context
      val infos = items.map { shortcut(ctx, it) }
      // 已经固定在桌面上的：还在菜单里的重新启用、跟着改名；不在的停用（App 不能替用户拿掉桌面上的图标）。
      // 先启用再放进菜单：停用的快捷方式不能直接再做成动态的。
      val wanted = items.map { it.id }.toSet()
      val pinned = ShortcutManagerCompat.getShortcuts(ctx, ShortcutManagerCompat.FLAG_MATCH_PINNED)
      val keep = infos.filter { info -> pinned.any { it.id == info.id } }
      val gone = pinned.map { it.id }.filter { it !in wanted }
      if (keep.isNotEmpty()) ShortcutManagerCompat.enableShortcuts(ctx, keep)
      ShortcutManagerCompat.setDynamicShortcuts(ctx, infos)
      if (keep.isNotEmpty()) ShortcutManagerCompat.updateShortcuts(ctx, keep)
      if (gone.isNotEmpty()) ShortcutManagerCompat.disableShortcuts(ctx, gone, disabledMessage)
    }

    Function("canPin") { ShortcutManagerCompat.isRequestPinShortcutSupported(context) }

    // 系统弹确认框（有的桌面直接放上去），用户决定；这里只说请求有没有发出去。
    AsyncFunction("pin") { item: ShortcutItemRecord ->
      val ctx = context
      ShortcutManagerCompat.isRequestPinShortcutSupported(ctx) &&
        ShortcutManagerCompat.requestPinShortcut(ctx, shortcut(ctx, item), null)
    }

    Function("takeLaunched") {
      val intent = appContext.currentActivity?.intent ?: return@Function null
      val id = idOf(intent) ?: return@Function null
      // 只用一次：重新加载 JS 或回到前台时不再开始一遍。
      intent.action = Intent.ACTION_MAIN
      intent.removeExtra(EXTRA_ID)
      id
    }

    OnNewIntent { intent ->
      val id = idOf(intent) ?: return@OnNewIntent
      intent.action = Intent.ACTION_MAIN
      intent.removeExtra(EXTRA_ID)
      sendEvent("onOpen", mapOf("id" to id))
    }
  }

  private fun idOf(intent: Intent): String? =
    if (intent.action == ACTION_OPEN) intent.getStringExtra(EXTRA_ID)?.takeIf { it.isNotEmpty() } else null

  private fun shortcut(ctx: Context, item: ShortcutItemRecord): ShortcutInfoCompat {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      ?: Intent().setPackage(ctx.packageName)
    val intent = Intent(ACTION_OPEN).apply {
      component = launch.component
      setPackage(ctx.packageName)
      putExtra(EXTRA_ID, item.id)
    }
    return ShortcutInfoCompat.Builder(ctx, item.id)
      .setShortLabel(item.title)
      .setLongLabel(item.title)
      .setIcon(IconCompat.createWithResource(ctx, ctx.applicationInfo.icon))
      .setIntent(intent)
      .build()
  }
}
