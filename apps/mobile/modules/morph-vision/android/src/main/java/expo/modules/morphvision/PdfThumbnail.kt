package expo.modules.morphvision

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

// PDF 第一页的缩略图（D-451）：系统的 PdfRenderer，本机画，不联网。白底（PDF 页面本身可能是透明的），
// 长边不超过 maxSide，存成 JPEG。打不开（损坏、要密码）时抛出，App 显示 PDF 图标。
object PdfThumbnail {
  fun render(input: File, output: File, maxSide: Int): Map<String, Any> {
    val fd = ParcelFileDescriptor.open(input, ParcelFileDescriptor.MODE_READ_ONLY)
    try {
      PdfRenderer(fd).use { renderer ->
        if (renderer.pageCount == 0) throw VisionFailedException("PDF has no pages")
        renderer.openPage(0).use { page ->
          val scale = maxSide.toDouble() / max(page.width, page.height)
          val width = max(1, (page.width * scale).roundToInt())
          val height = max(1, (page.height * scale).roundToInt())
          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          try {
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            output.parentFile?.mkdirs()
            FileOutputStream(output).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
          } finally {
            bitmap.recycle()
          }
          return mapOf("width" to width, "height" to height, "pageCount" to renderer.pageCount)
        }
      }
    } catch (e: VisionFailedException) {
      throw e
    } catch (e: Exception) {
      throw VisionFailedException(e.message)
    } finally {
      fd.close()
    }
  }
}
