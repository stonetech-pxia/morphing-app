package expo.modules.morphvision

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// 文字识别和扫描的 Android 实现（D-087）：Google ML Kit，全部在本机处理。
// 和 iOS 的 JS 接口相同；ML Kit 没有「给一张照片找四个角」的接口，所以 canFindPaper 是 false，
// 相册照片的找边退回扫描包。识别出的文字只返回给 App，不写日志。

class VisionFailedException(detail: String?) : CodedException("Vision failed: $detail")

class UnsupportedLanguageException(code: String) :
  CodedException("Text recognition does not support $code")

class DocumentCameraUnavailableException :
  CodedException("The document camera is not available on this device")

private const val SCAN_REQUEST = 0x4d56

class ClassifyOptions : Record {
  @Field val maxResults: Int = 10
  @Field val minConfidence: Double = 0.1
}

/** ML Kit 文字识别 v2 的拉丁字母语言（Morph 用得到的）；俄文等西里尔字母不支持。 */
private val LATIN = setOf("en", "fr", "de", "es", "pt", "it", "vi")

private class PendingScan(
  val promise: Promise,
  val directory: File,
  val maxSide: Int,
  val quality: Double,
)

class MorphVisionModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private var pendingScan: PendingScan? = null

  override fun definition() = ModuleDefinition {
    Name("MorphVision")

    Function("backgroundRemovalSupported") { BackgroundRemoval.supported(context) }
    AsyncFunction("backgroundStatus") { BackgroundRemoval.status(context) }
    AsyncFunction("downloadBackgroundModel") { BackgroundRemoval.download(context) }
    AsyncFunction("removeBackground") { uri: String, background: String, output: String ->
      BackgroundRemoval.remove(context, Uri.parse(uri), background, File(Uri.parse(output).path!!))
    }

    // 证件照（D-252）：ML Kit 人脸检测（模型打包进 App）；换底色用上面的主体分割（Google Play 服务的模型）。
    AsyncFunction("detectFaces") { uri: String -> FaceFinder.detect(context, Uri.parse(uri)) }

    // 照片里是什么（没有文字的照片做推荐用）：ML Kit 图像标注，见 ImageClassifier。后台线程跑，取消时轮询结束。
    AsyncFunction("classifyImage") { taskId: String, uri: String, options: ClassifyOptions, promise: Promise ->
      thread(name = "morph-classify") {
        try {
          promise.resolve(
            ImageClassifier.classify(context, Uri.parse(uri), taskId, options.maxResults, options.minConfidence)
          )
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Throwable) {
          promise.reject(VisionFailedException(e.message))
        }
      }
    }

    Function("cancelClassify") { taskId: String -> ImageClassifier.cancel(taskId) }

    AsyncFunction("adjustImage") { uri: String, options: Map<String, Any?>, format: String, output: String ->
      ImageAdjustment.adjust(context, Uri.parse(uri), options, format, File(Uri.parse(output).path!!))
    }

    Function("canFindPaper") { false }

    // 文档扫描在 Google Play 服务里，没有 Google Play 服务的手机用不了。
    Function("isDocumentCameraSupported") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
        ConnectionResult.SUCCESS
    }

    Function("isCameraAvailable") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }

    Function("supportsLanguage") { code: String -> recognizerFor(code) != null }

    AsyncFunction("supportedLanguages") {
      LATIN.toList() + listOf("zh-Hans", "zh-Hant", "ja", "ko")
    }

    // languages 是 BCP 47，第一种是用户选的语言，决定用哪个识别器（中日韩识别器也认拉丁字母）。
    AsyncFunction("recognizeText") { uri: String, languages: List<String> ->
      val first = languages.firstOrNull() ?: ""
      val recognizer = recognizerFor(first) ?: throw UnsupportedLanguageException(first)
      try {
        val image = InputImage.fromFilePath(context, Uri.parse(uri))
        val result = Tasks.await(recognizer.process(image))
        val lines = result.textBlocks.flatMap { block ->
          block.lines.mapNotNull { line -> line.boundingBox?.let { TextLine(line.text, it) } }
        }
        // 每行的位置（D-195）：像素，原点在左上角；框是按拍摄方向摆正后的坐标，宽高也按摆正后的给。
        val turned = image.rotationDegrees == 90 || image.rotationDegrees == 270
        val items = lines.map {
          mapOf(
            "text" to it.text,
            "x" to it.box.left.toDouble(),
            "y" to it.box.top.toDouble(),
            "width" to it.box.width().toDouble(),
            "height" to it.box.height().toDouble(),
          )
        }
        mapOf(
          "text" to layout(lines),
          "lines" to lines.size,
          "languages" to listOf(first),
          "width" to (if (turned) image.height else image.width),
          "height" to (if (turned) image.width else image.height),
          "items" to items,
        )
      } catch (e: Exception) {
        throw VisionFailedException(e.message)
      } finally {
        recognizer.close()
      }
    }

    // 系统文档扫描（ML Kit）：实时找边、自动拍、多页、可以从相册导入，拍完已经拉正。
    // 每页存成 JPG（长边不超过 maxSide）放在 directory 里；用户取消时返回 null。
    AsyncFunction("scanDocuments") { directory: String, maxSide: Int, quality: Double, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || pendingScan != null) {
        promise.reject(DocumentCameraUnavailableException())
        return@AsyncFunction
      }
      val options = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()
      GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
        .addOnSuccessListener { intentSender ->
          pendingScan = PendingScan(promise, File(Uri.parse(directory).path!!), maxSide, quality)
          activity.startIntentSenderForResult(intentSender, SCAN_REQUEST, null, 0, 0, 0)
        }
        .addOnFailureListener { promise.reject(DocumentCameraUnavailableException()) }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != SCAN_REQUEST) return@OnActivityResult
      val pending = pendingScan ?: return@OnActivityResult
      pendingScan = null
      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      if (payload.resultCode != Activity.RESULT_OK || result == null) {
        pending.promise.resolve(null)
        return@OnActivityResult
      }
      // 解码和编码放到后台，不卡界面。
      thread {
        try {
          pending.promise.resolve(savePages(result, pending))
        } catch (e: Exception) {
          pending.promise.reject(VisionFailedException(e.message))
        }
      }
    }
  }

  private fun recognizerFor(code: String): TextRecognizer? {
    val lang = code.substringBefore('-')
    return when {
      lang == "zh" -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
      lang == "ja" -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
      lang == "ko" -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
      lang in LATIN -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      else -> null
    }
  }

  private fun savePages(result: GmsDocumentScanningResult, pending: PendingScan): List<Map<String, Any>> {
    pending.directory.mkdirs()
    return (result.pages ?: emptyList()).mapIndexed { i, page ->
      val bitmap = decodeScaled(page.imageUri, pending.maxSide)
      val file = File(pending.directory, "page-${i + 1}.jpg")
      FileOutputStream(file).use {
        bitmap.compress(Bitmap.CompressFormat.JPEG, (pending.quality * 100).roundToInt(), it)
      }
      val saved = mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "width" to bitmap.width,
        "height" to bitmap.height,
        "size" to file.length().toInt(),
      )
      bitmap.recycle()
      saved
    }
  }

  /** 先按 2 的幂缩小解码（省内存），再精确缩到长边 maxSide。 */
  private fun decodeScaled(uri: Uri, maxSide: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = context.contentResolver.openInputStream(uri).use {
      BitmapFactory.decodeStream(it, null, options)
    } ?: throw VisionFailedException("could not decode page")
    val side = max(decoded.width, decoded.height)
    if (side <= maxSide) return decoded
    val k = maxSide.toDouble() / side
    val scaled = Bitmap.createScaledBitmap(
      decoded, (decoded.width * k).roundToInt(), (decoded.height * k).roundToInt(), true,
    )
    decoded.recycle()
    return scaled
  }
}

private class TextLine(val text: String, val box: Rect)

/**
 * 和 iOS 一样排版：同一高度的几段（收据上的品名和价格）放在一行，用空格隔开；
 * 行距明显变大时空一行。ML Kit 的坐标原点在左上角，y 越大越靠下。
 */
private fun layout(lines: List<TextLine>): String {
  val sorted = lines.sortedBy { it.box.exactCenterY() }
  val rows = mutableListOf<MutableList<TextLine>>()
  for (line in sorted) {
    val first = rows.lastOrNull()?.firstOrNull()
    if (first != null) {
      val overlap = min(first.box.bottom, line.box.bottom) - max(first.box.top, line.box.top)
      if (overlap >= 0.5 * min(first.box.height(), line.box.height())) {
        rows.last().add(line)
        continue
      }
    }
    rows.add(mutableListOf(line))
  }
  val heights = sorted.map { it.box.height() }.sorted()
  val typical = if (heights.isEmpty()) 0 else heights[heights.size / 2]
  val out = mutableListOf<String>()
  var previousBottom: Int? = null
  for (row in rows) {
    out.add(row.sortedBy { it.box.left }.joinToString(" ") { it.text }.let { text ->
      val top = row.minOf { it.box.top }
      val prev = previousBottom
      previousBottom = row.maxOf { it.box.bottom }
      if (prev != null && top - prev > 1.2 * typical) "\n$text" else text
    })
  }
  return out.joinToString("\n")
}
