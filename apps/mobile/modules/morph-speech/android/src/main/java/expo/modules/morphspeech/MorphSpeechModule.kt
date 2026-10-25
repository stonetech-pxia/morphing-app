package expo.modules.morphspeech

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

// 语音转文字的 Android 实现（D-151）：系统不能识别音频文件，用编进 App 的 whisper.cpp 在本机识别，
// 模型来自下载内容（JS 传模型文件的地址进来）。和 iOS 的 JS 接口相同。识别出的文字只返回给 App，不写日志。

class SpeechException(code: String, message: String) : CodedException(code, message, null)

class TranscribeOptions : Record {
  @Field val taskId: String = ""
  @Field val language: String = ""
  @Field val model: String? = null
  @Field val vad: String? = null
  @Field val prompt: String? = null
  @Field val timed: Boolean = false
}

/** 一次交给 whisper 的声音最长 5 分钟（约 19 MB），在最后 20 秒里最安静的地方切开。 */
private const val CHUNK_SAMPLES = 300 * WHISPER_RATE
private const val SEARCH_SAMPLES = 20 * WHISPER_RATE
private const val QUIET_WINDOW = WHISPER_RATE * 3 / 10

class MorphSpeechModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private val cancelled = ConcurrentHashMap<String, AtomicBoolean>()
  private val handles = ConcurrentHashMap<String, Long>()

  override fun definition() = ModuleDefinition {
    Name("MorphSpeech")

    Events("onProgress")

    Constant("engine") { "whisper" }

    AsyncFunction("supportedLanguages") { WhisperNative.languages().toList() }

    // 模型由下载内容管理：whisper 认识的语言都算「已经有了」。
    AsyncFunction("languageStatus") { language: String ->
      if (WhisperNative.languages().contains(language)) "installed" else "unsupported"
    }

    AsyncFunction("prepareLanguage") { _: String, _: String -> }

    AsyncFunction("transcribe") { uri: String, options: TranscribeOptions, promise: Promise ->
      val flag = AtomicBoolean(false)
      cancelled[options.taskId] = flag
      thread(name = "morph-speech") {
        try {
          promise.resolve(transcribe(uri, options, flag))
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: UnreadableAudio) {
          promise.reject(SpeechException("ERR_SPEECH_UNREADABLE_AUDIO", "Could not read the audio: ${e.message}"))
        } catch (e: Throwable) {
          promise.reject(SpeechException("ERR_SPEECH_FAILED", e.message ?: e.toString()))
        } finally {
          cancelled.remove(options.taskId)
        }
      }
    }

    Function("cancel") { taskId: String ->
      cancelled[taskId]?.set(true)
      handles[taskId]?.let { WhisperNative.cancel(it) }
    }

    // 边读边算 SHA-256，一次 1 MB。
    AsyncFunction("sha256File") { uri: String, promise: Promise ->
      thread(name = "morph-sha256") {
        try {
          val digest = MessageDigest.getInstance("SHA-256")
          FileInputStream(fileOf(uri)).use { input ->
            val chunk = ByteArray(1 shl 20)
            while (true) {
              val n = input.read(chunk)
              if (n < 0) break
              digest.update(chunk, 0, n)
            }
          }
          promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
        } catch (e: Throwable) {
          promise.reject(SpeechException("ERR_SPEECH_FAILED", e.message ?: e.toString()))
        }
      }
    }
  }

  private fun fileOf(uri: String): File = if (uri.startsWith("file://")) File(Uri.parse(uri).path!!) else File(uri)

  private fun transcribe(uri: String, options: TranscribeOptions, flag: AtomicBoolean): Map<String, Any> {
    val modelPath = options.model?.let { fileOf(it).path }
      ?: throw SpeechException("ERR_SPEECH_MODEL", "No speech model")
    if (!WhisperNative.languages().contains(options.language)) {
      throw SpeechException("ERR_SPEECH_UNSUPPORTED_LANGUAGE", "Speech recognition does not support ${options.language}")
    }
    val handle = WhisperNative.init(modelPath, options.vad?.let { fileOf(it).path })
    if (handle == 0L) throw SpeechException("ERR_SPEECH_MODEL", "Could not load the speech model")
    handles[options.taskId] = handle
    try {
      val decoder = AudioDecoder(context, Uri.parse(uri))
      val pending = FloatBuffer()
      val segments = mutableListOf<Map<String, Any>>()
      /** 已经识别完的声音有多少个样本（下一段的时间从这里算起）。 */
      var offset = 0L
      val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)

      fun emit(fraction: Double) {
        sendEvent("onProgress", mapOf("taskId" to options.taskId, "fraction" to fraction.coerceIn(0.0, 1.0)))
      }

      fun run(count: Int) {
        if (flag.get()) throw cancelledError()
        val total = (decoder.durationUs * WHISPER_RATE / 1_000_000).coerceAtLeast(offset + count)
        // whisper 的进度回调在它自己的线程上：这里每半秒看一次，换算成整个文件的进度。
        val done = AtomicBoolean(false)
        val ticker = thread(name = "morph-speech-progress") {
          while (!done.get()) {
            emit((offset + count * WhisperNative.progress(handle) / 100.0) / total)
            try {
              Thread.sleep(500)
            } catch (_: InterruptedException) {
              break
            }
          }
        }
        val n = WhisperNative.transcribe(
          handle, pending.data, count, options.language, options.prompt, threads)
        done.set(true)
        ticker.interrupt()
        if (n == -1 || flag.get()) throw cancelledError()
        if (n < 0) throw SpeechException("ERR_SPEECH_FAILED", "whisper failed")
        val baseMs = offset * 1000 / WHISPER_RATE
        for (i in 0 until n) {
          val text = String(WhisperNative.segmentText(handle, i), Charsets.UTF_8)
          if (text.isBlank()) continue
          segments += mapOf(
            "startMs" to (baseMs + WhisperNative.segmentStart(handle, i)).toDouble(),
            "endMs" to (baseMs + WhisperNative.segmentEnd(handle, i)).toDouble(),
            "text" to text,
          )
        }
        offset += count
        pending.dropFirst(count)
        emit(offset.toDouble() / total)
      }

      decoder.decode({ flag.get() }) { values, count ->
        pending.append(values, count)
        if (pending.size >= CHUNK_SAMPLES + SEARCH_SAMPLES) {
          run(quietestPoint(pending.data, CHUNK_SAMPLES, CHUNK_SAMPLES + SEARCH_SAMPLES, QUIET_WINDOW))
        }
      }
      if (flag.get()) throw cancelledError()
      // 短于 0.1 秒的尾巴不识别。
      if (pending.size > WHISPER_RATE / 10) run(pending.size)
      val durationMs = maxOf(decoder.durationUs / 1000, (offset + pending.size) * 1000 / WHISPER_RATE)
      if (durationMs <= 0) throw UnreadableAudio("empty")
      return mapOf("segments" to segments, "durationMs" to durationMs.toDouble())
    } finally {
      handles.remove(options.taskId)
      WhisperNative.free(handle)
    }
  }

  private fun cancelledError() = SpeechException("ERR_SPEECH_CANCELLED", "Cancelled")
}
