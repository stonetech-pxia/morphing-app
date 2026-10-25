package expo.modules.morphmedia

import android.content.Context
import android.net.Uri
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/** 两遍流式解码：先测 LUFS/峰值，再把安全增益写进临时 PCM 文件。 */
object AudioVolume {
  fun prepare(context: Context, uri: Uri, output: File, automatic: Boolean, db: Double,
              cancelled: AtomicBoolean, durationMs: Double, progress: (Double) -> Unit) {
    var handle = 0L
    var rate = 0
    var channels = 0
    try {
      AudioPcm.visitTimeline(context, uri, durationMs, { cancelled.get() }) { chunk ->
        if (handle == 0L) {
          rate = chunk.sampleRate
          channels = chunk.channels
          handle = AudioDsp.nativeCreate(rate, channels)
          if (handle == 0L) throw MediaFailedException("loudness meter")
        }
        if (chunk.sampleRate != rate || chunk.channels != channels) throw MediaUnsupportedException("audio format changed")
        if (AudioDsp.nativeAdd(handle, chunk.samples, chunk.count) != 0) throw MediaFailedException("loudness analysis")
      }
      if (cancelled.get()) throw MediaCancelledException()
      if (handle == 0L) throw MediaUnsupportedException("no audio decoded")
      val gain = AudioDsp.nativeGain(handle, automatic, db)
      progress(0.25)
      val writer = AudioPcm.WavWriter(output)
      var complete = false
      try {
        AudioPcm.visitTimeline(context, uri, durationMs, { cancelled.get() }) { chunk ->
          if (chunk.sampleRate != rate || chunk.channels != channels) throw MediaUnsupportedException("audio format changed")
          val adjusted = ShortArray(chunk.count) { i -> (chunk.samples[i].toDouble() * gain).roundToInt().coerceIn(-32768, 32767).toShort() }
          writer.write(adjusted, channels, rate)
        }
        complete = true
      } finally { if (complete) writer.close() else runCatching { writer.close() } }
      if (cancelled.get()) throw MediaCancelledException()
      progress(0.5)
    } finally { if (handle != 0L) AudioDsp.nativeDestroy(handle) }
  }
}
