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

// 分享和存到文件夹的 Android 实现（D-119、D-120）：
// - 分享：ACTION_SEND_MULTIPLE 一次带上全部文件（content:// 地址，只给读权限）。
// - 存到文件夹：存储访问框架 ACTION_OPEN_DOCUMENT_TREE，用户选文件夹（本机、Google Drive 等文档提供者），
//   逐个 createDocument 并复制。记住上次选的文件夹（P-019、D-123）：申请长期读写授权、把地址存在
//   SharedPreferences，下次直接存进去；换文件夹时放掉旧的授权，文件夹没了或授权被收回时重新让用户选。
//   每个快捷操作记自己的文件夹（D-196）：另存「folder:快捷操作 ID → 地址」，还没有时用最后选过的那个并记给它；
//   某个文件夹不再被任何快捷操作（也不是最后选过的）用到时才放掉授权。
// 文件内容和文件名不写日志。

class MorphShareFileProvider : FileProvider()

class SheetBusyException : CodedException("Another share or save sheet is open")

class NoActivityException : CodedException("There is no screen to show the sheet on")

class FolderNotWritableException :
  CodedException("ERR_FOLDER_NOT_WRITABLE", "Files can't be saved into this folder", null)

class ExportFailedException(detail: String?) : CodedException("Saving failed: $detail")

private const val PREFS = "morph_share"
private const val FOLDER_KEY = "folder"
private const val FOLDER_PREFIX = "folder:"
private const val SHARE_REQUEST = 0x4d53
private const val FOLDER_REQUEST = 0x4d46

private class PendingExport(
  val key: String,
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

    Function("rememberedFolder") { key: String -> rememberedFolder(key, adopt = false)?.second }

    Function("forgetFolders") { keep: List<String> ->
      updateFolders { edit ->
        for (name in prefs.all.keys) {
          if (name.startsWith(FOLDER_PREFIX) && name.removePrefix(FOLDER_PREFIX) !in keep) edit.remove(name)
        }
      }
    }

    // useRemembered：有记住的文件夹就直接存进去，不弹选择器。key：快捷操作 ID。
    AsyncFunction("exportFiles") { uris: List<String>, names: List<String>, mimeTypes: List<String>, useRemembered: Boolean, key: String, promise: Promise ->
      if (pendingShare != null || pendingExport != null) {
        promise.reject(SheetBusyException())
        return@AsyncFunction
      }
      val pending = PendingExport(key, promise, uris.map(::fileOf), names, mimeTypes)
      val remembered = if (useRemembered) rememberedFolder(key, adopt = true) else null
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
          remember(tree, pending.key)
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

  // 快捷操作 key 的文件夹（地址和名字）：它自己的，没有时是最后选过的（adopt 为 true 时记给它，真正要存的
  // 时候才记）。都没有、授权被收回或文件夹已经不在了时返回 null（并忘掉失效的那个）。
  private fun rememberedFolder(key: String, adopt: Boolean): Pair<Uri, String>? {
    usable(FOLDER_PREFIX + key)?.let { return it }
    val last = usable(FOLDER_KEY) ?: return null
    if (adopt) updateFolders { it.putString(FOLDER_PREFIX + key, last.first.toString()) }
    return last
  }

  // 存在 pref 这一项里的文件夹；授权被收回或文件夹已经不在了时忘掉这个文件夹（所有用到它的地方）。
  private fun usable(pref: String): Pair<Uri, String>? {
    val tree = prefs.getString(pref, null)?.let(Uri::parse) ?: return null
    val granted = context.contentResolver.persistedUriPermissions.any {
      it.uri == tree && it.isWritePermission
    }
    val name = if (granted) folderName(tree) else null
    if (name == null) {
      updateFolders { edit ->
        for ((k, v) in prefs.all) if (k.startsWith(FOLDER_KEY) && v == tree.toString()) edit.remove(k)
      }
      return null
    }
    return tree to name
  }

  // 记给这个快捷操作，也记成最后选过的。
  private fun remember(tree: Uri, key: String) {
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    try {
      context.contentResolver.takePersistableUriPermission(tree, flags)
    } catch (e: SecurityException) {
      // 这个文档提供者不给长期授权：这次照样存，下次再问。
      return
    }
    updateFolders {
      it.putString(FOLDER_KEY, tree.toString())
      it.putString(FOLDER_PREFIX + key, tree.toString())
    }
  }

  // 改记住的文件夹；改完后没有任何地方再用到的文件夹放掉长期授权。
  private fun updateFolders(change: (android.content.SharedPreferences.Editor) -> Unit) {
    val before = folderUris()
    val edit = prefs.edit()
    change(edit)
    edit.commit()
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    for (uri in before - folderUris()) {
      try {
        context.contentResolver.releasePersistableUriPermission(Uri.parse(uri), flags)
      } catch (e: SecurityException) {
        // 本来就没有授权。
      }
    }
  }

  // 现在记着的所有文件夹地址（最后选过的和每个快捷操作的）。
  private fun folderUris(): Set<String> =
    prefs.all.filterKeys { it.startsWith(FOLDER_KEY) }.values.filterIsInstance<String>().toSet()

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
