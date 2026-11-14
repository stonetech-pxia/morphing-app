// Node 里跑 App 代码时替代 expo-localization：语言由用例参数给定，不读系统语言。
exports.getLocales = () => [{ languageTag: 'en-US', languageCode: 'en' }];
exports.getCalendars = () => [{ timeZone: 'UTC' }];
