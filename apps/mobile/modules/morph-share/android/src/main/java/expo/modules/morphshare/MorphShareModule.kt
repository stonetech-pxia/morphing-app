package expo.modules.morphshare

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlin.concurrent.thread

// 分享和存到文件夹的 Android 实现（D-100、D-101）：
// - 分享：ACTION_SEND_MULTIPLE 一次带上全部文件（content:// 地址，只给读权限）。
// - 存到文件夹：存储访问框架 ACTION_OPEN_DOCUMENT_TREE，用户选文件夹（本机、Google Drive 等文档提供者），
//   逐个 createDocument 并复制。记住上次选的文件夹（P-019、D-104）：申请长期读写授权、把地址存在
//   SharedPreferences，下次直接存进去；换文件夹时放掉旧的授权，文件夹没了或授权被收回时重新让用户选。
// 文件内容和文件名不写日志。

class MorphShareFileProvider : FileProvider()

class SheetBusyException : CodedException("Another share or save sheet is open")

class NoActivityException : CodedException("There is no screen to show the sheet on")

class FolderNotWritableException :
  CodedException("ERR_FOLDER_NOT_WRITABLE", "Files can't be saved into this folder", null)

class ExportFailedException(detail: String?) : CodedException("Saving failed: $detail")

private const val PREFS = "morph_share"
private const val FOLDER_KEY = "folder"
private const val SHARE_REQUEST = 0x4d53
private const val FOLDER_REQUEST = 0x4d46

private class PendingExport(
  val promise: Promise,
  val files: List<File>,
  val names: List<String>,
  val mimeTypes: List<String>,
)

class MorphShareModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private var pendingShare: Promise? = null
  private var pendingExport: PendingExport? = null

  private fun fileOf(uri: String) = File(Uri.parse(uri).path!!)

  override fun definition() = ModuleDefinition {
    Name("MorphShare")

    AsyncFunction("shareFiles") { uris: List<String>, mimeTypes: List<String>, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(NoActivityException())
        return@AsyncFunction
      }
      if (pendingShare != null || pendingExport != null) {
        promise.reject(SheetBusyException())
        return@AsyncFunction
      }
      val authority = "${context.packageName}.MorphShareFileProvider"
      val contentUris = ArrayList(uris.map { FileProvider.getUriForFile(context, authority, fileOf(it)) })
      val intent = if (contentUris.size == 1) {
        Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, contentUris[0])
      } else {
        Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, contentUris)
      }
      intent.type = commonType(mimeTypes)
      // 读权限通过 ClipData 交给选中的 App（只有它，只读）。
      val clip = ClipData.newRawUri(null, contentUris[0])
      for (uri in contentUris.drop(1)) clip.addItem(ClipData.Item(uri))
      intent.clipData = clip
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      pendingShare = promise
      activity.startActivityForResult(Intent.createChooser(intent, null), SHARE_REQUEST)
    }.runOnQueue(Queues.MAIN)

    Function("rememberedFolder") { rememberedFolder()?.second }

    // useRemembered：有记住的文件夹就直接存进去，不弹选择器。
    AsyncFunction("exportFiles") { uris: List<String>, names: List<String>, mimeTypes: List<String>, useRemembered: Boolean, promise: Promise ->
      if (pendingShare != null || pendingExport != null) {
        promise.reject(SheetBusyException())
        return@AsyncFunction
      }
      val pending = PendingExport(promise, uris.map(::fileOf), names, mimeTypes)
      val remembered = if (useRemembered) rememberedFolder() else null
      if (remembered != null) {
        copyInBackground(remembered.first, remembered.second, pending)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(NoActivityException())
        return@AsyncFunction
      }
      pendingExport = pending
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), FOLDER_REQUEST)
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        SHARE_REQUEST -> {
          pendingShare?.resolve(null)
          pendingShare = null
        }
        FOLDER_REQUEST -> {
          val pending = pendingExport ?: return@OnActivityResult
          pendingExport = null
          val tree = payload.data?.data
          if (payload.resultCode != Activity.RESULT_OK || tree == null) {
            pending.promise.resolve(null)
            return@OnActivityResult
          }
          remember(tree)
          copyInBackground(tree, folderName(tree) ?: "", pending)
        }
      }
    }
  }

  // 复制放到后台，不卡界面。结果：存了几个、文件夹名。
  private fun copyInBackground(tree: Uri, name: String, pending: PendingExport) {
    thread {
      try {
        val saved = copyInto(tree, pending)
        pending.promise.resolve(mapOf("saved" to saved, "folder" to name))
      } catch (e: CodedException) {
        pending.promise.reject(e)
      } catch (e: SecurityException) {
        pending.promise.reject(FolderNotWritableException())
      } catch (e: Exception) {
        pending.promise.reject(ExportFailedException(e.message))
      }
    }
  }

  private val prefs
    get() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // 记住的文件夹（地址和名字）；没有、授权被收回或文件夹已经不在了时返回 null（并忘掉它）。
  private fun rememberedFolder(): Pair<Uri, String>? {
    val tree = prefs.getString(FOLDER_KEY, null)?.let(Uri::parse) ?: return null
    val granted = context.contentResolver.persistedUriPermissions.any {
      it.uri == tree && it.isWritePermission
    }
    val name = if (granted) folderName(tree) else null
    if (name == null) {
      forget(tree)
      return null
    }
    return tree to name
  }

  private fun remember(tree: Uri) {
    val old = prefs.getString(FOLDER_KEY, null)?.let(Uri::parse)
    if (old != null && old != tree) forget(old)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      context.contentResolver.takePersistableUriPermission(tree, flags)
      prefs.edit().putString(FOLDER_KEY, tree.toString()).apply()
    } catch (e: SecurityException) {
      // 这个文档提供者不给长期授权：这次照样存，下次再问。
    }
  }

  private fun forget(tree: Uri) {
    prefs.edit().remove(FOLDER_KEY).apply()
    try {
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      context.contentResolver.releasePersistableUriPermission(tree, flags)
    } catch (e: SecurityException) {
      // 本来就没有授权。
    }
  }

  // 文件夹的显示名；文件夹不在了时返回 null。
  private fun folderName(tree: Uri): String? = try {
    val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    context.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
      ?.use { if (it.moveToFirst()) it.getString(0) else null }
  } catch (e: Exception) {
    null
  }

  private fun copyInto(tree: Uri, pending: PendingExport): Int {
    val resolver = context.contentResolver
    val folder = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    for ((i, file) in pending.files.withIndex()) {
      // 同名文件由文档提供者自己改名（例如「报告 (1).pdf」），不会覆盖。
      val doc = DocumentsContract.createDocument(resolver, folder, pending.mimeTypes[i], pending.names[i])
        ?: throw FolderNotWritableException()
      val out = resolver.openOutputStream(doc) ?: throw FolderNotWritableException()
      out.use { sink -> file.inputStream().use { it.copyTo(sink) } }
    }
    return pending.files.size
  }

  // 全部同一种类型就用它；同一大类（都是图片）用 image/*；否则 */*。
  private fun commonType(mimeTypes: List<String>): String {
    val distinct = mimeTypes.distinct()
    if (distinct.size == 1) return distinct[0]
    val groups = distinct.map { it.substringBefore('/') }.distinct()
    return if (groups.size == 1) "${groups[0]}/*" else "*/*"
  }
}
