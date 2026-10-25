package expo.modules.morphvision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate
import com.google.android.gms.common.moduleinstall.InstallStatusListener
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Google Play 服务只下载模型，图片在本机处理；由 JS 先征得下载同意。 */
object BackgroundRemoval {
  fun supported(context: Context) = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
  private fun segmenter() = SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundBitmap().build())
  fun status(context: Context): String {
    if (!supported(context)) return "unsupported"
    val client = segmenter()
    try { return if (Tasks.await(ModuleInstall.getClient(context).areModulesAvailable(client), 30, TimeUnit.SECONDS).areModulesAvailable()) "ready" else "download" }
    finally { client.close() }
  }
  fun download(context: Context) {
    if (!supported(context)) throw VisionFailedException("Google Play services required")
    val client = segmenter()
    val installer = ModuleInstall.getClient(context)
    val done = CountDownLatch(1)
    val installed = AtomicBoolean(false)
    val listener = InstallStatusListener { update ->
      when (update.installState) {
        ModuleInstallStatusUpdate.InstallState.STATE_COMPLETED -> { installed.set(true); done.countDown() }
        ModuleInstallStatusUpdate.InstallState.STATE_FAILED, ModuleInstallStatusUpdate.InstallState.STATE_CANCELED -> done.countDown()
      }
    }
    try {
      val response = Tasks.await(installer.installModules(ModuleInstallRequest.newBuilder().addApi(client).setListener(listener).build()), 30, TimeUnit.SECONDS)
      if (!response.areModulesAlreadyInstalled() && (!done.await(120, TimeUnit.SECONDS) || !installed.get())) throw VisionFailedException("model download failed")
      if (!Tasks.await(installer.areModulesAvailable(client), 30, TimeUnit.SECONDS).areModulesAvailable()) throw VisionFailedException("model unavailable")
    } finally { installer.unregisterListener(listener); client.close() }
  }
  fun remove(context: Context, uri: Uri, background: String, output: File): Map<String, Any> {
    if (background != "transparent" && !Regex("^#[0-9A-Fa-f]{6}$").matches(background)) throw VisionFailedException("invalid color")
    if (status(context) != "ready") throw VisionFailedException("model unavailable")
    val client = segmenter()
    var foreground: Bitmap? = null
    var flattened: Bitmap? = null
    try {
      foreground = Tasks.await(client.process(InputImage.fromFilePath(context, uri)), 60, TimeUnit.SECONDS).foregroundBitmap ?: throw VisionFailedException("no subject")
      // 找不到主体时不要悄悄导出空白图片。
      val row = IntArray(foreground.width)
      var found = false
      for (y in 0 until foreground.height) {
        foreground.getPixels(row, 0, foreground.width, 0, y, foreground.width, 1)
        if (row.any { Color.alpha(it) > 127 }) { found = true; break }
      }
      if (!found) throw VisionFailedException("no subject")
      val result = if (background == "transparent") foreground else {
        Bitmap.createBitmap(foreground.width, foreground.height, Bitmap.Config.ARGB_8888).also {
          flattened = it
          val canvas = Canvas(it); canvas.drawColor(Color.parseColor(background)); canvas.drawBitmap(foreground, 0f, 0f, Paint(Paint.ANTI_ALIAS_FLAG))
        }
      }
      output.parentFile?.mkdirs()
      output.outputStream().use { if (!result.compress(Bitmap.CompressFormat.PNG, 100, it)) throw VisionFailedException("PNG encode") }
      return mapOf("width" to result.width, "height" to result.height, "size" to output.length())
    } finally { flattened?.recycle(); foreground?.recycle(); client.close() }
  }
}
