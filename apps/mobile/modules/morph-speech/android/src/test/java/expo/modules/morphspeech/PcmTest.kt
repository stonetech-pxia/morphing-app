package expo.modules.morphspeech

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

class PcmTest {
  private fun sine(freq: Double, rate: Int, seconds: Double, amp: Float = 0.5f) =
    FloatArray((rate * seconds).toInt()) { (amp * sin(2 * PI * freq * it / rate)).toFloat() }

  private fun resampleAll(input: FloatArray, from: Int, chunk: Int = input.size): FloatArray {
    val out = FloatBuffer()
    val r = Resampler(from)
    var i = 0
    while (i < input.size) {
      val n = minOf(chunk, input.size - i)
      r.push(input.copyOfRange(i, i + n), n) { v, c -> out.append(v, c) }
      i += n
    }
    r.finish { v, c -> out.append(v, c) }
    return out.data.copyOf(out.size)
  }

  @Test
  fun downmixAveragesChannels() {
    val stereo = floatArrayOf(1f, 0f, 0.5f, 0.5f, -1f, 1f)
    assertArrayEquals(floatArrayOf(0.5f, 0.5f, 0f), downmix(stereo, 3, 2), 1e-6f)
  }

  @Test
  fun downsamplingKeepsSpeechAndLength() {
    val input = sine(440.0, 48000, 1.0)
    val out = resampleAll(input, 48000)
    assertEquals(16000, out.size)
    // 中间部分（避开两头的滤波器边缘）音量不变：正弦波的均方根是振幅的 0.707 倍。
    assertEquals(0.5 * 0.7071, rms(out, 1000, 15000), 0.01)
  }

  @Test
  fun downsamplingRemovesSoundAboveTheNewNyquist() {
    // 12 kHz 在 16 kHz 采样下会混叠成 4 kHz 的杂音，要先滤掉。
    val out = resampleAll(sine(12000.0, 48000, 1.0), 48000)
    assertTrue("rms ${rms(out, 1000, 15000)}", rms(out, 1000, 15000) < 0.02)
  }

  @Test
  fun chunkedInputGivesTheSameOutput() {
    val input = sine(300.0, 44100, 0.7)
    val whole = resampleAll(input, 44100)
    val chunked = resampleAll(input, 44100, chunk = 1000)
    assertEquals(whole.size, chunked.size)
    for (i in whole.indices) assertTrue("sample $i", abs(whole[i] - chunked[i]) < 1e-5f)
  }

  @Test
  fun upsamplingFrom8kHz() {
    val out = resampleAll(sine(300.0, 8000, 1.0), 8000)
    assertEquals(16000, out.size)
    assertEquals(0.5 * 0.7071, rms(out, 1000, 15000), 0.01)
  }

  @Test
  fun sameRatePassesThrough() {
    val input = sine(300.0, 16000, 0.1)
    assertArrayEquals(input, resampleAll(input, 16000), 0f)
  }

  @Test
  fun quietestPointFindsTheGap() {
    val samples = sine(200.0, 16000, 2.0)
    for (i in 20000 until 22000) samples[i] = 0f
    val split = quietestPoint(samples, 16000, 32000, 1600)
    assertTrue("split $split", split in 20000..22000)
  }
}
