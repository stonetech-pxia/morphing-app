package expo.modules.morphbackground

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// 长任务切到后台也继续的 Android 部分（D-160–D-162）。JS 在一次运行开始时 begin、运行中 update、
// 结束时 end；服务见 MorphBackgroundService.kt。和 iOS 的 JS 接口相同。

class DoneNotice : Record {
  @Field val title: String = ""
  @Field val body: String = ""
}

private const val PREFS = "morph-background"
private const val KEY_ASKED = "askedNotifications"

class MorphBackgroundModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  /**
   * begin 成功后、end 之前为 true。只在这期间、而且服务真的进了前台时改进度通知：
   * 不然发出去的是一条普通通知，停服务带不走它。
   */
  private var active = false
  private var title = ""

  override fun definition() = ModuleDefinition {
    Name("MorphBackground")

    Constant("continuesInBackground") { true }

    // Android 13 起要用户允许才显示通知：没允许过就问一次，以后不再问（D-161）。拒绝了任务照常跑。
    AsyncFunction("ensureNotificationPermission") { promise: Promise ->
      val permissions = appContext.permissions
      if (Build.VERSION.SDK_INT < 33 || permissions == null) {
        promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
        return@AsyncFunction
      }
      if (permissions.hasGrantedPermissions(Manifest.permission.POST_NOTIFICATIONS)) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (prefs.getBoolean(KEY_ASKED, false)) {
        promise.resolve(false)
        return@AsyncFunction
      }
      prefs.edit { putBoolean(KEY_ASKED, true) }
      permissions.askForPermissions(
        { result ->
          promise.resolve(result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED)
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    Function("begin") { title: String, text: String ->
      this@MorphBackgroundModule.title = title
      active = MorphBackgroundService.start(context, title, text)
      active
    }

    Function("update") { text: String, fraction: Double? ->
      if (!active || !MorphBackgroundService.running || !MorphBackgroundService.canNotify(context)) {
        return@Function
      }
      try {
        NotificationManagerCompat.from(context).notify(
          MorphBackgroundService.NOTIFICATION_ID,
          MorphBackgroundService.progressNotification(context, title, text, fraction),
        )
      } catch (_: SecurityException) {
      }
    }

    // 提醒按钮的后台处理（D-318）在 Android 上由 expo-task-manager 的后台任务管，这里不用做什么。
    Function("releaseActionTime") {}

    Function("end") { done: DoneNotice? ->
      if (active) MorphBackgroundService.stop(context)
      active = false
      if (done == null || !MorphBackgroundService.canNotify(context)) return@Function
      try {
        NotificationManagerCompat.from(context).notify(
          MorphBackgroundService.DONE_NOTIFICATION_ID,
          MorphBackgroundService.doneNotification(context, done.title, done.body),
        )
      } catch (_: SecurityException) {
      }
    }
  }
}
