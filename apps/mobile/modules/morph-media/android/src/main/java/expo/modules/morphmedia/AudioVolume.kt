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
    // MediaExtractor 的音轨可能晚于画面开始：补齐时间戳间隙，再做两遍相同的分析/写入。
    fun visit(sink: (PcmChunk) -> Unit) {
      var position = 0L
      var sourceRate = 0
      var sourceChannels = 0
      fun pad(to: Long) {
        while (position < to) {
          if (cancelled.get()) throw MediaCancelledException()
          val frames = minOf(to - position, 4096L).toInt()
          sink(PcmChunk(ShortArray(frames * sourceChannels), frames * sourceChannels, sourceChannels, sourceRate, position * 1000000 / sourceRate))
          position += frames
        }
      }
      AudioPcm.decode(context, uri, 0, Long.MAX_VALUE, { cancelled.get() }) { chunk ->
        if (sourceRate == 0) { sourceRate = chunk.sampleRate; sourceChannels = chunk.channels }
        if (sourceRate != chunk.sampleRate || sourceChannels != chunk.channels) throw MediaUnsupportedException("audio format changed")
        val end = (durationMs * sourceRate / 1000).toLong()
        val start = chunk.ptsUs * sourceRate / 1000000
        pad(minOf(end, maxOf(0, start)))
        val skip = maxOf(0, position - start).toInt()
        val frames = minOf((chunk.count / sourceChannels - skip).toLong(), end - position).coerceAtLeast(0).toInt()
        if (frames > 0) {
          val samples = chunk.samples.copyOfRange(skip * sourceChannels, (skip + frames) * sourceChannels)
          sink(PcmChunk(samples, samples.size, sourceChannels, sourceRate, position * 1000000 / sourceRate))
          position += frames
        }
      }
      if (sourceRate > 0) pad((durationMs * sourceRate / 1000).toLong())
    }
    try {
      visit { chunk ->
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
        visit { chunk ->
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
