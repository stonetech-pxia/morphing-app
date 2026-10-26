package expo.modules.morphvision

import android.content.Context
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.util.concurrent.TimeUnit

/**
 * 证件照自动框脸（D-252）：ML Kit 人脸检测，模型打包进 App（不需要 Google Play 服务、不下载）。
 * 先摆正并缩到长边 2048 再检测（找脸不需要更大，200 MP 原图解码会内存不足）；返回的坐标是这张缩小图的像素，
 * 连同它的宽高一起返回，JS 按比例换回原图。
 */
object FaceFinder {
  private const val MAX_SIDE = 2048

  fun detect(context: Context, uri: Uri): Map<String, Any> {
    val bitmap = ImageLoading.decodeUpright(context, uri, MAX_SIDE)
    val detector = FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setMinFaceSize(0.1f)
        .build()
    )
    try {
      val faces = Tasks.await(detector.process(InputImage.fromBitmap(bitmap, 0)), 30, TimeUnit.SECONDS)
      return mapOf(
        "width" to bitmap.width,
        "height" to bitmap.height,
        "faces" to faces.map {
          val box = it.boundingBox
          mapOf("x" to box.left, "y" to box.top, "width" to box.width(), "height" to box.height())
        },
      )
    } finally {
      bitmap.recycle()
      detector.close()
    }
  }
}
