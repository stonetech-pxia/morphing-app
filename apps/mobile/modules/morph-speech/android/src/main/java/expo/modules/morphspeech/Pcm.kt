package expo.modules.morphspeech

import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

// 声音数据的纯计算部分（不依赖 Android，src/test 里有单元测试）：whisper 要 16 kHz 单声道 float。

const val WHISPER_RATE = 16000

/** 交错的多声道 PCM → 单声道（各声道取平均）。 */
fun downmix(interleaved: FloatArray, frames: Int, channels: Int): FloatArray {
  if (channels == 1) return interleaved.copyOf(frames)
  val out = FloatArray(frames)
  for (f in 0 until frames) {
    var sum = 0f
    for (c in 0 until channels) sum += interleaved[f * channels + c]
    out[f] = sum / channels
  }
  return out
}

/**
 * 流式重采样（加窗 sinc 低通 + 插值）：降采样时先滤掉新采样率的奈奎斯特频率以上的声音，免得混叠成杂音。
 * push 一块一块地喂进来，输出也一块一块地交给 sink；最后调 finish 把剩下的输出完。
 */
class Resampler(srcRate: Int, private val dstRate: Int = WHISPER_RATE) {
  /** 每个输出样本前进多少个输入样本。 */
  private val step = srcRate.toDouble() / dstRate
  /** 截止频率（相对输入的奈奎斯特频率）。 */
  private val cutoff = min(1.0, dstRate.toDouble() / srcRate) * 0.95
  /** 每边用多少个输入样本。 */
  private val half = ceil(TAPS / cutoff).toInt()
  private val passthrough = srcRate == dstRate

  private var buf = FloatArray(4096)
  private var bufLen = 0
  /** buf[0] 是第几个输入样本。 */
  private var bufStart = 0L
  private var inputTotal = 0L
  private var nextOut = 0L

  fun push(input: FloatArray, count: Int, sink: (FloatArray, Int) -> Unit) {
    if (passthrough) {
      sink(input, count)
      return
    }
    ensure(bufLen + count)
    System.arraycopy(input, 0, buf, bufLen, count)
    bufLen += count
    inputTotal += count
    produce(sink, flush = false)
  }

  fun finish(sink: (FloatArray, Int) -> Unit) {
    if (passthrough) return
    produce(sink, flush = true)
  }

  private fun produce(sink: (FloatArray, Int) -> Unit, flush: Boolean) {
    // 总输出数 = 输入数 ÷ step（向上取整）；不 flush 时只算右边的样本已经到齐的。
    val limit = if (flush) ceil(inputTotal / step).toLong() else Long.MAX_VALUE
    val out = FloatArray(1024)
    var n = 0
    while (nextOut < limit) {
      val t = nextOut * step
      val center = floor(t).toLong()
      if (!flush && center + half >= bufStart + bufLen) break
      out[n++] = sample(t, center)
      nextOut++
      if (n == out.size) {
        sink(out, n)
        n = 0
      }
    }
    if (n > 0) sink(out, n)
    // 丢掉以后用不到的输入。
    val keepFrom = floor(nextOut * step).toLong() - half
    val drop = (keepFrom - bufStart).toInt().coerceIn(0, bufLen)
    if (drop > 0) {
      System.arraycopy(buf, drop, buf, 0, bufLen - drop)
      bufLen -= drop
      bufStart += drop
    }
  }

  private fun sample(t: Double, center: Long): Float {
    var sum = 0.0
    for (k in center - half + 1..center + half) {
      val i = (k - bufStart).toInt()
      if (i < 0 || i >= bufLen) continue
      val x = t - k
      sum += buf[i] * kernel(x)
    }
    return sum.toFloat()
  }

  private fun kernel(x: Double): Double {
    val u = x / half
    if (u <= -1 || u >= 1) return 0.0
    val window = 0.5 * (1 + cos(PI * u))
    val y = cutoff * x
    val sinc = if (y == 0.0) 1.0 else sin(PI * y) / (PI * y)
    return cutoff * sinc * window
  }

  private fun ensure(capacity: Int) {
    if (capacity <= buf.size) return
    buf = buf.copyOf(maxOf(capacity, buf.size * 2))
  }

  private companion object {
    const val TAPS = 8.0
  }
}

/** 一直变长的 float 数组。 */
class FloatBuffer(initial: Int = 1 shl 16) {
  var data = FloatArray(initial)
    private set
  var size = 0
    private set

  fun append(values: FloatArray, count: Int) {
    if (size + count > data.size) data = data.copyOf(maxOf(size + count, data.size * 2))
    System.arraycopy(values, 0, data, size, count)
    size += count
  }

  /** 去掉前 count 个。 */
  fun dropFirst(count: Int) {
    System.arraycopy(data, count, data, 0, size - count)
    size -= count
  }
}

/**
 * 在 [from, to) 里找最安静的一小段（window 个样本，看均方根），返回它的中间位置。
 * 长录音分段识别时在这里切开，尽量不切在一个词中间。
 */
fun quietestPoint(samples: FloatArray, from: Int, to: Int, window: Int): Int {
  if (to - from <= window) return (from + to) / 2
  var energy = 0.0
  for (i in from until from + window) energy += samples[i] * samples[i]
  var best = energy
  var bestStart = from
  for (start in from + 1..to - window) {
    val out = samples[start - 1]
    val inn = samples[start + window - 1]
    energy += inn * inn - out * out
    if (energy < best) {
      best = energy
      bestStart = start
    }
  }
  return bestStart + window / 2
}

/** 均方根，测试和调试用。 */
fun rms(samples: FloatArray, from: Int = 0, to: Int = samples.size): Double {
  var sum = 0.0
  for (i in from until to) sum += samples[i] * samples[i]
  return sqrt(sum / (to - from))
}
