package expo.modules.morphtranslate

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.TimeUnit

// 本机翻译的 Android 实现（D-170）：Google ML Kit 翻译 + 语言识别，和 iOS 的 JS 接口相同。
// 翻译的语言模型（每种约 30 MB）不在 App 里：status 报出还没下载的语言，App 先问用户，再调 download。
// ML Kit 只有一种中文（译文是简体），繁体中文报 unsupported。文字只返回给 App，不写日志。

class TranslateUnsupportedException(what: String) :
  CodedException("ERR_TRANSLATE_UNSUPPORTED", "Translation is not available for $what", null)

class TranslateDownloadException(cause: Throwable?) :
  CodedException("ERR_TRANSLATE_DOWNLOAD", "The language model could not be downloaded: ${cause?.message}", cause)

class TranslateFailedException(cause: Throwable?) :
  CodedException("ERR_TRANSLATE_FAILED", "Translation failed: ${cause?.message}", cause)

/** 每种语言模型的大小（ML Kit 文档：约 30 MB），只用来提示用户。 */
private const val MODEL_BYTES = 30L * 1024 * 1024

/** 一种语言最多下载多久：ML Kit 没有网络时会一直等，不会自己报错。 */
private const val DOWNLOAD_TIMEOUT_MINUTES = 10L

class MorphTranslateModule : Module() {
  private val models get() = RemoteModelManager.getInstance()

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  /** 现在有没有能上网的网络（没有时 ML Kit 的下载会一直等，所以先查）。 */
  private fun online(): Boolean {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return true
    val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  override fun definition() = ModuleDefinition {
    Name("MorphTranslate")

    Constants("downloadBytes" to MODEL_BYTES)

    Function("isSupported") { true }

    // 每段文字的语言（BCP 47）；拿不准（und）时返回 null。
    AsyncFunction("detectLanguages") { texts: List<String> ->
      val client = LanguageIdentification.getClient()
      try {
        texts.map { text ->
          val code = Tasks.await(client.identifyLanguage(text))
          if (code == "und") null else code
        }
      } finally {
        client.close()
      }
    }

    AsyncFunction("status") { from: String, to: String ->
      val source = mlkitLanguage(from)
      val target = mlkitLanguage(to)
      if (source == null || target == null || source == target) {
        return@AsyncFunction mapOf("status" to "unsupported")
      }
      val have = downloaded()
      val missing = listOf(from to source, to to target).filter { it.second !in have }.map { it.first }
      if (missing.isEmpty()) mapOf("status" to "installed")
      else mapOf("status" to "download", "missing" to missing)
    }

    // 下载一种语言的模型（不限 Wi-Fi：用户已经在 App 的提示里确认过，提示里建议用 Wi-Fi）。
    AsyncFunction("download") { language: String ->
      val code = mlkitLanguage(language) ?: throw TranslateUnsupportedException(language)
      if (!online()) throw TranslateDownloadException(null)
      try {
        Tasks.await(
          models.download(TranslateRemoteModel.Builder(code).build(), DownloadConditions.Builder().build()),
          DOWNLOAD_TIMEOUT_MINUTES,
          TimeUnit.MINUTES,
        )
      } catch (e: Exception) {
        throw TranslateDownloadException(e)
      }
    }

    AsyncFunction("translate") { texts: List<String>, from: String, to: String ->
      val source = mlkitLanguage(from) ?: throw TranslateUnsupportedException(from)
      val target = mlkitLanguage(to) ?: throw TranslateUnsupportedException(to)
      val translator = Translation.getClient(
        TranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build()
      )
      try {
        // 模型都已下载时不会联网；没下载时这里会失败（App 先调 status / download）。
        val have = downloaded()
        if (source !in have || target !in have) throw TranslateDownloadException(null)
        texts.map { Tasks.await(translator.translate(it)) }
      } catch (e: CodedException) {
        throw e
      } catch (e: Exception) {
        throw TranslateFailedException(e)
      } finally {
        translator.close()
      }
    }

    // 设置里列出和删除已下载的语言（英文是 ML Kit 自带的，不列出）。
    AsyncFunction("downloadedLanguages") {
      downloaded().filter { it != TranslateLanguage.ENGLISH }
        .map { if (it == TranslateLanguage.CHINESE) "zh-Hans" else it }
    }

    AsyncFunction("deleteLanguage") { language: String ->
      val code = mlkitLanguage(language) ?: return@AsyncFunction
      if (code == TranslateLanguage.ENGLISH) return@AsyncFunction
      Tasks.await(models.deleteDownloadedModel(TranslateRemoteModel.Builder(code).build()))
    }
  }

  private fun downloaded(): Set<String> =
    Tasks.await(models.getDownloadedModels(TranslateRemoteModel::class.java)).map { it.language }.toSet()

  /** BCP 47 → ML Kit 的语言代码；ML Kit 只有简体中文。 */
  private fun mlkitLanguage(tag: String): String? {
    val lower = tag.lowercase()
    if (lower.startsWith("zh")) {
      return if (lower.contains("hant") || lower.endsWith("-tw") || lower.endsWith("-hk")) null
      else TranslateLanguage.CHINESE
    }
    return TranslateLanguage.fromLanguageTag(lower.substringBefore('-'))
  }
}
