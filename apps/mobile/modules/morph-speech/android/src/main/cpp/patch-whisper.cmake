# 给下载下来的 whisper.cpp 打一个小补丁（FetchContent 的 PATCH_COMMAND，在源码目录里运行）。
#
# whisper 在一个 30 秒窗口里只说出一句、以单个时间戳结束时，按原来的规则认为「后面没人说话」，跳过窗口剩下的部分。
# 我们开了语音检测，送进去的只有有人说话的部分，这个假设不成立：三星 SM-S948B 上 5 分钟的会议录音一次漏掉约 1 分钟的话，
# Mac 上同样的版本也会漏 15–30 秒。改成从最后一个时间戳接着识别（至少往前 1 秒，避免原地打转）。
# 换 whisper.cpp 版本时先确认这一行还在；找不到就让构建失败，不悄悄跳过。
set(file src/whisper.cpp)
file(READ ${file} text)
set(old "if (single_timestamp_ending) {")
set(new "if (single_timestamp_ending && !(params.vad && seek_delta >= 100)) {")
string(FIND "${text}" "${new}" done)
if(done EQUAL -1)
  string(FIND "${text}" "${old}" found)
  if(found EQUAL -1)
    message(FATAL_ERROR "patch-whisper.cmake: '${old}' not found in ${file}")
  endif()
  string(REPLACE "${old}" "${new}" text "${text}")
  file(WRITE ${file} "${text}")
endif()
