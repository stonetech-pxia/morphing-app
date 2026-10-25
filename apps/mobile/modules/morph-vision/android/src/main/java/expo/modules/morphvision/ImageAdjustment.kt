package expo.modules.morphvision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.media.ExifInterface
import android.net.Uri
import java.io.File
import kotlin.math.max
import kotlin.math.sqrt

object ImageAdjustment {
  /** 按 EXIF 摆正，包括镜像拍摄方向。 */
  fun load(context: Context, uri: Uri): Bitmap {
    val bitmap = context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }) } ?: throw VisionFailedException("unreadable image")
    val orientation = try { context.contentResolver.openInputStream(uri).use { ExifInterface(it!!).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) } } catch (_: Exception) { 1 }
    val values = when(orientation) {
      2 -> floatArrayOf(-1f,0f,0f,0f,1f,0f,0f,0f,1f)
      3 -> floatArrayOf(-1f,0f,0f,0f,-1f,0f,0f,0f,1f)
      4 -> floatArrayOf(1f,0f,0f,0f,-1f,0f,0f,0f,1f)
      5 -> floatArrayOf(0f,1f,0f,1f,0f,0f,0f,0f,1f)
      6 -> floatArrayOf(0f,-1f,0f,1f,0f,0f,0f,0f,1f)
      7 -> floatArrayOf(0f,-1f,0f,-1f,0f,0f,0f,0f,1f)
      8 -> floatArrayOf(0f,1f,0f,-1f,0f,0f,0f,0f,1f)
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap,0,0,bitmap.width,bitmap.height, Matrix().apply { setValues(values) }, true).also { if (it !== bitmap) bitmap.recycle() }
  }
  fun adjust(context: Context, uri: Uri, options: Map<String, Any?>, format: String, output: File): Map<String, Any> {
    val source = load(context, uri)
    var result: Bitmap? = null
    try {
      var brightness = (options["brightness"] as? Number)?.toDouble() ?: 0.0
      var contrast = (options["contrast"] as? Number)?.toDouble() ?: 100.0
      var saturation = (options["saturation"] as? Number)?.toDouble() ?: 100.0
      if (options["mode"] == "auto") {
        // 最多采样约 65536 像素，不保留内容；适度提亮暗图，避免把全黑图变成灰色。
        val step = max(1, sqrt(source.width.toDouble()*source.height/65536).toInt())
        var sum = 0.0; var weight = 0.0
        for (y in 0 until source.height step step) for (x in 0 until source.width step step) {
          val pixel = source.getPixel(x,y); val alpha = Color.alpha(pixel)/255.0
          sum += (.2126*Color.red(pixel)+.7152*Color.green(pixel)+.0722*Color.blue(pixel))*alpha; weight += alpha
        }
        val mean = if (weight>0) sum/weight/255 else 0.0
        brightness = if (mean>.01) ((.45-mean).coerceIn(-.12,.20)*100) else 0.0
        contrast = if (mean>.01) 105.0 else 100.0; saturation = 100.0
      }
      if (!brightness.isFinite() || !contrast.isFinite() || !saturation.isFinite() || brightness !in -100.0..100.0 || contrast !in 0.0..200.0 || saturation !in 0.0..200.0) throw VisionFailedException("invalid adjustment")
      val scale = (contrast/100).toFloat()
      val offset = (128*(1-scale)+brightness*255/100).toFloat()
      val matrix = ColorMatrix().apply { setSaturation((saturation/100).toFloat()); postConcat(ColorMatrix(floatArrayOf(scale,0f,0f,0f,offset, 0f,scale,0f,0f,offset, 0f,0f,scale,0f,offset, 0f,0f,0f,1f,0f))) }
      result = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
      Canvas(result).drawBitmap(source,0f,0f,Paint().apply { colorFilter = ColorMatrixColorFilter(matrix) })
      output.parentFile?.mkdirs()
      output.outputStream().use { if (!result.compress(if (format=="png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 92, it)) throw VisionFailedException("image encode") }
      return mapOf("width" to result.width, "height" to result.height, "size" to output.length())
    } finally { result?.recycle(); source.recycle() }
  }
}
