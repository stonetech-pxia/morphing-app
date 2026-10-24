package expo.modules.morphbackground

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

// 长任务的前台服务（D-160）：运行期间通知栏有一条带进度的通知，Morph 切到别的 App、锁屏都继续跑。
// 服务本身不做事，只让系统别冻结、别杀掉 App 的进程；视频和音频还是由 morph-media / morph-speech 处理。
// Android 15 起类型是 mediaProcessing（每 24 小时最多 6 小时，到了调 onTimeout），Android 14 用 dataSync。

private const val TAG = "MorphBackground"

class MorphBackgroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stop()
      return START_NOT_STICKY
    }
    val notification = progressNotification(
      this,
      intent?.getStringExtra(EXTRA_TITLE).orEmpty(),
      intent?.getStringExtra(EXTRA_TEXT).orEmpty(),
      null,
    )
    // 先试 mediaProcessing；有的 Android 15 系统没开这种类型（报「type none」），退回 dataSync。
    val started = serviceTypes().any { type ->
      try {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        true
      } catch (e: Exception) {
        Log.w(TAG, "startForeground failed (type $type)", e)
        false
      }
    }
    if (!started) {
      // 系统不让（例如已经在后台）：不保活，任务照旧只在前台跑。
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      // 锁屏后 CPU 不睡；最长 7 小时（mediaProcessing 每天最多 6 小时），防止忘了释放。
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Morph:background").apply {
        setReferenceCounted(false)
        acquire(7 * 60 * 60 * 1000L)
      }
    }
    return START_NOT_STICKY
  }

  // Android 15：这种类型今天的 6 小时用完了。停掉服务，任务回到普通的后台规则。
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.w(TAG, "foreground service timed out")
    stop()
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  private fun stop() {
    running = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  companion object {
    const val NOTIFICATION_ID = 3101
    const val DONE_NOTIFICATION_ID = 3102
    private const val CHANNEL_WORK = "morph_background_work"
    private const val CHANNEL_DONE = "morph_background_done"
    private const val ACTION_STOP = "expo.modules.morphbackground.STOP"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    /** 服务已经在前台（startForeground 成功、还没停）：只有这时才改进度通知。 */
    @Volatile
    var running = false
      private set

    private fun serviceTypes(): List<Int> = when {
      Build.VERSION.SDK_INT >= 35 -> listOf(
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> listOf(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else -> listOf(0)
    }

    /** 开始保活；系统不让时（Android 12 起 App 在后台不能启动前台服务）返回 false。 */
    fun start(context: Context, title: String, text: String): Boolean {
      ensureChannels(context)
      val intent = Intent(context, MorphBackgroundService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: Exception) {
        Log.w(TAG, "could not start the foreground service", e)
        false
      }
    }

    /** 结束保活。和 start 走同一个队列，保证先 startForeground 再停（反过来系统会让 App 崩溃）。 */
    fun stop(context: Context) {
      val intent = Intent(context, MorphBackgroundService::class.java).setAction(ACTION_STOP)
      try {
        context.startService(intent)
      } catch (e: Exception) {
        // 服务没在跑（start 失败过）时，后台的 App 不能 startService。
        context.stopService(Intent(context, MorphBackgroundService::class.java))
      }
    }

    fun canNotify(context: Context): Boolean =
      Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

    fun progressNotification(context: Context, title: String, text: String, fraction: Double?): Notification =
      NotificationCompat.Builder(context, CHANNEL_WORK)
        .setSmallIcon(R.drawable.morph_background_working)
        .setContentTitle(title)
        .setContentText(text)
        .setProgress(100, ((fraction ?: 0.0) * 100).roundToInt().coerceIn(0, 100), fraction == null)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(openApp(context))
        .build()

    fun doneNotification(context: Context, title: String, body: String): Notification {
      ensureChannels(context)
      return NotificationCompat.Builder(context, CHANNEL_DONE)
        .setSmallIcon(R.drawable.morph_background_done)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .setContentIntent(openApp(context))
        .build()
    }

    /** 点通知回到 Morph 原来的任务（运行页或结果页），不新开页面。 */
    private fun openApp(context: Context): PendingIntent? =
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { intent ->
        PendingIntent.getActivity(
          context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }

    private fun ensureChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_WORK) == null) {
        manager.createNotificationChannel(
          NotificationChannel(
            CHANNEL_WORK,
            context.getString(R.string.morph_background_channel_work),
            NotificationManager.IMPORTANCE_LOW,
          ).apply {
            description = context.getString(R.string.morph_background_channel_work_description)
            setShowBadge(false)
          }
        )
      }
      if (manager.getNotificationChannel(CHANNEL_DONE) == null) {
        manager.createNotificationChannel(
          NotificationChannel(
            CHANNEL_DONE,
            context.getString(R.string.morph_background_channel_done),
            NotificationManager.IMPORTANCE_DEFAULT,
          ).apply {
            description = context.getString(R.string.morph_background_channel_done_description)
          }
        )
      }
    }
  }
}
