import BackgroundTasks
import ExpoModulesCore
import UIKit

// 长任务切到后台也继续的 iOS 部分（D-163）：iOS 26 的 BGContinuedProcessingTask。用户点了运行之后提交，
// 系统在锁屏和灵动岛上显示进度，切到别的 App 也给时间继续跑；系统收回时间时让 morph-media 按「切到后台」中断。
// 视频编码器和语音识别在后台能不能用要真机确认，所以默认关着：关着时什么都不做，iOS 和 D-148 一样要留在 Morph 里。

/** 实验开关（D-163）。真机确认之前保持 false。 */
private let continuedProcessingEnabled = false

/** 和 morph-media 约定的通知名（两个模块互相看不到对方的代码）。 */
private let changedNotification = Notification.Name("MorphContinuedProcessingChanged")
private let expiredNotification = Notification.Name("MorphContinuedProcessingExpired")

struct DoneNotice: Record {
  @Field var title: String = ""
  @Field var body: String = ""
}

public class MorphBackgroundModule: Module {
  private let lock = NSLock()
  /** 这次运行的任务标识；end 之后为 nil（系统晚到的任务直接结束）。 */
  private var identifier: String?
  /** 系统开始运行的任务（BGContinuedProcessingTask，iOS 26 起）。 */
  private var task: AnyObject?
  private var title = ""

  /** 后台启动时要的那段后台时间（D-318）；还了之后是 .invalid。 */
  private var launchTask: UIBackgroundTaskIdentifier = .invalid

  public func definition() -> ModuleDefinition {
    Name("MorphBackground")

    // 提醒通知上的按钮（D-318）不打开 App：系统在后台拉起 App，expo-notifications 一收到点击就回复系统，
    // 之后 App 随时可能被挂起，JS 来不及写记录。后台启动时先要一段后台时间，JS 处理完调 releaseLaunch 还掉。
    OnCreate {
      DispatchQueue.main.async { self.holdLaunch() }
    }

    Function("releaseLaunch") {
      DispatchQueue.main.async { self.releaseLaunch() }
    }

    Constant("continuesInBackground") { Self.available }

    // iOS 不发我们自己的通知：进度和完成都由系统的后台任务界面显示。
    AsyncFunction("ensureNotificationPermission") { () -> Bool in false }

    Function("begin") { (title: String, text: String) -> Bool in
      self.begin(title, text)
    }

    Function("update") { (text: String, fraction: Double?) in
      self.update(text, fraction)
    }

    Function("end") { (_: DoneNotice?) in
      self.end()
    }
  }

  private func holdLaunch() {
    guard UIApplication.shared.applicationState == .background, launchTask == .invalid else {
      return
    }
    launchTask = UIApplication.shared.beginBackgroundTask(withName: "morph-reminder-action") {
      [weak self] in self?.releaseLaunch()
    }
  }

  private func releaseLaunch() {
    guard launchTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(launchTask)
    launchTask = .invalid
  }

  private static var available: Bool {
    guard continuedProcessingEnabled else { return false }
    // 模拟器没有 BGTaskScheduler（提交报「not available on this platform」）。
    #if targetEnvironment(simulator)
      return false
    #else
      if #available(iOS 26.0, *) { return true }
      return false
    #endif
  }

  private func begin(_ title: String, _ text: String) -> Bool {
    guard Self.available else { return false }
    guard #available(iOS 26.0, *) else { return false }
    let bundle = Bundle.main.bundleIdentifier ?? "app.morph.mobile"
    // Info.plist 的 BGTaskSchedulerPermittedIdentifiers 里是 app.morph.mobile.work.*；每次一个新标识（同一个标识注册两次系统会杀掉 App）。
    let id = "\(bundle).work.\(UUID().uuidString)"
    lock.withLock {
      identifier = id
      task = nil
      self.title = title
    }
    let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) {
      [weak self] bgTask in
      guard let self, let bgTask = bgTask as? BGContinuedProcessingTask else {
        bgTask.setTaskCompleted(success: false)
        return
      }
      let current = self.lock.withLock { () -> Bool in
        guard self.identifier == id else { return false }
        self.task = bgTask
        return true
      }
      // 运行已经结束了才轮到：直接结束。
      guard current else {
        bgTask.setTaskCompleted(success: true)
        return
      }
      bgTask.progress.totalUnitCount = 1000
      bgTask.expirationHandler = { [weak self] in self?.expire(id) }
      NotificationCenter.default.post(name: changedNotification, object: nil, userInfo: ["active": true])
    }
    guard registered else {
      NSLog("[MorphBackground] could not register %@", id)
      lock.withLock { identifier = nil }
      return false
    }
    let request = BGContinuedProcessingTaskRequest(identifier: id, title: title, subtitle: text)
    // 现在跑不了就算了（还在 Morph 里，照旧在前台跑），不排队。
    request.strategy = .fail
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("[MorphBackground] submit failed: %@", String(describing: error))
      lock.withLock { identifier = nil }
      return false
    }
    return true
  }

  private func update(_ text: String, _ fraction: Double?) {
    guard #available(iOS 26.0, *) else { return }
    let (task, title) = lock.withLock { (self.task, self.title) }
    guard let task = task as? BGContinuedProcessingTask else { return }
    if let fraction {
      task.progress.completedUnitCount = Int64((min(1, max(0, fraction)) * 1000).rounded())
    }
    task.updateTitle(title, subtitle: text)
  }

  private func end() {
    let task = lock.withLock { () -> AnyObject? in
      identifier = nil
      defer { self.task = nil }
      return self.task
    }
    NotificationCenter.default.post(name: changedNotification, object: nil, userInfo: ["active": false])
    if #available(iOS 26.0, *), let task = task as? BGContinuedProcessingTask {
      task.progress.completedUnitCount = task.progress.totalUnitCount
      task.setTaskCompleted(success: true)
    }
  }

  /** 系统收回了后台时间：正在处理的视频和音频按「切到后台」中断（ERR_MEDIA_INTERRUPTED）。 */
  private func expire(_ id: String) {
    let task = lock.withLock { () -> AnyObject? in
      guard identifier == id else { return nil }
      identifier = nil
      defer { self.task = nil }
      return self.task
    }
    NotificationCenter.default.post(name: changedNotification, object: nil, userInfo: ["active": false])
    NotificationCenter.default.post(name: expiredNotification, object: nil)
    if #available(iOS 26.0, *), let task = task as? BGContinuedProcessingTask {
      task.setTaskCompleted(success: false)
    }
  }
}
