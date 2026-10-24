package expo.modules.morphmedia

import java.io.ByteArrayOutputStream
import java.util.Random
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// GIF 编码器（D-184）：编出来的文件用一个独立写的小解码器读回来（Android 单元测试里没有 javax.imageio），
// 帧数、尺寸、颜色都要对得上。电脑上用系统 GIF 解码器（ImageIO、macOS sips）也检查过同样的输出。
class GifEncoderTest {
  private val w = 241
  private val h = 137

  private fun encode(frames: List<IntArray>): ByteArray {
    val out = ByteArrayOutputStream()
    val encoder = GifEncoder(out, w, h)
    for (f in frames) encoder.addFrame(f, 100)
    encoder.finish()
    return out.toByteArray()
  }

  /** 只认这个编码器写出的结构：没有全局调色板，每帧一个图形控制扩展 + 256 色局部调色板。 */
  private fun decode(gif: ByteArray): List<IntArray> {
    var p = 0
    fun u8() = gif[p++].toInt() and 0xFF
    fun u16() = u8() or (u8() shl 8)
    assertEquals("GIF89a", String(gif, 0, 6, Charsets.US_ASCII))
    p = 6
    assertEquals(w, u16())
    assertEquals(h, u16())
    p += 3
    val frames = mutableListOf<IntArray>()
    while (true) {
      when (u8()) {
        0x21 -> {
          u8()
          while (true) {
            val size = u8()
            if (size == 0) break
            p += size
          }
        }
        0x2C -> {
          p += 8
          val flags = u8()
          val palette = IntArray(2 shl (flags and 7)) { (u8() shl 16) or (u8() shl 8) or u8() }
          val minCode = u8()
          val data = ByteArrayOutputStream()
          while (true) {
            val size = u8()
            if (size == 0) break
            data.write(gif, p, size)
            p += size
          }
          frames += lzwDecode(data.toByteArray(), minCode, w * h).map { palette[it] }.toIntArray()
        }
        0x3B -> return frames
        else -> throw AssertionError("bad block")
      }
    }
  }

  private fun lzwDecode(data: ByteArray, minCode: Int, count: Int): IntArray {
    val clear = 1 shl minCode
    val end = clear + 1
    val prefix = IntArray(4096)
    val suffix = IntArray(4096)
    val out = IntArray(count)
    var n = 0
    var codeSize = minCode + 1
    var next = end + 1
    var old = -1
    var bitPos = 0
    fun read(): Int {
      var code = 0
      for (i in 0 until codeSize) {
        val byte = data[(bitPos + i) / 8].toInt()
        if ((byte shr ((bitPos + i) % 8)) and 1 == 1) code = code or (1 shl i)
      }
      bitPos += codeSize
      return code
    }
    fun emit(code: Int): Int {
      val stack = ArrayDeque<Int>()
      var c = code
      while (c >= clear) {
        stack.addFirst(suffix[c])
        c = prefix[c]
      }
      stack.addFirst(c)
      for (v in stack) if (n < count) out[n++] = v
      return stack.first()
    }
    while (bitPos + codeSize <= data.size * 8) {
      val code = read()
      if (code == clear) {
        codeSize = minCode + 1
        next = end + 1
        old = -1
        continue
      }
      if (code == end) break
      if (old < 0) {
        emit(code)
      } else if (code < next) {
        val first = emit(code)
        prefix[next] = old
        suffix[next] = first
        next++
      } else {
        prefix[next] = old
        suffix[next] = firstOf(old, clear, prefix, suffix)
        next++
        emit(code)
      }
      if (next == (1 shl codeSize) && codeSize < 12) codeSize++
      old = code
    }
    assertEquals(count, n)
    return out
  }

  private fun firstOf(code: Int, clear: Int, prefix: IntArray, suffix: IntArray): Int {
    var c = code
    while (c >= clear) c = prefix[c]
    return c
  }

  /** 解码后每帧每个通道的平均误差。 */
  private fun meanErrors(frames: List<IntArray>): List<Double> {
    val decoded = decode(encode(frames))
    assertEquals(frames.size, decoded.size)
    return frames.indices.map { k ->
      var err = 0L
      for (i in 0 until w * h) {
        for (s in intArrayOf(16, 8, 0)) {
          err += abs(((frames[k][i] shr s) and 255) - ((decoded[k][i] shr s) and 255))
        }
      }
      err.toDouble() / (w * h * 3)
    }
  }

  @Test
  fun gradientsSolidAndNoiseDecode() {
    val gradients = (0 until 3).map { f ->
      IntArray(w * h) { i ->
        val x = i % w
        val y = i / w
        (0xFF shl 24) or (((x * 255 / w + f * 30) and 255) shl 16) or ((y * 255 / h) shl 8) or (((x + y) * 3) and 255)
      }
    }
    // 随机噪点：码表很快写满，要发清除码重来。
    val random = Random(1)
    val noise = IntArray(w * h) { 0xFF000000.toInt() or random.nextInt(0xFFFFFF) }
    val solid = IntArray(w * h) { 0xFF336699.toInt() }
    val errors = meanErrors(gradients + listOf(noise, solid))
    errors.take(3).forEach { assertTrue("gradient error $it", it < 12) }
    assertTrue("noise error ${errors[3]}", errors[3] < 16)
    assertTrue("solid error ${errors[4]}", errors[4] < 4)
  }

  @Test
  fun fewColorsAreClose() {
    val colors = intArrayOf(0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0xFF0000FF.toInt(), 0xFFFFFFFF.toInt())
    val frame = IntArray(w * h) { colors[(it / 7) % colors.size] }
    val errors = meanErrors(listOf(frame))
    assertTrue("error ${errors[0]}", errors[0] < 4.5)
  }
}
