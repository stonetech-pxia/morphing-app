import { requireOptionalNativeModule } from 'expo';

// 本地 Expo 模块 MorphBackground（D-160–D-163）：长任务（视频、音频）切到别的 App 也继续。
// Android 是 android/…/MorphBackgroundService.kt（前台服务 + 进度通知）；iOS 是 ios/MorphBackgroundModule.swift
// （iOS 26 的 BGContinuedProcessingTask，默认关着，continuesInBackground 为 false）。Expo Go 和测试里是 null。

export interface MorphBackgroundModule {
  /** 切到别的 App 时长任务会不会继续（Android 总是 true；iOS 只有打开了实验开关、iOS 26 起才是 true）。 */
  readonly continuesInBackground: boolean;
  /** Android 13 起：没允许过通知就问一次，以后不再问（D-161）。返回现在能不能发通知。 */
  ensureNotificationPermission(): Promise<boolean>;
  /** 开始保活并显示进度通知；系统不让开始时返回 false（例如 App 已经在后台）。 */
  begin(title: string, text: string): boolean;
  /** 更新进度通知；fraction 为 null 时进度条不定。 */
  update(text: string, fraction: number | null): void;
  /** 结束保活；done 不为 null 时发一条完成通知（只有 Android）。 */
  end(done: { title: string; body: string } | null): void;
  /**
   * iOS：系统在后台拉起 App（提醒通知上的按钮，D-318）时模块先要了一段后台时间，处理完调这个还掉。
   * Android 什么也不做。
   */
  releaseLaunch(): void;
}

export default requireOptionalNativeModule<MorphBackgroundModule>('MorphBackground');
