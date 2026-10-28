package expo.modules.morphtts

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WavTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun pcm(vararg samples: Int): ByteArray =
    ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
      .apply { samples.forEach { putShort(it.toShort()) } }.array()

  private fun wav(name: String, data: ByteArray, rate: Int = 24000, channels: Int = 1, dataSize: Long = data.size.toLong()): File =
    tmp.newFile(name).apply { writeBytes(Wav.header(channels, rate, 16, dataSize) + data) }

  /** 有的引擎在 fmt 和 data 之间写一个 LIST 块。 */
  private fun wavWithList(name: String, data: ByteArray): File {
    val plain = Wav.header(1, 24000, 16, data.size.toLong())
    val list = "LIST".toByteArray() + byteArrayOf(3, 0, 0, 0) + "abc".toByteArray() + byteArrayOf(0)
    return tmp.newFile(name).apply { writeBytes(plain.copyOfRange(0, 36) + list + plain.copyOfRange(36, 44) + data) }
  }

  @Test
  fun readsTheFormatAndWhereTheDataIs() {
    val info = Wav.read(wav("a.wav", pcm(1, 2, 3, 4)))
    assertEquals(WavInfo(1, 24000, 16, 44, 8), info)
    assertEquals(8 * 1000.0 / 48000, info.durationMs, 1e-9)
  }

  @Test
  fun skipsOtherChunksWithTheirPadByte() {
    val info = Wav.read(wavWithList("b.wav", pcm(5, 6)))
    assertEquals(4L, info.dataSize)
    assertEquals(44L + 12, info.dataOffset)
  }

  @Test
  fun usesTheFileLengthWhenTheEngineLeftTheDataSizeOpen() {
    assertEquals(6L, Wav.read(wav("c.wav", pcm(1, 2, 3), dataSize = 0)).dataSize)
    assertEquals(6L, Wav.read(wav("d.wav", pcm(1, 2, 3), dataSize = 0xFFFFFFFFL)).dataSize)
  }

  @Test
  fun joinsTheSamplesInOrderUnderOneHeader() {
    val out = File(tmp.root, "out/joined.wav")
    val info = Wav.join(listOf(wav("1.wav", pcm(1, 2)), wavWithList("2.wav", pcm(3)), wav("3.wav", pcm())), out)
    assertEquals(6L, info.dataSize)
    val bytes = out.readBytes()
    assertArrayEquals(Wav.header(1, 24000, 16, 6), bytes.copyOfRange(0, 44))
    assertArrayEquals(pcm(1, 2, 3), bytes.copyOfRange(44, bytes.size))
    assertEquals(info, Wav.read(out))
  }

  @Test
  fun refusesSegmentsWithDifferentFormats() {
    val a = wav("e.wav", pcm(1), rate = 24000)
    val b = wav("f.wav", pcm(1), rate = 22050)
    assertThrows(IOException::class.java) { Wav.join(listOf(a, b), File(tmp.root, "x.wav")) }
  }

  @Test
  fun refusesFilesThatAreNotPcmWav() {
    val junk = tmp.newFile("junk.wav").apply { writeBytes("not a wav at all".toByteArray()) }
    assertThrows(IOException::class.java) { Wav.read(junk) }
    assertThrows(IOException::class.java) { Wav.join(emptyList(), File(tmp.root, "y.wav")) }
  }

  @Test
  fun stopsCopyingWhenCancelled() {
    val out = File(tmp.root, "z.wav")
    assertThrows(InterruptedException::class.java) {
      Wav.join(listOf(wav("g.wav", pcm(1, 2))), out) { true }
    }
  }
}
