package expo.modules.morphvision

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabel
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import expo.modules.kotlin.exception.CodedException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

class VisionCancelledException : CodedException("ERR_VISION_CANCELLED", "Cancelled", null)

/**
 * 照片里是什么（没有文字的照片做推荐用，还没接进推荐）：ML Kit 图像标注的基础模型，打包进 App
 * （不需要 Google Play 服务、不下载）。标签是 ML Kit 自己的英文词，和 iOS 的 Vision 不是一套。
 * 先摆正并缩到长边 1024 再标注（模型只看很小的图，原图解码会内存不足）；不写中间文件，
 * 位图和标注器成功、失败、取消都释放。cancel(taskId) 让这次以 ERR_VISION_CANCELLED 结束。
 */
object ImageClassifier {
  private const val MAX_SIDE = 1024
  /** 多久看一次「取消」。 */
  private const val POLL_MS = 100L

  private val running = ConcurrentHashMap<String, AtomicBoolean>()

  fun classify(
    context: Context,
    uri: Uri,
    taskId: String,
    maxResults: Int,
    minConfidence: Double,
  ): Map<String, Any> {
    val flag = AtomicBoolean(false)
    running[taskId] = flag
    // 门槛交给 ML Kit 过滤（它默认 0.5），个数和排序在这里做。
    val labeler = ImageLabeling.getClient(
      ImageLabelerOptions.Builder().setConfidenceThreshold(minConfidence.toFloat()).build()
    )
    var bitmap: Bitmap? = null
    var task: Task<List<ImageLabel>>? = null
    try {
      val image = ImageLoading.decodeUpright(context, uri, MAX_SIDE)
      bitmap = image
      if (flag.get()) throw VisionCancelledException()
      val pending = labeler.process(InputImage.fromBitmap(image, 0))
      task = pending
      while (true) {
        if (flag.get()) throw VisionCancelledException()
        val labels = try {
          Tasks.await(pending, POLL_MS, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
          continue
        }
        return mapOf(
          "labels" to labels.sortedByDescending { it.confidence }.take(maxOf(0, maxResults)).map {
            mapOf("id" to it.text, "confidence" to it.confidence.toDouble())
          },
          "width" to image.width,
          "height" to image.height,
        )
      }
    } finally {
      running.remove(taskId)
      val done = { labeler.close(); bitmap?.recycle() }
      // 取消时 ML Kit 可能还在读这张位图：等它结束再回收，不然会读到已回收的位图。
      val unfinished = task?.takeIf { !it.isComplete }
      if (unfinished != null) unfinished.addOnCompleteListener { done() } else done()
    }
  }

  /** 还没开始或已经结束的取消不起作用（JS 那边自己先结束 Promise）。 */
  fun cancel(taskId: String) {
    running[taskId]?.set(true)
  }
}
