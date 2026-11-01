const { withGradleProperties } = require('expo/config-plugins');

// Android 上 llama.rn 从源码编译：预编译的库会把提示词的 token 写进 logcat，能还原成识别出的文字（底线 1、2）。
// 补丁在 patches/llama.rn+0.12.9.patch；iOS 不受这个开关影响。
// 这样编译后 Gradle 默认的 2 GB 不够 R8 用（OutOfMemoryError），所以一起调大。
module.exports = (config) =>
  withGradleProperties(config, (next) => {
    const set = {
      rnllamaBuildFromSource: 'true',
      'org.gradle.jvmargs': '-Xmx5g -XX:MaxMetaspaceSize=1g',
    };
    next.modResults = next.modResults.filter(
      (item) => !(item.type === 'property' && item.key in set),
    );
    for (const [key, value] of Object.entries(set))
      next.modResults.push({ type: 'property', key, value });
    return next;
  });
