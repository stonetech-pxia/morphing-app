import AVFoundation
import ExpoModulesCore
import ImageIO
import MorphLame
import MorphDsp
import UIKit
import UniformTypeIdentifiers

// 视频和音频的 iOS 实现（D-141）：只用 AVFoundation，全部在本机处理，不联网。
// - probe：AVURLAsset 读时长、宽高、方向、帧率、码率、编码、是否 HDR。
// - transcode：AVAssetReader（经过 AVVideoComposition：摆正、缩小、限帧率、HDR 转 BT.709）
//   + AVAssetWriter（H.264 + AAC，MP4），自己指定码率。
// - trim：AVAssetExportSession 的 Passthrough + timeRange，不重新编码。
// - thumbnails：AVAssetImageGenerator。
// - MP3（D-183）：AVFoundation 不能写 MP3，解成 PCM 后交给编进 App 的 LAME（MorphLame pod）。
// - GIF（D-184）：视频用 AVAssetImageGenerator 按帧率取画面，图片用 ImageIO 读（摆正、缩小），
//   ImageIO 写 GIF（每帧自己的调色板，循环播放）。
// 视频编码器不能在后台用：处理时切到别的 App 会失败，报 ERR_MEDIA_INTERRUPTED（D-148）。
// 例外：morph-background 拿到了 iOS 26 的后台任务时（D-163，默认关着），切到后台不算中断；
// 系统收回后台时间时，正在处理的任务按中断结束。

final class MediaUnsupportedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_UNSUPPORTED" }
  override var reason: String { "This media can't be opened: \(param)" }
}

final class MediaCancelledException: Exception, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_CANCELLED" }
  override var reason: String { "Cancelled" }
}

final class MediaInterruptedException: Exception, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_INTERRUPTED" }
  override var reason: String { "Morph went to the background while processing" }
}

final class NotImplementedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_NOT_IMPLEMENTED" }
  override var reason: String { "Not implemented yet: \(param)" }
}

final class MediaFailedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_MEDIA_FAILED" }
  override var reason: String { "Processing failed: \(param)" }
}

/** 一个正在进行的任务：能取消，记得有没有切到后台过。 */
private final class Job: @unchecked Sendable {
  private let lock = NSLock()
  private var _cancelled = false
  private var _backgrounded = false
  private var _onCancel: (() -> Void)?

  /** 取消时要做的事（停止读写或导出）；设置时已经取消了就马上做。 */
  var onCancel: (() -> Void)? {
    get { lock.withLock { _onCancel } }
    set {
      let run = lock.withLock { () -> Bool in
        _onCancel = newValue
        return _cancelled
      }
      if run { newValue?() }
    }
  }

  var cancelled: Bool { lock.withLock { _cancelled } }
  var backgrounded: Bool { lock.withLock { _backgrounded } }

  func cancel() {
    let handler: (() -> Void)? = lock.withLock {
      _cancelled = true
      return _onCancel
    }
    handler?()
  }

  func markBackgrounded() { lock.withLock { _backgrounded = true } }

  /** 系统收回了后台时间：停下来，按「切到后台」报错。 */
  func interrupt() {
    let handler: (() -> Void)? = lock.withLock {
      _backgrounded = true
      return _onCancel
    }
    handler?()
  }
}

/** 和 morph-background 约定的通知名（两个模块互相看不到对方的代码）。 */
private let continuedChangedNotification = Notification.Name("MorphContinuedProcessingChanged")
private let continuedExpiredNotification = Notification.Name("MorphContinuedProcessingExpired")

public class MorphMediaModule: Module {
  private let jobsLock = NSLock()
  private var jobs: [String: Job] = [:]
  /** morph-background 拿到了后台任务（D-163）：这期间切到后台不算中断。 */
  private var continued = false
  private var continuedObservers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("MorphMedia")

    Events("progress")

    OnCreate {
      let center = NotificationCenter.default
      self.continuedObservers = [
        center.addObserver(forName: continuedChangedNotification, object: nil, queue: nil) {
          [weak self] note in
          guard let self else { return }
          let active = note.userInfo?["active"] as? Bool ?? false
          self.jobsLock.withLock { self.continued = active }
        },
        center.addObserver(forName: continuedExpiredNotification, object: nil, queue: nil) {
          [weak self] _ in
          guard let self else { return }
          self.jobsLock.withLock { Array(self.jobs.values) }.forEach { $0.interrupt() }
        },
      ]
    }

    OnDestroy {
      self.continuedObservers.forEach { NotificationCenter.default.removeObserver($0) }
      self.continuedObservers = []
    }

    AsyncFunction("probe") { (uri: URL, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Self.probe(uri))
        } catch {
          promise.reject(Self.coded(error))
        }
      }
    }

    AsyncFunction("transcode") {
      (jobId: String, uri: URL, output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          let video = options["video"] as? [String: Any]
          let result: [String: Any]
          if let factor = (video?["speed"] as? NSNumber)?.doubleValue {
            result = try await self.speedVideo(job, jobId: jobId, uri: uri, output: output, options: options, factor: factor)
          } else {
            result = try await self.transcode(job, jobId: jobId, uri: uri, output: output, options: options)
          }
          promise.resolve(result)
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("volume") {
      (jobId: String, uri: URL, output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do { promise.resolve(try await self.adjustVolume(job, jobId: jobId, uri: uri, output: output, options: options)) }
        catch { promise.reject(Self.coded(error, job: job)) }
      }
    }

    AsyncFunction("denoise") {
      (jobId: String, uri: URL, output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do { promise.resolve(try await self.denoiseAudio(job, jobId: jobId, uri: uri, output: output, options: options)) }
        catch { promise.reject(Self.coded(error, job: job)) }
      }
    }

    AsyncFunction("rotate") {
      (jobId: String, uri: URL, output: URL, degrees: Int, _options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do { promise.resolve(try await self.rotateVideo(job, jobId: jobId, uri: uri, output: output, degrees: degrees)) }
        catch { promise.reject(Self.coded(error, job: job)) }
      }
    }

    AsyncFunction("mixAudio") {
      (jobId: String, uri: URL, music: URL, output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do { promise.resolve(try await self.mixVideoAudio(job, jobId: jobId, uri: uri, music: music, output: output, options: options)) }
        catch { promise.reject(Self.coded(error, job: job)) }
      }
    }

    AsyncFunction("trim") {
      (jobId: String, uri: URL, output: URL, range: [String: Double], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          let result = try await self.trim(job, jobId: jobId, uri: uri, output: output, range: range)
          promise.resolve(result)
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("frame") { (uri: URL, timeMs: Double, directory: URL, promise: Promise) in
      Task {
        do {
          guard timeMs.isFinite, timeMs >= 0 else { throw MediaUnsupportedException("invalid frame time") }
          let frames = try await Self.thumbnails(uri, timesMs: [timeMs], maxSide: 0, directory: directory, precise: true)
          promise.resolve(frames[0])
        } catch { promise.reject(Self.coded(error)) }
      }
    }

    AsyncFunction("thumbnails") {
      (uri: URL, timesMs: [Double], maxSide: Double, directory: URL, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Self.thumbnails(uri, timesMs: timesMs, maxSide: maxSide, directory: directory))
        } catch {
          promise.reject(Self.coded(error))
        }
      }
    }

    // 音频（D-153、D-155，音频会话）：几段接成一段、波形。
    AsyncFunction("concat") {
      (jobId: String, uris: [URL], output: URL, options: [String: Any], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          let result = try await self.concat(job, jobId: jobId, uris: uris, output: output, options: options)
          promise.resolve(result)
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("waveform") { (uri: URL, buckets: Int, range: [String: Double]?, promise: Promise) in
      Task {
        do {
          promise.resolve(try await Self.waveform(uri, buckets: buckets, range: range))
        } catch {
          promise.reject(Self.coded(error))
        }
      }
    }

    // 动图（D-184）
    AsyncFunction("videoGif") {
      (jobId: String, uri: URL, output: URL, options: [String: Double], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          promise.resolve(try await self.videoGif(job, jobId: jobId, uri: uri, output: output, options: options))
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    AsyncFunction("imagesGif") {
      (jobId: String, uris: [URL], output: URL, options: [String: Double], promise: Promise) in
      let job = self.start(jobId)
      Task {
        defer { self.finish(jobId) }
        do {
          promise.resolve(try self.imagesGif(job, jobId: jobId, uris: uris, output: output, options: options))
        } catch {
          promise.reject(Self.coded(error, job: job))
        }
      }
    }

    Function("cancel") { (jobId: String) in
      let job = self.jobsLock.withLock { self.jobs[jobId] }
      job?.cancel()
    }
  }

  // MARK: - 任务

  private func start(_ jobId: String) -> Job {
    let job = Job()
    // 切到后台时记一下：之后编码失败就是因为这个（iOS 不让后台用视频编码器）。有后台任务时不算。
    let token = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
    ) { [weak self] _ in
      let continued = self.map { module in module.jobsLock.withLock { module.continued } } ?? false
      if !continued { job.markBackgrounded() }
    }
    jobsLock.withLock {
      jobs[jobId] = job
      observers[jobId] = token
    }
    return job
  }

  private var observers: [String: NSObjectProtocol] = [:]

  private func finish(_ jobId: String) {
    jobsLock.withLock {
      jobs[jobId] = nil
      if let token = observers.removeValue(forKey: jobId) {
        NotificationCenter.default.removeObserver(token)
      }
    }
  }

  private func progress(_ jobId: String, _ value: Double) {
    sendEvent("progress", ["jobId": jobId, "progress": min(1, max(0, value))])
  }

  private static func coded(_ error: Error, job: Job? = nil) -> Exception {
    if let job, job.cancelled { return MediaCancelledException() }
    if let exception = error as? Exception { return exception }
    if let job, job.backgrounded { return MediaInterruptedException() }
    return MediaFailedException(error.localizedDescription)
  }

  // MARK: - probe

  static func probe(_ url: URL) async throws -> [String: Any] {
    let asset = AVURLAsset(url: url)
    let duration: CMTime
    let tracks: [AVAssetTrack]
    do {
      (duration, tracks) = try await asset.load(.duration, .tracks)
    } catch {
      throw MediaUnsupportedException(error.localizedDescription)
    }
    if (try? await asset.load(.hasProtectedContent)) == true {
      throw MediaUnsupportedException("protected")
    }
    let video = tracks.first { $0.mediaType == .video }
    let audio = tracks.first { $0.mediaType == .audio }
    if video == nil && audio == nil { throw MediaUnsupportedException("no tracks") }
    var info: [String: Any] = [
      "kind": video != nil ? "video" : "audio",
      "durationMs": duration.isNumeric ? duration.seconds * 1000 : 0,
      "size": fileSize(url),
      "hasVideo": video != nil,
      "hasAudio": audio != nil,
    ]
    if let video {
      let (size, transform, fps, rate, formats) = try await video.load(
        .naturalSize, .preferredTransform, .nominalFrameRate, .estimatedDataRate, .formatDescriptions)
      let shown = size.applying(transform)
      info["width"] = Int(abs(shown.width).rounded())
      info["height"] = Int(abs(shown.height).rounded())
      info["rotation"] = rotation(of: transform)
      info["fps"] = Double(fps)
      info["videoBitrateKbps"] = Double(rate) / 1000
      if let format = formats.first {
        info["videoCodec"] = fourCC(CMFormatDescriptionGetMediaSubType(format))
      }
      info["hdr"] = (try? await video.load(.mediaCharacteristics))?.contains(.containsHDRVideo) ?? false
    }
    if let audio {
      let (rate, formats) = try await audio.load(.estimatedDataRate, .formatDescriptions)
      info["audioBitrateKbps"] = Double(rate) / 1000
      if let format = formats.first {
        info["audioCodec"] = fourCC(CMFormatDescriptionGetMediaSubType(format))
        if let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee {
          info["sampleRate"] = asbd.mSampleRate
          info["channels"] = Int(asbd.mChannelsPerFrame)
        }
      }
    }
    return info
  }

  private static func fileSize(_ url: URL) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
  }

  private static func rotation(of t: CGAffineTransform) -> Int {
    let degrees = Int((atan2(t.b, t.a) * 180 / .pi).rounded())
    return ((degrees % 360) + 360) % 360
  }

  private static func fourCC(_ code: FourCharCode) -> String {
    let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }
    let text = String(bytes: bytes, encoding: .ascii) ?? ""
    return text.trimmingCharacters(in: .whitespaces)
  }

  // MARK: - transcode

  private func transcode(
    _ job: Job, jobId: String, uri: URL, output: URL, options: [String: Any],
    sourceAsset: AVAsset? = nil, suppliedComposition: AVVideoComposition? = nil, suppliedAudioMix: AVAudioMix? = nil, suppliedTimePitch: AVAudioTimePitchAlgorithm? = nil
  ) async throws -> [String: Any] {
    let container = options["container"] as? String ?? "mp4"
    if options["video"] as? String == "drop" {
      let asset = AVURLAsset(url: uri)
      let (duration, tracks) = try await asset.load(.duration, .tracks)
      let audioTracks = tracks.filter { $0.mediaType == .audio }
      if audioTracks.isEmpty { throw MediaUnsupportedException("no audio") }
      var timeRange = CMTimeRange(start: .zero, duration: duration)
      if let range = options["range"] as? [String: Double], let start = range["startMs"], let end = range["endMs"] {
        timeRange = CMTimeRange(
          start: CMTime(seconds: start / 1000, preferredTimescale: 600),
          end: CMTime(seconds: min(end / 1000, duration.seconds), preferredTimescale: 600))
      }
      return try await writeAudio(
        job, jobId: jobId, asset: asset, tracks: audioTracks, timeRange: timeRange, output: output,
        container: container, audio: options["audio"] as? [String: Any] ?? [:])
    }
    guard container == "mp4", let video = options["video"] as? [String: Any] else {
      throw NotImplementedException("transcode to \(container)")
    }
    let audioOptions = options["audio"] as? [String: Any]
    if audioOptions == nil, options["audio"] as? String != "drop" {
      throw NotImplementedException("audio settings")
    }
    if let codec = audioOptions?["codec"] as? String, codec != "aac" {
      throw NotImplementedException("audio codec \(codec)")
    }

    let asset: AVAsset = sourceAsset ?? AVURLAsset(url: uri)
    let (duration, tracks) = try await asset.load(.duration, .tracks)
    guard let videoTrack = tracks.first(where: { $0.mediaType == .video }) else {
      throw MediaUnsupportedException("no video")
    }
    let audioTracks = audioOptions == nil ? [] : tracks.filter { $0.mediaType == .audio }

    var timeRange = CMTimeRange(start: .zero, duration: duration)
    if let range = options["range"] as? [String: Double], let start = range["startMs"], let end = range["endMs"] {
      timeRange = CMTimeRange(
        start: CMTime(seconds: start / 1000, preferredTimescale: 600),
        end: CMTime(seconds: end / 1000, preferredTimescale: 600))
    }

    // 输出尺寸：摆正之后按短边缩小，不放大；H.264 要偶数宽高。
    let (natural, transform, nominalFps) = try await videoTrack.load(.naturalSize, .preferredTransform, .nominalFrameRate)
    let shown = natural.applying(transform)
    let frameW = suppliedComposition?.renderSize.width ?? abs(shown.width)
    let frameH = suppliedComposition?.renderSize.height ?? abs(shown.height)
    let ratio = (video["aspectRatio"] as? NSNumber)?.doubleValue
    if let ratio, !ratio.isFinite || ratio <= 0 { throw MediaUnsupportedException("invalid aspect ratio") }
    let shownW = ratio.map { min(frameW, frameH * CGFloat($0)) } ?? frameW
    let shownH = ratio.map { min(frameH, frameW / CGFloat($0)) } ?? frameH
    let shortSide = min(shownW, shownH)
    let maxShort = (video["maxShortSide"] as? Double).map { CGFloat($0) } ?? shortSide
    let scale = min(1, maxShort / max(shortSide, 1))
    let outW = max(2, Int((shownW * scale / 2).rounded()) * 2)
    let outH = max(2, Int((shownH * scale / 2).rounded()) * 2)
    let maxFps = video["maxFps"] as? Double ?? 30
    let fps = min(Double(nominalFps > 0 ? nominalFps : 30), maxFps)

    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: outW, height: outH)
    composition.frameDuration = CMTime(seconds: 1 / fps, preferredTimescale: 6000)
    // 普通画面（BT.709）：HDR 视频在这里转换，否则发到别处会发灰或过暗。
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
    // 摆正：preferredTransform 不一定带平移（不是 iPhone 拍的视频常常只有旋转），
    // 按转过之后的外框把画面挪回原点，再缩放到输出尺寸。
    let bounds = CGRect(origin: .zero, size: natural).applying(transform)
    let upright = transform.concatenating(
      CGAffineTransform(translationX: -bounds.minX - (frameW - shownW) / 2, y: -bounds.minY - (frameH - shownH) / 2))
    let sx = CGFloat(outW) / shownW
    let sy = CGFloat(outH) / shownH
    layer.setTransform(upright.concatenating(CGAffineTransform(scaleX: sx, y: sy)), at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      try? FileManager.default.removeItem(at: output)
      try FileManager.default.createDirectory(
        at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
      writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    } catch {
      throw MediaFailedException(error.localizedDescription)
    }
    reader.timeRange = timeRange
    writer.shouldOptimizeForNetworkUse = true

    let videoOut = AVAssetReaderVideoCompositionOutput(
      videoTracks: tracks.filter { $0.mediaType == .video },
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    videoOut.videoComposition = suppliedComposition ?? composition
    videoOut.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOut) else { throw MediaUnsupportedException("video output") }
    reader.add(videoOut)

    let bitrate = (video["bitrateKbps"] as? Double ?? 2500) * 1000
    let videoIn = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: outW,
        AVVideoHeightKey: outH,
        AVVideoColorPropertiesKey: [
          AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: Int(bitrate),
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: Int(fps.rounded()),
          AVVideoMaxKeyFrameIntervalDurationKey: 2,
        ],
      ])
    videoIn.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoIn) else { throw MediaFailedException("video input") }
    writer.add(videoIn)

    var audioOut: AVAssetReaderAudioMixOutput?
    var audioIn: AVAssetWriterInput?
    if !audioTracks.isEmpty, let audioOptions {
      let kbps = audioOptions["bitrateKbps"] as? Double ?? 128
      // AAC 低码率时用单声道、低采样率，否则编码器不接受。
      let channels = (audioOptions["channels"] as? NSNumber)?.intValue ?? (kbps < 64 ? 1 : 2)
      let sampleRate = (audioOptions["sampleRate"] as? Double) ?? (kbps < 64 ? 22050 : 44100)
      let out = AVAssetReaderAudioMixOutput(
        audioTracks: audioTracks,
        audioSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVSampleRateKey: sampleRate,
          AVNumberOfChannelsKey: channels,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
        ])
      out.audioMix = suppliedAudioMix
      if let suppliedTimePitch { out.audioTimePitchAlgorithm = suppliedTimePitch }
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: sampleRate,
          AVNumberOfChannelsKey: channels,
          AVEncoderBitRateKey: Int(kbps * 1000),
        ])
      input.expectsMediaDataInRealTime = false
      if reader.canAdd(out), writer.canAdd(input) {
        reader.add(out)
        writer.add(input)
        audioOut = out
        audioIn = input
      }
    }

    job.onCancel = {
      reader.cancelReading()
      writer.cancelWriting()
    }
    if job.cancelled { throw MediaCancelledException() }
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }
    guard writer.startWriting() else {
      throw MediaFailedException(writer.error?.localizedDescription ?? "writer")
    }
    writer.startSession(atSourceTime: timeRange.start)

    let total = max(timeRange.duration.seconds, 0.001)
    let start = timeRange.start.seconds
    var lastReported = -1.0
    let report: (CMTime) -> Void = { time in
      let value = (time.seconds - start) / total
      if value - lastReported >= 0.01 {
        lastReported = value
        self.progress(jobId, value)
      }
    }

    // 两路（画面、声音）各自在自己的队列上搬运，都搬完再收尾。
    await withTaskGroup(of: Void.self) { group in
      group.addTask {
        await Self.pump(videoOut, into: videoIn, queue: DispatchQueue(label: "morph.media.video"), onSample: report)
      }
      if let audioOut, let audioIn {
        group.addTask {
          await Self.pump(audioOut, into: audioIn, queue: DispatchQueue(label: "morph.media.audio"), onSample: nil)
        }
      }
    }

    if job.cancelled {
      writer.cancelWriting()
      throw MediaCancelledException()
    }
    if reader.status == .failed {
      writer.cancelWriting()
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(reader.error?.localizedDescription ?? "read")
    }
    await writer.finishWriting()
    if writer.status != .completed {
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(writer.error?.localizedDescription ?? "write")
    }
    progress(jobId, 1)
    return try await Self.result(output)
  }

  /** 把一路样本从 reader 搬到 writer，直到读完或写入失败。 */
  private static func pump(
    _ output: AVAssetReaderOutput, into input: AVAssetWriterInput, queue: DispatchQueue,
    onSample: ((CMTime) -> Void)? = nil
  ) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      var done = false
      input.requestMediaDataWhenReady(on: queue) {
        while input.isReadyForMoreMediaData && !done {
          guard let sample = output.copyNextSampleBuffer() else {
            done = true
            input.markAsFinished()
            continuation.resume()
            return
          }
          onSample?(CMSampleBufferGetPresentationTimeStamp(sample))
          if !input.append(sample) {
            done = true
            input.markAsFinished()
            continuation.resume()
            return
          }
        }
      }
    }
  }

  private static func result(_ url: URL) async throws -> [String: Any] {
    let info = try await probe(url)
    return ["uri": url.absoluteString, "size": fileSize(url), "info": info]
  }

  // MARK: - 音频（D-153、D-155）

  /**
   * 把几路声音（混在一起；合成时它们首尾相接）编码成 M4A（AAC）或 WAV（16 位 PCM）。
   * AAC 低码率时用单声道、低采样率，否则编码器不接受（和视频的声音一样）。
   */
  private func writeAudio(
    _ job: Job, jobId: String, asset: AVAsset, tracks: [AVAssetTrack], timeRange: CMTimeRange,
    output: URL, container: String, audio: [String: Any]
  ) async throws -> [String: Any] {
    if container == "mp3" {
      return try await writeMp3(
        job, jobId: jobId, asset: asset, tracks: tracks, timeRange: timeRange, output: output, audio: audio)
    }
    let codec = audio["codec"] as? String ?? (container == "wav" ? "pcm" : "aac")
    guard (container == "m4a" && codec == "aac") || (container == "wav" && codec == "pcm") else {
      throw NotImplementedException("\(container) with \(codec)")
    }
    let kbps = audio["bitrateKbps"] as? Double ?? 128
    // JS 的数字到这里是 Double，`as? Int` 取不到：用 NSNumber 读。
    let channels = (audio["channels"] as? NSNumber)?.intValue ?? (codec == "aac" && kbps < 64 ? 1 : 2)
    let sampleRate = audio["sampleRate"] as? Double ?? (codec == "aac" && kbps < 48 ? 22050 : 44100)
    let pcm: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let settings: [String: Any] =
      codec == "pcm"
      ? pcm
      : [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: channels,
        AVEncoderBitRateKey: Int(kbps * 1000),
      ]

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      try? FileManager.default.removeItem(at: output)
      try FileManager.default.createDirectory(
        at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
      writer = try AVAssetWriter(outputURL: output, fileType: container == "wav" ? .wav : .m4a)
    } catch {
      throw MediaFailedException(error.localizedDescription)
    }
    reader.timeRange = timeRange
    let out = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: pcm)
    out.alwaysCopiesSampleData = false
    guard reader.canAdd(out) else { throw MediaUnsupportedException("audio output") }
    reader.add(out)
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { throw MediaFailedException("audio input \(kbps) kbps \(channels) ch") }
    writer.add(input)

    job.onCancel = {
      reader.cancelReading()
      writer.cancelWriting()
    }
    if job.cancelled { throw MediaCancelledException() }
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }
    guard writer.startWriting() else {
      throw MediaFailedException(writer.error?.localizedDescription ?? "writer")
    }
    writer.startSession(atSourceTime: timeRange.start)

    let total = max(timeRange.duration.seconds, 0.001)
    let start = timeRange.start.seconds
    var lastReported = -1.0
    await Self.pump(out, into: input, queue: DispatchQueue(label: "morph.media.audio")) { time in
      let value = (time.seconds - start) / total
      if value - lastReported >= 0.01 {
        lastReported = value
        self.progress(jobId, value)
      }
    }

    if job.cancelled {
      writer.cancelWriting()
      throw MediaCancelledException()
    }
    if reader.status == .failed {
      writer.cancelWriting()
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(reader.error?.localizedDescription ?? "read")
    }
    await writer.finishWriting()
    if writer.status != .completed {
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(writer.error?.localizedDescription ?? "write")
    }
    progress(jobId, 1)
    return try await Self.result(output)
  }

  /**
   * MP3（D-183）：AVAssetReader 把声音解成 44.1 kHz 的 16 位 PCM（需要时系统重采样），LAME 编码，边编边写文件。
   * LAME 的 quality 用 2（好，比默认的 5 慢一点）。
   */
  private func writeMp3(
    _ job: Job, jobId: String, asset: AVAsset, tracks: [AVAssetTrack], timeRange: CMTimeRange,
    output: URL, audio: [String: Any]
  ) async throws -> [String: Any] {
    let kbps = Int32(audio["bitrateKbps"] as? Double ?? 192)
    let channels = (audio["channels"] as? NSNumber)?.intValue ?? 2
    let sampleRate = 44100.0
    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch {
      throw MediaUnsupportedException(error.localizedDescription)
    }
    reader.timeRange = timeRange
    let out = AVAssetReaderAudioMixOutput(
      audioTracks: tracks,
      audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: channels,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ])
    out.alwaysCopiesSampleData = false
    guard reader.canAdd(out) else { throw MediaUnsupportedException("audio output") }
    reader.add(out)

    guard let lame = lame_init() else { throw MediaFailedException("mp3 encoder") }
    defer { lame_close(lame) }
    lame_set_in_samplerate(lame, Int32(sampleRate))
    lame_set_num_channels(lame, Int32(channels))
    lame_set_mode(lame, channels == 1 ? MONO : JOINT_STEREO)
    lame_set_brate(lame, kbps)
    lame_set_quality(lame, 2)
    guard lame_init_params(lame) >= 0 else {
      throw MediaFailedException("mp3 encoder \(kbps) kbps \(channels) ch")
    }

    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(
      at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard FileManager.default.createFile(atPath: output.path, contents: nil),
      let file = try? FileHandle(forWritingTo: output)
    else { throw MediaFailedException("create \(output.lastPathComponent)") }
    defer { try? file.close() }

    job.onCancel = { reader.cancelReading() }
    if job.cancelled { throw MediaCancelledException() }
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }

    let total = max(timeRange.duration.seconds, 0.001)
    let start = timeRange.start.seconds
    var lastReported = -1.0
    var mp3 = [UInt8]()
    while let sample = out.copyNextSampleBuffer() {
      if job.cancelled { break }
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      let length = CMBlockBufferGetDataLength(block)
      var pcm = [Int16](repeating: 0, count: length / 2)
      pcm.withUnsafeMutableBytes { raw in
        _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
      }
      let frames = Int32(pcm.count / channels)
      // LAME 要求的最坏情况：1.25 × 样本数 + 7200 字节。
      let capacity = Int(frames) * 5 / 4 + 7200
      if mp3.count < capacity { mp3 = [UInt8](repeating: 0, count: capacity) }
      let written = pcm.withUnsafeMutableBufferPointer { samples in
        mp3.withUnsafeMutableBufferPointer { bytes in
          channels == 1
            ? lame_encode_buffer(lame, samples.baseAddress, samples.baseAddress, frames, bytes.baseAddress, Int32(capacity))
            : lame_encode_buffer_interleaved(lame, samples.baseAddress, frames, bytes.baseAddress, Int32(capacity))
        }
      }
      if written < 0 { throw MediaFailedException("mp3 encode \(written)") }
      file.write(Data(mp3[0..<Int(written)]))
      let value = (CMSampleBufferGetPresentationTimeStamp(sample).seconds - start) / total
      if value - lastReported >= 0.01 {
        lastReported = value
        progress(jobId, value)
      }
    }
    if job.cancelled {
      try? FileManager.default.removeItem(at: output)
      throw MediaCancelledException()
    }
    if reader.status == .failed {
      try? FileManager.default.removeItem(at: output)
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(reader.error?.localizedDescription ?? "read")
    }
    if mp3.count < 7200 { mp3 = [UInt8](repeating: 0, count: 7200) }
    let tail = mp3.withUnsafeMutableBufferPointer { bytes in
      lame_encode_flush(lame, bytes.baseAddress, Int32(bytes.count))
    }
    if tail > 0 { file.write(Data(mp3[0..<Int(tail)])) }
    try? file.close()
    progress(jobId, 1)
    return try await Self.result(output)
  }

  /** 统一解成 48 kHz 双声道 Float PCM；按时间戳补静音，视频的声音不会被提前。 */
  private func readPcm(_ job: Job, uri: URL, consume: (UnsafePointer<Float>, Int) throws -> Void) async throws {
    let asset = AVURLAsset(url: uri)
    let (duration, tracks) = try await asset.load(.duration, .tracks)
    let audio = tracks.filter { $0.mediaType == .audio }
    guard !audio.isEmpty, duration.seconds > 0, duration.seconds.isFinite, duration.seconds < Double(Int.max) / 48000 else { throw MediaUnsupportedException("no audio") }
    let totalFrames = Int((duration.seconds * 48000).rounded())
    let reader = try AVAssetReader(asset: asset)
    let out = AVAssetReaderAudioMixOutput(audioTracks: audio, audioSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000.0, AVNumberOfChannelsKey: 2,
      AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
    ])
    guard reader.canAdd(out) else { throw MediaUnsupportedException("PCM reader") }
    reader.add(out)
    job.onCancel = { reader.cancelReading() }
    guard reader.startReading() else { throw MediaUnsupportedException(reader.error?.localizedDescription ?? "PCM read") }
    defer { if reader.status == .reading { reader.cancelReading() } }
    var cursor = 0
    let silence = [Float](repeating: 0, count: 16384)
    func pad(to frame: Int) throws {
      while cursor < frame {
        if job.cancelled { throw MediaCancelledException() }
        let count = min(frame - cursor, silence.count / 2)
        try silence.withUnsafeBufferPointer { try consume($0.baseAddress!, count) }
        cursor += count
      }
    }
    while let sample = out.copyNextSampleBuffer() {
      if job.cancelled { throw MediaCancelledException() }
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      let seconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
      guard seconds.isFinite else { throw MediaUnsupportedException("audio timestamp") }
      let start = Int((seconds * 48000).rounded())
      try pad(to: min(totalFrames, max(0, start)))
      var length = 0
      var data: UnsafeMutablePointer<Int8>?
      guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &data) == kCMBlockBufferNoErr, let data else { throw MediaFailedException("PCM buffer") }
      let skip = max(0, cursor - start)
      let frames = max(0, min(length / 8 - skip, totalFrames - cursor))
      if frames > 0 {
        let samples = UnsafeRawPointer(data).assumingMemoryBound(to: Float.self).advanced(by: skip * 2)
        try consume(samples, frames)
        cursor += frames
      }
    }
    if job.cancelled { throw MediaCancelledException() }
    if reader.status == .failed { throw MediaFailedException(reader.error?.localizedDescription ?? "PCM decode") }
    try pad(to: totalFrames)
  }

  private func adjustVolume(_ job: Job, jobId: String, uri: URL, output: URL, options: [String: Any]) async throws -> [String: Any] {
    let automatic = options["automatic"] as? Bool ?? true
    let db = (options["db"] as? NSNumber)?.doubleValue ?? 0
    guard db.isFinite, (-24...24).contains(db) else { throw MediaUnsupportedException("invalid gain") }
    guard let meter = morph_meter_create(48000, 2) else { throw MediaFailedException("loudness meter") }
    defer { morph_meter_destroy(meter) }
    try await readPcm(job, uri: uri) { samples, frames in
      if morph_meter_add_float(meter, samples, frames * 2) != 0 { throw MediaFailedException("loudness analysis") }
    }
    let gain = Float(morph_meter_gain(meter, automatic ? 1 : 0, db))
    progress(jobId, 0.25)
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    let pcm = output.appendingPathExtension("volume.caf")
    defer { try? FileManager.default.removeItem(at: pcm) }
    let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
    var writer: AVAudioFile? = try AVAudioFile(forWriting: pcm, settings: format.settings)
    try await readPcm(job, uri: uri) { samples, frames in
      guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)), let data = buffer.floatChannelData else { throw MediaFailedException("PCM allocation") }
      buffer.frameLength = AVAudioFrameCount(frames)
      for i in 0..<frames { for c in 0..<2 {
        let value = samples[i * 2 + c] * gain
        data[c][i] = value.isFinite ? min(1, max(-1, value)) : 0
      } }
      try writer!.write(from: buffer)
    }
    writer = nil
    progress(jobId, 0.5)
    return try await encodeProcessedAudio(job, jobId: jobId, uri: uri, pcm: pcm, output: output, options: options)
  }

  /** RNNoise 每次处理 10ms；丢掉前 20ms 算法延迟、补尾帧，保持原始时间轴。 */
  private func denoiseAudio(_ job: Job, jobId: String, uri: URL, output: URL, options: [String: Any]) async throws -> [String: Any] {
    guard let denoiser = morph_denoise_create(2) else { throw MediaFailedException("denoiser") }
    defer { morph_denoise_destroy(denoiser) }
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    let pcm = output.appendingPathExtension("denoise.caf")
    defer { try? FileManager.default.removeItem(at: pcm) }
    let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
    var writer: AVAudioFile? = try AVAudioFile(forWriting: pcm, settings: format.settings)
    var input = [Float](repeating: 0, count: 960)
    var filtered = input
    var filled = 0; var skip = 960; var total = 0; var written = 0
    func process() throws {
      if job.cancelled { throw MediaCancelledException() }
      let code = input.withUnsafeBufferPointer { source in filtered.withUnsafeMutableBufferPointer { target in morph_denoise_process(denoiser, source.baseAddress!, target.baseAddress!) } }
      guard code == 0 else { throw MediaFailedException("denoise frame") }
      let drop = min(480, skip); skip -= drop
      let frames = min(480 - drop, total - written)
      if frames > 0 {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)), let channels = buffer.floatChannelData else { throw MediaFailedException("PCM allocation") }
        buffer.frameLength = AVAudioFrameCount(frames)
        for i in 0..<frames { for c in 0..<2 { channels[c][i] = filtered[(i + drop)*2+c] } }
        try writer!.write(from: buffer); written += frames
      }
      filled = 0
    }
    try await readPcm(job, uri: uri) { samples, frames in
      total += frames
      var offset = 0
      while offset < frames {
        let count = min(480 - filled, frames - offset)
        for i in 0..<count*2 { input[filled*2+i] = samples[offset*2+i] }
        filled += count; offset += count
        if filled == 480 { try process() }
      }
    }
    if filled > 0 { for i in filled*2..<960 { input[i] = 0 }; try process() }
    input = [Float](repeating: 0, count: 960)
    for _ in 0..<2 { try process() }
    guard written == total else { throw MediaFailedException("denoise duration") }
    writer = nil
    progress(jobId, 0.5)
    return try await encodeProcessedAudio(job, jobId: jobId, uri: uri, pcm: pcm, output: output, options: options)
  }

  private func encodeProcessedAudio(_ job: Job, jobId: String, uri: URL, pcm: URL, output: URL, options: [String: Any]) async throws -> [String: Any] {
    var encode = options
    encode["container"] = "m4a"
    encode["audio"] = ["codec": "aac", "bitrateKbps": 192.0, "sampleRate": 48000.0, "channels": 2]
    if options["video"] is [String: Any] {
      encode["container"] = "mp4"; encode["originalVolume"] = 0; encode["loop"] = false
      return try await mixVideoAudio(job, jobId: jobId, uri: uri, music: pcm, output: output, options: encode)
    }
    encode["video"] = "drop"
    return try await transcode(job, jobId: jobId, uri: pcm, output: output, options: encode)
  }

  /** 变速同时缩放视频和音频的时间；varispeed 让声音按同样比例变调。 */
  private func speedVideo(_ job: Job, jobId: String, uri: URL, output: URL, options: [String: Any], factor: Double) async throws -> [String: Any] {
    guard factor.isFinite, (0.5...4).contains(factor) else { throw MediaUnsupportedException("invalid speed") }
    if job.cancelled { throw MediaCancelledException() }
    let source = AVURLAsset(url: uri)
    let tracks = try await source.load(.tracks)
    guard let video = tracks.first(where: { $0.mediaType == .video }) else { throw MediaUnsupportedException("no video") }
    let (range, transform) = try await video.load(.timeRange, .preferredTransform)
    guard range.duration.seconds > 0 else { throw MediaUnsupportedException("empty video") }
    let asset = AVMutableComposition()
    guard let target = asset.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("video track") }
    try target.insertTimeRange(range, of: video, at: .zero)
    target.preferredTransform = transform
    for audio in tracks where audio.mediaType == .audio {
      let audioRange = try await audio.load(.timeRange)
      let overlap = CMTimeRangeGetIntersection(range, otherRange: audioRange)
      if overlap.duration.seconds > 0 {
        guard let audioTarget = asset.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("audio track") }
        try audioTarget.insertTimeRange(overlap, of: audio, at: overlap.start - range.start)
      }
    }
    asset.scaleTimeRange(CMTimeRange(start: .zero, duration: range.duration),
                         toDuration: CMTime(seconds: range.duration.seconds / factor, preferredTimescale: 60000))
    return try await transcode(job, jobId: jobId, uri: uri, output: output, options: options, sourceAsset: asset, suppliedTimePitch: .varispeed)
  }

  /** 配乐在运行时由用户选；原音轨按指定比例混入，音乐可循环，输出时长始终跟随视频。 */
  private func mixVideoAudio(
    _ job: Job, jobId: String, uri: URL, music: URL, output: URL, options: [String: Any]
  ) async throws -> [String: Any] {
    let originalVolume = (options["originalVolume"] as? NSNumber)?.floatValue ?? 0
    let loop = options["loop"] as? Bool ?? true
    guard originalVolume.isFinite, (0...100).contains(originalVolume) else { throw MediaUnsupportedException("invalid original volume") }
    let source = AVURLAsset(url: uri)
    let tracks = try await source.load(.tracks)
    guard let video = tracks.first(where: { $0.mediaType == .video }) else { throw MediaUnsupportedException("no video") }
    let (range, transform) = try await video.load(.timeRange, .preferredTransform)
    guard range.duration.seconds > 0 else { throw MediaUnsupportedException("empty video") }
    let musicAsset = AVURLAsset(url: music)
    let musicTracks = try await musicAsset.load(.tracks)
    guard let musicTrack = musicTracks.first(where: { $0.mediaType == .audio }) else { throw MediaUnsupportedException("no music") }
    let musicRange = try await musicTrack.load(.timeRange)
    guard musicRange.duration.seconds > 0, musicRange.duration.seconds.isFinite else { throw MediaUnsupportedException("empty music") }
    let asset = AVMutableComposition()
    guard let videoTarget = asset.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
          let musicTarget = asset.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("composition track") }
    try videoTarget.insertTimeRange(range, of: video, at: .zero)
    videoTarget.preferredTransform = transform
    var gains: [AVAudioMixInputParameters] = []
    if originalVolume > 0, let original = tracks.first(where: { $0.mediaType == .audio }) {
      let originalRange = try await original.load(.timeRange)
      let overlap = CMTimeRangeGetIntersection(range, otherRange: originalRange)
      if overlap.duration.seconds > 0 {
        guard let originalTarget = asset.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("audio track") }
        try originalTarget.insertTimeRange(overlap, of: original, at: overlap.start - range.start)
        let gain = AVMutableAudioMixInputParameters(track: originalTarget)
        gain.setVolume(originalVolume / 100, at: .zero)
        gains.append(gain)
      }
    }
    var cursor = CMTime.zero
    repeat {
      if job.cancelled { throw MediaCancelledException() }
      let length = CMTimeMinimum(musicRange.duration, range.duration - cursor)
      try musicTarget.insertTimeRange(CMTimeRange(start: musicRange.start, duration: length), of: musicTrack, at: cursor)
      cursor = cursor + length
    } while loop && cursor < range.duration
    let musicGain = AVMutableAudioMixInputParameters(track: musicTarget)
    musicGain.setVolume(1, at: .zero)
    gains.append(musicGain)
    let mix = AVMutableAudioMix()
    mix.inputParameters = gains
    return try await transcode(job, jobId: jobId, uri: uri, output: output, options: options, sourceAsset: asset, suppliedAudioMix: mix)
  }

  /** 视频首尾拼接：每段独立摆正并按第一段画布等比留边；无声片段不插入音轨。 */
  private func concatVideo(
    _ job: Job, jobId: String, uris: [URL], output: URL, options: [String: Any]
  ) async throws -> [String: Any] {
    guard (2...10).contains(uris.count), let videoOptions = options["video"] as? [String: Any] else {
      throw MediaUnsupportedException("expected 2–10 video clips")
    }
    let width = (videoOptions["width"] as? NSNumber)?.intValue ?? 0
    let height = (videoOptions["height"] as? NSNumber)?.intValue ?? 0
    let fps = (videoOptions["maxFps"] as? NSNumber)?.doubleValue ?? 30
    guard width > 0, height > 0, width % 2 == 0, height % 2 == 0, fps > 0, fps.isFinite else {
      throw MediaUnsupportedException("invalid output dimensions or frame rate")
    }
    let asset = AVMutableComposition()
    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: width, height: height)
    composition.frameDuration = CMTime(seconds: 1 / fps, preferredTimescale: 60000)
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    var instructions: [AVVideoCompositionInstructionProtocol] = []
    var cursor = CMTime.zero
    for uri in uris {
      if job.cancelled { throw MediaCancelledException() }
      let sourceAsset = AVURLAsset(url: uri)
      let sourceTracks = try await sourceAsset.load(.tracks)
      guard let source = sourceTracks.first(where: { $0.mediaType == .video }),
            let target = asset.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw MediaUnsupportedException("no video")
      }
      let (range, natural, transform) = try await source.load(.timeRange, .naturalSize, .preferredTransform)
      guard range.duration.seconds > 0, range.duration.seconds.isFinite else { throw MediaUnsupportedException("empty video") }
      try target.insertTimeRange(range, of: source, at: cursor)
      let bounds = CGRect(origin: .zero, size: natural).applying(transform)
      guard bounds.width > 0, bounds.height > 0 else { throw MediaUnsupportedException("empty frame") }
      let scale = min(CGFloat(width) / bounds.width, CGFloat(height) / bounds.height)
      let position = transform
        .concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
        .concatenating(CGAffineTransform(scaleX: scale, y: scale))
        .concatenating(CGAffineTransform(translationX: (CGFloat(width) - bounds.width * scale) / 2,
                                       y: (CGFloat(height) - bounds.height * scale) / 2))
      let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: target)
      layer.setTransform(position, at: cursor)
      let instruction = AVMutableVideoCompositionInstruction()
      instruction.timeRange = CMTimeRange(start: cursor, duration: range.duration)
      instruction.backgroundColor = UIColor.black.cgColor
      instruction.layerInstructions = [layer]
      instructions.append(instruction)
      if options["audio"] as? String != "drop", let audio = sourceTracks.first(where: { $0.mediaType == .audio }) {
        let audioRange = try await audio.load(.timeRange)
        let overlap = CMTimeRangeGetIntersection(range, otherRange: audioRange)
        if overlap.duration.seconds > 0 {
          guard let audioTarget = asset.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("audio track") }
          try audioTarget.insertTimeRange(overlap, of: audio, at: cursor + overlap.start - range.start)
        }
      }
      cursor = cursor + range.duration
    }
    composition.instructions = instructions
    return try await transcode(job, jobId: jobId, uri: uris[0], output: output, options: options,
                               sourceAsset: asset, suppliedComposition: composition)
  }

  /** 几段接成一段：每段放进合成里自己的一路，首尾相接，读的时候混成一路（格式、采样率可以不同）。 */
  private func concat(
    _ job: Job, jobId: String, uris: [URL], output: URL, options: [String: Any]
  ) async throws -> [String: Any] {
    if options["video"] is [String: Any] {
      return try await concatVideo(job, jobId: jobId, uris: uris, output: output, options: options)
    }
    let composition = AVMutableComposition()
    var tracks: [AVAssetTrack] = []
    var cursor = CMTime.zero
    for uri in uris {
      let asset = AVURLAsset(url: uri)
      let (duration, sourceTracks) = try await asset.load(.duration, .tracks)
      guard let source = sourceTracks.first(where: { $0.mediaType == .audio }) else {
        throw MediaUnsupportedException("no audio: \(uri.lastPathComponent)")
      }
      guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw MediaFailedException("composition track")
      }
      do {
        try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: cursor)
      } catch {
        throw MediaUnsupportedException(error.localizedDescription)
      }
      tracks.append(track)
      cursor = cursor + duration
    }
    return try await writeAudio(
      job, jobId: jobId, asset: composition, tracks: tracks,
      timeRange: CMTimeRange(start: .zero, duration: cursor), output: output,
      container: options["container"] as? String ?? "m4a", audio: options["audio"] as? [String: Any] ?? [:])
  }

  /** 波形：解成 8 kHz 单声道，每一份取最大的音量，再按最响的一份归一到 0–1。 */
  static func waveform(_ uri: URL, buckets: Int, range: [String: Double]?) async throws -> [Double] {
    let asset = AVURLAsset(url: uri)
    let (duration, tracks) = try await asset.load(.duration, .tracks)
    let audio = tracks.filter { $0.mediaType == .audio }
    if audio.isEmpty || buckets <= 0 { throw MediaUnsupportedException("no audio") }
    var timeRange = CMTimeRange(start: .zero, duration: duration)
    if let range, let start = range["startMs"], let end = range["endMs"] {
      timeRange = CMTimeRange(
        start: CMTime(seconds: start / 1000, preferredTimescale: 600),
        end: CMTime(seconds: end / 1000, preferredTimescale: 600))
    }
    let rate = 8000.0
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = timeRange
    let out = AVAssetReaderAudioMixOutput(
      audioTracks: audio,
      audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: rate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ])
    guard reader.canAdd(out) else { throw MediaUnsupportedException("waveform output") }
    reader.add(out)
    guard reader.startReading() else {
      throw MediaUnsupportedException(reader.error?.localizedDescription ?? "reader")
    }
    let total = max(1, Int(timeRange.duration.seconds * rate))
    var peaks = [Double](repeating: 0, count: buckets)
    var index = 0
    while let sample = out.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      let length = CMBlockBufferGetDataLength(block)
      var data = Data(count: length)
      data.withUnsafeMutableBytes { raw in
        _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
      }
      data.withUnsafeBytes { raw in
        for value in raw.bindMemory(to: Int16.self) {
          let bucket = min(buckets - 1, index * buckets / total)
          peaks[bucket] = max(peaks[bucket], abs(Double(value)) / 32768)
          index += 1
        }
      }
    }
    let loudest = peaks.max() ?? 0
    return loudest > 0 ? peaks.map { $0 / loudest } : peaks
  }

  // MARK: - GIF（D-184）

  private static func gifDestination(_ output: URL, frames: Int) throws -> CGImageDestination {
    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(
      at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.gif.identifier as CFString, frames, nil)
    else { throw MediaFailedException("gif destination") }
    CGImageDestinationSetProperties(
      dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
    return dest
  }

  private static func gifFrame(delay: Double) -> CFDictionary {
    [kCGImagePropertyGIFDictionary: [
      kCGImagePropertyGIFDelayTime: delay, kCGImagePropertyGIFUnclampedDelayTime: delay,
    ]] as CFDictionary
  }

  private static func gifResult(_ output: URL, width: Int, height: Int, frames: Int) -> [String: Any] {
    ["uri": output.absoluteString, "size": fileSize(output), "width": width, "height": height, "frames": frames]
  }

  /** 视频 → GIF：从头到尾按 fps 取画面（已摆正，宽度不超过 width），整段都要（长度由调用方先检查）。 */
  private func videoGif(
    _ job: Job, jobId: String, uri: URL, output: URL, options: [String: Double]
  ) async throws -> [String: Any] {
    let width = options["width"] ?? 480
    let fps = max(1, options["fps"] ?? 12)
    let asset = AVURLAsset(url: uri)
    let (duration, tracks) = try await asset.load(.duration, .tracks)
    guard tracks.contains(where: { $0.mediaType == .video }) else { throw MediaUnsupportedException("no video") }
    let count = max(1, Int(duration.seconds * fps))
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // 宽度不超过 width，高度不限（竖着的视频按宽度缩）。
    generator.maximumSize = CGSize(width: width, height: width * 20)
    let tolerance = CMTime(seconds: 0.5 / fps, preferredTimescale: 600)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
    let dest = try Self.gifDestination(output, frames: count)
    let props = Self.gifFrame(delay: 1 / fps)
    var size = CGSize.zero
    for i in 0..<count {
      if job.cancelled { throw MediaCancelledException() }
      let image: CGImage
      do {
        image = try await generator.image(at: CMTime(seconds: Double(i) / fps, preferredTimescale: 600)).image
      } catch {
        if i == 0 { throw MediaUnsupportedException(error.localizedDescription) }
        continue
      }
      if i == 0 { size = CGSize(width: image.width, height: image.height) }
      CGImageDestinationAddImage(dest, image, props)
      progress(jobId, Double(i + 1) / Double(count) * 0.9)
    }
    guard CGImageDestinationFinalize(dest) else { throw MediaFailedException("gif finalize") }
    progress(jobId, 1)
    return Self.gifResult(output, width: Int(size.width), height: Int(size.height), frames: count)
  }

  /** 图片 → GIF：画布是第一张（长边缩到 maxSide），每张按比例放进画布居中，空的地方白色。 */
  private func imagesGif(
    _ job: Job, jobId: String, uris: [URL], output: URL, options: [String: Double]
  ) throws -> [String: Any] {
    let maxSide = options["maxSide"] ?? 480
    let delay = (options["delayMs"] ?? 500) / 1000
    func load(_ url: URL) throws -> CGImage {
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateThumbnailAtIndex(
          source, 0,
          [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
          ] as CFDictionary)
      else { throw MediaUnsupportedException(url.lastPathComponent) }
      return image
    }
    guard let first = uris.first else { throw MediaFailedException("no images") }
    let firstImage = try load(first)
    let canvas = CGSize(width: firstImage.width, height: firstImage.height)
    let dest = try Self.gifDestination(output, frames: uris.count)
    let props = Self.gifFrame(delay: delay)
    guard
      let context = CGContext(
        data: nil, width: Int(canvas.width), height: Int(canvas.height), bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw MediaFailedException("gif canvas") }
    for (i, url) in uris.enumerated() {
      if job.cancelled { throw MediaCancelledException() }
      let image = i == 0 ? firstImage : try load(url)
      let scale = min(canvas.width / CGFloat(image.width), canvas.height / CGFloat(image.height))
      let w = CGFloat(image.width) * scale
      let h = CGFloat(image.height) * scale
      context.setFillColor(UIColor.white.cgColor)
      context.fill(CGRect(origin: .zero, size: canvas))
      context.interpolationQuality = .high
      context.draw(image, in: CGRect(x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, width: w, height: h))
      guard let frame = context.makeImage() else { throw MediaFailedException("gif frame") }
      CGImageDestinationAddImage(dest, frame, props)
      progress(jobId, Double(i + 1) / Double(uris.count) * 0.9)
    }
    guard CGImageDestinationFinalize(dest) else { throw MediaFailedException("gif finalize") }
    progress(jobId, 1)
    return Self.gifResult(output, width: Int(canvas.width), height: Int(canvas.height), frames: uris.count)
  }

  /** iOS 只改容器里的方向信息，编码样本原样保留。 */
  private func rotateVideo(_ job: Job, jobId: String, uri: URL, output: URL, degrees: Int) async throws -> [String: Any] {
    guard [90, 180, 270].contains(degrees) else { throw MediaUnsupportedException("invalid rotation") }
    if job.cancelled { throw MediaCancelledException() }
    let source = AVURLAsset(url: uri)
    let tracks = try await source.load(.tracks)
    guard let video = tracks.first(where: { $0.mediaType == .video }) else { throw MediaUnsupportedException("no video") }
    let (range, natural, transform) = try await video.load(.timeRange, .naturalSize, .preferredTransform)
    let asset = AVMutableComposition()
    guard let target = asset.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("video track") }
    try target.insertTimeRange(range, of: video, at: .zero)
    let rotated = transform.concatenating(CGAffineTransform(rotationAngle: CGFloat(degrees) * .pi / 180))
    let bounds = CGRect(origin: .zero, size: natural).applying(rotated)
    target.preferredTransform = rotated.concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
    for audio in tracks where audio.mediaType == .audio {
      let audioRange = try await audio.load(.timeRange)
      let overlap = CMTimeRangeGetIntersection(range, otherRange: audioRange)
      if overlap.duration.seconds > 0 {
        guard let audioTarget = asset.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw MediaFailedException("audio track") }
        try audioTarget.insertTimeRange(overlap, of: audio, at: overlap.start - range.start)
      }
    }
    return try await trim(job, jobId: jobId, uri: uri, output: output, range: ["startMs": 0, "endMs": range.duration.seconds * 1000], sourceAsset: asset)
  }

  // MARK: - trim

  private func trim(
    _ job: Job, jobId: String, uri: URL, output: URL, range: [String: Double], sourceAsset: AVAsset? = nil
  ) async throws -> [String: Any] {
    guard let startMs = range["startMs"], let endMs = range["endMs"], endMs > startMs else {
      throw MediaFailedException("range")
    }
    let asset: AVAsset = sourceAsset ?? AVURLAsset(url: uri)
    let timeRange = CMTimeRange(
      start: CMTime(seconds: startMs / 1000, preferredTimescale: 600),
      end: CMTime(seconds: endMs / 1000, preferredTimescale: 600))
    try? FileManager.default.createDirectory(
      at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    // 先按要求的容器（一般是 MP4）；原来的声音放不进 MP4（例如 PCM）时改成 MOV。
    var targets = [output]
    if output.pathExtension.lowercased() == "mp4" {
      targets.append(output.deletingPathExtension().appendingPathExtension("mov"))
    }
    var lastError: Error?
    for target in targets {
      if job.cancelled { throw MediaCancelledException() }
      do {
        try await export(job, jobId: jobId, asset: asset, range: timeRange, to: target)
        progress(jobId, 1)
        return try await Self.result(target)
      } catch let error as MediaCancelledException {
        throw error
      } catch {
        lastError = error
      }
    }
    throw lastError ?? MediaFailedException("trim")
  }

  private func export(_ job: Job, jobId: String, asset: AVAsset, range: CMTimeRange, to url: URL) async throws {
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
      throw MediaUnsupportedException("export")
    }
    let type: AVFileType
    switch url.pathExtension.lowercased() {
    case "mov": type = .mov
    case "m4a": type = .m4a
    default: type = .mp4
    }
    guard session.supportedFileTypes.contains(type) else {
      throw MediaUnsupportedException("container \(type.rawValue)")
    }
    try? FileManager.default.removeItem(at: url)
    session.outputURL = url
    session.outputFileType = type
    session.timeRange = range
    session.shouldOptimizeForNetworkUse = true
    job.onCancel = { session.cancelExport() }
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { self.progress(jobId, Double(session.progress)) }
    timer.resume()
    defer { timer.cancel() }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { continuation.resume() }
    }
    switch session.status {
    case .completed:
      return
    case .cancelled:
      if job.backgrounded && !job.cancelled { throw MediaInterruptedException() }
      throw MediaCancelledException()
    default:
      if job.backgrounded { throw MediaInterruptedException() }
      throw MediaFailedException(session.error?.localizedDescription ?? "export")
    }
  }

  // MARK: - thumbnails

  static func thumbnails(_ uri: URL, timesMs: [Double], maxSide: Double, directory: URL, precise: Bool = false) async throws -> [String] {
    let asset = AVURLAsset(url: uri)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: maxSide, height: maxSide)
    // 时间轴上的缩略图不需要准确到帧，放宽一点快很多。
    let tolerance = precise ? CMTime.zero : CMTime(seconds: 0.5, preferredTimescale: 600)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var uris: [String] = []
    for ms in timesMs {
      let time = CMTime(seconds: ms / 1000, preferredTimescale: 600)
      let image: CGImage
      do {
        image = try await generator.image(at: time).image
      } catch {
        throw MediaUnsupportedException(error.localizedDescription)
      }
      guard let data = UIImage(cgImage: image).jpegData(compressionQuality: precise ? 0.95 : 0.7) else {
        throw MediaFailedException("jpeg")
      }
      let file = directory.appendingPathComponent("\(UUID().uuidString).jpg")
      try data.write(to: file)
      uris.append(file.absoluteString)
    }
    return uris
  }
}
