package expo.modules.morphmedia

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// 视频和音频的 Android 实现（D-132）：和 iOS 的 JS 接口相同。
// - probe：MediaExtractor（编码、码率、采样率、HDR）+ MediaMetadataRetriever（时长、宽高、方向）。
// - transcode：Media3 Transformer，H.264 + AAC 写 MP4，指定码率；缩小用 Presentation，限帧率用
//   FrameDropEffect，HDR 用 OpenGL 转成普通画面。
// - trim：Transformer 的剪切优化（只重新编码开头一小段，其余原样搬过去）。
// - thumbnails：MediaMetadataRetriever。
// 全部在本机处理，不联网。分享进来的 content:// 地址直接读，不复制。

class MediaUnsupportedException(detail: String?) :
  CodedException("ERR_MEDIA_UNSUPPORTED", "This media can't be opened: $detail", null)

class MediaCancelledException : CodedException("ERR_MEDIA_CANCELLED", "Cancelled", null)

class NotImplementedException(what: String) :
  CodedException("ERR_NOT_IMPLEMENTED", "Not implemented yet: $what", null)

class MediaFailedException(detail: String?) :
  CodedException("ERR_MEDIA_FAILED", "Processing failed: $detail", null)

@OptIn(markerClass = [UnstableApi::class])
class MorphMediaModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private val main = Handler(Looper.getMainLooper())

  /** 正在进行的任务（只在主线程读写）。 */
  private val jobs = mutableMapOf<String, Transformer>()
  private val cancelled = mutableSetOf<String>()

  override fun definition() = ModuleDefinition {
    Name("MorphMedia")

    Events("progress")

    AsyncFunction("probe") { uri: String, promise: Promise ->
      thread {
        try {
          promise.resolve(probe(Uri.parse(uri)))
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Exception) {
          promise.reject(MediaUnsupportedException(e.message))
        }
      }
    }

    AsyncFunction("transcode") {
      jobId: String, uri: String, output: String, options: Map<String, Any?>, promise: Promise ->
      try {
        val transformer = buildTranscode(Uri.parse(uri), options)
        run(jobId, transformer.first, transformer.second, File(Uri.parse(output).path!!), promise)
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(MediaFailedException(e.message))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("trim") {
      jobId: String, uri: String, output: String, range: Map<String, Double>, promise: Promise ->
      val start = range["startMs"]
      val end = range["endMs"]
      if (start == null || end == null || end <= start) {
        promise.reject(MediaFailedException("range"))
        return@AsyncFunction
      }
      val source = Uri.parse(uri)
      // 先在后台读格式：手机没有能按原尺寸编码这种格式（例如 HEVC）的编码器时，Transformer 会
      // 悄悄退到很小的分辨率（模拟器实测 1080×1920 的 HEVC 变成 270×480），这时改用 H.264。
      thread {
        val info = try {
          probe(source)
        } catch (e: CodedException) {
          promise.reject(e)
          return@thread
        }
        main.post {
          val item = MediaItem.Builder()
            .setUri(source)
            .setClippingConfiguration(
              MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs(start.toLong())
                .setEndPositionMs(end.toLong())
                .build()
            )
            .build()
          // 不改编码、不加效果：只重新编码开头到第一个关键帧的一小段，其余原样搬过去。
          val builder = Transformer.Builder(context).experimentalSetTrimOptimizationEnabled(true)
          val codec = (info["videoCodec"] as? String)?.let { "video/$it" }
          val width = (info["width"] as? Int) ?: 0
          val height = (info["height"] as? Int) ?: 0
          if (codec != null && !canEncode(codec, width, height)) {
            builder.setVideoMimeType(MimeTypes.VIDEO_H264)
          }
          val composition = Composition.Builder(
            EditedMediaItemSequence.withAudioAndVideoFrom(listOf(EditedMediaItem.Builder(item).build()))
          ).build()
          run(jobId, builder.build(), composition, File(Uri.parse(output).path!!), promise)
        }
      }
    }

    AsyncFunction("thumbnails") {
      uri: String, timesMs: List<Double>, maxSide: Double, directory: String, promise: Promise ->
      thread {
        try {
          promise.resolve(thumbnails(Uri.parse(uri), timesMs, maxSide.roundToInt(), File(Uri.parse(directory).path!!)))
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Exception) {
          promise.reject(MediaUnsupportedException(e.message))
        }
      }
    }

    Function("cancel") { jobId: String ->
      main.post {
        cancelled.add(jobId)
        jobs[jobId]?.cancel()
      }
    }
  }

  // ---- 任务 ----

  /** 在主线程开始导出，轮询进度，完成后读一遍输出文件的信息。 */
  private fun run(
    jobId: String,
    transformer: Transformer,
    composition: Composition,
    output: File,
    promise: Promise,
  ) {
    if (cancelled.remove(jobId)) {
      promise.reject(MediaCancelledException())
      return
    }
    output.parentFile?.mkdirs()
    output.delete()
    val holder = ProgressHolder()
    val poll = object : Runnable {
      override fun run() {
        if (!jobs.containsKey(jobId)) return
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          sendProgress(jobId, holder.progress / 100.0)
        }
        main.postDelayed(this, 250)
      }
    }
    transformer.addListener(object : Transformer.Listener {
      override fun onCompleted(composition: Composition, exportResult: ExportResult) {
        jobs.remove(jobId)
        cancelled.remove(jobId)
        sendProgress(jobId, 1.0)
        thread {
          try {
            promise.resolve(result(output))
          } catch (e: Exception) {
            promise.reject(MediaFailedException(e.message))
          }
        }
      }

      override fun onError(
        composition: Composition,
        exportResult: ExportResult,
        exportException: ExportException,
      ) {
        jobs.remove(jobId)
        output.delete()
        if (cancelled.remove(jobId)) {
          promise.reject(MediaCancelledException())
          return
        }
        promise.reject(
          when (exportException.errorCode) {
            ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            ExportException.ERROR_CODE_IO_FILE_NOT_FOUND,
            ExportException.ERROR_CODE_IO_NO_PERMISSION -> MediaUnsupportedException(exportException.message)
            else -> MediaFailedException(exportException.errorCodeName)
          }
        )
      }
    })
    jobs[jobId] = transformer
    try {
      transformer.start(composition, output.absolutePath)
    } catch (e: Exception) {
      jobs.remove(jobId)
      promise.reject(MediaFailedException(e.message))
      return
    }
    main.post(poll)
  }

  private fun sendProgress(jobId: String, value: Double) {
    sendEvent("progress", mapOf("jobId" to jobId, "progress" to value.coerceIn(0.0, 1.0)))
  }

  @Suppress("UNCHECKED_CAST")
  private fun buildTranscode(uri: Uri, options: Map<String, Any?>): Pair<Transformer, Composition> {
    val container = options["container"] as? String ?: "mp4"
    val video = options["video"] as? Map<String, Any?>
    if (container != "mp4" || video == null) throw NotImplementedException("transcode to $container")
    val audio = options["audio"] as? Map<String, Any?>
    val dropAudio = options["audio"] == "drop"
    if (audio == null && !dropAudio) throw NotImplementedException("audio settings")
    if (audio != null && (audio["codec"] as? String ?: "aac") != "aac") {
      throw NotImplementedException("audio codec ${audio["codec"]}")
    }

    val itemBuilder = MediaItem.Builder().setUri(uri)
    (options["range"] as? Map<String, Any?>)?.let { range ->
      val start = (range["startMs"] as Number).toLong()
      val end = (range["endMs"] as Number).toLong()
      itemBuilder.setClippingConfiguration(
        MediaItem.ClippingConfiguration.Builder().setStartPositionMs(start).setEndPositionMs(end).build()
      )
    }

    val effects = mutableListOf<androidx.media3.common.Effect>()
    // JS 只在要缩小时才给 maxShortSide（不放大）；H.264 要偶数。
    (video["maxShortSide"] as? Number)?.toInt()?.let { shortSide ->
      effects.add(Presentation.createForShortSide(shortSide / 2 * 2))
    }
    (video["maxFps"] as? Number)?.toFloat()?.let { fps ->
      effects.add(FrameDropEffect.createDefaultFrameDropEffect(fps))
    }

    val edited = EditedMediaItem.Builder(itemBuilder.build())
      .setRemoveAudio(dropAudio)
      .setEffects(Effects(listOf(), effects))
      .build()
    val composition = Composition.Builder(
      if (dropAudio) EditedMediaItemSequence.withVideoFrom(listOf(edited))
      else EditedMediaItemSequence.withAudioAndVideoFrom(listOf(edited))
    )
      // 普通画面（BT.709）：HDR 视频在这里转换，否则发到别处会发灰或过暗。
      .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
      .build()

    val encoders = DefaultEncoderFactory.Builder(context)
      .setEnableFallback(true)
    (video["bitrateKbps"] as? Number)?.let { kbps ->
      encoders.setRequestedVideoEncoderSettings(
        VideoEncoderSettings.Builder().setBitrate((kbps.toDouble() * 1000).roundToInt()).build()
      )
    }
    (audio?.get("bitrateKbps") as? Number)?.let { kbps ->
      encoders.setRequestedAudioEncoderSettings(
        AudioEncoderSettings.Builder().setBitrate((kbps.toDouble() * 1000).roundToInt()).build()
      )
    }
    val transformer = Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(encoders.build())
      .build()
    return transformer to composition
  }

  /** 有没有硬件或软件编码器能按这个尺寸（横竖都试）编码这种格式。 */
  private fun canEncode(mime: String, width: Int, height: Int): Boolean {
    if (width <= 0 || height <= 0) return true
    return MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
      info.isEncoder && info.supportedTypes.any { it.equals(mime, ignoreCase = true) } &&
        runCatching {
          val video = info.getCapabilitiesForType(mime).videoCapabilities
          video != null &&
            (video.isSizeSupported(width, height) || video.isSizeSupported(height, width))
        }.getOrDefault(false)
    }
  }

  // ---- probe ----

  private fun probe(uri: Uri): Map<String, Any?> {
    val info = mutableMapOf<String, Any?>()
    var hasVideo = false
    var hasAudio = false
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, uri, null)
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/") && !hasVideo) {
          hasVideo = true
          info["videoCodec"] = mime.removePrefix("video/")
          if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) {
            info["fps"] = format.getNumber(MediaFormat.KEY_FRAME_RATE)?.toDouble()
          }
          if (format.containsKey(MediaFormat.KEY_BIT_RATE)) {
            info["videoBitrateKbps"] = format.getInteger(MediaFormat.KEY_BIT_RATE) / 1000.0
          }
          if (format.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) {
            val transfer = format.getInteger(MediaFormat.KEY_COLOR_TRANSFER)
            info["hdr"] = transfer == MediaFormat.COLOR_TRANSFER_ST2084 ||
              transfer == MediaFormat.COLOR_TRANSFER_HLG
          } else {
            info["hdr"] = false
          }
        } else if (mime.startsWith("audio/") && !hasAudio) {
          hasAudio = true
          info["audioCodec"] = mime.removePrefix("audio/")
          if (format.containsKey(MediaFormat.KEY_BIT_RATE)) {
            info["audioBitrateKbps"] = format.getInteger(MediaFormat.KEY_BIT_RATE) / 1000.0
          }
          if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
            info["sampleRate"] = format.getInteger(MediaFormat.KEY_SAMPLE_RATE).toDouble()
          }
          if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
            info["channels"] = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
        }
      }
    } catch (e: Exception) {
      throw MediaUnsupportedException(e.message)
    } finally {
      extractor.release()
    }
    if (!hasVideo && !hasAudio) throw MediaUnsupportedException("no tracks")

    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
      info["durationMs"] = duration
      if (hasVideo) {
        val w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        val h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
        val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        val turned = rotation == 90 || rotation == 270
        info["width"] = if (turned) h else w
        info["height"] = if (turned) w else h
        info["rotation"] = rotation
        if (info["videoBitrateKbps"] == null) {
          // 读不到视频码率时用整个文件的码率减去声音。
          val total = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toDoubleOrNull()
          if (total != null) {
            val audioKbps = (info["audioBitrateKbps"] as? Double) ?: 0.0
            info["videoBitrateKbps"] = max(0.0, total / 1000 - audioKbps)
          }
        }
        if (info["fps"] == null && Build.VERSION.SDK_INT >= 28) {
          val frames = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toDoubleOrNull()
          if (frames != null && duration > 0) info["fps"] = frames / (duration / 1000)
        }
      }
    } catch (e: Exception) {
      throw MediaUnsupportedException(e.message)
    } finally {
      retriever.release()
    }
    info["kind"] = if (hasVideo) "video" else "audio"
    info["hasVideo"] = hasVideo
    info["hasAudio"] = hasAudio
    info["size"] = sizeOf(uri)
    return info
  }

  private fun sizeOf(uri: Uri): Long {
    if (uri.scheme == "file" || uri.scheme == null) return File(uri.path!!).length()
    context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
    }
    return context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: 0
  }

  private fun result(output: File): Map<String, Any?> {
    val uri = Uri.fromFile(output)
    return mapOf("uri" to uri.toString(), "size" to output.length(), "info" to probe(uri))
  }

  // ---- thumbnails ----

  private fun thumbnails(uri: Uri, timesMs: List<Double>, maxSide: Int, directory: File): List<String> {
    directory.mkdirs()
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      return timesMs.map { ms ->
        val us = (ms * 1000).toLong()
        val frame = if (Build.VERSION.SDK_INT >= 27) {
          retriever.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxSide, maxSide)
        } else {
          retriever.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { scaled(it, maxSide) }
        } ?: throw MediaUnsupportedException("frame at $ms")
        val file = File(directory, "${UUID.randomUUID()}.jpg")
        FileOutputStream(file).use { frame.compress(Bitmap.CompressFormat.JPEG, 70, it) }
        frame.recycle()
        Uri.fromFile(file).toString()
      }
    } finally {
      retriever.release()
    }
  }

  private fun scaled(bitmap: Bitmap, maxSide: Int): Bitmap {
    val k = min(1.0, maxSide.toDouble() / max(bitmap.width, bitmap.height))
    if (k >= 1.0) return bitmap
    val out = Bitmap.createScaledBitmap(
      bitmap, max(1, (bitmap.width * k).roundToInt()), max(1, (bitmap.height * k).roundToInt()), true
    )
    bitmap.recycle()
    return out
  }
}
